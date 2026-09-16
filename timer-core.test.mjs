import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, PHASES, WorkoutSequence } from './timer-core.mjs';

const defaults = { workMs: 20_000, restMs: 10_000, pauseMs: 120_000, rounds: 3 };

test('formats durations without wrapping after nine minutes', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(20_000), '00:20');
    assert.equal(formatDuration(610_000), '10:10');
});

test('runs rest and work for every round before the set pause', () => {
    const sequence = new WorkoutSequence(defaults);
    const states = [sequence.snapshot()];

    for (let index = 0; index < 6; index += 1) {
        states.push(sequence.next());
    }

    assert.deepEqual(
        states.map(({ phase, round }) => [phase, round]),
        [
            [PHASES.REST, 1],
            [PHASES.WORK, 1],
            [PHASES.REST, 2],
            [PHASES.WORK, 2],
            [PHASES.REST, 3],
            [PHASES.WORK, 3],
            [PHASES.PAUSE, 3]
        ]
    );
});

test('starts a fresh set after the pause', () => {
    const sequence = new WorkoutSequence({ ...defaults, rounds: 1 });

    sequence.next();
    sequence.next();
    assert.deepEqual(sequence.next(), {
        phase: PHASES.REST,
        round: 1,
        duration: defaults.restMs,
        rounds: 1
    });
});

test('rejects zero durations and zero rounds', () => {
    assert.throws(
        () => new WorkoutSequence({ ...defaults, workMs: 0 }),
        /workMs must be at least/
    );
    assert.throws(
        () => new WorkoutSequence({ ...defaults, rounds: 0 }),
        /rounds must be a positive integer/
    );
});
