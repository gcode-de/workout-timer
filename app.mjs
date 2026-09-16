import { formatDuration, PHASES, WorkoutSequence } from './timer-core.mjs';

const ACTIVE_CONFIG_KEY = 'workoutTimerActiveConfig';
const CONFIGURATIONS_KEY = 'workoutTimerConfigurations';
const defaultConfig = {
    workMs: 20_000,
    restMs: 10_000,
    pauseMs: 120_000,
    rounds: 8,
    sets: 3
};

const builtInConfigurations = [
    { id: 'tabata', name: 'Classic Tabata', workMs: 20_000, restMs: 10_000, pauseMs: 60_000, rounds: 8, sets: 1 },
    { id: 'cardio', name: 'Cardio Intervals', workMs: 60_000, restMs: 30_000, pauseMs: 120_000, rounds: 10, sets: 2 },
    { id: 'strength', name: 'Strength Training', workMs: 45_000, restMs: 75_000, pauseMs: 180_000, rounds: 4, sets: 3 }
];

function isValidConfiguration(value) {
    return value
        && ['workMs', 'restMs', 'pauseMs'].every((key) => Number.isFinite(value[key]) && value[key] >= 1_000)
        && ['rounds', 'sets'].every((key) => Number.isInteger(value[key]) && value[key] >= 1);
}

function loadActiveConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(ACTIVE_CONFIG_KEY));
        return isValidConfiguration(saved) ? { ...defaultConfig, ...saved } : { ...defaultConfig };
    } catch {
        return { ...defaultConfig };
    }
}

function loadCustomConfigurations() {
    try {
        const saved = JSON.parse(localStorage.getItem(CONFIGURATIONS_KEY));
        return Array.isArray(saved)
            ? saved.filter((item) => typeof item.name === 'string' && item.name.trim() && isValidConfiguration(item))
            : [];
    } catch {
        return [];
    }
}

const config = loadActiveConfig();
let customConfigurations = loadCustomConfigurations();

const sequence = new WorkoutSequence(config);
const alarm = new Audio('./alarm.mp3');
const shortAlarm = new Audio('./alarm_short.mp3');
const PREFERENCES_KEY = 'workoutTimerPreferences';
const defaultPreferences = {
    theme: 'system',
    vibration: true,
    keepAwake: true
};

function loadPreferences() {
    try {
        const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
        return { ...defaultPreferences, ...saved };
    } catch {
        return { ...defaultPreferences };
    }
}

let preferences = loadPreferences();

const elements = {
    workDuration: document.querySelector('#workDuration'),
    restDuration: document.querySelector('#restDuration'),
    pauseDuration: document.querySelector('#pauseDuration'),
    rounds: document.querySelector('#rounds'),
    sets: document.querySelector('#sets'),
    roundCounter: document.querySelector('#roundCounter'),
    status: document.querySelector('#status'),
    timer: document.querySelector('#timer'),
    progress: document.querySelector('#progress'),
    primaryButton: document.querySelector('#primaryButton'),
    primaryIcon: document.querySelector('#primaryIcon'),
    primaryLabel: document.querySelector('#primaryLabel'),
    stopButton: document.querySelector('#stopButton'),
    settingButtons: [...document.querySelectorAll('[data-setting]')],
    settingsDialog: document.querySelector('#settingsDialog'),
    openSettingsButton: document.querySelector('#openSettingsButton'),
    closeSettingsButton: document.querySelector('#closeSettingsButton'),
    themeSetting: document.querySelector('#themeSetting'),
    vibrationSetting: document.querySelector('#vibrationSetting'),
    vibrationSupport: document.querySelector('#vibrationSupport'),
    wakeLockSetting: document.querySelector('#wakeLockSetting'),
    wakeLockSupport: document.querySelector('#wakeLockSupport'),
    configurationSelect: document.querySelector('#configurationSelect'),
    loadConfigurationButton: document.querySelector('#loadConfigurationButton'),
    deleteConfigurationButton: document.querySelector('#deleteConfigurationButton'),
    configurationName: document.querySelector('#configurationName'),
    saveConfigurationForm: document.querySelector('#saveConfigurationForm'),
    configurationMessage: document.querySelector('#configurationMessage'),
    configurationControls: [...document.querySelectorAll('[data-configuration-control]')]
};

