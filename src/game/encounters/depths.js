import * as THREE from 'three';
import { Encounter } from './base.js';
import { Octopus, Predator, armPath } from '../actors/creatures.js';
import { litMaterial, globalUniforms } from '../gfx/materials.js';
import { paintVerts, mix } from '../gfx/geometry.js';
import { Ease, lerp, smoothstep, damp, fbm3, TAU, clamp } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const DEEP_ROCKS = [0x2c5478, 0x274a6b, 0x375d82, 0x30577a];

/**
 * Predator capture used by the chase and the final encounter: a lunge and a snap — then darkness.
 * The predator lives in the encounter's local space.
 */
export async function gulp(enc, pred) {
  const g = enc.game;
  enc.predMode = 'script';
  pred.mouthTarget = 1;
  g.pip.setExpression('scared');
  const p = g.pip.position.clone().sub(enc.origin);
  const from = pred.group.position.clone();
  const scale = pred.model.scale.x;
  const dir = from.clone().sub(p).setY(0).normalize();
  const to = p.clone().addScaledVector(dir, 1.35 * scale + 0.3).add(V(0, 0.25 * scale, 0));
  await enc.sched.tween(0.75, (k) => pred.group.position.lerpVectors(from, to, k), Ease.inQuad);
  pred.mouthTarget = 0;
  g.audio.chomp();
  g.shake(1);
  await enc.sched.wait(0.08);
  g.pip.group.visible = false;
  await enc.sched.wait(0.7);
}

// ===========================================================================
// 4. Octopus ambush — tentacles emerge from a rocky crevice; Pip twists between them.
// ===========================================================================
export class OctopusAmbush extends Encounter {
  get title() {
    return 'Octopus Ambush';
  }
  get icon() {
    return 'octopus';
  }
  hint() {
    return 'An octopus rises over the rock, reaching for Pip. Answer to slip past.';
  }
  get captureText() {
    return 'The octopus pulled Pip behind its rock.';
  }

  onBuild() {
    this.hold.set(0, 0.4, 8);
    const fl = this.floorAt(0, -2);
    this.fl = fl;
    // A big rock in the middle of the path with the octopus behind it, taller rocks either side;
    // Pip can slip past on the right.
    this.hideRock = this.rock(0, fl + 1.35, -1.0, 4.4, 3.6, 3.0, DEEP_ROCKS[1], 1, 0.3);
    this.rock(-5.6, fl + 2.6, -2.6, 2.9, 6.6, 3.2, DEEP_ROCKS[0], 0, 0.6);
    this.rock(6.2, fl + 2.4, -3.0, 3.0, 6.2, 3.1, DEEP_ROCKS[2], 2, 1.4);
    this.rock(0.5, fl + 1.2, -6.6, 5.4, 4.2, 3.2, DEEP_ROCKS[3], 0, 2);
    // The hiding rock's extents (encounter space) guide where the arms drape.
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.hideRock);
    box.min.sub(this.origin);
    box.max.sub(this.origin);
    this.rockTop = box.max.y - 0.25;
    this.rockFront = box.max.z - 0.35;
    this.rockBack = box.min.z + 0.35;
    this.rockHalfW = (box.max.x - box.min.x) / 2 - 0.3;

    this.octo = new Octopus();
    this.octoScale = 1.3;
    // Perched on the back of the rock's top, head and eyes in full view…
    this.perch = V(0.25, this.rockTop - 0.3, this.rockBack + 1.05);
    // …but tucked down behind it until Pip comes close.
    this.hidden = V(0.25, this.rockTop - 1.9, this.rockBack + 0.2);
    this.rise = 0;
    this.riseTarget = 0;
    this.octo.group.position.copy(this.hidden);
    this.octo.group.scale.setScalar(this.octoScale);
    this.group.add(this.octo.group);

