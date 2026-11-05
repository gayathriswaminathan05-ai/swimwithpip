// Question selection: no repeats within a playthrough, and (given the questions seen in earlier
// games) fresh questions in every new game until a difficulty's whole set has been seen. Also
// rotates categories and spreads correct answers evenly across the four button positions. Pure
// logic (no DOM / Three.js) so it can be unit tested in Node.

export const CATEGORIES = ['maths', 'geography', 'history', 'science', 'nature', 'logic'];
export const CATEGORY_LABELS = { maths: 'Maths', geography: 'Geography', history: 'History', science: 'Science', nature: 'Nature', logic: 'Logic' };
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Questions from the last game or so stay out even when a difficulty's set starts over.
const RECENT_KEEP = 12;
const MAX_REMEMBERED = 600;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Validates one question; returns a list of problems (empty when fine). */
export function validateQuestion(q) {
  const problems = [];
  if (!q || typeof q !== 'object') return ['not an object'];
  if (!q.id) problems.push('missing id');
  if (!CATEGORIES.includes(q.category)) problems.push(`bad category "${q.category}"`);
  if (!DIFFICULTIES.includes(q.difficulty)) problems.push(`bad difficulty "${q.difficulty}"`);
  if (!q.question || typeof q.question !== 'string') problems.push('missing question text');
  if (!Array.isArray(q.choices) || q.choices.length !== 4) problems.push('needs exactly 4 choices');
  else if (new Set(q.choices.map((c) => String(c).trim().toLowerCase())).size !== 4) problems.push('choices must be different');
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) problems.push('answer must be 0-3');
  if (!q.explanation) problems.push('missing explanation');
  return problems;
}

export class QuestionDeck {
  /**
   * @param {Array} bank   question bank (see src/data/questions.js)
   * @param {string} difficulty 'easy' | 'medium' | 'hard'
   * @param {number} seed  optional seed for reproducible tests
   * @param {{ seen?: string[] }} opts  ids asked in earlier games, oldest first; they are kept
   *   out until every question of that difficulty has been seen
   */
  constructor(bank, difficulty = 'medium', seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0, opts = {}) {
    this.rand = mulberry(seed);
    this.difficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'medium';
    this.bank = bank.filter((q) => validateQuestion(q).length === 0);
    this.byId = new Map(this.bank.map((q) => [q.id, q]));
    this.used = new Set();
    // Earlier games, oldest first (unknown ids and duplicates dropped, newest kept).
    const seen = [];
    for (const id of (opts.seen || []).slice().reverse()) if (this.byId.has(id) && !seen.includes(id)) seen.unshift(id);
    this.seenOrder = seen;
    this.seen = new Set(seen);
    this.catCursor = Math.floor(this.rand() * CATEGORIES.length);
    this.positions = [];
    this.lastPosition = -1;
    this.history = [];
  }

  _pool(difficulty, category, fresh) {
    return this.bank.filter(
      (q) => q.difficulty === difficulty && (!category || q.category === category) && !this.used.has(q.id) && !(fresh && this.seen.has(q.id)),
    );
  }

  /** A question of `difficulty`, rotating through the categories. */
  _fromCategories(difficulty, fresh) {
    for (let k = 0; k < CATEGORIES.length; k++) {
      const cat = CATEGORIES[(this.catCursor + k) % CATEGORIES.length];
      const pool = this._pool(difficulty, cat, fresh);
      if (pool.length) {
        this.catCursor = (this.catCursor + k + 1) % CATEGORIES.length;
        return pool[Math.floor(this.rand() * pool.length)];
      }
    }
    return null;
  }

  /**
   * Every question of `difficulty` has been seen in earlier games: start that set over, but keep
   * the most recently seen ones out so the last game's questions do not come straight back.
   */
  _refresh(difficulty) {
    const mine = this.seenOrder.filter((id) => this.byId.get(id).difficulty === difficulty);
    if (!mine.length) return false;
    for (const keep of [RECENT_KEEP, 0]) {
      const drop = new Set(mine.slice(0, Math.max(0, mine.length - keep)));
      if (!drop.size) continue;
      const free = this._pool(difficulty, null, false).filter((q) => !this.seen.has(q.id) || drop.has(q.id));
      if (free.length || keep === 0) {
        this.seenOrder = this.seenOrder.filter((id) => !drop.has(id));
        this.seen = new Set(this.seenOrder);
        return true;
      }
    }
    return false;
  }

  _pickQuestion() {
    // Preferred difficulty first, fresh questions only; when that set is used up, refresh it
    // rather than switching difficulty. Then nearby difficulties, then recycle.
    const order = { easy: ['easy', 'medium', 'hard'], medium: ['medium', 'easy', 'hard'], hard: ['hard', 'medium', 'easy'] }[this.difficulty];
    const first = this._fromCategories(order[0], true) || (this._refresh(order[0]) && this._fromCategories(order[0], true));
    if (first) return first;
    for (const diff of order) {
      const q = this._fromCategories(diff, true) || this._fromCategories(diff, false);
      if (q) return q;
    }
    // Everything used: start over (least recently used first).
    const oldest = this.history.slice(0, Math.max(1, Math.floor(this.history.length / 2)));
    this.used = new Set(this.history.slice(oldest.length));
    const pool = this.bank.filter((q) => !this.used.has(q.id));
    return pool[Math.floor(this.rand() * pool.length)] || this.bank[0];
  }

  /** Ids to remember for the next game: earlier games plus this one, oldest first. */
  seenList() {
    const out = this.seenOrder.filter((id) => !this.used.has(id)).concat(this.history.filter((id, i, a) => a.lastIndexOf(id) === i));
    return out.slice(-MAX_REMEMBERED);
  }

  _nextPosition() {
    if (!this.positions.length) {
      let deck = shuffled([0, 1, 2, 3], this.rand);
      if (deck[0] === this.lastPosition) deck = deck.slice(1).concat(deck[0]);
      this.positions = deck;
    }
    const p = this.positions.shift();
    this.lastPosition = p;
    return p;
  }

  /** Returns a ready-to-show question with shuffled choices. */
  next() {
    const q = this._pickQuestion();
    if (!q) throw new Error('Question bank is empty');
    this.used.add(q.id);
    this.history.push(q.id);
    const correctText = q.choices[q.answer];
    const wrong = shuffled(
      q.choices.filter((_, i) => i !== q.answer),
      this.rand,
    );
    const pos = this._nextPosition();
    const choices = wrong.slice();
    choices.splice(pos, 0, correctText);
    return {
      id: q.id,
      category: q.category,
      categoryLabel: CATEGORY_LABELS[q.category],
      difficulty: q.difficulty,
      question: q.question,
      choices,
      correctIndex: pos,
      correctText,
      explanation: q.explanation,
    };
  }
}
