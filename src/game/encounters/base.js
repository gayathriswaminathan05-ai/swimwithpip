import * as THREE from 'three';
import { disposeTree, litMaterial } from '../gfx/materials.js';
import { Ease } from '../core/util.js';

// Encounter contract (one per hurdle):
//   approach()        Pip swims in, the danger reveals itself (threat visible before the question)
//   holdShot(stage)   camera framing while the question is on screen (threat suspended, ambient alive)
//   success(stage)    escape choreography that visibly beats this specific hurdle
//   nearMiss(stage)   wrong answer with lives left: close call, Pip recoils to the hold point
//   capture()         third wrong answer: short, non-graphic capture that fits the hurdle
// Local coordinates: origin at the hazard, Pip arrives from +Z and leaves toward -Z.

export class Encounter {
  constructor(game, cfg) {
    this.game = game;
    this.index = cfg.index;
    this.s = cfg.s;
    this.exit = cfg.exit ?? 15;
    this.approachFrom = cfg.approachFrom ?? 26;
    this.stages = cfg.stages ?? 1;
    this.clearHalfWidth = cfg.clearHalfWidth ?? 7;
    this.clearBefore = cfg.clearBefore ?? 18; // reef cleared this far before the hurdle (camera side)
    this.origin = new THREE.Vector3(0, 0, -this.s);
    this.group = null;
    this.built = false;
    this.phase = 'idle';
    this.time = 0;
    this.hold = new THREE.Vector3(0, 0, 7);
  }

  // Metadata (overridden).
  get title() {
    return 'Hurdle';
  }
  /** Illustration shown in the hurdle panel (see ui/ui.js HURDLE_ICONS). */
  get icon() {
    return 'danger';
  }
  hint() {
    return 'Answer correctly to help Pip escape!';
  }
  get captureText() {
    return 'Pip was caught.';
  }
  get isFinal() {
    return false;
  }

  /** Local → world. */
  L(x, y, z, out = new THREE.Vector3()) {
    return out.set(this.origin.x + x, this.origin.y + y, this.origin.z + z);
  }

  get holdWorld() {
    return this.L(this.hold.x, this.hold.y, this.hold.z);
  }

  /** Seabed height (local y) under local (x, z), matching the drawn sand surface. */
  floorAt(x, z) {
    return this.game.ocean.surfaceHeight(x, this.s - z) - this.origin.y;
  }

  /** A smooth reef rock using the shared rock geometry, tinted. Added to `parent` (default group). */
  rock(x, y, z, sx, sy, sz, tint = 0x3f6f8f, variant = 0, rotY = 0, parent = null) {
    this._rockMats = this._rockMats || new Map();
    let mat = this._rockMats.get(tint);
    if (!mat) {
      mat = litMaterial({ color: tint, nearFade: true });
      this._rockMats.set(tint, mat);
    }
    const geo = this.game.ocean.geos.rocks[variant % this.game.ocean.geos.rocks.length];
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = rotY;
    (parent || this.group).add(m);
    return m;
  }

  /** Pip's position in this encounter's local space. */
  pipLocal(out = new THREE.Vector3()) {
    return out.copy(this.game.pip.position).sub(this.origin);
  }

  build() {
    if (this.built) return;
    this.group = new THREE.Group();
    this.group.position.copy(this.origin);
    this.game.scene.add(this.group);
    this.onBuild();
    this.built = true;
  }

  onBuild() {}

  dispose() {
    if (!this.built) return;
    this.onDispose();
    this.game.scene.remove(this.group);
    disposeTree(this.group);
    this.group = null;
    this.built = false;
  }

  onDispose() {}

  update(dt) {
    this.time += dt;
  }

  // ---------- helpers ----------
  get pip() {
    return this.game.pip;
  }
  get sched() {
    return this.game.sched;
  }

  /** Swim from the current position through local waypoints. */
  swim(localPoints, duration, ease = Ease.inOutSine, onUpdate) {
    const pts = [this.game.pip.position.clone(), ...localPoints.map((p) => this.L(p[0], p[1], p[2]))];
    return this.game.swimPath(pts, duration, ease, onUpdate);
  }

  /** Default approach: glide in and settle at the hold point. */
  async approach() {
    const h = this.hold;
    await this.swim([[h.x * 0.5, h.y * 0.5 + 0.3, h.z + 7], [h.x, h.y, h.z]], 3.4, Ease.outCubic);
    this.game.hoverAt(this.holdWorld);
  }

  holdShot() {
    return { target: this.L(0, 0.4, 3.5), yaw: 0.35, pitch: 0.15, radius: 7, rate: 1.6, rotRate: 1.2 };
  }

  followShot(extra = {}) {
    return { target: this.game.pip.group, offset: new THREE.Vector3(0, 0.3, -1.2), yaw: 0.5, pitch: 0.18, radius: 3.6, rate: 3, rotRate: 1.4, ...extra };
  }

  /** Default near miss: shiver and recoil back to the hold point. */
  async nearMiss() {
    const g = this.game;
    g.pip.setExpression('scared', 2.2);
    g.pip.shiver = 1;
    g.shake(0.5);
    await this.swim([[this.hold.x, this.hold.y + 0.5, this.hold.z + 2.5]], 0.6, Ease.outCubic);
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.0, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    await this.sched.wait(1.5);
  }

  async success() {
    await this.swim([[0, 0, 0], [0, 0, -this.exit]], 3, Ease.inOutSine);
  }
}
