export const PHASES = Object.freeze({
    REST: 'rest',
    WORK: 'work',
    PAUSE: 'pause',
    COMPLETE: 'complete'
});

const MIN_DURATION_MS = 1000;

function assertDuration(value, name) {
    if (!Number.isFinite(value) || value < MIN_DURATION_MS) {
        throw new RangeError(`${name} must be at least ${MIN_DURATION_MS} ms`);
    }
}

function assertCount(value, name) {
    if (!Number.isInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer`);
    }
}

export function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export class WorkoutSequence {
    constructor({ workMs, restMs, pauseMs, rounds, sets }) {
        this.updateConfig({ workMs, restMs, pauseMs, rounds, sets });
        this.reset();
    }

    updateConfig({ workMs, restMs, pauseMs, rounds, sets }) {
        assertDuration(workMs, 'workMs');
        assertDuration(restMs, 'restMs');
        assertDuration(pauseMs, 'pauseMs');
        assertCount(rounds, 'rounds');
        assertCount(sets, 'sets');

        this.config = { workMs, restMs, pauseMs, rounds, sets };
    }

    reset() {
        this.phase = PHASES.REST;
        this.round = 1;
        this.set = 1;
    }

    get duration() {
        const durationByPhase = {
            [PHASES.REST]: this.config.restMs,
            [PHASES.WORK]: this.config.workMs,
            [PHASES.PAUSE]: this.config.pauseMs,
            [PHASES.COMPLETE]: 0
        };

        return durationByPhase[this.phase];
    }

    next() {
        if (this.phase === PHASES.REST) {
            this.phase = PHASES.WORK;
        } else if (this.phase === PHASES.WORK && this.round < this.config.rounds) {
            this.round += 1;
            this.phase = PHASES.REST;
        } else if (this.phase === PHASES.WORK && this.set < this.config.sets) {
            this.phase = PHASES.PAUSE;
        } else if (this.phase === PHASES.WORK) {
            this.phase = PHASES.COMPLETE;
        } else if (this.phase === PHASES.PAUSE) {
            this.set += 1;
            this.round = 1;
            this.phase = PHASES.REST;
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
            sets: this.config.sets
        };
    }
}
