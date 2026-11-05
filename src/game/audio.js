// All sound is synthesised with the Web Audio API — no audio files to download or license.
// The context is created on the first user gesture (browsers require this).

const PENTA = [
  [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33], // Lost Waters (C major pentatonic)
  [220.0, 261.63, 293.66, 329.63, 392.0, 440.0], // Depths (A minor pentatonic)
  [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46], // Glowing Home (D minor-ish, brighter)
];
const DRONES = [
  [55, 82.41],
  [46.25, 69.3],
  [65.41, 98.0],
];

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.zone = 0;
    this.musicTimer = 0;
    this.enabled = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this._build();
    }
    if (this.ctx.state === 'suspended' && !this.muted) this.ctx.resume().catch(() => {});
  }

  _build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.comp = ctx.createDynamicsCompressor();
    this.master.connect(this.comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    // Echo bus for music / chimes.
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 1800;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    this.delay.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);
    this.music.connect(this.delay);

    // Underwater wash: looping brown noise through a slowly moving low-pass.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    this.noiseBuf = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.washFilter = ctx.createBiquadFilter();
    this.washFilter.type = 'lowpass';
    this.washFilter.frequency.value = 380;
    const washGain = ctx.createGain();
    washGain.gain.value = 0.32;
    src.connect(this.washFilter).connect(washGain).connect(this.master);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(this.washFilter.frequency);
    lfo.start();

    // Drone pad.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.05;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 500;
    this.droneGain.connect(droneFilter).connect(this.master);
    this.drones = DRONES[0].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(this.droneGain);
      o.start();
      return o;
    });
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, t, 0.05);
    if (!m && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) this.ctx.resume().catch(() => {});
  }

  setZone(i) {
    if (i === this.zone) return;
    this.zone = i;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.drones.forEach((o, k) => o.frequency.setTargetAtTime(DRONES[i][k], t, 2));
    this.washFilter.frequency.setTargetAtTime(i === 1 ? 260 : 380, t, 2);
  }

  /** Called every frame; plays sparse generative music notes. */
  update(dt, calm = true) {
    if (!this.ctx || this.muted) return;
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.musicTimer = calm ? 2.2 + Math.random() * 3 : 4 + Math.random() * 4;
      const scale = PENTA[this.zone];
      const f = scale[Math.floor(Math.random() * scale.length)];
      this._tone({ type: 'sine', freq: f, dur: 2.2, vol: calm ? 0.07 : 0.04, attack: 0.08, bus: this.music });
      if (Math.random() < 0.35) this._tone({ type: 'sine', freq: f * 1.5, dur: 1.8, vol: 0.03, attack: 0.1, delay: 0.25, bus: this.music });
    }
  }

  // ---------- primitives ----------
  _tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.3, vol = 0.2, attack = 0.01, delay = 0, filter = null, bus = null }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 1000;
      f.Q.value = filter.q || 0.7;
      node = o.connect(f);
    }
    node.connect(g).connect(bus || this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise({ dur = 0.4, vol = 0.2, type = 'bandpass', freq = 800, freqEnd = null, q = 1, delay = 0, attack = 0.02 }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- sound effects ----------
  tap() {
    this._tone({ type: 'sine', freq: 620, freqEnd: 900, dur: 0.07, vol: 0.12 });
  }

  correct() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._tone({ type: 'triangle', freq: f, dur: 0.35, vol: 0.16, delay: i * 0.07 }));
    this._tone({ type: 'sine', freq: 2093, dur: 0.6, vol: 0.05, delay: 0.3 });
  }

  wrong() {
    this._tone({ type: 'square', freq: 233, freqEnd: 117, dur: 0.38, vol: 0.09, filter: { freq: 900 } });
    this._noise({ dur: 0.25, vol: 0.18, type: 'lowpass', freq: 400 });
  }

  lifeLost() {
    this._tone({ type: 'sine', freq: 440, freqEnd: 415, dur: 0.25, vol: 0.14, delay: 0.15 });
    this._tone({ type: 'sine', freq: 330, freqEnd: 247, dur: 0.5, vol: 0.14, delay: 0.38 });
  }

  whoosh() {
    this._noise({ dur: 0.7, vol: 0.22, type: 'bandpass', freq: 300, freqEnd: 1600, q: 0.8, attack: 0.15 });
  }

  danger() {
    this._tone({ type: 'sawtooth', freq: 73, freqEnd: 65, dur: 1.2, vol: 0.09, attack: 0.05, filter: { freq: 320 } });
    this._tone({ type: 'sine', freq: 164.8, dur: 1.0, vol: 0.05, delay: 0.1 });
    this._tone({ type: 'sine', freq: 174.6, dur: 1.0, vol: 0.05, delay: 0.1 });
  }

  bubble() {
    this._tone({ type: 'sine', freq: 280 + Math.random() * 200, freqEnd: 900 + Math.random() * 500, dur: 0.09, vol: 0.06 });
  }

  chime(i = 0) {
    const scale = PENTA[2];
    this._tone({ type: 'sine', freq: scale[i % scale.length] * (i >= scale.length ? 2 : 1), dur: 1.4, vol: 0.09, attack: 0.01, bus: this.music });
  }

  rumble(dur = 1.4) {
    this._noise({ dur, vol: 0.38, type: 'lowpass', freq: 140, attack: 0.2 });
  }

  /** A sustained roar of rushing water (deep rumble plus a hissing wash). */
  roar(dur = 5) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const layer = (type, freq, freqEnd, q, vol) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.6);
      g.gain.setValueAtTime(vol, t + Math.max(0.7, dur - 1.4));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.sfx);
      src.start(t, Math.random() * 1.5);
      src.stop(t + dur + 0.05);
    };
    layer('lowpass', 120, 90, 0.8, 0.5);
    layer('bandpass', 700, 260, 0.7, 0.16);
  }

  /** Pip calling out for its family: two little rising chirps and a faint echo. */
  call() {
    [0, 0.2].forEach((d) => this._tone({ type: 'sine', freq: 760, freqEnd: 1180, dur: 0.16, vol: 0.13, delay: d }));
    [0.75, 0.95].forEach((d) => this._tone({ type: 'sine', freq: 760, freqEnd: 1180, dur: 0.16, vol: 0.035, delay: d, filter: { freq: 900 } }));
  }

  /** A soft, lonely falling phrase. */
  lonely() {
    [392, 349.23, 293.66, 261.63].forEach((f, i) => this._tone({ type: 'sine', freq: f, dur: 1.4, vol: 0.07, attack: 0.12, delay: i * 0.42, bus: this.music }));
  }

  thud() {
    this._tone({ type: 'sine', freq: 95, freqEnd: 38, dur: 0.45, vol: 0.32 });
    this._noise({ dur: 0.35, vol: 0.22, type: 'lowpass', freq: 500 });
  }

  zap() {
    this._tone({ type: 'square', freq: 1400, freqEnd: 300, dur: 0.14, vol: 0.06, filter: { freq: 3000 } });
    this._noise({ dur: 0.15, vol: 0.1, type: 'highpass', freq: 2500 });
  }

  chomp() {
    this._noise({ dur: 0.18, vol: 0.28, type: 'lowpass', freq: 900 });
    this._tone({ type: 'sine', freq: 160, freqEnd: 55, dur: 0.22, vol: 0.28 });
  }

  steam() {
    this._noise({ dur: 1.1, vol: 0.26, type: 'bandpass', freq: 500, freqEnd: 2400, q: 0.6, attack: 0.05 });
  }

  signal() {
    this._tone({ type: 'sine', freq: 520, freqEnd: 1250, dur: 0.5, vol: 0.12 });
    [784, 988, 1175, 1568].forEach((f, i) => this._tone({ type: 'sine', freq: f, dur: 0.9, vol: 0.06, delay: 0.25 + i * 0.09, bus: this.music }));
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._tone({ type: 'triangle', freq: f, dur: 0.5, vol: 0.14, delay: i * 0.18, bus: this.music }));
    [261.63, 329.63, 392.0].forEach((f) => this._tone({ type: 'sine', freq: f, dur: 2.6, vol: 0.06, attack: 0.3, delay: 1.0, bus: this.music }));
  }

  gameOver() {
    [440, 349.23, 293.66, 220].forEach((f, i) => this._tone({ type: 'sine', freq: f, dur: 0.9, vol: 0.12, delay: i * 0.32, bus: this.music }));
  }

  zoneChime() {
    [392, 523.25, 659.25].forEach((f, i) => this._tone({ type: 'sine', freq: f, dur: 1.6, vol: 0.07, delay: i * 0.15, bus: this.music }));
  }
}