let mode = 'idle';
let intervalId = null;
let remainingMs = sequence.duration;
let phaseEndsAt = 0;
let lastCountdownSecond = null;
let audioUnlocked = false;
let wakeLock = null;

function savePreferences() {
    try {
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {}
}

function saveActiveConfig() {
    try {
        localStorage.setItem(ACTIVE_CONFIG_KEY, JSON.stringify(config));
    } catch {}
}

function saveCustomConfigurations() {
    try {
        localStorage.setItem(CONFIGURATIONS_KEY, JSON.stringify(customConfigurations));
    } catch {}
}

function applyTheme() {
    if (preferences.theme === 'system') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = preferences.theme;
    }

    const light = preferences.theme === 'light'
        || (preferences.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.querySelector('#themeColor').content = light ? '#f4f5fb' : '#0b0c0f';
}

function vibrate(pattern) {
    if (preferences.vibration && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
    }
}

function updateCapabilityLabels() {
    if (!('vibrate' in navigator)) {
        elements.vibrationSetting.disabled = true;
        elements.vibrationSupport.textContent = 'Vibration is not supported by this device.';
    }

    if (!('wakeLock' in navigator)) {
        elements.wakeLockSetting.disabled = true;
        elements.wakeLockSupport.textContent = 'Screen wake lock is not supported by this browser.';
    } else if (wakeLock) {
        elements.wakeLockSupport.textContent = 'The screen will stay awake during this workout.';
    } else {
        elements.wakeLockSupport.textContent = 'Prevent the display from sleeping during a workout.';
    }
}

async function acquireWakeLock() {
    if (!preferences.keepAwake || mode !== 'running' || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator) || wakeLock) return;

    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
            wakeLock = null;
            updateCapabilityLabels();
        }, { once: true });
    } catch {
        wakeLock = null;
    }
    updateCapabilityLabels();
}

async function releaseWakeLock() {
    if (!wakeLock) return;
    const currentLock = wakeLock;
    wakeLock = null;
    await currentLock.release().catch(() => {});
    updateCapabilityLabels();
}

function safelyPlay(audio) {
    audio.currentTime = 0;
    const result = audio.play();
    result?.catch(() => {});
}

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    for (const audio of [alarm, shortAlarm]) {
        const previousVolume = audio.volume;
        audio.volume = 0;
        const result = audio.play();

        result?.then(() => {
            audio.pause();
            audio.currentTime = 0;
            audio.volume = previousVolume;
        }).catch(() => {
            audio.volume = previousVolume;
        });
    }
}

function updateSettings() {
    elements.workDuration.textContent = `work ${formatDuration(config.workMs)}`;
    elements.restDuration.textContent = `rest ${formatDuration(config.restMs)}`;
    elements.pauseDuration.textContent = `pause ${formatDuration(config.pauseMs)}`;
    elements.rounds.textContent = `${config.rounds} ${config.rounds === 1 ? 'round' : 'rounds'}`;
    elements.sets.textContent = `${config.sets} ${config.sets === 1 ? 'set' : 'sets'}`;
}

function updatePhaseDisplay() {
    const { phase, round, rounds, set, sets } = sequence.snapshot();
    elements.status.textContent = mode === 'idle' ? 'READY' : mode === 'complete' ? 'DONE' : phase.toUpperCase();
    if (phase === PHASES.COMPLETE) {
        elements.roundCounter.textContent = 'workout complete';
    } else if (phase === PHASES.PAUSE) {
        elements.roundCounter.textContent = `set ${set} of ${sets} complete`;
    } else {
        elements.roundCounter.textContent = `set ${set} of ${sets} · round ${round} of ${rounds}`;
    }
}

function updateTimerDisplay() {
    const duration = sequence.duration;
    const progress = mode === 'complete' ? 1 : duration > 0 ? 1 - (remainingMs / duration) : 0;
    elements.timer.textContent = formatDuration(remainingMs);
    elements.progress.value = Math.min(1, Math.max(0, progress));
    elements.progress.setAttribute('aria-valuetext', `${Math.round(progress * 100)}%`);
}