    // Arm roles by where each arm sits around the head: front (toward Pip), sides, back.
    const arms = [...this.octo.tentacles].sort((p, q) => Math.abs(Math.atan2(p.out.x, p.out.z)) - Math.abs(Math.atan2(q.out.x, q.out.z)));
    this.front = arms.slice(0, 3).sort((p, q) => p.out.x - q.out.x);
    this.sides = arms.slice(3, 5).sort((p, q) => p.out.x - q.out.x);
    this.back = arms.slice(5);
    this.strikers = [...this.front, ...this.sides];
    this.octo.setEyes(0);
    this.mode = 'hidden';
    this.history = [];
    this.t = 0;
    this._buildDrapes();
    this._pose(true);
  }

  /** Point on the hiding rock's surface: cast a ray (encounter space) and stand off by `lift`. */
  _hit(from, dir, lift, fallback) {
    this._rc = this._rc || new THREE.Raycaster();
    this._rc.set(from.clone().add(this.origin), dir.clone().normalize());
    const h = this._rc.intersectObject(this.hideRock, false)[0];
    if (!h) return fallback;
    const n = h.face ? h.face.normal.clone().transformDirection(this.hideRock.matrixWorld) : dir.clone().negate();
    return h.point.sub(this.origin).addScaledVector(n, lift);
  }

  /** Arm routes that hug the real rock: over the top edge and down the front or side faces. */
  _buildDrapes() {
    const top = this.rockTop;
    const front = this.rockFront;
    const back = this.rockBack;
    const hw = this.rockHalfW;
    const down = V(0, -1, 0);
    const topAt = (x, z) => this._hit(V(x, top + 4, z), down, 0.26, V(x, top + 0.26, z));
    const faceAt = (x, y) => this._hit(V(x, y, front + 8), V(0, 0, -1), 0.24, V(x, y, front + 0.24));
    const sideAt = (sd, y, z) => this._hit(V(sd * (hw + 8), y, z), V(-sd, 0, 0), 0.24, V(sd * (hw + 0.24), y, z));
    this.drapes = new Map();
    this.front.forEach((arm, fi) => {
      if (fi === 1) return; // the middle arm reaches for Pip instead
      const j = fi - 1;
      const xs = (k) => j * (0.95 + 0.55 * k) + 0.25;
      this.drapes.set(arm, {
        pts: [topAt(xs(0), front - 0.9), faceAt(xs(0.25), top - 0.45), faceAt(xs(0.55), top - 1.25), faceAt(xs(0.85), top - 2.0)],
        curlSide: V(j * 0.8, 0.3, 0.7),
      });
    });
    this.sides.forEach((arm, si) => {
      const sd = si === 0 ? -1 : 1;
      const mid = (front + back) / 2;
      this.drapes.set(arm, {
        pts: [topAt(sd * hw * 0.55, back + 1.3), sideAt(sd, top - 0.55, mid), sideAt(sd, top - 1.5, mid + 0.6), sideAt(sd, this.fl + 1.1, front - 0.3)],
        curlSide: V(sd * 0.7, 0.3, 0.7),
      });
    });
  }

  /** Encounter-space point → the octopus's own space. */
  _o(v) {
    return v.sub(this.octo.group.position).divideScalar(this.octoScale);
  }

  /** Root of an arm in encounter space. */
  _root(arm) {
    return arm.attach.clone().multiplyScalar(this.octoScale).add(this.octo.group.position);
  }

  /** Sets every arm's path for the current mode (encounter space, converted to octopus space). */
  _pose(snap = false) {
    const t = this.t;
    const g = this.game;
    const top = this.rockTop;
    const front = this.rockFront;
    const back = this.rockBack;
    const hw = this.rockHalfW;
    const pipL = this.pipLocal();
    const set = (arm, pts, opts, rate, under = V(0, -1, 0)) => {
      const local = pts.map((p) => this._o(p.clone()));
      const path = armPath(local, arm.length, { ...opts, curlSide: opts.curlSide.clone() });
      arm.setPath(path, under, rate);
      if (snap) arm.snap();
    };
    const sway = (i, f = 0.8) => Math.sin(t * f + i * 1.7);
    const mode = this.mode;

    this.octo.tentacles.forEach((arm) => {
      const r = this._root(arm);
      const out = arm.out;
      const i = arm.index;
      if (mode === 'hidden') {
        set(arm, [r, r.clone().add(V(out.x * 0.7, -0.8, out.z * 0.4 - 0.5)), r.clone().add(V(out.x * 1.3, -1.9, out.z * 0.6 - 1.1))], { curlR: 0.42, curlSide: V(out.x, 0, out.z) }, 3);
        return;
      }
      if (this.back.includes(arm)) {
        // Hanging down behind the rock.
        set(arm, [r, r.clone().add(V(out.x * 1.0, -0.4, -0.6)), V(r.x + out.x * 1.8, top - 1.5, back - 0.7), V(r.x + out.x * 2.4, this.fl + 0.6, back - 1.5)], { curlR: 0.5, curlSide: V(out.x, 0.4, 0) }, 2.5);
        return;
      }
      const fi = this.front.indexOf(arm);
      const si = this.sides.indexOf(arm);
      const striking = this.strikers.includes(arm);
      if (mode === 'coil' && striking) {
        set(arm, [r, V(r.x * 1.4, top + 1.3, front - 0.7), V(r.x * 1.8 + (fi - 1) * 0.5, top + 2.5, front + 0.2)], { curlR: 0.34, curlSide: V(0, -0.4, -1) }, 5);
        return;
      }
      if (mode === 'strike' && striking) {
        const lag = this.history[Math.max(0, this.history.length - 9)] || g.pip.position;
        const target = lag.clone().sub(this.origin).add(V(((fi >= 0 ? fi : si * 2 - 1) - 1) * 0.45, (i % 2) * 0.4 - 0.2, 0));
        set(arm, [r, V(r.x * 1.3, top + 0.7, front - 0.2), target], { curlR: 0.22, curlSide: V(0, 1, 0) }, 9);
        return;
      }
      if (mode === 'wrap' && striking) {
        const k = this.strikers.indexOf(arm);
        set(arm, [r, V(r.x * 1.2, top + 0.6, front - 0.3), pipL.clone().add(V((k - 2) * 0.35, 0.5, -0.3))], { curlR: 0.32, curlSide: V(k % 2 ? 1 : -1, -0.6, 0.4) }, 6);
        return;
      }
      if (mode === 'tangled' && striking) {
        const k = this.strikers.indexOf(arm);
        const knot = V(0.9 + (k - 2) * 0.35, this.fl + 1.4 + (k % 2) * 0.4, front + 1.6);
        set(arm, [r, V(r.x * 1.1, top + 0.2, front - 0.4), V(r.x * 0.8, top - 0.8, front + 0.5), knot], { curlR: 0.55, curlSide: V(k % 2 ? 1 : -1, 0.5, 0.3) }, 3);
        return;
      }
      if (mode === 'near' && arm === this.front[1]) {
        set(arm, [r, V(0.3, top + 0.7, front + 0.4), pipL.clone().add(V(0, -0.1, -0.5))], { curlR: 0.2, curlSide: V(0, 1, 0) }, 10);
        return;
      }
      // Hold: draped over the rock (hugging its surface), tips curling away from it; the middle
      // front arm rises toward Pip.
      if (fi === 1) {
        // Raised beside the head and curling over, like the arm held up in the reference; it
        // sways toward Pip.
        set(arm, [r, V(-0.7, top + 0.7, front - 1.0), V(-1.45 + 0.15 * sway(i), top + 1.7, front - 0.6 + 0.3 * sway(i, 0.7)), V(-1.2 + 0.25 * sway(i, 0.6), top + 2.8 + 0.15 * sway(i, 0.9), front + 0.1 + 0.35 * sway(i, 0.5))], { curlR: 0.55 + 0.08 * sway(i, 1.3), curlSide: V(1, -0.2, 0.2) }, 2.2, V(1, 0, 0));
        return;
      }
      const d = this.drapes.get(arm);
      const pts = d.pts.map((p, k) => (k === d.pts.length - 1 ? p.clone().add(V(0.12 * sway(i), 0.1 * sway(i, 0.6), 0.12 * Math.max(0, sway(i, 0.5)))) : p));
      set(arm, [r, ...pts], { curlR: 0.48 + 0.07 * sway(i, 1.2), curlSide: d.curlSide }, 2.2);
    });
  }

  update(dt, t) {
    super.update(dt);
    this.t += dt;
    const g = this.game;
    this.history.push(g.pip.position.clone());
    if (this.history.length > 20) this.history.shift();
    this.rise = lerp(this.rise, this.riseTarget, damp(3, dt));
    this.octo.group.position.lerpVectors(this.hidden, this.perch, this.rise);
    this._pose();
    this.octo.update(dt);
  }

  async approach() {
    const g = this.game;
    const swim = super.approach();
    await this.sched.wait(1.3);
    // The octopus rises over its rock, arms pouring over the edge toward Pip.
    g.audio.danger();
    if (g.seaLife) g.seaLife.quiet = true; // a clean stage: passing schools keep away
    this.octo.setEyes(1);
    this.riseTarget = 1;
    this.mode = 'hold';
    await swim;
    g.pip.setExpression('scared', 2);
  }

  holdShot() {
    return { target: this.L(0.5, (this.rockTop + 1.2 + 0.4) / 2 - 0.2, 3.0), yaw: 0.5, pitch: 0.12, radius: 6.4, rate: 1.6, rotRate: 1.1 };
  }

  async success() {
    const g = this.game;
    // Anticipation: arms rear up…
    this.mode = 'coil';
    this.octo.setEyes(1, 1);
    await this.sched.wait(0.45);
    // …then strike where Pip was a moment ago, as Pip twists around the side of the rock.
    this.mode = 'strike';
    g.audio.whoosh();
    g.rig.setShot(this.followShot({ yaw: 0.75, pitch: 0.2, radius: 3.8 }));
    let swapped = false;
    const side = this.fl + 2.2;
    await this.swim(
      [
        [1.6, 0.2, 4.6],
        [3.3, side, 1.0],
        [3.4, side, -2.4],
        [1.8, 0.2, -6.5],
        [0, 0, -this.exit],
      ],
      2.8,
      Ease.inOutSine,
      (k) => {
        g.pip.swimmer.extraRoll = smoothstep(0.12, 0.55, k) * TAU;
        if (!swapped && k > 0.5) {
          swapped = true;
          this.mode = 'tangled';
          this.octo.setEyes(0.6, 1);
          g.rig.setShot(this.followShot({ yaw: 0.25, pitch: 0.18, radius: 3.6 }));
        }
      },
    );
    g.pip.swimmer.extraRoll = 0;
    if (g.seaLife) g.seaLife.quiet = false;
  }

  async nearMiss() {
    const g = this.game;
    this.mode = 'near';
    g.audio.whoosh();
    await this.sched.wait(0.3);
    g.shake(0.5);
    g.pip.setExpression('scared', 2.4);
    g.pip.shiver = 1;
    await this.swim([[0, 0.7, 10.6]], 0.45, Ease.outCubic);
    this.mode = 'hold';
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.1, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    const g = this.game;
    this.mode = 'wrap';
    this.octo.setEyes(1, 1);
    g.audio.whoosh();
    g.drive = 'script';
    await this.sched.wait(0.8);
    g.pip.setExpression('scared');
    g.pip.swimmer.effort = 1;
    g.rig.setShot({ target: this.L(0, this.rockTop, 2), yaw: -0.3, pitch: 0.08, radius: 7, rate: 1, rotRate: 0.6 });
    const p0 = g.pip.position.clone();
    const dest = this.L(0.25, this.rockTop + 0.5, this.rockBack + 1.6); // pulled in behind the rock
    await this.sched.tween(
      2.6,
      (k) => {
        g.pip.position.lerpVectors(p0, dest, k);
        g.pip.group.scale.setScalar(1 - 0.45 * k);
        g.pip.glowBoost = 1 - 0.8 * k;
      },
      Ease.inOutCubic,
    );
    this.octo.setEyes(0.3, 1);
    this.riseTarget = 0.4;
    g.pip.swimmer.effort = 0;
  }
}

