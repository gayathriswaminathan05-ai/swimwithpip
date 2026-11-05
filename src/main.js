// Boot: shows the splash (with real loading progress) while the engine downloads and the scene is built.
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/500.css';
import '@fontsource/lexend/600.css';
import './styles.css';
import { isCancel } from './game/core/scheduler.js';

const splash = document.getElementById('loader');
const fill = document.getElementById('loader-fill');
const step = document.getElementById('loader-step');
const pct = document.getElementById('loader-pct');

function progress(p, label) {
  const v = Math.round(Math.max(0, Math.min(1, p)) * 100);
  fill.style.width = v + '%';
  pct.textContent = v + '%';
  if (label) step.textContent = label;
}

function fail(message) {
  const p = document.createElement('p');
  p.className = 'loader__error';
  p.textContent = message;
  splash.querySelector('.splash__load').appendChild(p);
  step.textContent = 'Could not start';
}

// Splash timing: long enough to read "Deep-Sea Quiz Adventure", never longer than loading needs.
// Automated test runs skip the wait unless the URL asks for it (?splash).
const splashStart = performance.now();
const quickSplash = navigator.webdriver === true && !/[?&]splash\b/.test(location.search);
const SPLASH_MIN = quickSplash ? 0 : 2800; // ms on screen in total
const SPLASH_AFTER_READY = quickSplash ? 0 : 900; // ms the finished splash lingers

// The headline animates in once its display font has arrived, so it never flashes a fallback font.
Promise.race([document.fonts?.load('700 48px Unbounded'), new Promise((r) => setTimeout(r, 1200))])
  .catch(() => {})
  .finally(() => splash.classList.add('is-in'));

function leaveSplash() {
  splash.classList.add('is-ready');
  const wait = Math.max(SPLASH_AFTER_READY, SPLASH_MIN - (performance.now() - splashStart));
  return new Promise((resolve) => {
    const go = () => {
      clearTimeout(timer);
      splash.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      resolve();
    };
    const timer = setTimeout(go, wait);
    // A tap or key press skips the wait once the ocean is ready.
    splash.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }).then(() => {
    splash.classList.add('is-leaving');
    document.getElementById('title')?.classList.add('is-enter');
    setTimeout(() => (splash.hidden = true), 720);
  });
}

// Sequences cancelled by Restart / Quit / Skip reject with Cancelled — that's expected.
window.addEventListener('unhandledrejection', (e) => {
  if (isCancel(e.reason)) e.preventDefault();
});

async function boot() {
  progress(0.05, 'Loading engine…');
  // Animate toward 50% while the engine chunk downloads (real completion jumps it forward).
  let fake = 0.05;
  const timer = setInterval(() => {
    fake = Math.min(0.48, fake + (0.5 - fake) * 0.08);
    progress(fake);
  }, 120);
  let Game;
  try {
    ({ Game } = await import('./game/Game.js'));
  } catch (e) {
    clearInterval(timer);
    console.error(e);
    fail('The game files could not be loaded. Please check your connection and reload.');
    return;
  }
  clearInterval(timer);
  progress(0.5, 'Engine ready');
  const canvas = document.getElementById('scene');
  const game = new Game(canvas);
  try {
    await game.init(progress);
  } catch (e) {
    console.error(e);
    fail(/webgl/i.test(String(e && e.message)) ? 'This device or browser does not support WebGL, which the 3D ocean needs.' : 'Something went wrong while building the ocean. Please reload.');
    return;
  }
  progress(1, 'Ready!');
  await leaveSplash();
}

boot();
