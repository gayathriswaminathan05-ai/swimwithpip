// Boot: shows real loading progress while the engine downloads and the scene is built.
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/600.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/500.css';
import '@fontsource/lexend/600.css';
import './styles.css';
import { isCancel } from './game/core/scheduler.js';

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
  const loader = document.getElementById('loader');
  const p = document.createElement('p');
  p.className = 'loader__error';
  p.textContent = message;
  loader.appendChild(p);
  step.textContent = 'Could not start';
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
  const loader = document.getElementById('loader');
  loader.style.transition = 'opacity 500ms ease';
  loader.style.opacity = '0';
  setTimeout(() => (loader.hidden = true), 520);
}

boot();