function updateControls() {
    const isRunning = mode === 'running';
    const workoutActive = mode === 'running' || mode === 'paused';
    const workoutComplete = mode === 'complete';

    elements.primaryIcon.textContent = isRunning ? 'Ⅱ' : '▶';
    elements.primaryLabel.textContent = isRunning ? 'Pause' : workoutComplete ? 'Restart' : workoutActive ? 'Resume' : 'Start';
    elements.primaryButton.setAttribute('aria-label', elements.primaryLabel.textContent);
    elements.stopButton.hidden = !workoutActive;
    elements.settingButtons.forEach((button) => {
        button.disabled = workoutActive;
    });
    elements.configurationControls.forEach((control) => {
        control.disabled = workoutActive;
    });
    updateDeleteConfigurationButton();
}

function render() {
    updatePhaseDisplay();
    updateTimerDisplay();
    updateControls();
}

function announceCountdown() {
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds >= 1 && seconds <= 3 && seconds !== lastCountdownSecond) {
        lastCountdownSecond = seconds;
        safelyPlay(shortAlarm);
        vibrate(40);
    }
}

function finishWorkout() {
    mode = 'complete';
    remainingMs = 0;
    clearInterval(intervalId);
    intervalId = null;
    releaseWakeLock();
}

function syncExpiredPhases(now) {
    if (now < phaseEndsAt) return false;

    safelyPlay(alarm);
    vibrate([160, 80, 160]);
    do {
        sequence.next();
        if (sequence.phase === PHASES.COMPLETE) {
            finishWorkout();
            return true;
        }
        phaseEndsAt += sequence.duration;
    } while (now >= phaseEndsAt);

    lastCountdownSecond = null;
    return false;
}

function tick() {
    const now = Date.now();
    if (syncExpiredPhases(now)) {
        render();
        return;
    }
    remainingMs = Math.max(0, phaseEndsAt - now);
    announceCountdown();
    render();
}

function startTimer() {
    if (mode === 'running') return;

    if (mode === 'complete') {
        sequence.reset();
        remainingMs = sequence.duration;
    }

    unlockAudio();
    mode = 'running';
    phaseEndsAt = Date.now() + remainingMs;
    lastCountdownSecond = null;
    clearInterval(intervalId);
    intervalId = window.setInterval(tick, 200);
    acquireWakeLock();
    render();
}

function pauseTimer() {
    const now = Date.now();
    if (syncExpiredPhases(now)) {
        render();
        return;
    }
    remainingMs = Math.max(0, phaseEndsAt - now);
    mode = 'paused';
    clearInterval(intervalId);
    intervalId = null;
    releaseWakeLock();
    render();
}

function stopTimer() {
    clearInterval(intervalId);
    intervalId = null;
    mode = 'idle';
    sequence.reset();
    remainingMs = sequence.duration;
    lastCountdownSecond = null;
    releaseWakeLock();
    elements.progress.value = 0;
    render();
    elements.timer.textContent = '00:00';
}

function changeSetting(name, amount) {
    if (mode !== 'idle') return;

    const minimum = name === 'rounds' || name === 'sets' ? 1 : amount < 0 ? Math.abs(amount) : 1_000;
    config[name] = Math.max(minimum, config[name] + amount);
    sequence.updateConfig(config);
    sequence.reset();
    remainingMs = sequence.duration;
    saveActiveConfig();
    updateSettings();
}

function renderConfigurationOptions(selectedId = '') {
    elements.configurationSelect.replaceChildren();

    const builtInGroup = document.createElement('optgroup');
    builtInGroup.label = 'Built-in';
    for (const item of builtInConfigurations) {
        const option = new Option(item.name, `built-in:${item.id}`);
        builtInGroup.append(option);
    }
    elements.configurationSelect.append(builtInGroup);

    if (customConfigurations.length > 0) {
        const customGroup = document.createElement('optgroup');
        customGroup.label = 'My configurations';
        for (const item of customConfigurations) {
            const option = new Option(item.name, `custom:${item.id}`);
            customGroup.append(option);
        }
        elements.configurationSelect.append(customGroup);
    }

    if (selectedId) elements.configurationSelect.value = selectedId;
    updateDeleteConfigurationButton();
}

