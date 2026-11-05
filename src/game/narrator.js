// Narrator: reads the opening story aloud in a warm, playful storyteller voice using the
// device's own speech synthesis (no audio files, nothing to download, works offline). Voices differ
// by device, so we pick the friendliest English voice available. Words in quotation marks (Pip's
// own thoughts) are spoken a little higher and bouncier, like a character voice.

// Best first: natural / enhanced friendly voices, then good standard ones, then any clear English.
const PREFERRED = [
  /Microsoft (Ana|Aria|Jenny|Ava|Emma|Sonia|Libby|Maisie) Online \(Natural\)/i,
  /\b(Samantha|Karen|Moira|Tessa|Serena|Kate|Stephanie|Fiona|Martha)\b.*\((Premium|Enhanced)\)/i,
  /Google UK English Female/i,
  /Google US English/i,
  /^(Samantha|Karen|Moira|Tessa|Serena|Kate|Fiona|Martha|Victoria|Allison|Ava|Susan)\b/i,
  /^(Daniel|Oliver|Jamie|Aaron|Tom|Alex)\b/i,
];
// Novelty voices that should never narrate.
const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Grandma|Grandpa|Rocko|Shelley|Flo|Eddy|Reed|Sandy)\b/i;

import { NARRATION_FILES } from '../data/narration.js';

const VOICE = { rate: 1.0, pitch: 1.12 }; // a cheerful storyteller
const THOUGHT = { rate: 1.06, pitch: 1.45 }; // Pip's own little voice

export class Narrator {
  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.enabled = true;
    this.muted = false;
    // Automated test runs stay silent and fast.
    this.automation = typeof navigator !== 'undefined' && navigator.webdriver === true;
    this.voice = null;
    this.open = new Set(); // finish callbacks of lines not yet spoken
    this.clips = new Set(); // recorded clips queued or playing
    this.chain = Promise.resolve();
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

  /**
   * Queues a line. A recorded clip is played when one exists for `id` (data/narration.js);
   * otherwise the device voice reads it (quoted thoughts in Pip's voice). Resolves when done.
   */
  say(text, id) {
    if (!this.active) return Promise.resolve();
    if (id && NARRATION_FILES[id]) return this._clip(`${import.meta.env.BASE_URL || '/'}audio/narration/${NARRATION_FILES[id]}`);
    const parts = text.split(/(“[^”]*”|"[^"]*")/).filter((p) => p.trim());
    return Promise.all(parts.map((p) => {
      const thought = /^[“"]/.test(p);
      return this._utter(p.replace(/[“”"]/g, ''), thought ? THOUGHT : VOICE);
    })).then(() => {});
  }

  _utter(text, { rate, pitch }) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text.replace(/…/g, '...').replace(/\s*—\s*/g, ', '));
      if (this.voice) {
        u.voice = this.voice;
        u.lang = this.voice.lang;
      } else u.lang = 'en-GB';
      u.rate = rate;
      u.pitch = pitch;
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

  /** Plays recorded narration, one clip after another. */
  _clip(url) {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      const finish = () => {
        if (!this.open.has(finish)) return;
        this.open.delete(finish);
        this.clips.delete(audio);
        audio.pause();
        resolve();
      };
      this.open.add(finish);
      this.clips.add(audio);
      this.chain = this.chain.then(
        () =>
          new Promise((next) => {
            if (!this.open.has(finish)) return next();
            const done = () => {
              finish();
              next();
            };
            audio.onended = done;
            audio.onerror = done;
            audio.play().catch(done);
          }),
      );
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
    if (this.synth) this.synth.cancel();
    for (const finish of [...this.open]) finish();
    this.chain = Promise.resolve();
  }

  pause() {
    if (this.synth && this.open.size) this.synth.pause();
    for (const a of this.clips) a.pause();
  }

  resume() {
    if (this.synth) this.synth.resume();
    for (const a of this.clips) if (a.currentTime > 0 && !a.ended) a.play().catch(() => {});
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