// ===========================================================================
// 5. Falling rocks — debris tumbles into a canyon; Pip dodges beneath a protective rock arch.
// ===========================================================================
const FALL_ROCKS = [0x6f8aa6, 0x63809d, 0x7a94ae, 0x5b7692];

class FallingRocks {
  constructor(enc, n = 44) {
    this.enc = enc;
    this.items = [];
    for (let i = 0; i < n; i++) {
      // Lighter slate than the canyon walls so falling rocks read against them.
      const m = enc.rock(0, -100, 0, 1, 1, 1, FALL_ROCKS[i % FALL_ROCKS.length], i, 0);
      m.visible = false;
      this.items.push({ m, active: false, vel: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1, life: 0, landed: false, landT: 0, chip: false, trailT: 0 });
    }
    this.colliders = [];
    this.gravity = 34; // heavy: rocks plummet rather than drift
    this.thudT = 0;
    this._p = new THREE.Vector3();
  }

  /** Drops a rock (local space). vy < 0 throws it downward. Reuses the oldest rock when all are busy. */
  spawn(x, y, z, size = 0.6, vy = -8) {
    const it = this.items.find((r) => !r.active) || this.items.reduce((a, b) => (a.life > b.life ? a : b));
    it.active = true;
    it.life = 0;
    it.size = size;
    it.landed = false;
    it.landT = 0;
    it.chip = false;
    it.trailT = 0;
    it.m.visible = true;
    it.m.position.set(x, y, z);
    it.m.scale.set(size, size * 0.9, size);
    it.vel.set((Math.random() - 0.5) * 1.2, vy, (Math.random() - 0.5) * 1.2);
    it.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    return it;
  }

