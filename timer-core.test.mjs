import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, phaseAnnouncement, PHASES, WorkoutSequence } from './timer-core.mjs';

const defaults = {
    warmupMs: 300_000,
    workMs: 20_000,
    restMs: 10_000,
    pauseMs: 120_000,
    cooldownMs: 300_000,
    rounds: 3,
    sets: 2
};

test('formats durations without wrapping after nine minutes', () => {
    assert.equal(formatDuration(0), '00:00');
    assert.equal(formatDuration(20_000), '00:20');
    assert.equal(formatDuration(610_000), '10:10');
});

test('builds concise voice announcements for plans and interval mode', () => {
    assert.equal(
        phaseAnnouncement({ phase: PHASES.WARMUP, nextExerciseName: 'Squats' }),
        'Warm-up. First exercise: Squats'
    );
    assert.equal(phaseAnnouncement({ phase: PHASES.WORK, exerciseName: 'Squats' }), 'Squats');
    assert.equal(
        phaseAnnouncement({ phase: PHASES.REST, nextExerciseName: 'Push-ups' }),
        'Rest. Next: Push-ups'
    );
    assert.equal(
        phaseAnnouncement({ phase: PHASES.PAUSE, nextExerciseName: 'Squats' }),
        'Set complete. Next set starts with Squats'
    );
    assert.equal(phaseAnnouncement({ phase: PHASES.WORK }), 'Work');
    assert.equal(phaseAnnouncement({ phase: PHASES.COOLDOWN }), 'Cool-down');
    assert.equal(phaseAnnouncement({ phase: PHASES.COMPLETE }), 'Workout complete');
});

test('runs warm-up once, starts with work and rests only between rounds', () => {
    const sequence = new WorkoutSequence(defaults);
    const states = [sequence.snapshot()];

    for (let index = 0; index < 6; index += 1) {
        states.push(sequence.next());
    }

    assert.deepEqual(
        states.map(({ phase, round }) => [phase, round]),
        [
            [PHASES.WARMUP, 1],
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
    const sequence = new WorkoutSequence({ ...defaults, rounds: 1, sets: 2 });

    sequence.next();
    sequence.next();
    assert.deepEqual(sequence.next(), {
        phase: PHASES.WORK,
        round: 1,
        set: 2,
        duration: defaults.workMs,
        rounds: 1,
        sets: 2,
        exercise: null
    });
});

test('runs cool-down once after the final work interval', () => {
    const sequence = new WorkoutSequence({ ...defaults, rounds: 1, sets: 1 });

    sequence.next();
    assert.equal(sequence.next().phase, PHASES.COOLDOWN);
    assert.equal(sequence.duration, defaults.cooldownMs);
    assert.equal(sequence.next().phase, PHASES.COMPLETE);
});

test('derives rounds and phase durations from a training plan', () => {
    const sequence = new WorkoutSequence({
        ...defaults,
        rounds: 99,
        exercises: [
            { name: 'Squats', workMs: 45_000, restMs: 15_000, notes: 'Keep knees tracking over toes' },
            { name: 'Push-ups', workMs: 30_000, restMs: null }
        ]
    });

    assert.deepEqual(sequence.snapshot(), {
        phase: PHASES.WARMUP,
        round: 1,
        set: 1,
        duration: defaults.warmupMs,
        rounds: 2,
        sets: defaults.sets,
        exercise: {
            name: 'Squats',
            workMs: 45_000,
            restMs: 15_000,
            notes: 'Keep knees tracking over toes'
        }
    });
    assert.equal(sequence.next().duration, 45_000);
    sequence.next();
    assert.equal(sequence.snapshot().exercise.name, 'Push-ups');
    assert.equal(sequence.duration, defaults.restMs);
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
    assert.throws(
        () => new WorkoutSequence({ ...defaults, sets: 0 }),
        /sets must be a positive integer/
    );
    assert.throws(
        () => new WorkoutSequence({ ...defaults, exercises: [{ name: '' }] }),
        /must have a name/
    );
});
