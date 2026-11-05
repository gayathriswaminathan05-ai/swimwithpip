// Narrator: reads the opening story aloud in a calm, documentary-style voice using the device's
// own speech synthesis (no audio files, nothing to download, works offline). Voices differ by
// device, so we pick the best English narrator voice available and slow it down a little.

// Best first: natural / enhanced voices, then good standard ones. British male voices suit the
// nature-documentary tone best; any clear English voice is the fallback.
const PREFERRED = [
  /Microsoft (Ryan|Thomas|Guy|Christopher|Andrew|Brian|Eric|Davis) Online \(Natural\)/i,
  /\b(Daniel|Arthur|Oliver|Malcolm|Jamie|Lee|Tom|Evan|Nathan|Aaron)\b.*\((Premium|Enhanced)\)/i,
  /Google UK English Male/i,
  /^(Daniel|Arthur|Oliver|Malcolm|Jamie)\b/i,
  /^(Aaron|Tom|Evan|Nathan|Alex|Lee)\b/i,
];
// Novelty voices that should never narrate.
const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Grandma|Grandpa|Rocko|Shelley|Flo|Eddy|Reed|Sandy)\b/i;

export class Narrator {
  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.enabled = true;
    this.muted = false;
    // Automated test runs stay silent and fast.
    this.automation = typeof navigator !== 'undefined' && navigator.webdriver === true;
    this.voice = null;
    this.open = new Set(); // finish callbacks of lines not yet spoken
    if (this.synth) {
      this._pick();
      this.synth.addEventListener?.('voiceschanged', () => this._pick());
    }
  }

  /** Speech synthesis exists on this device (the setting is hidden otherwise). */
  get available() {
    return !!this.synth;
  }

  get active() {
    return this.available && this.enabled && !this.muted && !this.automation;
  }

  _pick() {
    const voices = this.synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang) && !NOVELTY.test(v.name));
    if (!voices.length) return;
    for (const re of PREFERRED) {
      const hit = voices.find((v) => re.test(v.name));
      if (hit) {
        this.voice = hit;
        return;
      }
    }
    this.voice = voices.find((v) => /en[-_]GB/i.test(v.lang)) || voices.find((v) => /en[-_]US/i.test(v.lang)) || voices[0];
  }

  /** Queues a line. Resolves once it has been spoken (or stopped, or failed). */
  say(text) {
    if (!this.active) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text.replace(/…/g, '...').replace(/—/g, ','));
      if (this.voice) {
        u.voice = this.voice;
        u.lang = this.voice.lang;
      } else u.lang = 'en-GB';
      u.rate = 0.88; // unhurried
      u.pitch = 0.86; // a touch deeper
      u.volume = 1;
      let guard = 0;
      const finish = () => {
        if (!this.open.has(finish)) return;
        this.open.delete(finish);
        clearTimeout(guard);
        resolve();
      };
      this.open.add(finish);
      u.onend = finish;
      u.onerror = finish;
      // Some browsers never fire "end": move on after a generous estimate of the line's length.
      guard = setTimeout(finish, 3000 + text.length * 120);
      this.synth.speak(u);
    });
  }

  /** Resolves when every queued line has been spoken. */
  idle() {
    if (!this.open.size) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => (this.open.size ? setTimeout(check, 120) : resolve());
      check();
    });
  }

  stop() {
    if (!this.synth) return;
    this.synth.cancel();
    for (const finish of [...this.open]) finish();
  }

  pause() {
    if (this.synth && this.open.size) this.synth.pause();
  }

  resume() {
    if (this.synth) this.synth.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop();
  }

  setMuted(m) {
    this.muted = m;
    if (m) this.stop();
  }
}
