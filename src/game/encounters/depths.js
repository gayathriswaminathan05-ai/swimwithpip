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
    return 'An octopus slips out from behind the rock, reaching for Pip. Answer to slip past.';
  }
  get captureText() {
    return 'The octopus wrapped Pip up in its arms.';
  }

  onBuild() {
    const fl = this.floorAt(0, -2);
    this.fl = fl;
    this.hold.set(2.4, fl + 3.0, 10.5);
    // The rock the octopus hides behind, with taller rocks either side; Pip slips past on the right.
    this.hideRock = this.rock(0, fl + 1.35, -1.0, 4.4, 3.6, 3.0, DEEP_ROCKS[1], 1, 0.3);
    this.rock(-5.6, fl + 2.6, -2.6, 2.9, 6.6, 3.2, DEEP_ROCKS[0], 0, 0.6);
    this.rock(6.2, fl + 2.4, -3.0, 3.0, 6.2, 3.1, DEEP_ROCKS[2], 2, 1.4);
    this.rock(0.5, fl + 1.2, -6.6, 5.4, 4.2, 3.2, DEEP_ROCKS[3], 0, 2);
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.hideRock);
    box.min.sub(this.origin);
    box.max.sub(this.origin);
    this.rockTop = box.max.y - 0.25;
    this.rockFront = box.max.z;
    this.rockBack = box.min.z;

    this.octo = new Octopus();
    this.S = 1.25;
    this.octo.group.scale.setScalar(this.S);
    // Hidden behind the rock → cresting its left edge → out in the open on the sand, in full view.
    this.hidden = V(-0.5, this.rockTop - 2.9, this.rockBack + 0.2);
    this.crest = V(-1.6, this.rockTop + 0.1, (this.rockFront + this.rockBack) / 2);
    this.open = V(-1.5, this.floorAt(-1.5, this.rockFront + 1.4) + 0.1, this.rockFront + 1.4);
    this.octo.group.position.copy(this.hidden);
    this.group.add(this.octo.group);

    // Arm roles by where each arm sits around the head: the most forward arm reaches for Pip, the
    // two rear arms are raised and curl over the head (as in the reference), the rest spread on
    // the sand with their tips curling up.
    const arms = [...this.octo.tentacles].sort((p, q) => q.out.z - p.out.z);
    this.reach = arms[0];
    this.raised = arms.slice(6).sort((p, q) => p.out.x - q.out.x);
    this.sand = arms.slice(1, 6);
    this.strikers = [this.reach, ...this.raised, ...this.sand.filter((t) => t.out.z > 0.2)];
    this.octo.setEyes(0);
    this.mode = 'hidden';
    this.history = [];
    this.t = 0;
    this.cam = V(0.25, 0.5, 1).normalize(); // roughly toward the camera: suckers turn this way
    this._pose(true);
  }

  /** Encounter-space point → the octopus's own space. */
  _o(v) {
    return v.clone().sub(this.octo.group.position).divideScalar(this.S);
  }

  /** Sets every arm's path for the current mode. Paths are in the octopus's own space. */
  _pose(snap = false) {
    const t = this.t;
    const S = this.S;
    const pos = this.octo.group.position;
    const sway = (i, f = 0.8) => Math.sin(t * f + i * 1.7);
    const sandY = (this.floorAt(pos.x, pos.z) + 0.24 - pos.y) / S;
    const pipL = this._o(this.game.pip.position.clone().sub(this.origin));
    const toPip = V(pipL.x, 0, pipL.z).normalize();
    const set = (arm, pts, opts, rate, under = V(0, -1, 0), face = null) => {
      arm.setPath(armPath(pts, arm.length, opts), under, rate, face);
      if (snap) arm.snap();
    };
    for (const arm of this.octo.tentacles) {
      const a = arm.attach;
      const o = arm.out;
      const i = arm.index;
      const striker = this.strikers.includes(arm);
      if (this.mode === 'hidden') {
        set(arm, [a, a.clone().add(V(o.x * 0.6, -0.7, o.z * 0.4)), a.clone().add(V(o.x * 1.2, -1.6, o.z * 0.8))], { curlR: 0.4, curlSide: V(o.x, 0, o.z) }, 3);
        continue;
      }
      if (this.mode === 'climb') {
        // Pulling itself over the rock: arms reach forward and down the front.
        set(arm, [a, a.clone().add(V(o.x * 0.9, -0.3, 0.6 + o.z * 0.4)), a.clone().add(V(o.x * 1.6, -1.4, 1.5 + o.z * 0.5))], { curlR: 0.45, curlSide: V(0, 1, 0.4) }, 4);
        continue;
      }
      if (this.mode === 'coil' && striker) {
        set(arm, [a, a.clone().add(V(o.x * 0.6, 1.4, -0.3)), a.clone().add(V(o.x * 1.0, 2.8, -0.1))], { curlR: 0.35, curlSide: V(0, -0.4, 1) }, 5, undefined, this.cam);
        continue;
      }
      if (this.mode === 'strike' && striker) {
        const lag = this.history[Math.max(0, this.history.length - 9)] || this.game.pip.position;
        const k = this.strikers.indexOf(arm);
        const tgt = this._o(lag.clone().sub(this.origin)).add(V((k - 2) * 0.3, (k % 2) * 0.3 - 0.15, 0));
        set(arm, [a, a.clone().add(V(o.x * 0.3, 0.9, 0.6)), tgt], { curlR: 0.22, curlSide: V(0, 1, 0) }, 9, undefined, this.cam);
        continue;
      }
      if (this.mode === 'wrap' && striker) {
        const k = this.strikers.indexOf(arm);
        set(arm, [a, a.clone().add(V(o.x * 0.3, 0.8, 0.6)), pipL.clone().add(V((k - 2) * 0.25, 0.3, -0.2))], { curlR: 0.28, curlSide: V(k % 2 ? 1 : -1, -0.5, 0.4) }, 6, undefined, this.cam);
        continue;
      }
      if (this.mode === 'tangled' && striker) {
        const k = this.strikers.indexOf(arm);
        const knot = V(1.6 + (k - 2) * 0.3, 1.0 + (k % 2) * 0.35, 1.6);
        set(arm, [a, a.clone().add(V(o.x * 0.4, 0.5, 0.6)), knot], { curlR: 0.5, curlSide: V(k % 2 ? 1 : -1, 0.5, 0.3) }, 3, undefined, this.cam);
        continue;
      }
      if (this.mode === 'near' && arm === this.reach) {
        set(arm, [a, a.clone().add(V(0.2, 0.8, 0.9)), pipL.clone().add(V(0, -0.15, -0.35))], { curlR: 0.2, curlSide: V(0, 1, 0) }, 10, undefined, this.cam);
        continue;
      }
      // Out in the open (hold).
      if (arm === this.reach) {
        set(arm, [a, a.clone().add(V(toPip.x * 0.5, 0.45, toPip.z * 0.5 + 0.3)), a.clone().add(V(toPip.x * 1.9 + 0.2 * sway(i), 1.0 + 0.2 * sway(i, 0.6), toPip.z * 1.9)), a.clone().add(V(toPip.x * 3.0 + 0.3 * sway(i, 0.7), 1.6 + 0.25 * sway(i, 0.9), toPip.z * 3.0))], { curlR: 0.5 + 0.06 * sway(i, 1.3), curlSide: V(0, 1, -0.2) }, 2.2, undefined, this.cam);
      } else if (this.raised.includes(arm)) {
        const sd = arm === this.raised[0] ? -1 : 1;
        set(arm, [a, a.clone().add(V(sd * 0.55, 0.7, -0.25)), a.clone().add(V(sd * 1.45 + 0.15 * sway(i), 2.0, 0.0 + 0.2 * sway(i, 0.6))), a.clone().add(V(sd * 1.2 + 0.2 * sway(i, 0.7), 3.2 + 0.15 * sway(i, 0.9), 0.45))], { curlR: 0.62 + 0.06 * sway(i, 1.2), curlSide: V(-sd, -0.2, 0.3) }, 2.2, undefined, this.cam);
      } else {
        // Spread on the sand, tips curling up so their suckers show.
        const side = V(-o.z, 0, o.x);
        const mid = a.clone().add(V(o.x * 1.9, 0, o.z * 1.9)).addScaledVector(side, 0.25 * sway(i));
        mid.y = sandY;
        const end = a.clone().add(V(o.x * 3.0, 0, o.z * 3.0)).addScaledVector(side, 0.35 * sway(i, 0.6));
        end.y = sandY + 0.04;
        set(arm, [a, a.clone().add(V(o.x * 0.75, (sandY - a.y) * 0.6, o.z * 0.75)), mid, end], { curlR: 0.42 + 0.05 * sway(i, 1.1), curlSide: V(-o.x * 0.3, 1, -o.z * 0.3) }, 2.2);
      }
    }
  }

  update(dt, t) {
    super.update(dt);
    this.t += dt;
    const g = this.game;
    this.history.push(g.pip.position.clone());
    if (this.history.length > 20) this.history.shift();
    this._pose();
    this.octo.update(dt);
  }

  async approach() {
    const g = this.game;
    const swim = super.approach();
    await this.sched.wait(1.1);
    // Out it comes: over the rock's edge and down onto the sand, in full view.
    g.audio.danger();
    if (g.seaLife) g.seaLife.quiet = true; // a clean stage: passing schools keep away
    this.octo.setEyes(1);
    this.mode = 'climb';
    const P = this.octo.group.position;
    const h0 = this.hidden.clone();
    await this.sched.tween(0.8, (k) => P.lerpVectors(h0, this.crest, k), Ease.outCubic);
    await this.sched.tween(0.9, (k) => P.lerpVectors(this.crest, this.open, k), Ease.inOutSine);
    this.mode = 'hold';
    await swim;
    g.pip.setExpression('scared', 2);
  }

  holdShot() {
    return { target: this.L(-0.1, this.fl + 2.2, this.open.z + 2.4), yaw: -0.1, pitch: 0.1, radius: 5.4, rate: 1.6, rotRate: 1.1 };
  }

  async success() {
    const g = this.game;
    // Anticipation: arms rear up…
    this.mode = 'coil';
    this.octo.setEyes(1, 1);
    await this.sched.wait(0.45);
    // …then strike where Pip was a moment ago, as Pip twists away around the rock's right side.
    this.mode = 'strike';
    g.audio.whoosh();
    g.rig.setShot(this.followShot({ yaw: 0.75, pitch: 0.2, radius: 3.8 }));
    let swapped = false;
    const side = this.fl + 2.2;
    await this.swim(
      [
        [1.8, this.hold.y - 0.3, 7.6],
        [3.3, side, 1.0],
        [3.4, side, -2.4],
        [1.8, this.fl + 2.6, -6.5],
        [0, this.fl + 3.0, -this.exit],
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
    await this.swim([[this.hold.x, this.hold.y + 0.3, this.hold.z + 2.6]], 0.45, Ease.outCubic);
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
    g.rig.setShot({ target: this.L(this.open.x, this.open.y + 1.6, this.open.z + 1), yaw: 0.2, pitch: 0.1, radius: 6.5, rate: 1, rotRate: 0.6 });
    const p0 = g.pip.position.clone();
    const dest = this.L(this.open.x + 0.3, this.open.y + 1.9, this.open.z + 1.3); // drawn in close to the octopus
    await this.sched.tween(
      2.4,
      (k) => {
        g.pip.position.lerpVectors(p0, dest, k);
        g.pip.group.scale.setScalar(1 - 0.35 * k);
        g.pip.glowBoost = 1 - 0.8 * k;
      },
      Ease.inOutCubic,
    );
    this.octo.setEyes(0.3, 1);
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
