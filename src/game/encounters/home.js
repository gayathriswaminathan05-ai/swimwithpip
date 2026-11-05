import * as THREE from 'three';
import { Encounter } from './base.js';
import { Predator } from '../actors/creatures.js';
import { gulp } from './depths.js';
import { litMaterial, GlowPoints } from '../gfx/materials.js';
import { paintVerts, merge, mix } from '../gfx/geometry.js';
import { Ease, fbm3, smoothstep, TAU } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CAVE_ROCK = [0x2e2b4c, 0x37325a, 0x2a2846];
const GLOWS = [0x5ff3ff, 0xff6bd5, 0xffd66b, 0x9b7bff, 0x6bffb5];

function mushroomGeometry() {
  const parts = [];
  const stalk = new THREE.CylinderGeometry(0.07, 0.11, 0.6, 8);
  stalk.translate(0, 0.3, 0);
  parts.push(paintVerts(stalk, () => ({ color: 0xe8e2ff, glow: 0.3 })));
  const cap = new THREE.SphereGeometry(0.3, 14, 8, 0, TAU, 0, Math.PI / 2);
  cap.scale(1, 0.62, 1);
  cap.translate(0, 0.56, 0);
  parts.push(paintVerts(cap, (p) => ({ color: 0xffffff, glow: 0.9 + (p.y - 0.56) * 2 })));
  return merge(parts);
}

// ===========================================================================
// 8. Dark cavern — the route vanishes into darkness; bioluminescent markers reveal the way.
// ===========================================================================
export class DarkCavern extends Encounter {
  get title() {
    return 'Dark Cavern';
  }
  get icon() {
    return 'cavern';
  }
  hint() {
    return 'The path vanishes into a pitch-black cavern. Answer to light the way.';
  }
  get captureText() {
    return 'A dark undertow pulled Pip deep into the cavern.';
  }

