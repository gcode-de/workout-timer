import { formatDuration, PHASES, WorkoutSequence } from './timer-core.mjs';

const config = {
    workMs: 20_000,
    restMs: 10_000,
    pauseMs: 120_000,
    rounds: 8
};

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
    wakeLockSupport: document.querySelector('#wakeLockSupport')
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
}

function updatePhaseDisplay() {
    const { phase, round, rounds } = sequence.snapshot();
    elements.status.textContent = mode === 'idle' ? 'READY' : phase.toUpperCase();
    elements.roundCounter.textContent = phase === PHASES.PAUSE
        ? 'set complete'
        : `round ${round} of ${rounds}`;
}

function updateTimerDisplay() {
    const duration = sequence.duration;
    const progress = duration > 0 ? 1 - (remainingMs / duration) : 0;
    elements.timer.textContent = formatDuration(remainingMs);
    elements.progress.value = Math.min(1, Math.max(0, progress));
    elements.progress.setAttribute('aria-valuetext', `${Math.round(progress * 100)}%`);
}

function updateControls() {
    const isRunning = mode === 'running';
    const workoutStarted = mode !== 'idle';

    elements.primaryIcon.textContent = isRunning ? 'Ⅱ' : '▶';
    elements.primaryLabel.textContent = isRunning ? 'Pause' : workoutStarted ? 'Resume' : 'Start';
    elements.primaryButton.setAttribute('aria-label', elements.primaryLabel.textContent);
    elements.stopButton.hidden = !workoutStarted;
    elements.settingButtons.forEach((button) => {
        button.disabled = workoutStarted;
    });
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

function syncExpiredPhases(now) {
    if (now < phaseEndsAt) return;

    safelyPlay(alarm);
    vibrate([160, 80, 160]);
    do {
        sequence.next();
        phaseEndsAt += sequence.duration;
    } while (now >= phaseEndsAt);

    lastCountdownSecond = null;
}

function tick() {
    const now = Date.now();
    syncExpiredPhases(now);
    remainingMs = Math.max(0, phaseEndsAt - now);
    announceCountdown();
    render();
}

function startTimer() {
    if (mode === 'running') return;

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
    syncExpiredPhases(now);
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

    const minimum = name === 'rounds' ? 1 : amount < 0 ? Math.abs(amount) : 1_000;
    config[name] = Math.max(minimum, config[name] + amount);
    sequence.updateConfig(config);
    sequence.reset();
    remainingMs = sequence.duration;
    updateSettings();
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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mode === 'running') {
        tick();
        acquireWakeLock();
    }
});

elements.themeSetting.value = preferences.theme;
elements.vibrationSetting.checked = preferences.vibration;
elements.wakeLockSetting.checked = preferences.keepAwake;
applyTheme();
updateCapabilityLabels();
updateSettings();
render();
elements.timer.textContent = '00:00';
