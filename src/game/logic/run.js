// Run state: exactly three lives, progress and statistics, plus a one-shot answer gate.
// Pure logic so the life rules can be unit tested in Node.

export const MAX_LIVES = 3;

export class RunState {
  constructor(totalHurdles = 8) {
    this.totalHurdles = totalHurdles;
    this.reset();
  }

  reset() {
    this.lives = MAX_LIVES;
    this.cleared = 0;
    this.correct = 0;
    this.answered = 0;
    this.mistakes = 0;
    this.zone = 0;
    this.over = false;
    this.won = false;
    this.startedAt = Date.now();
  }

  /** Record a correct answer. */
  recordCorrect() {
    if (this.over) return this.lives;
    this.answered++;
    this.correct++;
    return this.lives;
  }

  /** Record a wrong answer: removes exactly one life. Returns lives left. */
  recordWrong() {
    if (this.over) return this.lives;
    this.answered++;
    this.mistakes++;
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives === 0) this.over = true;
    return this.lives;
  }

  clearHurdle() {
    this.cleared = Math.min(this.totalHurdles, this.cleared + 1);
  }

  win() {
    this.won = true;
    this.over = true;
  }

  get isCaught() {
    return this.lives === 0;
  }
}

/**
 * Accepts only the first submission for a given question. Repeated taps, double clicks or
 * key repeats are ignored, so a life can never be deducted twice for one answer.
 */
export class AnswerGate {
  constructor() {
    this.counter = 0;
    this.openToken = null;
  }

  /** Opens a new question and returns its unique token. */
  open() {
    this.counter++;
    this.openToken = this.counter;
    return this.counter;
  }

  /** Returns true only for the first submission while that question is open. */
  submit(token) {
    if (this.openToken === null || token !== this.openToken) return false;
    this.openToken = null;
    return true;
  }

  get isOpen() {
    return this.openToken !== null;
  }

  close() {
    this.openToken = null;
  }
}
