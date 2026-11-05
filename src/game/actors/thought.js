import * as THREE from 'three';
import { clamp } from '../core/util.js';

// A cartoon thought bubble (a big "?") that pops up above a character's head. It is drawn once
// to a canvas and shown as a sprite that keeps the same size on screen, so it stays readable in
// wide shots. Used in the intro when Pip realises it is lost.

const INK = '#163b50';
const ACCENT = '#ff7f57';

function backOut(k) {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
}

export class ThoughtBubble {
  constructor({ symbol = '?', size = 0.16 } = {}) {
    this.symbol = symbol;
    this.size = size; // fraction of the screen height (roughly)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false, fog: false, sizeAttenuation: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.renderOrder = 30;
    this.sprite.center.set(0.16, 0.08); // anchored at the smallest trailing bubble, near the head
    this.sprite.visible = false;
    this.offset = new THREE.Vector3(0, 0.42, 0);
    this.k = 0; // 0 hidden .. 1 shown
    this.on = false;
    this.t = 0;
    this.pop = 0;
    this.drawn = false;
  }

  _draw() {
    const c = this.canvas.getContext('2d');
    const draw = () => {
      c.clearRect(0, 0, 256, 256);
      const blob = (x, y, r) => {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      };
      c.lineWidth = 7;
      c.strokeStyle = 'rgba(22, 59, 80, 0.85)';
      c.fillStyle = '#ffffff';
      // Little trailing bubbles leading down to the head.
      blob(40, 236, 11);
      blob(66, 206, 16);
      // The cloud: overlapping puffs, stroked first, then filled again to hide inner seams.
      const puffs = [
        [150, 106, 72],
        [102, 118, 46],
        [196, 116, 48],
        [128, 68, 46],
        [178, 66, 44],
        [150, 150, 46],
      ];
      for (const [x, y, r] of puffs) blob(x, y, r);
      c.lineWidth = 0;
      for (const [x, y, r] of puffs) {
        c.beginPath();
        c.arc(x, y, r - 3.5, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = ACCENT;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = '700 120px Unbounded, Lexend, system-ui, sans-serif';
      c.lineWidth = 10;
      c.strokeStyle = INK;
      c.lineJoin = 'round';
      c.strokeText(this.symbol, 152, 116);
      c.fillText(this.symbol, 152, 116);
      this.tex.needsUpdate = true;
    };
    draw();
    // Redraw once the display font (Unbounded, as in the UI) is ready; the title screen normally loads it already.
    if (document.fonts && document.fonts.load) document.fonts.load('700 120px Unbounded').then(draw, () => {});
    this.drawn = true;
  }

  show(on = true) {
    if (on && !this.drawn) this._draw();
    if (on && !this.on) {
      this.t = 0;
      this.pop = 0;
    }
    this.on = on;
  }

  hide() {
    this.on = false;
  }

  reset() {
    this.on = false;
    this.k = 0;
    this.pop = 0;
    this.sprite.visible = false;
  }

  /** Follow `anchor` (a world position, e.g. the top of Pip's head). */
  update(dt, anchor) {
    this.t += dt;
    if (this.on) this.pop = Math.min(1, this.pop + dt / 0.45);
    this.k = this.on ? backOut(this.pop) : Math.max(0, this.k - dt * 4);
    this.sprite.visible = this.k > 0.01;
    if (!this.sprite.visible) return;
    const s = this.size * clamp(this.k, 0, 1.3);
    this.sprite.scale.set(s, s, 1);
    this.sprite.position.copy(anchor).add(this.offset);
    this.sprite.position.y += Math.sin(this.t * 2.2) * 0.05;
    this.mat.rotation = Math.sin(this.t * 2.6) * 0.06;
    this.mat.opacity = clamp(this.k * 1.4, 0, 1);
  }
}