  onBuild() {
    this.hold.set(0, 0, 9);
    const fl = this.floorAt(0, -15);
    const R = 5.4;
    const len = 50;
    this.cy = fl + R - 0.4;
    const cy = this.cy;
    // Tunnel: an irregular rocky tube along Z.
    const g = new THREE.CylinderGeometry(R, R, len, 26, 18, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, cy, -len / 2 + 6);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const dx = v.x;
      const dy = v.y - cy;
      const n = fbm3(v.x * 0.35, v.y * 0.35, v.z * 0.25, 3);
      const k = 1 + (n - 0.5) * 0.45;
      pos.setXYZ(i, dx * k, cy + dy * k, v.z);
    }
    g.computeVertexNormals();
    const tunnel = paintVerts(g, (p) => {
      const n = fbm3(p.x * 0.8, p.y * 0.8, p.z * 0.8, 2);
      if (n > 0.72) return { color: 0x7ff5ff, glow: 0.7 };
      return mix(CAVE_ROCK[0], CAVE_ROCK[1], n);
    });
    this.group.add(new THREE.Mesh(tunnel, litMaterial({ side: THREE.DoubleSide, glowUniform: { value: 0.6 } })));
    // Rocky entrance.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.15;
      this.rock(Math.cos(a) * (R + 1.2), cy + Math.sin(a) * (R + 0.6), 6.4, 2.8, 2.6, 2.4, CAVE_ROCK[i % 3], i, a);
    }
    this.rock(0, cy + R + 2.4, 5, 7, 3.4, 5, CAVE_ROCK[1], 1, 0);
    // Pillars inside (and one at the entrance that Pip can bump in the dark).
    this.rock(1.0, cy - 2.0, -2.6, 0.95, 4.6, 0.95, CAVE_ROCK[2], 0, 0);
    this.rock(1.8, cy - 1.8, -11, 1.15, 5.6, 1.15, CAVE_ROCK[0], 1, 1);
    this.rock(-2.0, cy - 1.6, -19, 1.25, 5.6, 1.25, CAVE_ROCK[1], 2, 2);
    this.rock(1.6, cy - 1.8, -27, 1.15, 5.6, 1.15, CAVE_ROCK[2], 0, 3);
    // The safe route and the markers that reveal it.
    this.route = [V(0, 0, 9), V(0, 0.2, 3), V(-1.3, 0.4, -5), V(-0.4, -0.3, -11), V(-0.2, 0.3, -15), V(0.6, 0.5, -19.5), V(-0.2, -0.2, -24), V(-1.0, 0.2, -29), V(-0.4, 0, -35), V(0, 0, -this.exit)];
    const curve = new THREE.CatmullRomCurve3(this.route, false, 'centripetal');
    const n = 18;
    this.markerGeo = mushroomGeometry();
    this.markers = new THREE.InstancedMesh(this.markerGeo, litMaterial({ glowUniform: { value: 1.8 } }), n);
    const halos = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.markerColors = [];
    for (let i = 0; i < n; i++) {
      const t = 0.06 + (i / (n - 1)) * 0.88;
      const p = curve.getPointAt(t);
      const side = i % 2 ? 1 : -1;
      const x = p.x + side * (1.5 + (i % 3) * 0.3);
      const y = cy - Math.sqrt(Math.max(0, R * R - x * x)) * 0.86 + 0.1;
      const tilt = new THREE.Vector3(-x * 0.12, 1, 0).normalize();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tilt);
      m.compose(V(x, y, p.z), q, V(1, 1, 1).multiplyScalar(0.9 + (i % 3) * 0.25));
      this.markers.setMatrixAt(i, m);
      const col = new THREE.Color(GLOWS[i % GLOWS.length]);
      this.markerColors.push(col);
      this.markers.setColorAt(i, new THREE.Color(0x060608));
      halos.push({ x, y: y + 0.8, z: p.z, size: 2.4, color: col });
    }
    this.markers.instanceColor.needsUpdate = true;
    this.group.add(this.markers);
    this.halos = new GlowPoints(halos, 0.9);
    for (let i = 0; i < n; i++) this.halos.setBrightness(i, 0);
    this.group.add(this.halos);
    this.lit = new Array(n).fill(0);
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    const z = this.pipLocal().z;
    let dark = 0;
    if (this.phase !== 'idle' && this.phase !== 'done') {
      if (z < 4.5 && z > -this.exit + 3) dark = 1;
      else if (this.phase === 'approach' || this.phase === 'hold' || this.phase === 'near') dark = 0.82;
    } else if (this.phase === 'done' && z < 4.5 && z > -this.exit + 3) dark = 1;
    if (this.phase !== 'idle') g.ocean.darkTarget = dark;
    // Lit markers pulse gently.
    const t = this.time;
    let changed = false;
    for (let i = 0; i < this.lit.length; i++) {
      if (this.lit[i] <= 0) continue;
      const k = this.lit[i] * (0.8 + 0.2 * Math.sin(t * 2.5 + i));
      this.markers.setColorAt(i, this.markerColors[i].clone().multiplyScalar(k));
      this.halos.setBrightness(i, k);
      changed = true;
    }
    if (changed) this.markers.instanceColor.needsUpdate = true;
  }

  onDispose() {
    this.game.ocean.darkTarget = 0;
  }

  async approach() {
    this.game.pip.setExpression('scared', 2);
    await super.approach();
  }

  holdShot() {
    return { target: this.L(0, 0.2, 5), yaw: 0.25, pitch: 0.08, radius: 5.6, rate: 1.4, rotRate: 1 };
  }

  async success() {
    const g = this.game;
    g.pip.setExpression('hopeful', 3);
    // Markers light up one after another, each with a soft chime.
    for (let i = 0; i < this.lit.length; i++) {
      const idx = i;
      this.sched.tween(0.5, (k) => (this.lit[idx] = k)).catch(() => {});
      if (i % 2 === 0) g.audio.chime(i / 2);
      await this.sched.wait(0.11);
    }
    g.rig.setShot(this.followShot({ yaw: 0.15, pitch: 0.12, radius: 3.0 }));
    await this.swim(
      this.route.slice(1).map((p) => [p.x, p.y, p.z]),
      7.2,
      Ease.inOutSine,
    );
  }

  async nearMiss() {
    const g = this.game;
    await this.swim([[0.3, -0.3, 1.2], [0.4, -0.4, -1.4]], 1.4, Ease.inQuad);
    g.audio.thud();
    g.shake(0.5);
    g.fx.sparkBurst(g.pip.position, 12, { color: 0xffe98a });
    g.pip.setExpression('dizzy', 2);
    await this.swim([[0, 0, 5], [this.hold.x, this.hold.y, this.hold.z]], 1.6, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    const g = this.game;
    g.rig.setShot({ target: this.L(0, 0, 4), yaw: 0.1, pitch: 0.05, radius: 5, rate: 1, rotRate: 0.6 });
    g.pip.setExpression('scared');
    const p0 = g.pip.position.clone();
    const dest = this.L(-0.6, -0.4, -14);
    g.drive = 'script';
    await this.sched.tween(
      3.6,
      (k) => {
        g.pip.position.lerpVectors(p0, dest, k);
        g.pip.glowBoost = 1 - k;
        g.pip.swimmer.extraRoll = k * 4;
      },
      Ease.inCubic,
    );
    g.pip.group.visible = false;
  }
}

