// Unit tests for the game rules and the question bank:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS } from '../src/data/questions.js';
import { QuestionDeck, validateQuestion, CATEGORIES, DIFFICULTIES } from '../src/game/logic/quiz.js';
import { RunState, AnswerGate, MAX_LIVES } from '../src/game/logic/run.js';

test('question bank: every question is valid and ids are unique', () => {
  const ids = new Set();
  for (const q of QUESTIONS) {
    assert.deepEqual(validateQuestion(q), [], `${q.id}: ${validateQuestion(q).join(', ')}`);
    assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
    ids.add(q.id);
  }
});

test('question bank: at least 8 questions per topic and difficulty (6 topics)', () => {
  assert.deepEqual(CATEGORIES, ['maths', 'geography', 'history', 'science', 'nature', 'logic']);
  for (const d of DIFFICULTIES) {
    for (const c of CATEGORIES) {
      const n = QUESTIONS.filter((q) => q.difficulty === d && q.category === c).length;
      assert.ok(n >= 8, `${d}/${c} has only ${n}`);
    }
  }
});

test('question bank: written for every player (no alphabet puzzles, metric units only)', () => {
  for (const q of QUESTIONS) {
    const text = `${q.question} ${q.choices.join(' ')}`;
    assert.ok(!/\b[A-Z], [A-Z], [A-Z]\b/.test(text), `${q.id} looks like a letter sequence`);
    assert.ok(!/\b(miles?|feet|foot|inch(es)?|pounds?|ounces?|gallons?|°F|fahrenheit)\b/i.test(text), `${q.id} uses non-metric units`);
  }
});

test('question bank: text fits phone buttons and explanations state the answer', () => {
  for (const q of QUESTIONS) {
    assert.ok(q.question.length <= 110, `${q.id} question too long`);
    for (const c of q.choices) assert.ok(String(c).length <= 26, `${q.id} choice "${c}" too long`);
    assert.ok(q.explanation.length <= 140, `${q.id} explanation too long`);
    const correct = String(q.choices[q.answer]).toLowerCase();
    assert.ok(q.explanation.toLowerCase().includes(correct), `${q.id} explanation should mention "${correct}"`);
    const bad = q.choices.find((c) => /all of the above|none of the above/i.test(c));
    assert.equal(bad, undefined, `${q.id} uses a position-dependent choice`);
  }
});

test('deck: no repeated questions within a playthrough', () => {
  for (const d of DIFFICULTIES) {
    const deck = new QuestionDeck(QUESTIONS, d, 42);
    const seen = new Set();
    // A full run asks at most 10 questions plus 2 retries after wrong answers.
    for (let i = 0; i < 12; i++) {
      const q = deck.next();
      assert.ok(!seen.has(q.id), `repeat of ${q.id}`);
      seen.add(q.id);
      assert.equal(q.difficulty, d);
    }
  }
});

test('deck: shuffled choices keep the right answer and spread across positions', () => {
  const deck = new QuestionDeck(QUESTIONS, 'medium', 7);
  const counts = [0, 0, 0, 0];
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const q = deck.next();
    const src = QUESTIONS.find((x) => x.id === q.id);
    assert.equal(q.choices[q.correctIndex], src.choices[src.answer]);
    assert.deepEqual([...q.choices].sort(), [...src.choices].sort());
    assert.notEqual(q.correctIndex, last, 'correct answer should not sit in the same spot twice in a row');
    last = q.correctIndex;
    counts[q.correctIndex]++;
  }
  for (const c of counts) assert.equal(c, 10, `positions should be balanced, got ${counts}`);
  assert.ok(QUESTIONS.filter((q) => q.difficulty === 'medium').length >= 40);
});

test('deck: topics rotate so a journey covers all six', () => {
  const deck = new QuestionDeck(QUESTIONS, 'easy', 3);
  const cats = Array.from({ length: 9 }, () => deck.next().category);
  for (let i = 1; i < cats.length; i++) assert.notEqual(cats[i], cats[i - 1]);
  assert.equal(new Set(cats.slice(0, 6)).size, 6);
});

test('deck: falls back gracefully when a pool runs out', () => {
  const tiny = QUESTIONS.filter((q) => q.difficulty === 'hard').slice(0, 3);
  const deck = new QuestionDeck(tiny, 'hard', 1);
  for (let i = 0; i < 10; i++) assert.ok(deck.next().id);
});

test('lives: a run starts with exactly three lives', () => {
  const run = new RunState(9);
  assert.equal(MAX_LIVES, 3);
  assert.equal(run.lives, 3);
});

test('lives: each wrong answer costs exactly one life; the third ends the game', () => {
  const run = new RunState(9);
  assert.equal(run.recordWrong(), 2);
  assert.equal(run.over, false);
  run.recordCorrect();
  assert.equal(run.lives, 2, 'correct answers never cost a life');
  assert.equal(run.recordWrong(), 1);
  assert.equal(run.recordWrong(), 0);
  assert.equal(run.over, true);
  assert.equal(run.isCaught, true);
  assert.equal(run.recordWrong(), 0, 'no further deductions after game over');
  assert.equal(run.mistakes, 3);
});

test('lives: reset gives a fresh journey', () => {
  const run = new RunState(9);
  run.recordWrong();
  run.clearHurdle();
  run.reset();
  assert.equal(run.lives, 3);
  assert.equal(run.cleared, 0);
  assert.equal(run.answered, 0);
  assert.equal(run.over, false);
});

test('answer gate: repeated taps submit only once', () => {
  const gate = new AnswerGate();
  const t = gate.open();
  assert.equal(gate.submit(t), true);
  assert.equal(gate.submit(t), false);
  assert.equal(gate.submit(t), false);
  const t2 = gate.open();
  assert.equal(gate.submit(t), false, 'a stale question cannot be answered');
  assert.equal(gate.submit(t2), true);
  gate.open();
  gate.close();
  assert.equal(gate.isOpen, false);
});