  /** Chips thrown out sideways when a big rock smashes down. */
  _chips(p, size, n) {
    for (let i = 0; i < n; i++) {
      const c = this.spawn(p.x, p.y + 0.15, p.z, size * (0.2 + Math.random() * 0.16), 3 + Math.random() * 4);
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 3.5;
      c.vel.x = Math.cos(a) * sp;
      c.vel.z = Math.sin(a) * sp;
      c.chip = true;
    }
  }

  _impact(p, size, strong) {
    const g = this.enc.game;
    g.fx.dustPuff(this.enc.L(p.x, p.y, p.z, this._p), Math.round(6 + size * 14), { color: 0x6f7c8c, speed: 3 + size * 3 });
    if (!strong) return;
    if (this.thudT <= 0) {
      g.audio.thud();
      this.thudT = 0.12;
    }
    g.shake(Math.min(0.5, 0.12 + size * 0.25));
    this._chips(p, size, 1 + Math.round(size * 1.5));
  }

  update(dt) {
    const enc = this.enc;
    const g = enc.game;
    this.thudT -= dt;
    for (const it of this.items) {
      if (!it.active) continue;
      it.life += dt;
      const p = it.m.position;
      it.vel.y = Math.max(-28, it.vel.y - this.gravity * dt);
      p.addScaledVector(it.vel, dt);
      it.m.rotation.x += it.spin.x * dt;
      it.m.rotation.y += it.spin.y * dt;
      it.m.rotation.z += it.spin.z * dt;
      // A dust trail behind big, fast rocks so they read as plummeting.
      if (!it.landed && it.size > 0.5 && it.vel.y < -7) {
        it.trailT -= dt;
        if (it.trailT <= 0) {
          it.trailT = 0.05;
          g.fx.dust.emit(enc.L(p.x, p.y + it.size * 0.6, p.z, this._p), { count: 1, spread: it.size * 0.6, speed: 0.3, life: 0.9, size: 0.3 + it.size * 0.5, grow: 0.8, drag: 2, color: 0x7d8796, alpha: 0.35 });
        }
      }
      for (const c of this.colliders) {
        // Arch of boulders: rocks smash onto its top and glance off to the sides.
        if (Math.abs(p.z - c.z) < c.tube + 0.4 && Math.abs(p.x) < c.R + c.tube && it.vel.y < 0) {
          const surf = c.y + Math.sqrt(Math.max(0, c.R * c.R - p.x * p.x)) + c.tube * 0.9;
          if (p.y - it.size * 0.45 < surf && p.y > c.y + c.R * 0.4) {
            p.y = surf + it.size * 0.45;
            const strong = it.size > 0.6 && it.vel.y < -6;
            it.vel.y = -it.vel.y * 0.3;
            it.vel.x += (p.x >= 0 ? 1 : -1) * 3.2;
            it.vel.z += (Math.random() - 0.5) * 2;
            this._impact(p, it.size, strong);
          }
        }
      }
      const fy = enc.floorAt(p.x, p.z) + it.size * 0.4;
      if (p.y < fy) {
        p.y = fy;
        const hit = -it.vel.y;
        if (hit > 6) this._impact(p, it.size, it.size > 0.55 && !it.chip);
        it.landed = true;
        it.vel.y = hit * 0.18;
        it.vel.x *= 0.45;
        it.vel.z *= 0.45;
        it.spin.multiplyScalar(0.4);
      }
      // Landed rocks sink into the sand soon after, so they never pile up in front of the camera.
      if (it.landed) it.landT += dt;
      if (it.landT > 1.0 || it.life > 5) p.y -= dt * (0.8 + it.size);
      if (it.landT > 2.4 || it.life > 6.5) {
        it.active = false;
        it.m.visible = false;
      }
    }
  }
}

export class Rockfall extends Encounter {
  get title() {
    return 'Falling Rocks';
  }
  get icon() {
    return 'rocks';
  }
  hint() {
    return 'Rocks are crashing down the canyon. Answer to find a safe way through.';
  }
  get captureText() {
    return 'A rockslide trapped Pip in the canyon.';
  }

