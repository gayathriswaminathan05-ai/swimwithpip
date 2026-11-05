// Press ring: the tap feedback for every button (after a reference the player liked).
// Touch-down: a thick ring in a darker shade of the button's colour appears at the finger and
// contracts while the button squishes in. Release: the ring expands, thins and fades while the
// button springs back. Purely visual; the button's own click handler runs as normal.

const SELECTOR = '.answer, .btn, .icon-btn';
const CONTRACT_MS = 200; // touch-down beat; a quick tap still plays it before the burst
const BURST_MS = 280;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const reduced = () => document.documentElement.classList.contains('reduced-motion');

function spawn(el, x, y) {
  const r = el.getBoundingClientRect();
  const d = Math.round(Math.max(40, Math.min(r.height * 1.45, 92)));
  const w = Math.max(3, Math.round(d * 0.075));
  const ring = document.createElement('span');
  ring.className = 'press-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.style.cssText = `left:${x - r.left}px;top:${y - r.top}px;width:${d}px;height:${d}px;border-width:${w}px`;
  ring.dataset.w = w;
  el.appendChild(ring);
  ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 1 },
    ],
    { duration: CONTRACT_MS, easing: EASE_OUT, fill: 'forwards' },
  );
  return ring;
}

function burst(el, ring) {
  el.classList.remove('is-pressing');
  if (!ring) return;
  const w = Number(ring.dataset.w);
  const a = ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.8)', opacity: 1, borderWidth: `${w}px` },
      { transform: 'translate(-50%, -50%) scale(1.75)', opacity: 0, borderWidth: '1px' },
    ],
    { duration: BURST_MS, easing: EASE_OUT, fill: 'forwards' },
  );
  a.onfinish = a.oncancel = () => ring.remove();
}

function press(el, x, y) {
  el.classList.add('is-pressing');
  return { el, ring: reduced() ? null : spawn(el, x, y), t0: performance.now() };
}

function release(p) {
  const wait = Math.max(0, CONTRACT_MS - (performance.now() - p.t0));
  setTimeout(() => burst(p.el, p.ring), wait);
}

/** Plays the full press at the centre of a button (keyboard shortcuts, assistive clicks). */
export function pulseButton(el) {
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  release(press(el, r.left + r.width / 2, r.top + r.height / 2));
}

export function installPressRing(root = document) {
  const active = new Map(); // pointerId -> press
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button > 0) return;
      const el = e.target.closest?.(SELECTOR);
      if (!el || el.disabled) return;
      active.set(e.pointerId, press(el, e.clientX, e.clientY));
    },
    true,
  );
  const end = (e) => {
    const p = active.get(e.pointerId);
    if (!p) return;
    active.delete(e.pointerId);
    release(p);
  };
  root.addEventListener('pointerup', end, true);
  root.addEventListener('pointercancel', end, true);
  // Enter / Space on a focused button arrives as a click with no pointer (detail 0).
  root.addEventListener(
    'click',
    (e) => {
      if (e.detail !== 0) return;
      const el = e.target.closest?.(SELECTOR);
      if (el) pulseButton(el);
    },
    true,
  );
}
