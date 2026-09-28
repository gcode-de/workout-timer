import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chooseAlternatingExercise,
    recommendProgression,
    sessionsForExercise,
    summarizeProgress
} from './progression-core.mjs';

const loadProfile = {
    type: 'load',
    minReps: 8,
    maxReps: 12,
    increment: 5,
    initialLoad: 30,
    initialReps: 10,
    unit: 'kg'
};

function entry(sessionId, set, reps, rir, load = 30, completedAt = '2026-09-28T10:00:00.000Z') {
    return { sessionId, trackingId: 'lat-pulldown', set, reps, rir, load, completedAt };
}

test('starts with the configured load and repetitions', () => {
    const recommendation = recommendProgression(loadProfile, [], 'lat-pulldown', { expectedSets: 2 });
    assert.equal(recommendation.text, '30 kg · 2 × 10');
});

test('adds a repetition while staying inside the target range', () => {
    const history = [entry('one', 1, 10, 2), entry('one', 2, 10, 2)];
    const recommendation = recommendProgression(loadProfile, history, 'lat-pulldown', { expectedSets: 2 });
    assert.equal(recommendation.action, 'add-rep');
    assert.equal(recommendation.reps, 11);
    assert.equal(recommendation.load, 30);
});

test('increases load only after all sets reach the top with reserve', () => {
    const history = [entry('one', 1, 12, 2), entry('one', 2, 12, 1)];
    const recommendation = recommendProgression(loadProfile, history, 'lat-pulldown', { expectedSets: 2 });
    assert.equal(recommendation.action, 'increase-load');
    assert.equal(recommendation.load, 35);
    assert.equal(recommendation.reps, 8);
});

test('does not increase after an incomplete session', () => {
    const history = [entry('one', 1, 12, 2)];
    const recommendation = recommendProgression(loadProfile, history, 'lat-pulldown', { expectedSets: 2 });
    assert.equal(recommendation.action, 'repeat');
    assert.equal(recommendation.load, 30);
    assert.equal(recommendation.reps, 12);
});

test('recommends the least recently used alternating exercise', () => {
    const alternatives = [
        { trackingId: 'row', name: 'Kabelrudern' },
        { trackingId: 'press', name: 'Schulterdrücken' }
    ];
    const history = [{
        sessionId: 'one',
        trackingId: 'row',
        set: 1,
        reps: 10,
        rir: 2,
        completedAt: '2026-09-28T10:00:00.000Z'
    }];

    assert.equal(chooseAlternatingExercise(alternatives, history).trackingId, 'press');
});

test('groups entries by session and builds a compact summary', () => {
    const history = [entry('one', 2, 10, 2), entry('one', 1, 11, 2)];
    assert.deepEqual(sessionsForExercise(history, 'lat-pulldown')[0].map(({ set }) => set), [1, 2]);
    assert.match(summarizeProgress(loadProfile, history, 'lat-pulldown', 2).last, /11 \/ 10 Wdh/);
});