  onBuild() {
    this.hold.set(0, -0.5, 8);
    // Canyon walls.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const z = 15 - i * 6;
        const f = this.floorAt(side * 8.4, z);
        this.rock(side * 8.4, f + 3.6, z, 3.4, 10, 5.6, DEEP_ROCKS[(i + (side > 0 ? 1 : 0)) % 4], i, i * 1.7);
        this.rock(side * 6.9, f + 8.6, z + 1, 2.4, 1.8, 3.2, DEEP_ROCKS[(i + 2) % 4], i + 1, i);
      }
    }
    // The shelter: an arch of boulders that does not exist yet. A right answer brings it crashing
    // down into place (see raiseArch), and only then can Pip shelter under it.
    this.archZ = -6;
    const fa = this.floorAt(0, this.archZ) - 0.3;
    this.archR = 3.5;
    this.archTube = 0.95;
    this.archParts = [];
    for (let i = 0; i <= 6; i++) {
      const th = (i / 6) * Math.PI;
      const s = i === 0 || i === 6 ? 1.6 : 1.25;
      const m = this.rock(Math.cos(th) * this.archR, fa + Math.sin(th) * this.archR + (i === 0 || i === 6 ? 0.2 : 0), this.archZ, s, s * 0.95, s * 1.05, i % 2 ? 0x5a7fa6 : 0x4f7399, i, i * 1.1);
      m.visible = false;
      this.archParts.push({ m, to: m.position.clone(), rotZ: m.rotation.z });
    }
    this.archY = fa;
    this.underY = fa + 1.3;
    // The teetering boulder on a high ledge.
    const fl = this.floorAt(1.6, 0.5);
    this.boulderPos = V(1.6, fl + 11.6, 0.5);
    this.rock(2.9, fl + 10.4, 0.5, 2.4, 1.6, 2.6, DEEP_ROCKS[1], 2, 0);
    this.boulder = this.rock(this.boulderPos.x, this.boulderPos.y, this.boulderPos.z, 1.5, 1.4, 1.5, DEEP_ROCKS[2], 1, 0.3);
    this.rocks = new FallingRocks(this, 44);
    this.trickle = 0;
    this.rumbleT = 1.5;
  }

  /** Boulders crash down one after another and lock together into an arch: the way through. */
  raiseArch(delay = 0) {
    const g = this.game;
    const order = [0, 6, 1, 5, 2, 4, 3]; // the two feet first, the keystone last
    order.forEach((idx, n) => {
      const part = this.archParts[idx];
      const m = part.m;
      const from = part.to.clone().add(V((Math.random() - 0.5) * 1.6, 13, (Math.random() - 0.5) * 1.6));
      const spin0 = part.rotZ + (Math.random() - 0.5) * 2.4;
      this.sched
        .wait(delay + n * 0.1)
        .then(() => {
          m.visible = true;
          m.position.copy(from);
          return this.sched.tween(0.34, (k) => {
            m.position.lerpVectors(from, part.to, k);
            m.rotation.z = spin0 + (part.rotZ - spin0) * k;
          }, Ease.inQuad);
        })
        .then(() => {
          if (n % 2 === 0) g.audio.thud();
          g.shake(idx === 3 ? 0.55 : 0.3);
          g.fx.dustPuff(this.L(part.to.x, part.to.y - 0.5, part.to.z), idx === 3 ? 26 : 12, { color: 0x6f7c8c, speed: 4 });
          if (idx === 3) this.rocks.colliders.push({ z: this.archZ, y: this.archY, R: this.archR, tube: this.archTube });
        })
        .catch(() => {});
    });
  }

  update(dt, t) {
    super.update(dt);
    this.rocks.update(dt);
    if (this.boulder.visible) this.boulder.rotation.z = Math.sin(t * 3.1) * (this.phase === 'hold' ? 0.06 : 0.02);
    if (this.phase === 'approach' || this.phase === 'hold' || this.phase === 'near') {
      // A steady barrage: mostly mid-sized rocks with the odd big boulder, thrown down hard.
      const hold = this.phase === 'hold';
      this.trickle -= dt;
      if (this.trickle <= 0) {
        this.trickle = hold ? 0.12 + Math.random() * 0.2 : 0.25 + Math.random() * 0.3;
        const big = Math.random() < (hold ? 0.25 : 0.15);
        const size = big ? 1.0 + Math.random() * 0.6 : 0.35 + Math.random() * 0.5;
        const pl = this.pipLocal();
        let x = (Math.random() - 0.5) * 10;
        const z = hold ? -6 + Math.random() * 10.5 : pl.z - 12 + Math.random() * 10; // ahead of the camera
        if (Math.abs(z - pl.z) < 2.2 && Math.abs(x - pl.x) < 2) x += x < pl.x ? -2.4 : 2.4; // never onto Pip
        this.rocks.spawn(x, 15 + Math.random() * 3, z, size, -8 - Math.random() * 6);
      }
      this.rumbleT -= dt;
      if (this.rumbleT <= 0 && hold) {
        this.rumbleT = 2.5 + Math.random() * 1.5;
        this.game.audio.rumble(1.2);
        this.game.shake(0.2);
      }
    }
  }

  holdShot() {
    return { target: this.L(0, 2.2, 0.6), yaw: 0.04, pitch: -0.08, radius: 8.2, rate: 1.6, rotRate: 1.1 };
  }

  async success() {
    const g = this.game;
    g.audio.rumble(2.4);
    g.shake(0.5);
    // The right answer brings the shelter crashing into place ahead of Pip: show it wide first.
    // (Camera stays inside the canyon: high behind Pip, looking down the canyon at the arch.)
    g.rig.setShot({ target: this.L(0, this.archY + 1.8, this.archZ + 2.5), yaw: 0.06, pitch: 0.3, radius: 12, rate: 2.4, rotRate: 1.6 });
    this.raiseArch(0.1);
    this.sched.wait(1.3).then(() => g.rig.setShot(this.followShot({ yaw: 0.12, pitch: 0.22, radius: 5 }))).catch(() => {});
    const drops = [
      [0.4, () => this.rocks.spawn(-4.2, 14, -1.5, 0.9, -10)],
      [0.55, () => {
        this.boulder.visible = false;
        this.rocks.spawn(this.boulderPos.x, this.boulderPos.y, this.boulderPos.z, 1.5, -2);
      }],
      [0.85, () => this.rocks.spawn(4.2, 14, -3, 0.8, -10)],
      [1.25, () => this.rocks.spawn(-0.8, 14, this.archZ + 0.3, 1.0, -9)],
      [1.45, () => this.rocks.spawn(0.9, 14, this.archZ - 0.2, 1.1, -9)],
      [1.65, () => this.rocks.spawn(0.1, 14.5, this.archZ, 0.9, -9)],
      [1.95, () => this.rocks.spawn(-3.6, 14, this.archZ - 2, 0.8, -10)],
    ];
    drops.forEach(([at, fn]) => this.sched.wait(at).then(fn).catch(() => {}));
    g.audio.whoosh();
    const yU = this.underY;
    await this.swim([[0, (yU - 0.5) / 2, 2.6], [0, yU, -3.6], [0, yU, this.archZ - 0.2]], 1.55, Ease.inOutQuad);
    g.hoverAt(this.L(0, yU, this.archZ - 0.2));
    g.pip.setExpression('determined');
    await this.sched.wait(1.35);
    g.pip.setExpression('happy', 2);
    await this.swim([[0, yU + 0.8, -9.6], [0, -0.8, -13], [0, 0, -this.exit]], 2.3, Ease.inOutSine);
  }

  async nearMiss() {
    const g = this.game;
    this.rocks.spawn(0.2, 9.5, 5.6, 1.0, -3);
    await this.sched.wait(0.7);
    g.pip.setExpression('scared', 2.4);
    g.pip.shiver = 1;
    g.shake(0.6);
    await this.swim([[0, -0.1, 10.4]], 0.45, Ease.outCubic);
    await this.sched.wait(0.5);
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.1, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    const g = this.game;
    const H = this.hold;
    const f = this.floorAt(H.x, H.z);
    g.pip.setExpression('scared');
    g.audio.rumble(3);
    g.shake(0.8);
    g.rig.setShot({ target: this.L(H.x, f + 1.5, H.z), yaw: 0.1, pitch: 0.45, radius: 7, rate: 1.2, rotRate: 0.7 });
    await this.swim([[H.x, f + 1.0, H.z]], 1.0, Ease.inOutCubic);
    g.hoverAt(this.L(H.x, f + 1.0, H.z));
    const spots = [
      [-1.7, 0.9, 0, 1.4],
      [1.7, 0.9, 0.2, 1.4],
      [0, 0.9, -1.7, 1.5],
      [0, 0.9, 1.7, 1.4],
      [0, 2.5, 0, 1.7],
    ];
    for (const [x, y, z, s] of spots) {
      const it = this.rocks.spawn(H.x + x, f + 12, H.z + z, s, 0);
      it.active = false; // scripted, not simulated
      const from = it.m.position.clone();
      const to = V(H.x + x, f + y, H.z + z);
      this.sched
        .tween(0.7, (k) => it.m.position.lerpVectors(from, to, k), Ease.inQuad)
        .then(() => {
          g.audio.thud();
          g.fx.dustPuff(this.L(to.x, to.y, to.z), 14, { color: 0x6f7c8c });
          g.shake(0.3);
        })
        .catch(() => {});
      await this.sched.wait(0.32);
    }
    await this.sched.wait(1.2);
  }
}

