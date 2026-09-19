export class SpeechController {
    constructor({ synthesis, Utterance, language = 'en' }) {
        this.synthesis = synthesis;
        this.Utterance = Utterance;
        this.language = language;
        this.activeUtterances = new Set();
        this.preferredVoice = null;
        this.primed = false;

        if (!this.supported) return;

        this.refreshVoices();
        this.synthesis.addEventListener?.('voiceschanged', () => this.refreshVoices());
    }

    get supported() {
        return Boolean(this.synthesis && this.Utterance);
    }

    refreshVoices() {
        if (!this.supported || typeof this.synthesis.getVoices !== 'function') return;

        const voices = this.synthesis.getVoices();
        const requestedLanguage = this.language.toLocaleLowerCase();
        const requestedBase = requestedLanguage.split('-')[0];
        this.preferredVoice = voices.find((voice) => voice.lang.toLocaleLowerCase() === requestedLanguage)
            ?? voices.find((voice) => voice.lang.toLocaleLowerCase().split('-')[0] === requestedBase)
            ?? null;
    }

    createUtterance(text, { volume = 1 } = {}) {
        const utterance = new this.Utterance(text);
        utterance.lang = this.preferredVoice?.lang ?? this.language;
        utterance.rate = 1;
        utterance.volume = volume;
        if (this.preferredVoice) utterance.voice = this.preferredVoice;

        const release = () => this.activeUtterances.delete(utterance);
        utterance.addEventListener?.('end', release, { once: true });
        utterance.addEventListener?.('error', release, { once: true });
        utterance.onend ??= release;
        utterance.onerror ??= release;
        return utterance;
    }

    enqueue(text, options) {
        if (!this.supported || !text) return false;

        const utterance = this.createUtterance(text, options);
        this.activeUtterances.add(utterance);
        if (this.synthesis.paused) this.synthesis.resume();
        this.synthesis.speak(utterance);
        return true;
    }

    prime() {
        if (!this.supported || this.primed) return false;

        // WebKit on iOS only removes its speech restriction when speak() is
        // called while a user gesture is active. A silent utterance unlocks
        // later timer-driven announcements without producing duplicate audio.
        this.primed = this.enqueue('\u00a0', { volume: 0 });
        return this.primed;
    }

    speak(text) {
        return this.enqueue(text);
    }

    cancel() {
        if (!this.supported) return;
        this.synthesis.cancel();
        this.activeUtterances.clear();
    }
}
