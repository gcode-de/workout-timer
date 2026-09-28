import { exerciseSpeechName, formatDuration, phaseAnnouncement, PHASES, WorkoutSequence } from './timer-core.mjs';
import { SpeechController } from './speech-controller.mjs';
import {
    chooseAlternatingExercise,
    formatLoad,
    recommendProgression,
    sessionsForExercise,
    summarizeProgress
} from './progression-core.mjs';

const ACTIVE_CONFIG_KEY = 'workoutTimerActiveConfig';
const CONFIGURATIONS_KEY = 'workoutTimerConfigurations';
const PROGRESS_HISTORY_KEY = 'workoutTimerProgressHistory';
const DEFAULT_SPEECH_NAMES = Object.freeze({
    'kraft-jo-lat-pulldown': 'Lat pulldown',
    'kraft-jo-step-ups': 'Step-ups',
    'kraft-jo-push-ups': 'Push-ups',
    'kraft-jo-rdl': 'Romanian deadlift',
    'kraft-jo-cable-row': 'Cable row',
    'kraft-jo-shoulder-press': 'Shoulder press',
    'kraft-jo-single-leg-hip-thrust': 'Single-leg hip thrusts'
});
const kraftJoExercises = [
    {
        trackingId: 'kraft-jo-lat-pulldown',
        name: 'Latzug',
        workMs: null,
        restMs: null,
        notes: 'Einstellung 45.',
        progression: {
            type: 'load', minReps: 8, maxReps: 12, initialReps: 10,
            initialLoad: 30, increment: 5, unit: 'kg am Kabelzug'
        }
    },
    {
        trackingId: 'kraft-jo-step-ups',
        name: 'Step-ups',
        workMs: null,
        restMs: null,
        notes: 'Wiederholungen je Seite; die schwächere Seite bestimmt die Steigerung.',
        progression: {
            type: 'load', minReps: 8, maxReps: 15, initialReps: 10,
            initialLoad: 0, increment: 1, unit: 'kg je Hantel', zeroLabel: 'Körpergewicht', perSide: true
        }
    },
    {
        trackingId: 'kraft-jo-push-ups',
        name: 'Liegestütze',
        workMs: null,
        restMs: null,
        notes: 'Brust, Trizeps und Rumpf stabil trainieren.',
        progression: {
            type: 'variant', minReps: 8, maxReps: 15, initialReps: 10,
            initialVariant: 'Normal',
            variants: ['Hände erhöht', 'Normal', 'Füße erhöht', 'Langsam absenken', 'Mit Zusatzgewicht']
        }
    },
    {
        trackingId: 'kraft-jo-rdl',
        name: 'Rumänisches Kreuzheben',
        workMs: null,
        restMs: null,
        notes: 'Gesamtgewicht erfassen.',
        progression: {
            type: 'load', minReps: 8, maxReps: 15, initialReps: 12,
            initialLoad: 10, increment: 2, unit: 'kg gesamt'
        }
    },
    {
        trackingId: 'kraft-jo-row-press-slot',
        name: 'Kabelrudern / Schulterdrücken',
        workMs: null,
        restMs: null,
        notes: 'Die App wählt automatisch die Übung, die länger nicht trainiert wurde.',
        alternatives: [
            {
                trackingId: 'kraft-jo-cable-row',
                name: 'Kabelrudern',
                progression: {
                    type: 'load', minReps: 8, maxReps: 12, initialReps: 10,
                    initialLoad: null, increment: 5, unit: 'kg am Kabelzug'
                }
            },
            {
                trackingId: 'kraft-jo-shoulder-press',
                name: 'Schulterdrücken',
                progression: {
                    type: 'load', minReps: 8, maxReps: 12, initialReps: 10,
                    initialLoad: 5, increment: 1, unit: 'kg je Hantel', perSide: true
                }
            }
        ]
    },
    {
        trackingId: 'kraft-jo-single-leg-hip-thrust',
        name: 'Einbeinige Hip Thrusts',
        workMs: null,
        restMs: null,
        notes: 'Wiederholungen je Seite; die schwächere Seite bestimmt die Steigerung.',
        progression: {
            type: 'load', minReps: 10, maxReps: 20, initialReps: 10,
            initialLoad: 0, increment: 2, unit: 'kg Zusatzgewicht', zeroLabel: 'Körpergewicht', perSide: true
        }
    }
];
const defaultConfig = {
    planName: 'Kraft Jo',
    exerciseOrder: 'straight',
    warmupMs: 300_000,
    workMs: 60_000,
    restMs: 30_000,
    pauseMs: 120_000,
    cooldownMs: 300_000,
    rounds: kraftJoExercises.length,
    sets: 2,
    exercises: kraftJoExercises
};