// ===========================================================================
// 6. Predator chase — a larger fish approaches from behind; Pip darts into a narrow passage.
// ===========================================================================
export class PredatorChase extends Encounter {
  get title() {
    return 'Predator Chase';
  }
  get icon() {
    return 'predator';
  }
  hint() {
    return 'A hungry predator is closing in. Answer to dash into the narrow passage.';
  }
  get captureText() {
    return 'The predator caught Pip.';
  }

  onBuild() {
    this.hold.set(0, 0, 6);
    const wallZ = -4;
    this.wallZ = wallZ;
    const f = this.floorAt(0, wallZ);
    // Ring of rocks around a small hole Pip can fit through.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      this.rock(Math.cos(a) * 2.45, Math.sin(a) * 2.35, wallZ + (i % 2) * 0.2, 1.75, 1.7, 2.4, DEEP_ROCKS[i % 4], i, a);
    }
    this.rock(0, f + 1.4, wallZ, 3.4, 3.2, 3.2, DEEP_ROCKS[1], 2, 0.4);
    for (const side of [-1, 1]) {
      this.rock(side * 4.9, f + 3.4, wallZ, 2.8, 8.6, 3.4, DEEP_ROCKS[side > 0 ? 2 : 3], 1, 0.8);
      this.rock(side * 7.6, f + 3.0, wallZ - 0.6, 3.2, 8, 3.6, DEEP_ROCKS[side > 0 ? 0 : 1], 0, 1.4);
    }
    this.rock(0, 4.6, wallZ, 4.6, 2.6, 3.4, DEEP_ROCKS[0], 1, 0.2);
    this.rock(-3.6, 4.8, wallZ + 0.3, 3.2, 2.8, 3.2, DEEP_ROCKS[2], 2, 1);
    this.rock(3.6, 4.9, wallZ - 0.2, 3.2, 2.8, 3.2, DEEP_ROCKS[3], 0, 2);

