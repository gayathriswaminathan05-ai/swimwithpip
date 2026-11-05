// End-to-end playthrough in a real browser (Playwright + Chrome).
//   npm run test:browser            (starts its own Vite server)
//   SHOTS=./test-results node tests/playthrough.mjs   (also saves screenshots)
// Scenarios: full victory run, wrong answers → near misses → game over → Try Again,
// double-tap protection, pause/resume, tab hidden auto-pause, rotation mid-question.

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || '';
const SPEED = Number(process.env.SPEED || 4);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const log = (...a) => console.log(...a);
function check(cond, msg) {
  if (cond) log('  ✓', msg);
  else {
    failures++;
    log('  ✗ FAIL:', msg);
  }
}

// No HMR / file watching: an edit made while the test runs must not reload the page mid-journey.
const PORT = Number(process.env.PW_PORT || 5199);
const server = await createServer({ root, logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const base = `http://127.0.0.1:${PORT}/`;

let browser;
try {
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
} catch {
  browser = await chromium.launch();
}

async function newGame(viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}?speed=${SPEED}&seed=7&quality=low`);
  await page.waitForFunction(() => window.__pip && window.__pip.game.state === 'title', null, { timeout: 60000 });
  return { ctx, page, errors };
}

const st = (page) => page.evaluate(() => window.__pip.state);
const waitFor = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

async function startJourney(page, difficulty = 'easy') {
  await page.tap(`.seg input[value="${difficulty}"]`);
  await page.tap('#btn-start');
  await waitFor(page, () => window.__pip.game.state === 'intro');
  await page.tap('#btn-skip');
  await waitFor(page, () => !document.getElementById('rules').hidden);
  await page.tap('#btn-go');
  await waitFor(page, () => window.__pip.game.state === 'playing');
}

async function waitQuestion(page) {
  await waitFor(page, () => {
    const s = window.__pip.state;
    return (s.quizOpen && document.querySelector('#quiz.is-open') && !document.querySelector('#quiz-answers .answer').disabled) || s.state === 'victory' || s.state === 'gameover';
  });
  await page.waitForTimeout(450);
}

async function answer(page, correct) {
  const idx = await page.evaluate((c) => {
    const k = window.__pip.correctIndex();
    return c ? k : (k + 1) % 4;
  }, correct);
  await page.tap(`#quiz-answers .answer[data-i="${idx}"]`);
  return idx;
}

try {
  // ------------------------------------------------------------------ Scenario 1
  log('\nScenario 1: full journey, all answers correct (with double-taps)');
  {
    const { ctx, page, errors } = await newGame();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/00-title.png` });
    await startJourney(page);
    let s = await st(page);
    check(s.lives === 3, 'journey starts with 3 lives');
    const seen = new Set();
    for (let guard = 0; guard < 14; guard++) {
      await waitQuestion(page);
      s = await st(page);
      if (s.state === 'victory') break;
      if (SHOTS && !seen.has(s.encounter + ':' + s.answered)) {
        seen.add(s.encounter + ':' + s.answered);
        await page.screenshot({ path: `${SHOTS}/q${String(s.encounter + 1).padStart(2, '0')}-${s.answered}.png` });
      }
      const before = s.answered;
      // Double tap the correct answer: must count once.
      const idx = await answer(page, true);
      await page.tap(`#quiz-answers .answer[data-i="${idx}"]`, { force: true }).catch(() => {});
      await page.waitForTimeout(150);
      s = await st(page);
      check(s.answered === before + 1 && s.lives === 3, `hurdle ${s.encounter + 1}: correct answer recorded once, lives still 3`);
      if (SHOTS) {
        await page.waitForTimeout(1600 / SPEED + 500);
        await page.screenshot({ path: `${SHOTS}/e${String(s.encounter + 1).padStart(2, '0')}-${s.answered}-escape.png` });
      }
    }
    await waitFor(page, () => window.__pip.game.state === 'victory', null, 120000);
    s = await st(page);
    check(s.state === 'victory', 'reached the reunion and victory screen');
    const total = await page.evaluate(() => window.__pip.game.encounters.length);
    const questions = await page.evaluate(() => window.__pip.game.encounters.reduce((n, e) => n + e.stages, 0));
    check(s.cleared === total, `cleared all ${total} hurdles (got ${s.cleared})`);
    check(s.answered === questions, `answered ${questions} questions (got ${s.answered})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/99-victory.png` });
    const visible = await page.isVisible('#victory');
    check(visible, 'victory card visible with Play Again');
    await page.tap('#btn-replay');
    await waitFor(page, () => window.__pip.game.state === 'playing');
    s = await st(page);
    check(s.lives === 3 && s.cleared === 0 && s.answered === 0, 'Play Again resets lives and progress');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // ------------------------------------------------------------------ Scenario 2
  log('\nScenario 2: wrong answers, near misses, third mistake → capture → Game Over → Try Again');
  {
    const { ctx, page, errors } = await newGame();
    await startJourney(page, 'medium');
    await waitQuestion(page);
    let s = await st(page);
    const firstEnc = s.encounter;
    const idx = await answer(page, false);
    await page.tap(`#quiz-answers .answer[data-i="${idx}"]`, { force: true }).catch(() => {});
    await page.waitForTimeout(200);
    s = await st(page);
    check(s.lives === 2, `first wrong answer costs exactly one life (lives ${s.lives})`);
    const marks = await page.evaluate(() => ({
      wrong: document.querySelectorAll('#quiz .answer.is-wrong').length,
      right: document.querySelectorAll('#quiz .answer.is-correct').length,
      text: document.getElementById('quiz-result').textContent,
    }));
    check(marks.wrong === 1 && marks.right === 1 && /not quite/i.test(marks.text), 'feedback marks wrong + correct answers with text, not colour only');
    await waitFor(page, () => window.__pip.state.explainOpen);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/w1-explain.png` });
    const explain = await page.textContent('#explain-text');
    const correctText = await page.evaluate(() => String(window.__pip.game.lastQuestion.correctText));
    check(explain.toLowerCase().includes(correctText.toLowerCase()), 'explanation of the correct answer shown');
    s = await st(page);
    check(s.encounter === firstEnc, 'still at the same hurdle after a near miss');
    await page.tap('#btn-next');
    await waitQuestion(page);
    await answer(page, false);
    await waitFor(page, () => window.__pip.state.explainOpen);
    s = await st(page);
    check(s.lives === 1 && s.encounter === firstEnc, 'second wrong answer → 1 life, fresh question at same hurdle');
    await page.tap('#btn-next');
    await waitQuestion(page);
    await answer(page, true);
    await waitQuestion(page);
    s = await st(page);
    check(s.lives === 1 && s.encounter === firstEnc + 1, 'lives carry over to the next hurdle');
    // Pause / resume during a question.
    await page.keyboard.press('Escape');
    s = await st(page);
    check(s.paused, 'Escape pauses during a question');
    const p0 = (await st(page)).pipS;
    await page.waitForTimeout(600);
    check((await st(page)).pipS === p0, 'game world frozen while paused');
    await page.tap('#btn-resume');
    s = await st(page);
    check(!s.paused && s.quizOpen, 'resume returns to the open question');
    // Rotation mid-question keeps state.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);
    s = await st(page);
    check(s.quizOpen && s.lives === 1, 'rotating to landscape keeps the question and lives');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/w2-landscape-question.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    // Third mistake.
    await answer(page, false);
    await waitFor(page, () => window.__pip.game.state === 'gameover', null, 60000);
    await waitFor(page, () => !document.getElementById('gameover').hidden, null, 30000);
    s = await st(page);
    check(s.lives === 0 && s.state === 'gameover', 'third wrong answer → capture → Game Over');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/w3-gameover.png` });
    const goText = await page.textContent('#gameover');
    const corr = (await st(page)).correct;
    check(new RegExp(`You answered ${corr} questions? correctly`).test(goText) && /Try Again/.test(goText), 'simple Game Over shows how many questions were answered correctly, with Try Again');
    await page.tap('#btn-retry');
    await waitFor(page, () => window.__pip.game.state === 'playing');
    s = await st(page);
    check(s.lives === 3 && s.cleared === 0 && s.answered === 0, 'Try Again starts a new journey with 3 lives');
    // Tab hidden → auto pause.
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    s = await st(page);
    check(s.paused, 'hiding the tab pauses the game');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.tap('#btn-quit');
    s = await st(page);
    check(s.state === 'title', 'Quit to title works');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }
  // ------------------------------------------------------------------ Scenario 3
  log('\nScenario 3: test-mode Skip button passes a hurdle without answering');
  {
    const { ctx, page, errors } = await newGame();
    await startJourney(page);
    await waitQuestion(page);
    let s = await st(page);
    const enc = s.encounter;
    check(await page.isVisible('#btn-skip-q'), 'Skip (test) button is visible on the question');
    await page.tap('#btn-skip-q');
    await page.tap('#btn-skip-q', { force: true }).catch(() => {});
    await waitQuestion(page);
    s = await st(page);
    check(s.encounter === enc + 1 && s.cleared === enc + 1, 'skipping clears the hurdle and moves on');
    check(s.lives === 3 && s.answered === 0, 'skipping costs no life and is not counted as an answer');
    check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}

log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
