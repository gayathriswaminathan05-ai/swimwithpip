import { AnswerGate } from '../logic/run.js';
import { installPressRing, pulseButton } from './pressRing.js';

// HTML/CSS overlay: HUD, quiz panel, dialogs, captions. The 3D scene stays in WebGL.

const ICONS = {
  soundOn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor"/></svg>',
};

// Hurdle illustrations for the top panel: simple line drawings on the amber lantern disc.
export const HURDLE_ICONS = {
  danger: '<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.2"/><path d="M12 16.9v.1"/>',
  current:
    '<path d="M3 8.5c2.4-2 4.6-2 7 0s4.6 2 7 0"/><path d="M3 13c2.4-2 4.6-2 7 0s4.6 2 7 0"/><path d="M3 17.5c2.4-2 4.6-2 7 0"/><path d="M14 17.5h7"/><path d="M18.5 15l2.5 2.5-2.5 2.5"/>',
  net: '<rect x="4" y="5" width="16" height="15" rx="3.5"/><path d="M4 12.5 11.5 5M4.5 19.5 19 5.5M11.5 20 20 11.5"/><path d="M12.5 5 20 12.5M5 5.5l14.5 14M4 12.5l7.5 7.5"/>',
  octopus:
    '<path d="M5.6 12.6C5.6 6.6 8.4 3 12 3s6.4 3.6 6.4 9.6"/><path d="M5.6 12.6c0 2.9-1.5 4.4-3.4 4.9"/><path d="M9.2 13.3c0 3.6-.9 6-2.9 7.4"/><path d="M14.8 13.3c0 3.6.9 6 2.9 7.4"/><path d="M18.4 12.6c0 2.9 1.5 4.4 3.4 4.9"/><path d="M5.6 12.6c2 1.1 4.2 1.6 6.4 1.6s4.4-.5 6.4-1.6"/><circle cx="9.5" cy="9.4" r="1.45" fill="currentColor" stroke="none"/><circle cx="14.5" cy="9.4" r="1.45" fill="currentColor" stroke="none"/>',
  rocks:
    '<path d="M3.8 16.2c0-2.2 1.8-3.9 4.1-3.9 2.5 0 4.4 1.7 4.4 4 0 2.2-1.9 3.9-4.3 3.9s-4.2-1.7-4.2-4z"/><path d="M13.4 7.8c0-1.7 1.4-3 3.2-3 1.9 0 3.4 1.3 3.4 3.1 0 1.7-1.5 3-3.3 3s-3.3-1.3-3.3-3.1z"/><path d="M15 17.6c0-1.2 1-2.1 2.3-2.1s2.3.9 2.3 2.1-1 2.1-2.3 2.1-2.3-.9-2.3-2.1z"/><path d="M6.4 4.6v4.2M9.6 3.6v3.4M17.3 11.9v1.4"/>',
  predator:
    '<path d="M21.5 7.5l-2.8 3C16.8 7.2 13.6 5.8 10.2 6.3 7 6.8 4.4 8.8 2.6 11.4l6 .6-5.7 2.3c1.8 2.5 4.4 4 7.4 4.3 3.6.4 7-1 8.8-4.3l2.8 3.2z"/><path d="M4.6 11.6l1 1.6M6.6 11.8l.9 1.5M5.3 13.6l.8-1.4M7.4 13.2l.7-1.3"/><circle cx="11.2" cy="9.6" r="1.3" fill="currentColor" stroke="none"/><path d="M9.6 7.9l2.6.6"/>',
  vents:
    '<path d="M9 21l1.2-6.4h3.6L15 21"/><path d="M6 21h12"/><path d="M12 14.4v-2.6"/><path d="M8.4 11.8a2.7 2.7 0 0 1-.3-5.4 3.9 3.9 0 0 1 7.6-.5 2.9 2.9 0 0 1 .3 5.9z"/><path d="M19 4v.1M5 3.6v.1M19.6 8.4v.1"/>',
  cavern: '<path d="M2.5 20c0-8.2 4.3-14 9.5-14s9.5 5.8 9.5 14"/><path d="M7 20c0-5.2 2.2-9 5-9s5 3.8 5 9"/><path d="M2 20h20"/><path d="M12 14.4v2.4M10.8 15.6h2.4"/>',
  ambush:
    '<path d="M2.5 20.5c.8-4.3 4-7 9.5-7s8.7 2.7 9.5 7z"/><path d="M4.8 9.6c1.7-2.1 4.6-2.1 6.3 0-1.7 1.7-4.6 1.7-6.3 0z"/><path d="M12.9 9.6c1.7-2.1 4.6-2.1 6.3 0-1.7 1.7-4.6 1.7-6.3 0z"/><path d="M7.95 8.4v2.4M16.05 8.4v2.4"/><path d="M4.6 6.2l4.6 1.4M19.4 6.2l-4.6 1.4"/>',
};

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      loader: $('loader'),
      loaderFill: $('loader-fill'),
      loaderStep: $('loader-step'),
      loaderPct: $('loader-pct'),
      hud: $('hud'),
      lives: $('lives'),
      track: $('track'),
      trackFill: $('track-fill'),
      trackDots: $('track-dots'),
      trackFish: $('track-fish'),
      zone: $('zone-label'),
      hudCount: $('hud-count'),
      btnSound: $('btn-sound'),
      btnSoundTop: $('btn-sound-top'),
      btnPause: $('btn-pause'),
      quiz: $('quiz'),
      hurdle: $('hurdle'),
      hurdleIcon: $('hurdle-icon'),
      hurdleTitle: $('hurdle-title'),
      hurdleStep: $('hurdle-step'),
      hurdleThreat: $('hurdle-threat'),
      hurdleGoal: $('hurdle-goal'),
      quizQ: $('quiz-q'),
      answers: Array.from(document.querySelectorAll('#quiz-answers .answer')),
      result: $('quiz-result'),
      feedback: $('quiz-feedback'),
      explain: $('quiz-explain'),
      explainText: $('explain-text'),
      btnNext: $('btn-next'),
      banner: $('banner'),
      toast: $('toast'),
      caption: $('caption'),
      skip: $('btn-skip'),
      vignette: $('vignette'),
      fade: $('fade'),
      title: $('title'),
      rules: $('rules'),
      pause: $('pause'),
      gameover: $('gameover'),
      victory: $('victory'),
    };
    this.gate = new AnswerGate();
    this.lastKeyboard = false;
    this.quizOpen = false;
    this.timers = {};
    installPressRing(document);
    this._bind();
  }

  _bind() {
    const e = this.el;
    e.btnPause.innerHTML = ICONS.pause;
    this.setMutedIcon(false);
    e.btnPause.addEventListener('click', () => this.h.onPause());
    e.btnSound.addEventListener('click', () => this.h.onToggleSound());
    e.btnSoundTop.addEventListener('click', () => this.h.onToggleSound());

    e.answers.forEach((btn) => {
      btn.addEventListener('click', () => this._submit(Number(btn.dataset.i)));
    });
    e.btnNext.addEventListener('click', () => {
      const r = this._resolveNext;
      this._resolveNext = null;
      if (r) {
        this.h.onTap?.();
        r();
      }
    });

    window.addEventListener(
      'keydown',
      (ev) => {
        this.lastKeyboard = true;
        if (ev.repeat) return;
        const k = ev.key.toLowerCase();
        if (k === 'escape' || k === 'p') {
          this.h.onEscape();
          ev.preventDefault();
          return;
        }
        if (k === 'm') {
          this.h.onToggleSound();
          return;
        }
        if (this.quizOpen && this.gate.isOpen && !this.h.isPaused()) {
          const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
          if (k in map) {
            ev.preventDefault();
            if (this.gate.isOpen) pulseButton(this.el.answers[map[k]]);
            this._submit(map[k]);
          }
        }
      },
      true,
    );
    window.addEventListener('pointerdown', () => (this.lastKeyboard = false), true);

    $('btn-start').addEventListener('click', () => this.h.onStart(this.getDifficulty()));
    $('btn-resume').addEventListener('click', () => this.h.onResume());
    $('btn-restart').addEventListener('click', () => this.h.onRestart());
    $('btn-quit').addEventListener('click', () => this.h.onQuit());
    $('btn-retry').addEventListener('click', () => this.h.onRestart());
    $('btn-go-title').addEventListener('click', () => this.h.onQuit());
    $('btn-replay').addEventListener('click', () => this.h.onRestart());
    $('btn-win-title').addEventListener('click', () => this.h.onQuit());
    e.skip.addEventListener('click', () => this.h.onSkip());

    document.querySelectorAll('input[name="difficulty"]').forEach((r) => r.addEventListener('change', () => this.h.onDifficulty?.(this.getDifficulty())));
  }

  // ---------- loader ----------
  setLoader(pct, step) {
    const p = Math.round(pct * 100);
    this.el.loaderFill.style.width = p + '%';
    this.el.loaderPct.textContent = p + '%';
    if (step) this.el.loaderStep.textContent = step;
  }

  hideLoader() {
    this.el.loader.style.transition = 'opacity 500ms ease';
    this.el.loader.style.opacity = '0';
    setTimeout(() => (this.el.loader.hidden = true), 520);
  }

  // ---------- screens ----------
  show(name, focusId) {
    const el = this.el[name];
    el.hidden = false;
    const target = focusId ? $(focusId) : el.querySelector('.btn--primary');
    if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }

  hide(name) {
    this.el[name].hidden = true;
  }

  hideScreens() {
    for (const n of ['title', 'rules', 'pause', 'gameover', 'victory']) this.el[n].hidden = true;
  }

  getDifficulty() {
    const r = document.querySelector('input[name="difficulty"]:checked');
    return r ? r.value : 'medium';
  }

  setDifficulty(d) {
    const r = document.querySelector(`input[name="difficulty"][value="${d}"]`);
    if (r) r.checked = true;
  }

  /** Applies the player's sound choice. */
  syncSettings({ muted }) {
    this.setMutedIcon(muted);
  }

  setMutedIcon(muted) {
    for (const b of [this.el.btnSound, this.el.btnSoundTop]) {
      b.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
      b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Mute sound');
      b.setAttribute('aria-pressed', String(muted));
    }
  }

  // ---------- HUD ----------
  showHUD(on) {
    this.el.hud.hidden = !on;
    this.el.btnSoundTop.hidden = on;
  }

  buildTrack(fractions) {
    this.el.trackDots.innerHTML = '';
    this.dots = fractions.map((f) => {
      const d = document.createElement('span');
      d.className = 'track__dot';
      d.style.left = f * 100 + '%';
      this.el.trackDots.appendChild(d);
      return d;
    });
    const home = document.createElement('span');
    home.className = 'track__dot is-home';
    home.style.left = '100%';
    this.el.trackDots.appendChild(home);
    this.el.track.setAttribute('aria-valuemax', String(fractions.length));
  }

  setLives(n, lostAnimIndex = -1) {
    const lives = this.el.lives.querySelectorAll('.life');
    lives.forEach((el, i) => {
      el.classList.toggle('is-lost', i >= n);
      if (i === lostAnimIndex) {
        el.classList.remove('is-breaking');
        void el.offsetWidth;
        el.classList.add('is-breaking');
      }
    });
    this.el.lives.setAttribute('aria-label', `Lives: ${n} of 3`);
  }

  setProgress(frac, cleared, total, zoneName) {
    const p = Math.max(0, Math.min(1, frac)) * 100;
    this.el.trackFill.style.width = p + '%';
    this.el.trackFish.style.left = p + '%';
    if (this.dots) this.dots.forEach((d, i) => d.classList.toggle('is-cleared', i < cleared));
    this.el.track.setAttribute('aria-valuenow', String(cleared));
    this.el.track.setAttribute('aria-valuetext', `${cleared} of ${total} hurdles cleared`);
    if (this.el.zone.textContent !== zoneName) this.el.zone.textContent = zoneName;
    const count = `${cleared} of ${total}`;
    if (this.el.hudCount.textContent !== count) this.el.hudCount.textContent = count;
  }

  // ---------- quiz ----------
  get isQuizOpen() {
    return this.quizOpen;
  }

  /** Shows a question; resolves with { index, correct } on the first valid answer. */
  ask(q, meta) {
    const e = this.el;
    // Top panel: the hurdle (what is happening and what the answer does), apart from the quiz.
    e.hurdleIcon.innerHTML = `<svg viewBox="0 0 24 24">${HURDLE_ICONS[meta.icon] || HURDLE_ICONS.danger}</svg>`;
    e.hurdleTitle.textContent = meta.title || '';
    e.hurdleStep.textContent = meta.step || '';
    const hint = meta.hint || '';
    const split = hint.match(/^(.*?)\s*(Answer\b.*)$/);
    e.hurdleThreat.textContent = split ? split[1] : hint;
    e.hurdleGoal.textContent = split ? split[2] : '';
    e.quizQ.textContent = q.question;
    e.result.textContent = '';
    e.feedback.hidden = true;
    e.feedback.className = 'feedback';
    e.explain.hidden = true;
    const longest = Math.max(...q.choices.map((c) => String(c).length));
    e.quiz.classList.toggle('quiz--stack', longest > 20 && window.innerWidth < 430 && window.innerHeight > window.innerWidth);
    e.answers.forEach((btn, i) => {
      btn.hidden = false;
      btn.disabled = false;
      btn.className = 'answer';
      btn.querySelector('.answer__text').textContent = q.choices[i];
      btn.querySelector('.answer__mark').textContent = '';
      btn.setAttribute('aria-label', `${i + 1}: ${q.choices[i]}`);
    });
    this.current = q;
    this.token = this.gate.open();
    this._openPanel();
    requestAnimationFrame(() => {
      if (this.lastKeyboard) e.answers[0].focus({ preventScroll: true });
      else e.quizQ.focus({ preventScroll: true });
    });
    return new Promise((resolve) => {
      this._resolveAnswer = resolve;
    });
  }

  _submit(i) {
    if (!this.quizOpen || this.h.isPaused()) return;
    if (!this.gate.submit(this.token)) return; // ignores repeated taps / double submits
    const q = this.current;
    const correct = i === q.correctIndex;
    this.el.answers.forEach((btn) => (btn.disabled = true));
    this.markAnswer(i, q.correctIndex);
    const r = this._resolveAnswer;
    this._resolveAnswer = null;
    if (r) r({ index: i, correct });
  }

  markAnswer(chosen, correctIndex) {
    this.el.answers.forEach((btn, i) => {
      const mark = btn.querySelector('.answer__mark');
      if (i === correctIndex) {
        btn.classList.add('is-correct');
        mark.textContent = '✓';
        btn.setAttribute('aria-label', `${i + 1}: ${this.current.choices[i]} — correct answer`);
      } else if (i === chosen) {
        btn.classList.add('is-wrong');
        mark.textContent = '✗';
        btn.setAttribute('aria-label', `${i + 1}: ${this.current.choices[i]} — your answer, wrong`);
      } else {
        btn.classList.add('is-dim');
      }
    });
  }

  showResult(text, good) {
    const e = this.el;
    e.result.textContent = text;
    e.feedback.className = 'feedback ' + (good ? 'is-good' : 'is-bad');
    e.feedback.hidden = false;
  }

  /** Shows the explanation and waits for "Try another question". */
  explainAndWait(html, buttonLabel) {
    const e = this.el;
    e.explainText.innerHTML = html;
    e.btnNext.textContent = buttonLabel;
    e.answers.forEach((btn) => {
      if (!btn.classList.contains('is-correct') && !btn.classList.contains('is-wrong')) btn.hidden = true;
    });
    e.explain.hidden = false;
    requestAnimationFrame(() => e.btnNext.focus({ preventScroll: true }));
    return new Promise((resolve) => {
      this._resolveNext = resolve;
    });
  }

  _openPanel() {
    const q = this.el.quiz;
    clearTimeout(this.timers.quiz);
    const hz = this.el.hurdle;
    q.hidden = false;
    hz.hidden = !this.el.hurdleTitle.textContent;
    this.quizOpen = true;
    void q.offsetWidth;
    q.classList.add('is-open');
    hz.classList.add('is-open');
    this.h.onLayout?.();
  }

  hideQuiz() {
    const q = this.el.quiz;
    this.gate.close();
    this.quizOpen = false;
    q.classList.remove('is-open');
    this.el.hurdle.classList.remove('is-open');
    this._resolveNext = null;
    this.h.onLayout?.();
    clearTimeout(this.timers.quiz);
    this.timers.quiz = setTimeout(() => {
      if (!this.quizOpen) q.hidden = this.el.hurdle.hidden = true;
    }, 420);
  }

  /** Screen rect not covered by HUD / quiz panel (for camera framing), in px. */
  freeRect(width, height) {
    let top = 0;
    let bottom = height;
    let right = width;
    if (!this.el.hud.hidden) top = this.el.hud.getBoundingClientRect().bottom;
    const hz = this.el.hurdle;
    // Layout box (offsetTop/Height), not the animated transform, so framing is stable mid-slide.
    if (this.quizOpen && !hz.hidden) top = Math.max(top, hz.offsetTop + hz.offsetHeight);
    if (this.quizOpen) {
      const r = this.el.quiz.getBoundingClientRect();
      // Use the final (open) position: compute from layout, not the animated transform.
      const docked = window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches;
      if (docked) right = width - (this.el.quiz.offsetWidth + 8);
      else bottom = height - this.el.quiz.offsetHeight - (window.innerWidth >= 900 && window.innerHeight >= 640 ? 18 : 0);
      void r;
    }
    return { x: 0, y: top, w: right, h: Math.max(80, bottom - top) };
  }

  // ---------- messages ----------
  toast(html, kind = '', dur = 3) {
    const t = this.el.toast;
    t.innerHTML = html;
    t.className = 'toast is-on' + (kind ? ' is-' + kind : '');
    clearTimeout(this.timers.toast);
    this.timers.toast = setTimeout(() => t.classList.remove('is-on'), dur * 1000);
  }

  hideToast() {
    this.el.toast.classList.remove('is-on');
  }

  banner(kicker, title, dur = 3.2) {
    const b = this.el.banner;
    b.innerHTML = `<small>${escapeHtml(kicker)}</small><strong>${escapeHtml(title)}</strong>`;
    b.classList.add('is-on');
    clearTimeout(this.timers.banner);
    this.timers.banner = setTimeout(() => b.classList.remove('is-on'), dur * 1000);
  }

  caption(text, { small = false, dur = 0 } = {}) {
    const c = this.el.caption;
    c.textContent = text;
    c.classList.toggle('is-small', small);
    c.classList.add('is-on');
    clearTimeout(this.timers.caption);
    if (dur) this.timers.caption = setTimeout(() => c.classList.remove('is-on'), dur * 1000);
  }

  hideCaption() {
    clearTimeout(this.timers.caption);
    this.el.caption.classList.remove('is-on');
  }

  flashDanger(reduced) {
    const v = this.el.vignette;
    v.classList.toggle('is-calm', !!reduced);
    v.classList.add('is-on');
    clearTimeout(this.timers.vig);
    this.timers.vig = setTimeout(() => v.classList.remove('is-on'), reduced ? 900 : 260);
  }

  fade(on, ms = 900) {
    this.el.fade.style.transitionDuration = ms + 'ms';
    this.el.fade.classList.toggle('is-on', on);
  }

  showSkip(on) {
    this.el.skip.hidden = !on;
  }

  clearTransient() {
    this.hideToast();
    this.hideCaption();
    this.el.banner.classList.remove('is-on');
    this.el.vignette.classList.remove('is-on');
    this.showSkip(false);
    if (this.quizOpen) this.hideQuiz();
    this.el.quiz.hidden = true;
    this.el.quiz.classList.remove('is-open');
    this.el.hurdle.hidden = true;
    this.el.hurdle.classList.remove('is-open');
  }

  // ---------- dialogs ----------
  rules() {
    this.show('rules', 'btn-go');
    return new Promise((resolve) => {
      const btn = $('btn-go');
      const go = () => {
        btn.removeEventListener('click', go);
        this.hide('rules');
        resolve();
      };
      btn.addEventListener('click', go);
    });
  }

  _stats(el, rows) {
    el.innerHTML = rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  }

  gameOver({ correct }) {
    $('go-score').textContent = `You answered ${correct} ${correct === 1 ? 'question' : 'questions'} correctly.`;
    this.show('gameover', 'btn-retry');
  }

  /** Journey complete: a short congratulations, nothing more. */
  victory() {
    this.show('victory', 'btn-replay');
  }

  showPause(progress) {
    $('pause-progress').textContent = progress;
    this.show('pause', 'btn-resume');
  }
}