    this.pred = new Predator({ scale: 1.9 });
    this.pred.group.visible = false;
    this.group.add(this.pred.group);
    this.predHold = V(0.4, 0.9, 12.4);
    this.predMode = 'hidden';
  }

  update(dt, t) {
    super.update(dt);
    const pred = this.pred;
    if (!pred.group.visible) return;
    if (this.predMode === 'hover') {
      pred.group.position.set(this.predHold.x + Math.sin(t * 0.8) * 0.3, this.predHold.y + Math.sin(t * 1.1) * 0.25, this.predHold.z + Math.sin(t * 0.6) * 0.4);
      pred.swimmer.faceDir = V(0, 0, -1);
      pred.mouthTarget = 0.22 + Math.sin(t * 1.4) * 0.14;
    }
    pred.update(dt);
  }

  async approach() {
    const g = this.game;
    const pred = this.pred;
    pred.group.visible = true;
    pred.swimmer.teleport(V(1.5, 1.8, 36), V(0, 0, -1));
    this.predMode = 'script';
    g.rig.setShot({ target: this.L(0, 0.6, 6), yaw: 1.42, pitch: 0.12, radius: 9.2, rate: 1.3, rotRate: 0.9 });
    const from = pred.group.position.clone();
    const to = this.predHold.clone();
    const predIn = this.sched.tween(3.8, (k) => pred.group.position.lerpVectors(from, to, k), Ease.outCubic);
    await super.approach();
    g.pip.setExpression('scared', 3);
    g.pip.shiver = 0.6;
    await predIn;
    this.predMode = 'hover';
  }

  holdShot() {
    return { target: this.L(0, 0.6, 4.4), yaw: 1.42, pitch: 0.12, radius: 9.2, rate: 1.4, rotRate: 1 };
  }

  async success() {
    const g = this.game;
    const pred = this.pred;
    this.predMode = 'script';
    g.pip.setExpression('determined');
    g.audio.whoosh();
    g.rig.setShot(this.followShot({ yaw: 1.45, pitch: 0.1, radius: 5.2 }));
    pred.mouthTarget = 1;
    const from = pred.group.position.clone();
    const snout = V(0.2, 0.2, this.wallZ + 1.35 * 1.9 + 0.4);
    const lunge = this.sched.tween(1.25, (k) => pred.group.position.lerpVectors(from, snout, k), Ease.inQuad).then(async () => {
      // Too big for the gap: BONK.
      g.audio.thud();
      g.shake(0.9);
      g.fx.dustPuff(this.L(0, 0, this.wallZ + 1), 20, { color: 0x6f7c8c });
      pred.mouthTarget = 0;
      const p0 = pred.group.position.clone();
      await this.sched.tween(0.7, (k) => {
        pred.group.position.lerpVectors(p0, V(0.2, 0.5, 4), k);
        pred.swimmer.extraRoll = Math.sin(k * 18) * 0.25 * (1 - k);
      });
      pred.swimmer.extraRoll = 0;
      const p1 = pred.group.position.clone();
      this.sched
        .tween(3.5, (k) => pred.group.position.lerpVectors(p1, V(-9, 4, 30), k), Ease.inOutSine)
        .then(() => (pred.group.visible = false))
        .catch(() => {});
    });
    await this.swim([[0, 0, 1.5], [0, 0, this.wallZ], [0, -0.2, -9], [0, 0, -this.exit]], 1.9, Ease.inOutQuad, () => {
      if (Math.random() < 0.5) g.fx.bubbleBurst(g.pip.position, 1, { size: 0.1 });
    });
    await lunge.catch(() => {});
  }

  async nearMiss() {
    const g = this.game;
    const pred = this.pred;
    this.predMode = 'script';
    pred.mouthTarget = 1;
    const from = pred.group.position.clone();
    this.sched.tween(0.55, (k) => pred.group.position.lerpVectors(from, V(0.3, 0.3, 8.6), k), Ease.inQuad).catch(() => {});
    await this.swim([[0, 0.3, 3.6]], 0.42, Ease.outCubic);
    pred.mouthTarget = 0;
    g.audio.chomp();
    g.shake(0.6);
    g.pip.setExpression('scared', 2.6);
    g.pip.shiver = 1.2;
    const p0 = pred.group.position.clone();
    await this.sched.tween(1.0, (k) => pred.group.position.lerpVectors(p0, this.predHold, k), Ease.inOutSine);
    this.predMode = 'hover';
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.0, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    this.game.rig.setShot({ target: this.L(0, 0.6, 7.5), yaw: 1.3, pitch: 0.12, radius: 7.5, rate: 1.4, rotRate: 1 });
    await gulp(this, this.pred);
  }
}