// ===========================================================================
// 8. Final: the ambush — a big hungry fish rises from behind a rock to block the way home.
//    Two questions: dodge the ambush, then signal the school, who drive the predator away.
// ===========================================================================
export class TheLure extends Encounter {
  get title() {
    return 'The Final Ambush';
  }
  get icon() {
    return 'ambush';
  }
  get isFinal() {
    return true;
  }
  hint(stage) {
    return stage === 0
      ? 'A big hungry fish bursts out from behind the rocks. Answer to dodge it.'
      : 'It circles back to block the way home. Answer to signal Pip’s family.';
  }
  get captureText() {
    return 'The big fish caught Pip.';
  }

  onBuild() {
    this.hold.set(0, 0.3, 7);
    this.pred = new Predator({ scale: 2.2 });
    this.group.add(this.pred.group);
    // It lurks low behind a big rock, eyes dark, until Pip comes close.
    const fl = this.floorAt(0, -3.4);
    this.rock(0.3, fl + 1.5, -3.4, 4.2, 3.6, 2.6, 0x41357e, 1, 0.4);
    this.rock(-3.6, fl + 1.2, -4.4, 2.6, 3, 2.4, 0x372c6c, 2, 1.2);
    this.lurkPos = V(0, fl + 1.2, -7);
    this.pred.swimmer.teleport(this.lurkPos.clone(), V(0, 0, 1));
    this.pred.eyeGlow = 0;
    this.predHold = this.lurkPos.clone();
    this.predMode = 'lurk';
    // Distant family lights.
    const items = [];
    for (let i = 0; i < 26; i++) {
      items.push({ x: (Math.random() - 0.5) * 12, y: 2 + (Math.random() - 0.5) * 4, z: -40 + (Math.random() - 0.5) * 6, size: 0.9, color: 0xffd36b });
    }
    this.familyBase = items.map((it) => V(it.x, it.y, it.z));
    this.family = new GlowPoints(items, 0);
    this.group.add(this.family);
    this.familyGlow = 0.2;
    this.buildHome();
  }

