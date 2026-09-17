import { formatDuration, phaseAnnouncement, PHASES, WorkoutSequence } from './timer-core.mjs';

const ACTIVE_CONFIG_KEY = 'workoutTimerActiveConfig';
const CONFIGURATIONS_KEY = 'workoutTimerConfigurations';
const defaultConfig = {
    planName: 'My workout',
    workMs: 20_000,
    restMs: 10_000,
    pauseMs: 120_000,
    rounds: 8,
    sets: 3,
    exercises: []
};

const builtInConfigurations = [
    { id: 'tabata', name: 'Classic Tabata', workMs: 20_000, restMs: 10_000, pauseMs: 60_000, rounds: 8, sets: 1 },
    { id: 'cardio', name: 'Cardio Intervals', workMs: 60_000, restMs: 30_000, pauseMs: 120_000, rounds: 10, sets: 2 },
    { id: 'strength', name: 'Strength Training', workMs: 45_000, restMs: 75_000, pauseMs: 180_000, rounds: 4, sets: 3 }
];

function createId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isValidExercise(exercise) {
    const validOptionalDuration = (value) => value == null || (Number.isFinite(value) && value >= 1_000);
    return exercise
        && typeof exercise.name === 'string'
        && Boolean(exercise.name.trim())
        && validOptionalDuration(exercise.workMs)
        && validOptionalDuration(exercise.restMs);
}

function normalizeExercises(exercises = []) {
    if (!Array.isArray(exercises)) return [];
    return exercises.map((exercise) => ({
        id: typeof exercise.id === 'string' && exercise.id ? exercise.id : createId(),
        name: exercise.name.trim(),
        workMs: exercise.workMs ?? null,
        restMs: exercise.restMs ?? null
    }));
}

function isValidConfiguration(value) {
    return value
        && ['workMs', 'restMs', 'pauseMs'].every((key) => Number.isFinite(value[key]) && value[key] >= 1_000)
        && ['rounds', 'sets'].every((key) => Number.isInteger(value[key]) && value[key] >= 1)
        && (value.exercises == null || (Array.isArray(value.exercises) && value.exercises.every(isValidExercise)));
}

function normalizeConfiguration(value) {
    if (!isValidConfiguration(value)) return null;
    const exercises = normalizeExercises(value.exercises);
    return {
        ...defaultConfig,
        ...value,
        planName: typeof value.planName === 'string' && value.planName.trim()
            ? value.planName.trim()
            : defaultConfig.planName,
        exercises,
        rounds: exercises.length || value.rounds
    };
}

function loadActiveConfig() {
    try {
        const saved = JSON.parse(localStorage.getItem(ACTIVE_CONFIG_KEY));
        return normalizeConfiguration(saved) ?? { ...defaultConfig, exercises: [] };
    } catch {
        return { ...defaultConfig, exercises: [] };
    }
}