function selectedConfiguration() {
    const [type, id] = elements.configurationSelect.value.split(':');
    const source = type === 'custom' ? customConfigurations : builtInConfigurations;
    return source.find((item) => item.id === id);
}

function updateDeleteConfigurationButton() {
    const workoutActive = mode === 'running' || mode === 'paused';
    elements.deleteConfigurationButton.disabled = workoutActive
        || !elements.configurationSelect.value.startsWith('custom:');
}

function applyConfiguration(item) {
    if (!item || mode === 'running' || mode === 'paused') return;
    for (const key of ['workMs', 'restMs', 'pauseMs', 'rounds', 'sets']) {
        config[key] = item[key];
    }
    sequence.updateConfig(config);
    sequence.reset();
    mode = 'idle';
    remainingMs = sequence.duration;
    saveActiveConfig();
    updateSettings();
    render();
    elements.timer.textContent = '00:00';
    elements.configurationMessage.textContent = `Loaded “${item.name}”.`;
}

function saveNamedConfiguration(name) {
    const cleanName = name.trim();
    if (!cleanName) return;

    let item = customConfigurations.find((entry) => entry.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    if (item) {
        Object.assign(item, config, { name: cleanName });
    } else {
        item = {
            id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
            name: cleanName,
            ...config
        };
        customConfigurations.push(item);
    }

    saveCustomConfigurations();
    renderConfigurationOptions(`custom:${item.id}`);
    elements.configurationName.value = '';
    elements.configurationMessage.textContent = `Saved “${cleanName}”.`;
}

elements.settingButtons.forEach((button) => {
    button.addEventListener('click', () => {
        changeSetting(button.dataset.setting, Number(button.dataset.change));
    });
});

elements.primaryButton.addEventListener('click', () => {
    if (mode === 'running') pauseTimer();
    else startTimer();
});

elements.stopButton.addEventListener('click', stopTimer);

elements.openSettingsButton.addEventListener('click', () => {
    elements.settingsDialog.showModal();
});

elements.closeSettingsButton.addEventListener('click', () => {
    elements.settingsDialog.close();
});

elements.themeSetting.addEventListener('change', () => {
    preferences.theme = elements.themeSetting.value;
    applyTheme();
    savePreferences();
});

elements.vibrationSetting.addEventListener('change', () => {
    preferences.vibration = elements.vibrationSetting.checked;
    savePreferences();
    if (preferences.vibration) vibrate(40);
});

elements.wakeLockSetting.addEventListener('change', () => {
    preferences.keepAwake = elements.wakeLockSetting.checked;
    savePreferences();
    if (preferences.keepAwake) acquireWakeLock();
    else releaseWakeLock();
});

elements.configurationSelect.addEventListener('change', () => {
    updateDeleteConfigurationButton();
    elements.configurationMessage.textContent = '';
});

elements.loadConfigurationButton.addEventListener('click', () => {
    applyConfiguration(selectedConfiguration());
});

elements.deleteConfigurationButton.addEventListener('click', () => {
    const [type, id] = elements.configurationSelect.value.split(':');
    if (type !== 'custom') return;
    const item = customConfigurations.find((entry) => entry.id === id);
    customConfigurations = customConfigurations.filter((entry) => entry.id !== id);
    saveCustomConfigurations();
    renderConfigurationOptions();
    elements.configurationMessage.textContent = item ? `Deleted “${item.name}”.` : '';
});

elements.saveConfigurationForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveNamedConfiguration(elements.configurationName.value);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mode === 'running') {
        tick();
        acquireWakeLock();
    }
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
}

elements.themeSetting.value = preferences.theme;
elements.vibrationSetting.checked = preferences.vibration;
elements.wakeLockSetting.checked = preferences.keepAwake;
applyTheme();
updateCapabilityLabels();
renderConfigurationOptions();
updateSettings();
render();
elements.timer.textContent = '00:00';