const builtInConfigurations = [
    { id: 'kraft-jo', name: 'Kraft Jo', ...defaultConfig },
    { id: 'tabata', name: 'Classic Tabata', warmupMs: 300_000, workMs: 20_000, restMs: 10_000, pauseMs: 60_000, cooldownMs: 300_000, rounds: 8, sets: 1 },
    { id: 'cardio', name: 'Cardio Intervals', warmupMs: 300_000, workMs: 60_000, restMs: 30_000, pauseMs: 120_000, cooldownMs: 300_000, rounds: 10, sets: 2 },
    { id: 'strength', name: 'Strength Training', warmupMs: 300_000, workMs: 45_000, restMs: 75_000, pauseMs: 180_000, cooldownMs: 300_000, rounds: 4, sets: 3 },
    { id: 'norwegian-4x4', name: 'Norwegian 4×4', warmupMs: 600_000, workMs: 240_000, restMs: 180_000, pauseMs: 120_000, cooldownMs: 300_000, rounds: 4, sets: 1 }
];

function createId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function trackingIdFor(name) {
    const slug = String(name)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return `exercise-${slug || createId()}`;
}

function normalizeProgression(value = {}) {
    const type = value.type === 'variant' ? 'variant' : 'load';
    const minReps = Number.isInteger(value.minReps) && value.minReps > 0 ? value.minReps : 8;
    const maxReps = Number.isInteger(value.maxReps) && value.maxReps >= minReps ? value.maxReps : 12;
    const progression = {
        type,
        minReps,
        maxReps,
        initialReps: Number.isInteger(value.initialReps)
            ? Math.min(maxReps, Math.max(minReps, value.initialReps))
            : minReps,
        perSide: Boolean(value.perSide)
    };

    if (type === 'variant') {
        progression.variants = Array.isArray(value.variants) && value.variants.length
            ? value.variants.map(String)
            : ['Aktuelle Variante'];
        progression.initialVariant = progression.variants.includes(value.initialVariant)
            ? value.initialVariant
            : progression.variants[0];
    } else {
        progression.initialLoad = Number.isFinite(value.initialLoad) ? value.initialLoad : null;
        progression.increment = Number.isFinite(value.increment) && value.increment > 0 ? value.increment : 1;
        progression.unit = typeof value.unit === 'string' && value.unit.trim() ? value.unit.trim() : 'kg';
        if (typeof value.zeroLabel === 'string' && value.zeroLabel.trim()) progression.zeroLabel = value.zeroLabel.trim();
    }

    return progression;
}

function normalizeSpeechName(value, trackingId) {
    if (typeof value === 'string') return value.trim().slice(0, 80);
    return DEFAULT_SPEECH_NAMES[trackingId] ?? '';
}

function normalizeAlternative(alternative) {
    const name = String(alternative?.name ?? 'Alternative').trim();
    const trackingId = typeof alternative?.trackingId === 'string' && alternative.trackingId
        ? alternative.trackingId
        : trackingIdFor(name);
    return {
        trackingId,
        name,
        speechName: normalizeSpeechName(alternative?.speechName, trackingId),
        progression: normalizeProgression(alternative?.progression)
    };
}

function isValidExercise(exercise) {
    const validOptionalDuration = (value) => value == null || (Number.isFinite(value) && value >= 1_000);
    return exercise
        && typeof exercise.name === 'string'
        && Boolean(exercise.name.trim())
        && (exercise.speechName == null || typeof exercise.speechName === 'string')
        && validOptionalDuration(exercise.workMs)
        && validOptionalDuration(exercise.restMs)
        && (exercise.notes == null || typeof exercise.notes === 'string');
}

function normalizeExercises(exercises = []) {
    if (!Array.isArray(exercises)) return [];
    return exercises.map((exercise) => {
        const trackingId = typeof exercise.trackingId === 'string' && exercise.trackingId
            ? exercise.trackingId
            : trackingIdFor(exercise.name);
        return {
            id: typeof exercise.id === 'string' && exercise.id ? exercise.id : createId(),
            trackingId,
            name: exercise.name.trim(),
            speechName: normalizeSpeechName(exercise.speechName, trackingId),
            workMs: exercise.workMs ?? null,
            restMs: exercise.restMs ?? null,
            notes: typeof exercise.notes === 'string' ? exercise.notes.slice(0, 500) : '',
            progression: normalizeProgression(exercise.progression),
            alternatives: Array.isArray(exercise.alternatives)
                ? exercise.alternatives.map(normalizeAlternative)
                : []
        };
    });
}

function isValidConfiguration(value) {
    return value
        && ['workMs', 'restMs', 'pauseMs'].every((key) => Number.isFinite(value[key]) && value[key] >= 1_000)
        && (value.warmupMs == null || (Number.isFinite(value.warmupMs) && value.warmupMs >= 0))
        && (value.cooldownMs == null || (Number.isFinite(value.cooldownMs) && value.cooldownMs >= 0))
        && (value.exerciseOrder == null || ['circuit', 'straight'].includes(value.exerciseOrder))
        && ['rounds', 'sets'].every((key) => Number.isInteger(value[key]) && value[key] >= 1)
        && (value.exercises == null || (Array.isArray(value.exercises) && value.exercises.every(isValidExercise)));
}