function loadCustomConfigurations() {
    try {
        const saved = JSON.parse(localStorage.getItem(CONFIGURATIONS_KEY));
        return Array.isArray(saved)
            ? saved
                .filter((item) => typeof item.name === 'string' && item.name.trim() && isValidConfiguration(item))
                .map((item) => ({ ...normalizeConfiguration(item), id: item.id || createId(), name: item.name.trim() }))
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
    keepAwake: true,
    voiceAnnouncements: false
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
    nextExercise: document.querySelector('#nextExercise'),
    timer: document.querySelector('#timer'),
    timerCard: document.querySelector('#timerCard'),
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
    voiceSetting: document.querySelector('#voiceSetting'),
    voiceSupport: document.querySelector('#voiceSupport'),
    configurationSelect: document.querySelector('#configurationSelect'),
    loadConfigurationButton: document.querySelector('#loadConfigurationButton'),
    deleteConfigurationButton: document.querySelector('#deleteConfigurationButton'),
    configurationName: document.querySelector('#configurationName'),
    saveConfigurationForm: document.querySelector('#saveConfigurationForm'),
    configurationMessage: document.querySelector('#configurationMessage'),
    configurationControls: [...document.querySelectorAll('[data-configuration-control]')],
    planName: document.querySelector('#planName'),
    exerciseList: document.querySelector('#exerciseList'),
    exerciseEmpty: document.querySelector('#exerciseEmpty'),
    addExerciseForm: document.querySelector('#addExerciseForm'),
    newExerciseName: document.querySelector('#newExerciseName'),
    newExerciseWork: document.querySelector('#newExerciseWork'),
    newExerciseRest: document.querySelector('#newExerciseRest'),
    importPlanButton: document.querySelector('#importPlanButton'),
    importPlanInput: document.querySelector('#importPlanInput'),
    exportPlanButton: document.querySelector('#exportPlanButton'),
    planMessage: document.querySelector('#planMessage')
};

let mode = 'idle';
let intervalId = null;
let remainingMs = sequence.duration;
let phaseEndsAt = 0;
let lastCountdownSecond = null;
let audioUnlocked = false;
let wakeLock = null;
let lastAnnouncementKey = null;

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

    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
        elements.voiceSetting.disabled = true;
        elements.voiceSupport.textContent = 'Voice announcements are not supported by this browser.';
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

function speak(text) {
    if (!preferences.voiceAnnouncements || !text) return;
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = document.documentElement.lang || navigator.language || 'en';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
}

function announceCurrentPhase() {
    const snapshot = sequence.snapshot();
    const key = `${snapshot.phase}:${snapshot.set}:${snapshot.round}`;
    if (key === lastAnnouncementKey) return;

    const exerciseName = snapshot.exercise?.name ?? '';
    const nextExerciseName = snapshot.phase === PHASES.PAUSE
        ? config.exercises[0]?.name ?? ''
        : exerciseName;
    speak(phaseAnnouncement({
        phase: snapshot.phase,
        exerciseName,
        nextExerciseName
    }));
    lastAnnouncementKey = key;
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
    elements.workDuration.textContent = formatDuration(config.workMs);
    elements.restDuration.textContent = formatDuration(config.restMs);
    elements.pauseDuration.textContent = formatDuration(config.pauseMs);
    elements.rounds.textContent = config.rounds;
    elements.sets.textContent = config.sets;
}

function updatePhaseDisplay() {
    const { phase, round, rounds, set, sets, exercise } = sequence.snapshot();
    const hasPlan = config.exercises.length > 0;
    elements.status.classList.toggle('exercise-status', hasPlan && phase === PHASES.WORK && mode !== 'complete');
    elements.nextExercise.hidden = true;

    if (mode === 'idle') {
        elements.status.textContent = 'READY';
        if (hasPlan) {
            elements.nextExercise.textContent = `First: ${config.exercises[0].name}`;
            elements.nextExercise.hidden = false;
        }
    } else if (mode === 'complete') {
        elements.status.textContent = 'DONE';
    } else if (hasPlan && phase === PHASES.WORK) {
        elements.status.textContent = exercise.name;
    } else {
        elements.status.textContent = phase.toUpperCase();
        if (hasPlan && phase === PHASES.REST) {
            elements.nextExercise.textContent = `Next: ${exercise.name}`;
            elements.nextExercise.hidden = false;
        } else if (hasPlan && phase === PHASES.PAUSE) {
            elements.nextExercise.textContent = `Next set: ${config.exercises[0].name}`;
            elements.nextExercise.hidden = false;
        }
    }

    elements.timerCard.dataset.phase = mode === 'idle' ? 'idle' : phase;
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
        button.disabled = workoutActive
            || (button.dataset.setting === 'rounds' && config.exercises.length > 0);
    });
    elements.configurationControls.forEach((control) => {
        control.disabled = workoutActive;
    });
    document.querySelectorAll('[data-plan-control]').forEach((control) => {
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
    announceCurrentPhase();
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
    announceCurrentPhase();
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
    announceCurrentPhase();
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
    lastAnnouncementKey = null;
    window.speechSynthesis?.cancel();
    releaseWakeLock();
    elements.progress.value = 0;
    render();
    elements.timer.textContent = '00:00';
}

function changeSetting(name, amount) {
    if (mode !== 'idle') return;

    const minimum = name === 'rounds' || name === 'sets' ? 1 : amount < 0 ? Math.abs(amount) : 1_000;
    const nextValue = Math.max(minimum, config[name] + amount);
    if (nextValue === config[name]) return;

    config[name] = nextValue;
    sequence.updateConfig(config);
    sequence.reset();
    remainingMs = sequence.duration;
    saveActiveConfig();
    updateSettings();
}

function optionalSeconds(input) {
    if (!input.value) return null;
    const seconds = Number(input.value);
    return Number.isFinite(seconds) && seconds >= 1 ? Math.round(seconds * 1000) : null;
}

function resetAfterPlanChange(message = '') {
    config.rounds = config.exercises.length || Math.max(1, config.rounds);
    sequence.updateConfig(config);
    sequence.reset();
    mode = 'idle';
    remainingMs = sequence.duration;
    lastAnnouncementKey = null;
    window.speechSynthesis?.cancel();
    saveActiveConfig();
    updateSettings();
    renderExerciseList();
    render();
    elements.timer.textContent = '00:00';
    elements.planMessage.textContent = message;
}

function exerciseIcon(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

function renderExerciseList() {
    elements.exerciseList.replaceChildren();
    elements.exerciseEmpty.hidden = config.exercises.length > 0;
    elements.planName.value = config.planName;

    config.exercises.forEach((exercise, index) => {
        const card = document.createElement('article');
        card.className = 'exercise-card';
        card.innerHTML = `
            <div class="exercise-main">
                <span class="exercise-index">${index + 1}</span>
                <input class="exercise-name" data-plan-control type="text" maxlength="60" aria-label="Exercise ${index + 1} name">
                <button class="compact-icon-button danger exercise-delete" data-plan-control type="button" aria-label="Delete ${index + 1}" title="Delete exercise">
                    ${exerciseIcon('M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5')}
                </button>
            </div>
            <div class="exercise-details">
                <label>Work seconds<input class="exercise-work" data-plan-control type="number" min="1" step="5" inputmode="numeric" placeholder="${config.workMs / 1000}"></label>
                <label>Prep seconds<input class="exercise-rest" data-plan-control type="number" min="1" step="5" inputmode="numeric" placeholder="${config.restMs / 1000}"></label>
                <div class="exercise-order">
                    <button class="compact-icon-button exercise-up" data-plan-control type="button" aria-label="Move ${index + 1} up" title="Move up" ${index === 0 ? 'disabled' : ''}>${exerciseIcon('m6 14 6-6 6 6')}</button>
                    <button class="compact-icon-button exercise-down" data-plan-control type="button" aria-label="Move ${index + 1} down" title="Move down" ${index === config.exercises.length - 1 ? 'disabled' : ''}>${exerciseIcon('m6 10 6 6 6-6')}</button>
                </div>
            </div>`;

        const nameInput = card.querySelector('.exercise-name');
        const workInput = card.querySelector('.exercise-work');
        const restInput = card.querySelector('.exercise-rest');
        nameInput.value = exercise.name;
        workInput.value = exercise.workMs == null ? '' : exercise.workMs / 1000;
        restInput.value = exercise.restMs == null ? '' : exercise.restMs / 1000;

        nameInput.addEventListener('change', () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.value = exercise.name;
                return;
            }
            exercise.name = name;
            resetAfterPlanChange('Exercise updated.');
        });

        workInput.addEventListener('change', () => {
            exercise.workMs = optionalSeconds(workInput);
            resetAfterPlanChange('Exercise timing updated.');
        });

        restInput.addEventListener('change', () => {
            exercise.restMs = optionalSeconds(restInput);
            resetAfterPlanChange('Exercise timing updated.');
        });

        card.querySelector('.exercise-delete').addEventListener('click', () => {
            config.exercises.splice(index, 1);
            resetAfterPlanChange(`Removed “${exercise.name}”.`);
        });

        card.querySelector('.exercise-up').addEventListener('click', () => {
            if (index === 0) return;
            [config.exercises[index - 1], config.exercises[index]] = [config.exercises[index], config.exercises[index - 1]];
            resetAfterPlanChange('Exercise moved.');
        });

        card.querySelector('.exercise-down').addEventListener('click', () => {
            if (index >= config.exercises.length - 1) return;
            [config.exercises[index], config.exercises[index + 1]] = [config.exercises[index + 1], config.exercises[index]];
            resetAfterPlanChange('Exercise moved.');
        });

        elements.exerciseList.append(card);
    });

    updateControls();
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
    const normalized = normalizeConfiguration({ ...defaultConfig, ...item, planName: item.name ?? item.planName });
    if (!normalized) return;

    for (const key of ['planName', 'workMs', 'restMs', 'pauseMs', 'rounds', 'sets']) config[key] = normalized[key];
    config.exercises = normalized.exercises.map((exercise) => ({ ...exercise }));
    sequence.updateConfig(config);
    sequence.reset();
    mode = 'idle';
    remainingMs = sequence.duration;
    lastAnnouncementKey = null;
    window.speechSynthesis?.cancel();
    saveActiveConfig();
    updateSettings();
    renderExerciseList();
    render();
    elements.timer.textContent = '00:00';
    elements.configurationMessage.textContent = `Loaded “${item.name}”.`;
}