  buildHome() {
    const ocean = this.game.ocean;
    const hz = -(772 - this.s) - 8;
    const f = this.floorAt(0, hz);
    this.rock(0, f + 1.6, hz - 5, 9, 5, 7, 0x41357e, 0, 0);
    this.rock(-7, f + 2.2, hz - 1, 4.5, 7, 4.5, 0x4a3d90, 1, 1);
    this.rock(7.5, f + 2, hz - 2, 4.5, 6.5, 4.5, 0x372c6c, 2, 2);
    const kinds = [
      [ocean.geos.bush[0], ocean.mats.coralGlow],
      [ocean.geos.fan[0], ocean.mats.fanGlow],
      [ocean.geos.tube, ocean.mats.coralGlow],
      [ocean.geos.anemone, ocean.mats.anemone],
    ];
    const halos = [];
    kinds.forEach(([geo, mat], kIdx) => {
      const n = 7;
      const im = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + kIdx * 0.8;
        const r = 4 + ((i * 7 + kIdx * 3) % 5);
        const x = Math.cos(a) * r;
        const z = hz - 3 + Math.sin(a) * r * 0.8;
        const y = this.floorAt(x, z) + (Math.abs(x) < 5 && z < hz - 2 ? 4.4 : 0) - 0.1;
        const s = 2 + ((i + kIdx) % 3) * 0.6;
        q.setFromAxisAngle(V(0, 1, 0), a * 3);
        m.compose(V(x, y, z), q, V(s, s, s));
        im.setMatrixAt(i, m);
        const col = new THREE.Color(GLOWS[(i + kIdx) % GLOWS.length]);
        im.setColorAt(i, col);
        if (i % 2 === 0) halos.push({ x, y: y + s * 1.1, z, size: s * 2.4, color: col });
      }
      im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
    halos.push({ x: 0, y: f + 9, z: hz - 4, size: 18, color: 0xb9a6ff });
    this.group.add(new GlowPoints(halos, 0.7));
  }

  update(dt, t) {
    super.update(dt);
    const pred = this.pred;
    if (pred.group.visible) {
      if (this.predMode === 'lurk') {
        pred.group.position.set(this.predHold.x + Math.sin(t * 0.6) * 0.25, this.predHold.y + Math.sin(t * 0.9) * 0.2, this.predHold.z);
        pred.swimmer.faceDir = V(0, 0, 1);
        pred.mouthTarget = 0.15 + Math.sin(t * 1.2) * 0.1;
      }
      pred.update(dt);
    }
    // Family lights drift and twinkle.
    this.familyBase.forEach((b, i) => {
      this.family.setPoint(i, b.x + Math.sin(t * 0.5 + i) * 0.6, b.y + Math.sin(t * 0.7 + i * 2) * 0.4, b.z + Math.cos(t * 0.4 + i) * 0.5);
    });
    this.family.opacity = this.familyGlow * (0.8 + 0.2 * Math.sin(t * 3));
    if (this.phase === 'approach' || this.phase === 'hold' || this.phase === 'near') this.game.ocean.darkTarget = 0.35;
  }

  onDispose() {
    this.game.ocean.darkTarget = 0;
  }

  async approach() {
    const g = this.game;
    g.pip.setExpression('hopeful');
    this.familyGlow = 0.25;
    const h = this.hold;
    await this.swim([[0, 0.6, h.z + 8], [h.x, h.y, h.z]], 4.4, Ease.outCubic);
    g.hoverAt(this.holdWorld);
    // Ambush: the big fish's eyes light up and it rises from behind the rock.
    g.audio.danger();
    g.shake(0.4);
    this.sched.tween(0.6, (k) => (this.pred.eyeGlow = k)).catch(() => {});
    this.pred.mouthTarget = 0.5;
    g.pip.setExpression('scared', 2.5);
    this.predMode = 'script';
    await this.swimPred([[0, -0.4, -5.5]], 1.1, Ease.outCubic);
    this.predHold.set(0, -0.4, -5.5);
    this.predMode = 'lurk';
    await this.sched.wait(0.3);
  }

  holdShot(stage) {
    return stage === 0
      ? { target: this.L(0, 0.4, 2.4), yaw: 0.45, pitch: 0.12, radius: 7, rate: 1.4, rotRate: 1 }
      : { target: this.L(-0.4, 0.6, -10.5), yaw: 0.85, pitch: 0.22, radius: 8.2, rate: 1.4, rotRate: 1 };
  }

  onHold(stage) {
    if (stage === 1) this.familyGlow = 0.7;
  }

  async swimPred(points, dur, ease = Ease.inOutSine) {
    this.predMode = 'script';
    const pts = [this.pred.group.position.clone(), ...points.map((p) => V(p[0], p[1], p[2]))];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    await this.sched.tween(dur, (k) => curve.getPointAt(k, this.pred.group.position), ease);
  }

  async success(stage) {
    const g = this.game;
    const pred = this.pred;
    if (stage === 0) {
      pred.mouthTarget = 1;
      const lunge = this.swimPred([[0, -0.2, 5.6]], 0.75, Ease.inQuad).then(() => {
        pred.mouthTarget = 0;
        g.audio.chomp();
        g.shake(0.5);
      });
      g.audio.whoosh();
      g.rig.setShot(this.followShot({ yaw: -0.6, pitch: 0.2, radius: 4.2 }));
      await this.swim([[-1.2, 2.9, 5.4], [-2.2, 3.4, 1], [-1.4, 1.6, -4], [-1.2, 1.2, -6]], 2.4, Ease.inOutSine);
      this.hold.set(-1.2, 1.2, -6);
      g.hoverAt(this.holdWorld);
      await lunge;
      // The anglerfish circles round to block the way home.
      await this.swimPred([[4.2, 0, 9], [6.5, 0.4, -2], [1.6, -0.2, -15]], 3.6, Ease.inOutSine);
      this.predHold.set(1.6, -0.2, -15);
      this.predMode = 'lurk';
      g.pip.setExpression('determined');
      return;
    }
    // Stage 2: flash a signal — the school answers and the predator is dazzled.
    g.audio.signal();
    g.pip.pulse(4);
    this.ring(g.pip.position.clone());
    this.familyGlow = 2.2;
    await this.sched.wait(0.6);
    this.familyGlow = 1;
    const school = g.school;
    school.setVisible(true);
    school.spread = 1;
    school.placeAround(this.L(0, 2, -40), 12);
    school.mode = 'swirl';
    school.anchor = g.pip.group;
    school.maxSpeed = 13;
    school.glowU.value = 1.2;
    g.pip.setExpression('happy');
    g.rig.setShot({ target: g.pip.group, offset: V(0, 0.4, -1), yaw: 0.7, pitch: 0.28, radius: 6.5, rate: 1.6, rotRate: 0.8 });
    await this.sched.wait(1.2);
    this.pred.eyeGlow = 0.3;
    pred.mouthTarget = 0;
    g.audio.whoosh();
    this.swimPred([[-6, -3, -22], [-14, -6, -34]], 3.2, Ease.inQuad)
      .then(() => (pred.group.visible = false))
      .catch(() => {});
    await this.sched.wait(2.2);
    this.familyGlow = 0;
    school.maxSpeed = 7;
    this.game.ocean.darkTarget = 0;
    this.phase = 'done';
  }

  /** Pip's signal: a soft burst of sparkles and a bloom of light (no hard shapes). */
  ring(at) {
    const g = this.game;
    g.fx.sparkBurst(at, 70, { speed: 9, life: 1.4, size: 0.45, drag: 1.6, color: 0xbff8ff });
    g.fx.sparkBurst(at, 30, { speed: 4, life: 1.8, size: 0.7, drag: 1.2, color: 0xffe08a });
    const flash = new GlowPoints([{ x: at.x, y: at.y, z: at.z, size: 2, color: 0xdffcff }], 1);
    g.scene.add(flash);
    this.sched
      .tween(1.3, (k) => {
        flash.setSize(0, 2 + k * 16);
        flash.opacity = 1.2 * (1 - k) * (1 - k);
      }, Ease.outCubic)
      .finally(() => {
        g.scene.remove(flash);
        flash.geometry.dispose();
        flash.material.dispose();
      })
      .catch(() => {});
  }

  async nearMiss() {
    const g = this.game;
    const pred = this.pred;
    pred.mouthTarget = 1;
    const p = g.pip.position.clone().sub(this.origin);
    const from = pred.group.position.clone();
    const dir = p.clone().sub(from).normalize();
    const to = p.clone().addScaledVector(dir, -3.2);
    const lunge = this.swimPred([[to.x, to.y, to.z]], 0.6, Ease.inQuad);
    await this.sched.wait(0.25);
    await this.swim([[this.hold.x + 2.4, this.hold.y + 0.6, this.hold.z + 0.5]], 0.4, Ease.outCubic);
    await lunge;
    pred.mouthTarget = 0;
    g.audio.chomp();
    g.shake(0.6);
    g.pip.setExpression('scared', 2.6);
    g.pip.shiver = 1.2;
    await this.swimPred([[this.predHold.x, this.predHold.y, this.predHold.z]], 1.1, Ease.inOutSine);
    this.predMode = 'lurk';
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.0, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    this.game.rig.setShot({ target: this.L(0, 0.4, 2), yaw: 0.5, pitch: 0.15, radius: 7, rate: 1.4, rotRate: 1 });
    await gulp(this, this.pred);
  }
}