function normalizeConfiguration(value) {
    if (!isValidConfiguration(value)) return null;
    const exercises = normalizeExercises(value.exercises);
    return {
        ...defaultConfig,
        ...value,
        warmupMs: value.warmupMs ?? defaultConfig.warmupMs,
        cooldownMs: value.cooldownMs ?? defaultConfig.cooldownMs,
        exerciseOrder: ['circuit', 'straight'].includes(value.exerciseOrder)
            ? value.exerciseOrder
            : value.planName === 'Kraft Jo' ? 'straight' : 'circuit',
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
        const legacyKraftJo = saved?.planName === 'Kraft Jo'
            && !saved.exercises?.some((exercise) => exercise.trackingId === 'kraft-jo-lat-pulldown');
        if (legacyKraftJo) return normalizeConfiguration(defaultConfig);
        return normalizeConfiguration(saved) ?? normalizeConfiguration(defaultConfig);
    } catch {
        return normalizeConfiguration(defaultConfig);
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

function loadProgressHistory() {
    try {
        const saved = JSON.parse(localStorage.getItem(PROGRESS_HISTORY_KEY));
        return Array.isArray(saved)
            ? saved.filter((entry) => entry
                && typeof entry.sessionId === 'string'
                && typeof entry.trackingId === 'string'
                && Number.isInteger(entry.set)
                && Number.isInteger(entry.reps)
                && Number.isInteger(entry.rir)
                && typeof entry.completedAt === 'string')
            : [];
    } catch {
        return [];
    }
}

const config = loadActiveConfig();
let customConfigurations = loadCustomConfigurations();
let progressHistory = loadProgressHistory();

const sequence = new WorkoutSequence(config);
const alarm = new Audio('./alarm.mp3');
const shortAlarm = new Audio('./alarm_short.mp3');
const speech = new SpeechController({
    synthesis: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
    language: 'en-US'
});
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
    warmupDuration: document.querySelector('#warmupDuration'),
    workDuration: document.querySelector('#workDuration'),
    restDuration: document.querySelector('#restDuration'),
    pauseDuration: document.querySelector('#pauseDuration'),
    cooldownDuration: document.querySelector('#cooldownDuration'),
    exerciseOrder: document.querySelector('#exerciseOrder'),
    rounds: document.querySelector('#rounds'),
    sets: document.querySelector('#sets'),
    roundCounter: document.querySelector('#roundCounter'),
    status: document.querySelector('#status'),
    nextExercise: document.querySelector('#nextExercise'),
    exerciseNote: document.querySelector('#exerciseNote'),
    timer: document.querySelector('#timer'),
    timerCard: document.querySelector('#timerCard'),
    progress: document.querySelector('#progress'),
    progressionPanel: document.querySelector('#progressionPanel'),
    progressionExercise: document.querySelector('#progressionExercise'),
    progressionRecommendation: document.querySelector('#progressionRecommendation'),
    progressionLast: document.querySelector('#progressionLast'),
    setLogForm: document.querySelector('#setLogForm'),
    loadField: document.querySelector('#loadField'),
    loadInput: document.querySelector('#loadInput'),
    loadUnit: document.querySelector('#loadUnit'),
    variantField: document.querySelector('#variantField'),
    variantInput: document.querySelector('#variantInput'),
    repsInput: document.querySelector('#repsInput'),
    repsLabel: document.querySelector('#repsLabel'),
    rirInput: document.querySelector('#rirInput'),
    setLogButton: document.querySelector('#setLogButton'),
    setLogMessage: document.querySelector('#setLogMessage'),
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
    importPlanButton: document.querySelector('#importPlanButton'),
    importPlanInput: document.querySelector('#importPlanInput'),
    exportPlanButton: document.querySelector('#exportPlanButton'),
    planMessage: document.querySelector('#planMessage'),
    progressList: document.querySelector('#progressList')
};

let mode = 'idle';
let intervalId = null;
let remainingMs = sequence.duration;
let phaseEndsAt = 0;
let lastCountdownSecond = null;
let audioUnlocked = false;
let wakeLock = null;
let lastAnnouncementKey = null;
let pendingAnnouncementId = null;
let activeSessionId = null;
let activeLogContext = null;
let sessionExerciseSelections = new Map();

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

function saveProgressHistory() {
    try {
        localStorage.setItem(PROGRESS_HISTORY_KEY, JSON.stringify(progressHistory));
    } catch {}
}

function trackableExercises() {
    return config.exercises.flatMap((exercise) => exercise.alternatives?.length
        ? exercise.alternatives
        : [exercise]);
}

function selectedExerciseFor(exercise) {
    if (!exercise?.alternatives?.length) return exercise;
    if (!sessionExerciseSelections.has(exercise.trackingId)) {
        sessionExerciseSelections.set(
            exercise.trackingId,
            chooseAlternatingExercise(exercise.alternatives, progressHistory)
        );
    }
    return sessionExerciseSelections.get(exercise.trackingId);
}

function currentExerciseName(exercise) {
    return selectedExerciseFor(exercise)?.name ?? exercise?.name ?? '';
}

function currentExerciseSpeechName(exercise) {
    const selected = selectedExerciseFor(exercise);
    return exerciseSpeechName(selected) || exerciseSpeechName(exercise);
}

function currentExerciseNotes(exercise) {
    const selected = selectedExerciseFor(exercise);
    const recommendation = selected
        ? recommendProgression(selected.progression, progressHistory, selected.trackingId, {
            expectedSets: config.sets,
            excludeSessionId: activeSessionId
        })
        : null;
    return [exercise?.notes, recommendation ? `Empfohlen: ${recommendation.text}` : '']
        .filter(Boolean)
        .join('\n');
}

function renderProgressList() {
    elements.progressList.replaceChildren();

    for (const exercise of trackableExercises()) {
        const summary = summarizeProgress(
            exercise.progression,
            progressHistory,
            exercise.trackingId,
            config.sets
        );
        const card = document.createElement('article');
        card.className = 'progress-card';
        card.innerHTML = `
            <div class="progress-card-heading">
                <strong></strong>
                <span></span>
            </div>
            <p class="progress-last"></p>
            <p class="progress-next"></p>
            <div class="progress-recent" aria-label="Recent sessions"></div>`;
        card.querySelector('strong').textContent = exercise.name;
        card.querySelector('.progress-card-heading span').textContent = `${exercise.progression.minReps}–${exercise.progression.maxReps} Wdh.`;
        card.querySelector('.progress-last').textContent = `Zuletzt: ${summary.last}`;
        card.querySelector('.progress-next').textContent = `Nächstes Ziel: ${summary.recommendation.text}`;

        const recent = card.querySelector('.progress-recent');
        for (const session of summary.recent.slice(0, 4)) {
            const item = document.createElement('span');
            const date = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' })
                .format(new Date(session.date));
            item.textContent = `${date} · ${session.reps.join('/')}`;
            recent.append(item);
        }
        elements.progressList.append(card);
    }
}

function activateExerciseLog(snapshot) {
    if (!snapshot.exercise || !activeSessionId) return;
    const selected = selectedExerciseFor(snapshot.exercise);
    const profile = selected.progression;
    const recommendation = recommendProgression(profile, progressHistory, selected.trackingId, {
        expectedSets: config.sets,
        excludeSessionId: activeSessionId
    });
    activeLogContext = {
        sessionId: activeSessionId,
        planName: config.planName,
        trackingId: selected.trackingId,
        exerciseName: selected.name,
        set: snapshot.set,
        profile,
        recommendation
    };

    const existing = progressHistory.find((entry) => entry.sessionId === activeSessionId
        && entry.trackingId === selected.trackingId
        && entry.set === snapshot.set);
    elements.progressionExercise.textContent = `${selected.name} · Satz ${snapshot.set} von ${snapshot.sets}`;
    elements.progressionRecommendation.textContent = `Heute: ${recommendation.text}`;
    const previousSessions = sessionsForExercise(progressHistory, selected.trackingId, {
        excludeSessionId: activeSessionId
    });
    if (previousSessions[0]?.length) {
        const previous = previousSessions[0];
        elements.progressionLast.textContent = `Zuletzt: ${previous.map((entry) => entry.reps).join(' / ')} Wdh.`;
    } else {
        elements.progressionLast.textContent = 'Noch kein früherer Eintrag.';
    }

    elements.loadField.hidden = profile.type === 'variant';
    elements.variantField.hidden = profile.type !== 'variant';
    elements.repsLabel.textContent = profile.perSide ? 'Wdh. je Seite' : 'Wiederholungen';
    elements.repsInput.min = String(profile.minReps);
    elements.repsInput.max = String(Math.max(100, profile.maxReps));
    elements.repsInput.value = String(existing?.reps ?? recommendation.reps);
    elements.rirInput.value = String(existing?.rir ?? 2);

    if (profile.type === 'variant') {
        elements.variantInput.replaceChildren();
        for (const variant of profile.variants) elements.variantInput.append(new Option(variant, variant));
        elements.variantInput.value = existing?.variant ?? recommendation.variant ?? profile.initialVariant;
    } else {
        elements.loadUnit.textContent = profile.unit;
        elements.loadInput.value = existing?.load ?? recommendation.load ?? '';
        elements.loadInput.step = String(profile.increment);
    }

    elements.setLogButton.textContent = existing ? 'Aktualisieren' : 'Satz speichern';
    elements.setLogMessage.textContent = existing ? 'Dieser Satz ist bereits gespeichert.' : '';
    elements.progressionPanel.hidden = false;
}

function hideExerciseLog() {
    activeLogContext = null;
    elements.progressionPanel.hidden = true;
    elements.setLogMessage.textContent = '';
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

    if (!speech.supported) {
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

function cancelSpeech() {
    clearTimeout(pendingAnnouncementId);
    pendingAnnouncementId = null;
    speech.cancel();
}

function speak(text) {
    if (!preferences.voiceAnnouncements || !text) return false;
    return speech.speak(text);
}

function announceCurrentPhase(delayMs = 0) {
    if (!preferences.voiceAnnouncements) return;

    const snapshot = sequence.snapshot();
    const key = `${snapshot.phase}:${snapshot.set}:${snapshot.round}`;
    if (key === lastAnnouncementKey) return;

    const exerciseName = currentExerciseSpeechName(snapshot.exercise);
    const nextExerciseName = snapshot.phase === PHASES.PAUSE
        ? currentExerciseSpeechName(config.exerciseOrder === 'straight' ? snapshot.exercise : config.exercises[0])
        : exerciseName;
    const announcement = phaseAnnouncement({
        phase: snapshot.phase,
        exerciseName,
        nextExerciseName
    });
    const deliver = () => {
        pendingAnnouncementId = null;
        if (speak(announcement)) lastAnnouncementKey = key;
    };

    clearTimeout(pendingAnnouncementId);
    if (delayMs > 0) pendingAnnouncementId = window.setTimeout(deliver, delayMs);
    else deliver();
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
    elements.warmupDuration.textContent = formatDuration(config.warmupMs);
    elements.workDuration.textContent = formatDuration(config.workMs);
    elements.restDuration.textContent = formatDuration(config.restMs);
    elements.pauseDuration.textContent = formatDuration(config.pauseMs);
    elements.cooldownDuration.textContent = formatDuration(config.cooldownMs);
    elements.exerciseOrder.value = config.exerciseOrder;
    elements.rounds.textContent = config.rounds;
    elements.sets.textContent = config.sets;
}

function updatePhaseDisplay() {
    const { phase, round, rounds, set, sets, exercise } = sequence.snapshot();
    const hasPlan = config.exercises.length > 0;
    elements.status.classList.toggle('exercise-status', hasPlan && phase === PHASES.WORK && mode !== 'complete');
    elements.nextExercise.hidden = true;
    elements.exerciseNote.hidden = true;
    const phaseLabels = {
        [PHASES.WARMUP]: 'WARM-UP',
        [PHASES.REST]: 'REST',
        [PHASES.WORK]: 'WORK',
        [PHASES.PAUSE]: 'SET PAUSE',
        [PHASES.COOLDOWN]: 'COOL-DOWN'
    };

    if (mode === 'idle') {
        elements.status.textContent = 'READY';
        if (hasPlan) {
            elements.nextExercise.textContent = `First: ${currentExerciseName(config.exercises[0])}`;
            elements.nextExercise.hidden = false;
        }
    } else if (mode === 'complete') {
        elements.status.textContent = 'DONE';
    } else if (hasPlan && phase === PHASES.WORK) {
        elements.status.textContent = currentExerciseName(exercise);
    } else {
        elements.status.textContent = phaseLabels[phase] ?? phase.toUpperCase();
        if (hasPlan && phase === PHASES.WARMUP) {
            elements.nextExercise.textContent = `First after warm-up: ${currentExerciseName(config.exercises[0])}`;
            elements.nextExercise.hidden = false;
        } else if (hasPlan && phase === PHASES.REST) {
            elements.nextExercise.textContent = `Next: ${currentExerciseName(exercise)}`;
            elements.nextExercise.hidden = false;
        } else if (hasPlan && phase === PHASES.PAUSE) {
            const nextSetExercise = config.exerciseOrder === 'straight' ? exercise : config.exercises[0];
            elements.nextExercise.textContent = `Next set: ${currentExerciseName(nextSetExercise)}`;
            elements.nextExercise.hidden = false;
        }
    }

    const noteExercise = mode === 'idle' || phase === PHASES.WARMUP
        ? config.exercises[0]
        : phase === PHASES.PAUSE && config.exerciseOrder === 'circuit'
            ? config.exercises[0]
            : exercise;
    const notes = noteExercise ? currentExerciseNotes(noteExercise) : '';
    if (mode !== 'complete' && phase !== PHASES.COOLDOWN && notes) {
        elements.exerciseNote.textContent = notes;
        elements.exerciseNote.hidden = false;
    }

    elements.timerCard.dataset.phase = mode === 'idle' ? 'idle' : phase;
    if (phase === PHASES.COMPLETE) {
        elements.roundCounter.textContent = 'workout complete';
    } else if (phase === PHASES.WARMUP) {
        elements.roundCounter.textContent = 'warm-up';
    } else if (phase === PHASES.COOLDOWN) {
        elements.roundCounter.textContent = 'cool-down';
    } else if (phase === PHASES.PAUSE) {
        elements.roundCounter.textContent = config.exerciseOrder === 'straight'
            ? `${currentExerciseName(exercise)} · set ${set} of ${sets} complete`
            : `set ${set} of ${sets} complete`;
    } else {
        elements.roundCounter.textContent = config.exerciseOrder === 'straight' && hasPlan
            ? `exercise ${round} of ${rounds} · set ${set} of ${sets}`
            : `set ${set} of ${sets} · round ${round} of ${rounds}`;
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
    elements.exerciseOrder.disabled = workoutActive || config.exercises.length === 0;
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

function finishWorkout(announcementDelayMs = 0) {
    mode = 'complete';
    remainingMs = 0;
    clearInterval(intervalId);
    intervalId = null;
    releaseWakeLock();
    announceCurrentPhase(announcementDelayMs);
}

function syncExpiredPhases(now) {
    if (now < phaseEndsAt) return false;

    safelyPlay(alarm);
    vibrate([160, 80, 160]);
    do {
        sequence.next();
        if (sequence.phase === PHASES.COMPLETE) {
            finishWorkout(600);
            return true;
        }
        phaseEndsAt += sequence.duration;
    } while (now >= phaseEndsAt);

    if (sequence.phase === PHASES.WORK) activateExerciseLog(sequence.snapshot());
    lastCountdownSecond = null;
    announceCurrentPhase(600);
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

    const startsNewSession = mode === 'idle' || mode === 'complete';
    if (mode === 'complete') {
        sequence.reset();
        remainingMs = sequence.duration;
    }

    if (startsNewSession) {
        activeSessionId = createId();
        sessionExerciseSelections = new Map();
        hideExerciseLog();
        if (sequence.phase === PHASES.WORK) activateExerciseLog(sequence.snapshot());
    }

    const needsAudioUnlock = !audioUnlocked;
    if (preferences.voiceAnnouncements) speech.prime();
    unlockAudio();
    mode = 'running';
    phaseEndsAt = Date.now() + remainingMs;
    lastCountdownSecond = null;
    clearInterval(intervalId);
    intervalId = window.setInterval(tick, 200);
    acquireWakeLock();
    render();
    announceCurrentPhase(needsAudioUnlock ? 100 : 0);
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
    activeSessionId = null;
    sessionExerciseSelections = new Map();
    hideExerciseLog();
    cancelSpeech();
    releaseWakeLock();
    elements.progress.value = 0;
    render();
    elements.timer.textContent = '00:00';
}

function changeSetting(name, amount) {
    if (mode !== 'idle') return;

    const minimum = name === 'warmupMs' || name === 'cooldownMs'
        ? 0
        : name === 'rounds' || name === 'sets'
            ? 1
            : amount < 0 ? Math.abs(amount) : 1_000;
    const nextValue = Math.max(minimum, config[name] + amount);
    if (nextValue === config[name]) return;

    config[name] = nextValue;
    sequence.updateConfig(config);
    sequence.reset();
    remainingMs = sequence.duration;
    saveActiveConfig();
    updateSettings();
}

function resetAfterPlanChange(message = '', { renderList = true } = {}) {
    config.rounds = config.exercises.length || Math.max(1, config.rounds);
    sequence.updateConfig(config);
    sequence.reset();
    mode = 'idle';
    remainingMs = sequence.duration;
    lastAnnouncementKey = null;
    activeSessionId = null;
    sessionExerciseSelections = new Map();
    hideExerciseLog();
    cancelSpeech();
    saveActiveConfig();
    updateSettings();
    if (renderList) renderExerciseList();
    renderProgressList();
    render();
    elements.timer.textContent = '00:00';
    elements.planMessage.textContent = message;
}

function exerciseIcon(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}

function exerciseTimingMarkup(key, label) {
    return `
        <div class="exercise-timing" data-timing="${key}">
            <div class="exercise-timing-header">
                <span>${label}</span>
                <button class="exercise-use-default" data-plan-control type="button">Use default</button>
            </div>
            <div class="exercise-stepper">
                <button class="exercise-time-button exercise-time-minus" data-plan-control type="button">${exerciseIcon('M5 12h14')}</button>
                <output class="exercise-time-output">
                    <span class="exercise-time-value"></span>
                    <span class="exercise-time-source"></span>
                </output>
                <button class="exercise-time-button exercise-time-plus" data-plan-control type="button">${exerciseIcon('M5 12h14M12 5v14')}</button>
            </div>
        </div>`;
}

function wireExerciseTiming(card, exercise, key, fallbackMs, label) {
    const control = card.querySelector(`[data-timing="${key}"]`);
    const minusButton = control.querySelector('.exercise-time-minus');
    const plusButton = control.querySelector('.exercise-time-plus');
    const defaultButton = control.querySelector('.exercise-use-default');
    const value = control.querySelector('.exercise-time-value');
    const source = control.querySelector('.exercise-time-source');

    minusButton.setAttribute('aria-label', `Reduce ${exercise.name} ${label.toLocaleLowerCase()} time`);
    plusButton.setAttribute('aria-label', `Increase ${exercise.name} ${label.toLocaleLowerCase()} time`);
    defaultButton.setAttribute('aria-label', `Use default ${label.toLocaleLowerCase()} time for ${exercise.name}`);

    const refresh = () => {
        const isCustom = exercise[key] != null;
        value.textContent = formatDuration(exercise[key] ?? fallbackMs);
        source.textContent = isCustom ? 'Custom' : 'Default';
        defaultButton.hidden = !isCustom;
    };

    const adjust = (deltaMs) => {
        exercise[key] = Math.max(1_000, (exercise[key] ?? fallbackMs) + deltaMs);
        resetAfterPlanChange(`${label} time updated.`, { renderList: false });
        refresh();
    };

    bindRepeatingAction(minusButton, () => adjust(-5_000));
    bindRepeatingAction(plusButton, () => adjust(5_000));
    defaultButton.addEventListener('click', () => {
        exercise[key] = null;
        resetAfterPlanChange(`${label} time now uses the default.`, { renderList: false });
        refresh();
    });
    refresh();
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
                ${exerciseTimingMarkup('workMs', 'Work')}
                ${exerciseTimingMarkup('restMs', 'Prep')}
                <div class="exercise-order">
                    <button class="compact-icon-button exercise-up" data-plan-control type="button" aria-label="Move ${index + 1} up" title="Move up" ${index === 0 ? 'disabled' : ''}>${exerciseIcon('m6 14 6-6 6 6')}</button>
                    <button class="compact-icon-button exercise-down" data-plan-control type="button" aria-label="Move ${index + 1} down" title="Move down" ${index === config.exercises.length - 1 ? 'disabled' : ''}>${exerciseIcon('m6 10 6 6 6-6')}</button>
                </div>
            </div>
            <label class="exercise-notes-label">
                <span>Voice name <small>(optional)</small></span>
                <input class="exercise-speech-name" data-plan-control type="text" maxlength="80" placeholder="e.g. Lat pulldown" aria-label="Voice name for exercise ${index + 1}">
            </label>
            <label class="exercise-notes-label">
                <span>Notes</span>
                <textarea class="exercise-notes" data-plan-control rows="2" maxlength="500" placeholder="Weight, reps, technique cues…" aria-label="Notes for exercise ${index + 1}"></textarea>
            </label>`;

        const nameInput = card.querySelector('.exercise-name');
        const speechNameInput = card.querySelector('.exercise-speech-name');
        const notesInput = card.querySelector('.exercise-notes');
        nameInput.value = exercise.name;
        speechNameInput.value = exercise.speechName;
        notesInput.value = exercise.notes;

        nameInput.addEventListener('change', () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.value = exercise.name;
                return;
            }
            exercise.name = name;
            resetAfterPlanChange('Exercise updated.', { renderList: false });
        });

        speechNameInput.addEventListener('input', () => {
            exercise.speechName = speechNameInput.value.trim().slice(0, 80);
            saveActiveConfig();
        });

        notesInput.addEventListener('input', () => {
            exercise.notes = notesInput.value;
            saveActiveConfig();
            updatePhaseDisplay();
        });

        wireExerciseTiming(card, exercise, 'workMs', config.workMs, 'Work');
        wireExerciseTiming(card, exercise, 'restMs', config.restMs, 'Prep');

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
    const normalized = normalizeConfiguration({
        ...defaultConfig,
        ...item,
        exercises: item.exercises ?? [],
        planName: item.name ?? item.planName
    });
    if (!normalized) return;

    for (const key of ['planName', 'exerciseOrder', 'warmupMs', 'workMs', 'restMs', 'pauseMs', 'cooldownMs', 'rounds', 'sets']) {
        config[key] = normalized[key];
    }
    config.exercises = normalized.exercises.map((exercise) => ({ ...exercise }));
    activeSessionId = null;
    sessionExerciseSelections = new Map();
    hideExerciseLog();
    sequence.updateConfig(config);
    sequence.reset();
    mode = 'idle';
    remainingMs = sequence.duration;
    lastAnnouncementKey = null;
    cancelSpeech();
    saveActiveConfig();
    updateSettings();
    renderExerciseList();
    renderProgressList();
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

const activeAdjustmentPresses = new Map();

function repeatAdjustment(button, state) {
    if (activeAdjustmentPresses.get(button) !== state || button.disabled) return;

    state.action();
    const elapsed = performance.now() - state.startedAt;
    const delay = elapsed > 2_000 ? 45 : elapsed > 1_000 ? 65 : 90;
    state.timerId = window.setTimeout(() => repeatAdjustment(button, state), delay);
}

function stopAdjustmentRepeat(button) {
    const state = activeAdjustmentPresses.get(button);
    if (!state) return;

    clearTimeout(state.timerId);
    activeAdjustmentPresses.delete(button);
}

function stopAllAdjustmentRepeats() {
    for (const button of activeAdjustmentPresses.keys()) {
        stopAdjustmentRepeat(button);
    }
}

function bindRepeatingAction(button, action) {
    button.title = 'Press and hold to adjust quickly';

    button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || button.disabled) return;
        event.preventDefault();
        stopAdjustmentRepeat(button);
        button.setPointerCapture?.(event.pointerId);
        action();

        const state = {
            action,
            startedAt: performance.now(),
            timerId: null
        };
        state.timerId = window.setTimeout(() => repeatAdjustment(button, state), 380);
        activeAdjustmentPresses.set(button, state);
    });

    button.addEventListener('pointerup', () => stopAdjustmentRepeat(button));
    button.addEventListener('pointercancel', () => stopAdjustmentRepeat(button));
    button.addEventListener('lostpointercapture', () => stopAdjustmentRepeat(button));

    button.addEventListener('click', (event) => {
        if (event.detail === 0 || !('PointerEvent' in window)) {
            action();
        }
    });
}

elements.settingButtons.forEach((button) => {
    bindRepeatingAction(button, () => {
        changeSetting(button.dataset.setting, Number(button.dataset.change));
    });
});

elements.exerciseOrder.addEventListener('change', () => {
    if (mode !== 'idle' || !config.exercises.length) return;
    config.exerciseOrder = elements.exerciseOrder.value;
    resetAfterPlanChange(config.exerciseOrder === 'straight'
        ? 'Exercise-by-exercise order enabled.'
        : 'Circuit order enabled.');
});

elements.setLogForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!activeLogContext) return;

    const reps = Number(elements.repsInput.value);
    const rir = Number(elements.rirInput.value);
    const load = activeLogContext.profile.type === 'load' && elements.loadInput.value !== ''
        ? Number(elements.loadInput.value)
        : null;
    if (!Number.isInteger(reps) || reps < 1 || !Number.isInteger(rir) || rir < 0 || rir > 3) return;
    if (load != null && (!Number.isFinite(load) || load < 0)) return;

    const entry = {
        id: createId(),
        sessionId: activeLogContext.sessionId,
        planName: activeLogContext.planName,
        trackingId: activeLogContext.trackingId,
        exerciseName: activeLogContext.exerciseName,
        set: activeLogContext.set,
        reps,
        rir,
        load,
        variant: activeLogContext.profile.type === 'variant' ? elements.variantInput.value : '',
        completedAt: new Date().toISOString()
    };
    const existingIndex = progressHistory.findIndex((item) => item.sessionId === entry.sessionId
        && item.trackingId === entry.trackingId
        && item.set === entry.set);
    if (existingIndex >= 0) {
        entry.id = progressHistory[existingIndex].id;
        progressHistory[existingIndex] = entry;
    } else {
        progressHistory.push(entry);
    }

    saveProgressHistory();
    renderProgressList();
    elements.setLogButton.textContent = 'Aktualisieren';
    elements.setLogMessage.textContent = 'Satz gespeichert.';
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
    lastAnnouncementKey = null;

    if (preferences.voiceAnnouncements) {
        speech.prime();
        if (mode === 'running' || mode === 'paused') announceCurrentPhase();
        else speak('Voice announcements enabled');
    } else cancelSpeech();
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
        trackingId: trackingIdFor(name),
        name,
        speechName: '',
        workMs: null,
        restMs: null,
        notes: '',
        progression: normalizeProgression(),
        alternatives: []
    });
    elements.newExerciseName.value = '';
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
            exerciseOrder: config.exerciseOrder,
            warmupMs: config.warmupMs,
            workMs: config.workMs,
            restMs: config.restMs,
            pauseMs: config.pauseMs,
            cooldownMs: config.cooldownMs,
            rounds: config.rounds,
            sets: config.sets,
            exercises: config.exercises.map(({
                trackingId, name, speechName, workMs, restMs, notes, progression, alternatives
            }) => ({ trackingId, name, speechName, workMs, restMs, notes, progression, alternatives }))
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
    if (document.visibilityState === 'hidden') stopAllAdjustmentRepeats();
    if (document.visibilityState === 'visible' && mode === 'running') {
        tick();
        acquireWakeLock();
    }
});

window.addEventListener('blur', stopAllAdjustmentRepeats);

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
renderProgressList();
render();
elements.timer.textContent = '00:00';