function saveNamedConfiguration(name) {
    const cleanName = name.trim();
    if (!cleanName) return;

    config.planName = cleanName;
    saveActiveConfig();
    let item = customConfigurations.find((entry) => entry.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    if (item) {
        Object.assign(item, config, {
            name: cleanName,
            exercises: config.exercises.map((exercise) => ({ ...exercise }))
        });
    } else {
        item = {
            id: createId(),
            name: cleanName,
            ...config,
            exercises: config.exercises.map((exercise) => ({ ...exercise }))
        };
        customConfigurations.push(item);
    }

    saveCustomConfigurations();
    renderConfigurationOptions(`custom:${item.id}`);
    renderExerciseList();
    elements.configurationName.value = '';
    elements.configurationMessage.textContent = `Saved “${cleanName}”.`;
}

const activeSettingPresses = new Map();

function repeatSettingChange(button, state) {
    if (activeSettingPresses.get(button) !== state || button.disabled) return;

    changeSetting(button.dataset.setting, Number(button.dataset.change));
    const elapsed = performance.now() - state.startedAt;
    const delay = elapsed > 2_000 ? 45 : elapsed > 1_000 ? 65 : 90;
    state.timerId = window.setTimeout(() => repeatSettingChange(button, state), delay);
}

function stopSettingRepeat(button) {
    const state = activeSettingPresses.get(button);
    if (!state) return;

    clearTimeout(state.timerId);
    activeSettingPresses.delete(button);
}

function stopAllSettingRepeats() {
    for (const button of activeSettingPresses.keys()) {
        stopSettingRepeat(button);
    }
}

elements.settingButtons.forEach((button) => {
    button.title = 'Press and hold to adjust quickly';

    button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || button.disabled) return;
        event.preventDefault();
        stopSettingRepeat(button);
        button.setPointerCapture?.(event.pointerId);
        changeSetting(button.dataset.setting, Number(button.dataset.change));

        const state = {
            startedAt: performance.now(),
            timerId: null
        };
        state.timerId = window.setTimeout(() => repeatSettingChange(button, state), 380);
        activeSettingPresses.set(button, state);
    });

    button.addEventListener('pointerup', () => stopSettingRepeat(button));
    button.addEventListener('pointercancel', () => stopSettingRepeat(button));
    button.addEventListener('lostpointercapture', () => stopSettingRepeat(button));

    button.addEventListener('click', (event) => {
        if (event.detail === 0 || !('PointerEvent' in window)) {
            changeSetting(button.dataset.setting, Number(button.dataset.change));
        }
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

elements.settingsDialog.addEventListener('click', (event) => {
    const bounds = elements.settingsDialog.getBoundingClientRect();
    const clickedBackdrop = event.clientX < bounds.left
        || event.clientX > bounds.right
        || event.clientY < bounds.top
        || event.clientY > bounds.bottom;

    if (clickedBackdrop) elements.settingsDialog.close();
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

elements.voiceSetting.addEventListener('change', () => {
    preferences.voiceAnnouncements = elements.voiceSetting.checked;
    savePreferences();
    window.speechSynthesis?.cancel();
    lastAnnouncementKey = null;

    if (preferences.voiceAnnouncements) {
        if (mode === 'running' || mode === 'paused') announceCurrentPhase();
        else speak('Voice announcements enabled');
    }
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

elements.planName.addEventListener('change', () => {
    const name = elements.planName.value.trim();
    config.planName = name || defaultConfig.planName;
    elements.planName.value = config.planName;
    saveActiveConfig();
});

elements.addExerciseForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode === 'running' || mode === 'paused') return;

    const name = elements.newExerciseName.value.trim();
    if (!name) return;
    config.exercises.push({
        id: createId(),
        name,
        workMs: optionalSeconds(elements.newExerciseWork),
        restMs: optionalSeconds(elements.newExerciseRest)
    });
    elements.newExerciseName.value = '';
    elements.newExerciseWork.value = '';
    elements.newExerciseRest.value = '';
    resetAfterPlanChange(`Added “${name}”.`);
});

elements.importPlanButton.addEventListener('click', () => {
    elements.importPlanInput.click();
});

elements.importPlanInput.addEventListener('change', async () => {
    const [file] = elements.importPlanInput.files;
    if (!file) return;

    try {
        const imported = JSON.parse(await file.text());
        const source = imported.configuration ?? imported;
        const name = String(imported.name ?? source.planName ?? 'Imported workout').trim();
        const normalized = normalizeConfiguration({ ...source, planName: name });
        if (!normalized) throw new Error('Invalid workout plan');

        applyConfiguration({ ...normalized, name });
        saveNamedConfiguration(name);
        elements.planMessage.textContent = `Imported and saved “${name}”.`;
    } catch {
        elements.planMessage.textContent = 'This file is not a valid workout plan.';
    } finally {
        elements.importPlanInput.value = '';
    }
});

elements.exportPlanButton.addEventListener('click', () => {
    const payload = {
        format: 'workout-timer-plan',
        version: 1,
        name: config.planName,
        configuration: {
            planName: config.planName,
            workMs: config.workMs,
            restMs: config.restMs,
            pauseMs: config.pauseMs,
            rounds: config.rounds,
            sets: config.sets,
            exercises: config.exercises.map(({ name, workMs, restMs }) => ({ name, workMs, restMs }))
        }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${config.planName.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workout-plan'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    elements.planMessage.textContent = `Exported “${config.planName}”.`;
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAllSettingRepeats();
    if (document.visibilityState === 'visible' && mode === 'running') {
        tick();
        acquireWakeLock();
    }
});

window.addEventListener('blur', stopAllSettingRepeats);

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
}

elements.themeSetting.value = preferences.theme;
elements.vibrationSetting.checked = preferences.vibration;
elements.wakeLockSetting.checked = preferences.keepAwake;
elements.voiceSetting.checked = preferences.voiceAnnouncements;
applyTheme();
updateCapabilityLabels();
renderConfigurationOptions();
updateSettings();
renderExerciseList();
render();
elements.timer.textContent = '00:00';