// ===========================================================================
// 7. Hydrothermal vents — bursts of scalding water; Pip moves between bursts to safety.
// ===========================================================================
class Plume {
  constructor(n = 70, height = 11) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uStrength: { value: 0.15 }, uHeight: { value: height } }]);
    this.u.uTime = globalUniforms.uTime;
    this.u.uPointScale = globalUniforms.uPointScale;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime; uniform float uStrength; uniform float uHeight; uniform float uPointScale;
        varying float vA; varying float vHeat;
        #include <fog_pars_vertex>
        void main() {
          float ph = fract(aSeed * 7.13 + uTime * (0.45 + aSeed * 0.35) * (0.6 + uStrength));
          float y = ph * uHeight * (0.3 + 0.7 * uStrength);
          float spread = (0.12 + ph * 1.25) * (0.45 + uStrength * 0.6);
          vec3 p = vec3(cos(aSeed * 91.0 + ph * 3.0) * spread, y, sin(aSeed * 57.0 + ph * 2.0) * spread);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.35 + ph * 1.9) * (0.45 + uStrength) * uPointScale / max(0.5, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vA = (1.0 - ph) * (0.18 + uStrength * 0.8);
          vHeat = 1.0 - ph;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vHeat;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a = (1.0 - smoothstep(0.1, 1.0, d)) * vA;
          #ifdef USE_FOG
            a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          vec3 c = mix(vec3(0.45, 0.5, 0.6), vec3(1.0, 0.62, 0.28), vHeat * vHeat);
          gl_FragColor = vec4(c * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    const cone = new THREE.CylinderGeometry(1.3, 0.35, height, 16, 1, true);
    cone.translate(0, height / 2, 0);
    this.columnMat = new THREE.MeshBasicMaterial({ color: 0xff9a55, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.column = new THREE.Mesh(cone, this.columnMat);
    this.group = new THREE.Group();
    this.group.add(this.points, this.column);
    this.strength = 0.15;
    this.target = 0.15;
  }

  update(dt) {
    this.strength = lerp(this.strength, this.target, damp(this.target > this.strength ? 9 : 4, dt));
    this.u.uStrength.value = this.strength;
    this.columnMat.opacity = Math.max(0, this.strength - 0.25) * 0.22;
    this.column.scale.set(0.6 + this.strength * 0.6, 0.35 + this.strength * 0.65, 0.6 + this.strength * 0.6);
  }
}

function chimneyGeometry(seed, h) {
  const g = new THREE.CylinderGeometry(0.5, 1.25, h, 16, 10);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * 1.4 + seed, v.y * 1.1, v.z * 1.4, 3);
    const k = 1 + (n - 0.5) * 0.6;
    pos.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  return paintVerts(g, (p) => {
    const crack = Math.abs(Math.sin(p.y * 3.1 + fbm3(p.x * 2 + seed, p.y, p.z * 2, 2) * 9));
    const hot = smoothstep(0.92, 0.99, 1 - crack) * smoothstep(0, h, p.y + 0.6);
    if (hot > 0.2) return { color: 0xff7a2e, glow: 1.4 * hot };
    return mix(0x22232c, 0x45434e, p.y / h);
  });
}

export class Vents extends Encounter {
  get title() {
    return 'Hydrothermal Vents';
  }
  get icon() {
    return 'vents';
  }
  hint() {
    return 'Scalding water bursts from the vents. Answer to dash between the bursts.';
  }
  get captureText() {
    return 'A scalding plume swept Pip up and away.';
  }

  onBuild() {
    this.hold.set(0, 0.2, 8);
    const layout = [
      [-2.6, 3.2, 4.0],
      [2.4, 0.2, 4.6],
      [-2.0, -3.4, 4.2],
      [2.6, -6.4, 4.8],
    ];
    const mat = litMaterial({ glowUniform: { value: 1 } });
    this.vents = layout.map(([x, z, h], i) => {
      const f = this.floorAt(x, z) - 0.3;
      const chim = new THREE.Mesh(chimneyGeometry(i * 3 + 1, h), mat);
      chim.position.set(x, f, z);
      this.group.add(chim);
      const plume = new Plume(this.game.quality.particles < 0.7 ? 45 : 70, 12);
      plume.group.position.set(x, f + h - 0.1, z);
      this.group.add(plume.group);
      return { plume, x, z, top: f + h, timer: 1 + i * 1.3, burst: 0 };
    });
    this.auto = true;
    this.waypoints = [V(0.2, -0.2, 2.0), V(-0.2, -0.3, -1.3), V(0.4, -0.2, -4.8)];
  }

  burst(i, dur = 1.2) {
    const v = this.vents[i];
    v.plume.target = 1;
    v.burst = dur;
    const d = this.pipLocal().distanceTo(V(v.x, v.top + 3, v.z));
    if (d < 12) this.game.audio.steam();
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    let hot = null;
    let hotS = 0;
    for (const v of this.vents) {
      if (this.auto) {
        v.timer -= dt;
        if (v.timer <= 0) {
          v.timer = 3 + Math.random() * 2.5;
          if (this.phase !== 'idle' && this.phase !== 'done') this.burst(this.vents.indexOf(v));
          else {
            v.plume.target = 1;
            v.burst = 1.1;
          }
        }
      }
      if (v.burst > 0) {
        v.burst -= dt;
        if (v.burst <= 0) v.plume.target = 0.15;
      }
      v.plume.update(dt);
      if (v.plume.strength > hotS) {
        hotS = v.plume.strength;
        hot = v;
      }
    }
    const near = Math.abs(this.pipLocal().z) < 22 && this.phase !== 'done';
    g.ocean.tintTarget = near ? 0.22 : 0;
    if (near && hot) {
      g.ocean.hazardLight.position.copy(this.L(hot.x, hot.top + 1.5, hot.z));
      g.ocean.hazardLight.intensity = 6 + hotS * 26;
    } else if (this.phase === 'done') {
      g.ocean.hazardLight.intensity = Math.max(0, g.ocean.hazardLight.intensity - dt * 20);
    }
  }

  onDispose() {
    this.game.ocean.tintTarget = 0;
    this.game.ocean.hazardLight.intensity = 0;
  }

  holdShot() {
    return { target: this.L(0, -0.8, 0.5), yaw: 0.45, pitch: 0.85, radius: 8.6, rate: 1.4, rotRate: 1 };
  }

  async dash(p, dur = 0.7) {
    await this.swim([[p.x, p.y, p.z]], dur, Ease.inOutQuad);
    this.game.hoverAt(this.L(p.x, p.y, p.z));
  }

  async success() {
    const g = this.game;
    this.auto = false;
    this.vents.forEach((v) => (v.plume.target = 0.15));
    g.pip.setExpression('determined');
    g.rig.setShot(this.followShot({ yaw: 0.5, pitch: 0.72, radius: 5.4 }));
    const [W1, W2, W3] = this.waypoints;
    this.burst(0, 1.0);
    await this.sched.wait(0.6);
    this.burst(1, 1.1);
    await this.dash(W1);
    await this.sched.wait(0.25);
    this.burst(0, 1.0);
    await this.dash(W2);
    this.burst(1, 1.0);
    this.burst(3, 0.9);
    await this.sched.wait(0.6);
    await this.dash(W3);
    this.burst(2, 1.1);
    await this.sched.wait(0.3);
    g.audio.whoosh();
    this.sched.wait(0.6).then(() => this.burst(3, 1.2)).catch(() => {});
    await this.swim([[0.2, 0, -9], [0, 0, -this.exit]], 1.5, Ease.inOutSine);
    g.pip.setExpression('happy', 2);
    this.auto = true;
  }

  async nearMiss() {
    const g = this.game;
    this.auto = false;
    await this.swim([[0.1, 0, 4.4]], 0.7, Ease.inQuad);
    this.burst(0, 1.1);
    this.burst(1, 1.1);
    g.ocean.tintTarget = 0.6;
    g.shake(0.5);
    g.pip.setExpression('scared', 2.6);
    await this.swim([[0, 2.6, 9.6]], 0.7, Ease.outCubic, (k) => (g.pip.swimmer.extraRoll = Math.sin(k * Math.PI) * 2.2));
    g.pip.swimmer.extraRoll = 0;
    g.pip.shiver = 1;
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.1, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
    this.auto = true;
  }

  async capture() {
    const g = this.game;
    this.auto = false;
    g.rig.setShot({ target: this.L(-0.5, 3, 3), yaw: 0.6, pitch: 0.2, radius: 9.5, rate: 1, rotRate: 0.6 });
    await this.swim([[-1.2, -0.2, 3.6]], 0.9, Ease.inQuad);
    this.burst(0, 4);
    g.ocean.tintTarget = 0.7;
    g.pip.setExpression('scared');
    g.shake(0.7);
    const p0 = this.pipLocal();
    g.drive = 'script';
    await this.sched.tween(
      3,
      (k) => {
        g.pip.position.copy(this.L(p0.x + Math.sin(k * 9) * 0.8, p0.y + k * 15, p0.z + Math.cos(k * 7) * 0.6));
        g.pip.swimmer.extraRoll = k * 16;
        g.pip.group.scale.setScalar(1 - k * 0.5);
      },
      Ease.inQuad,
    );
    g.pip.group.visible = false;
  }
}
