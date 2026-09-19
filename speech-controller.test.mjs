import test from 'node:test';
import assert from 'node:assert/strict';
import { SpeechController } from './speech-controller.mjs';

class FakeUtterance {
    constructor(text) {
        this.text = text;
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    dispatch(type) {
        this.listeners.get(type)?.();
    }
}

function createSynthesis(voices = []) {
    return {
        voices,
        spoken: [],
        cancelCalls: 0,
        resumeCalls: 0,
        paused: false,
        getVoices() { return this.voices; },
        speak(utterance) { this.spoken.push(utterance); },
        cancel() { this.cancelCalls += 1; },
        resume() { this.resumeCalls += 1; },
        addEventListener() {}
    };
}

test('primes iOS speech once with a retained silent utterance', () => {
    const synthesis = createSynthesis();
    const controller = new SpeechController({ synthesis, Utterance: FakeUtterance, language: 'de-DE' });

    assert.equal(controller.prime(), true);
    assert.equal(controller.prime(), false);
    assert.equal(synthesis.spoken.length, 1);
    assert.equal(synthesis.spoken[0].text, '\u00a0');
    assert.equal(synthesis.spoken[0].volume, 0);
    assert.equal(controller.activeUtterances.size, 1);

    synthesis.spoken[0].dispatch('end');
    assert.equal(controller.activeUtterances.size, 0);
});

test('uses the requested-language voice and does not cancel before speaking', () => {
    const germanVoice = { lang: 'de-DE', name: 'German' };
    const synthesis = createSynthesis([{ lang: 'en-US', name: 'English' }, germanVoice]);
    const controller = new SpeechController({ synthesis, Utterance: FakeUtterance, language: 'de-AT' });

    assert.equal(controller.speak('Weiter'), true);
    assert.equal(synthesis.cancelCalls, 0);
    assert.equal(synthesis.spoken[0].voice, germanVoice);
    assert.equal(synthesis.spoken[0].lang, 'de-DE');
});

test('resumes a paused synthesizer and explicitly cancels only on request', () => {
    const synthesis = createSynthesis();
    synthesis.paused = true;
    const controller = new SpeechController({ synthesis, Utterance: FakeUtterance });

    controller.speak('Work');
    assert.equal(synthesis.resumeCalls, 1);

    controller.cancel();
    assert.equal(synthesis.cancelCalls, 1);
    assert.equal(controller.activeUtterances.size, 0);
});
