export const PHASES = Object.freeze({
    REST: 'rest',
    WORK: 'work',
    PAUSE: 'pause'
});

const MIN_DURATION_MS = 1000;

function assertDuration(value, name) {
    if (!Number.isFinite(value) || value < MIN_DURATION_MS) {
        throw new RangeError(`${name} must be at least ${MIN_DURATION_MS} ms`);
    }
}

function assertRounds(value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError('rounds must be a positive integer');
    }
}

export function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export class WorkoutSequence {
    constructor({ workMs, restMs, pauseMs, rounds }) {
        this.updateConfig({ workMs, restMs, pauseMs, rounds });
        this.reset();
    }

    updateConfig({ workMs, restMs, pauseMs, rounds }) {
        assertDuration(workMs, 'workMs');
        assertDuration(restMs, 'restMs');
        assertDuration(pauseMs, 'pauseMs');
        assertRounds(rounds);

        this.config = { workMs, restMs, pauseMs, rounds };
    }

    reset() {
        this.phase = PHASES.REST;
        this.round = 1;
    }

    get duration() {
        const durationByPhase = {
            [PHASES.REST]: this.config.restMs,
            [PHASES.WORK]: this.config.workMs,
            [PHASES.PAUSE]: this.config.pauseMs
        };

        return durationByPhase[this.phase];
    }

    next() {
        if (this.phase === PHASES.REST) {
            this.phase = PHASES.WORK;
        } else if (this.phase === PHASES.WORK && this.round < this.config.rounds) {
            this.round += 1;
            this.phase = PHASES.REST;
        } else if (this.phase === PHASES.WORK) {
            this.phase = PHASES.PAUSE;
        } else {
            this.round = 1;
            this.phase = PHASES.REST;
        }

        return this.snapshot();
    }

    snapshot() {
        return {
            phase: this.phase,
            round: this.round,
            duration: this.duration,
            rounds: this.config.rounds
        };
    }
}
