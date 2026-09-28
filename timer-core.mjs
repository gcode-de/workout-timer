export const PHASES = Object.freeze({
    WARMUP: 'warmup',
    REST: 'rest',
    WORK: 'work',
    PAUSE: 'pause',
    COOLDOWN: 'cooldown',
    COMPLETE: 'complete'
});

const MIN_DURATION_MS = 1000;

function assertDuration(value, name) {
    if (!Number.isFinite(value) || value < MIN_DURATION_MS) {
        throw new RangeError(`${name} must be at least ${MIN_DURATION_MS} ms`);
    }
}

function assertOptionalPhaseDuration(value, name) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be zero or a positive duration`);
    }
}

function assertCount(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer`);
    }
}

function normalizeExercises(exercises = []) {
    if (!Array.isArray(exercises)) {
        throw new TypeError('exercises must be an array');
    }

    return exercises.map((exercise, index) => {
        if (typeof exercise?.name !== 'string' || !exercise.name.trim()) {
            throw new TypeError(`exercise ${index + 1} must have a name`);
        }
        if (exercise.workMs != null) assertDuration(exercise.workMs, `exercise ${index + 1} workMs`);
        if (exercise.restMs != null) assertDuration(exercise.restMs, `exercise ${index + 1} restMs`);

        return {
            ...exercise,
            name: exercise.name.trim(),
            workMs: exercise.workMs ?? null,
            restMs: exercise.restMs ?? null
        };
    });
}

export function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function phaseAnnouncement({ phase, exerciseName = '', nextExerciseName = '' }) {
    if (phase === PHASES.WARMUP) {
        return nextExerciseName ? `Warm-up. First exercise: ${nextExerciseName}` : 'Warm-up';
    }
    if (phase === PHASES.WORK) return exerciseName || 'Work';
    if (phase === PHASES.REST) return nextExerciseName ? `Rest. Next: ${nextExerciseName}` : 'Rest';
    if (phase === PHASES.PAUSE) {
        return nextExerciseName
            ? `Set complete. Next set starts with ${nextExerciseName}`
            : 'Set complete';
    }
    if (phase === PHASES.COOLDOWN) return 'Cool-down';
    if (phase === PHASES.COMPLETE) return 'Workout complete';
    return '';
}

export class WorkoutSequence {
    constructor({ warmupMs, workMs, restMs, pauseMs, cooldownMs, rounds, sets, exercises = [] }) {
        this.updateConfig({ warmupMs, workMs, restMs, pauseMs, cooldownMs, rounds, sets, exercises });
        this.reset();
    }

    updateConfig({ warmupMs, workMs, restMs, pauseMs, cooldownMs, rounds, sets, exercises = [] }) {
        assertOptionalPhaseDuration(warmupMs, 'warmupMs');
        assertDuration(workMs, 'workMs');
        assertDuration(restMs, 'restMs');
        assertDuration(pauseMs, 'pauseMs');
        assertOptionalPhaseDuration(cooldownMs, 'cooldownMs');
        assertCount(rounds, 'rounds');
        assertCount(sets, 'sets');

        const normalizedExercises = normalizeExercises(exercises);
        this.config = {
            warmupMs,
            workMs,
            restMs,
            pauseMs,
            cooldownMs,
            rounds: normalizedExercises.length || rounds,
            sets,
            exercises: normalizedExercises
        };
    }

    reset() {
        this.phase = this.config.warmupMs === 0 ? PHASES.WORK : PHASES.WARMUP;
        this.round = 1;
        this.set = 1;
    }

    get duration() {
        const exercise = this.config.exercises[this.round - 1];
        const durationByPhase = {
            [PHASES.WARMUP]: this.config.warmupMs,
            [PHASES.REST]: exercise?.restMs ?? this.config.restMs,
            [PHASES.WORK]: exercise?.workMs ?? this.config.workMs,
            [PHASES.PAUSE]: this.config.pauseMs,
            [PHASES.COOLDOWN]: this.config.cooldownMs,
            [PHASES.COMPLETE]: 0
        };

        return durationByPhase[this.phase];
    }

    next() {
        if (this.phase === PHASES.WARMUP || this.phase === PHASES.REST) {
            this.phase = PHASES.WORK;
        } else if (this.phase === PHASES.WORK && this.round < this.config.rounds) {
            this.round += 1;
            this.phase = PHASES.REST;
        } else if (this.phase === PHASES.WORK && this.set < this.config.sets) {
            this.phase = PHASES.PAUSE;
        } else if (this.phase === PHASES.WORK) {
            this.phase = this.config.cooldownMs === 0 ? PHASES.COMPLETE : PHASES.COOLDOWN;
        } else if (this.phase === PHASES.PAUSE) {
            this.set += 1;
            this.round = 1;
            this.phase = PHASES.WORK;
        } else if (this.phase === PHASES.COOLDOWN) {
            this.phase = PHASES.COMPLETE;
        } else {
            this.reset();
        }

        return this.snapshot();
    }

    snapshot() {
        return {
            phase: this.phase,
            round: this.round,
            set: this.set,
            duration: this.duration,
            rounds: this.config.rounds,
            sets: this.config.sets,
            exercise: this.config.exercises[this.round - 1] ?? null
        };
    }
}
