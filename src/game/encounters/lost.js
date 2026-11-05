import * as THREE from 'three';
import { Encounter } from './base.js';
import { CurrentStreaks } from '../world/streaks.js';
import { CurrentBand } from '../world/currentband.js';
import { GlowPoints, globalUniforms } from '../gfx/materials.js';
import { Ease, lerp, smoothstep, TAU } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A ring of warm glints that marks the safe way through. */
function guideRing(cx, cy, cz, radius = 0.9, n = 10, color = 0xfff1a8) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    items.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, z: cz, size: 0.5, color });
  }
  items.push({ x: cx, y: cy, z: cz, size: 2.2, color });
  const g = new GlowPoints(items, 0);
  return g;
}

// ===========================================================================
// 1. Powerful current — swirling water pushes Pip off course; Pip banks into a sheltered channel.
// ===========================================================================
export class PowerCurrent extends Encounter {
  get title() {
    return 'Powerful Current';
  }
  get icon() {
    return 'current';
  }
  hint() {
    return 'A powerful current keeps pushing Pip back. Answer to catch a lull in the current.';
  }
  get captureText() {
    return 'The current swept Pip far, far away.';
  }

  onBuild() {
    this.hold.set(-1.5, 0.6, 7);
    // The current: a broad stream of moving water crossing the path right where Pip is.
    this.bandAt = new THREE.Vector3(0, 0.8, 6.8);
    this.band = new CurrentBand({ length: 50, width: 3.6, height: 2.4, wiggle: 0.9, flow: 1.7 });
    this.band.group.position.copy(this.bandAt);
    // The stream runs straight against Pip's way home: from ahead, back toward the camera (+Z).
    this.band.group.rotation.y = -Math.PI / 2;
    this.band.target = 1;
    this.group.add(this.band.group);
    // A few soft streamlines running along inside the stream (same direction).
    this.streaks = new CurrentStreaks(22, { length: 44, radius: [0.4, 2.4], seed: 8, opacity: 0.45, width: 0.12 });
    this.streaks.mesh.rotation.y = -Math.PI / 2;
    this.streaks.center.set(this.bandAt.z, this.bandAt.y, -this.bandAt.x); // in the streak mesh's own (rotated) space
    this.streaks.flow = 13;
    this.streaks.spin = 0.18;
    this.streaks.target = 1;
    this.group.add(this.streaks.mesh);
    this._sp = new THREE.Vector3();
    this._sd = new THREE.Vector3();
    // The sheltered channel: two low rock walls to the right, calm kelp inside.
    const tints = [0x3f9199, 0x357c8c, 0x4fa29e];
    for (let i = 0; i < 4; i++) {
      const z = 3.5 - i * 4.2;
      for (const [x, big] of [[5.3, 1], [10.1, 1.25]]) {
        const f = this.floorAt(x, z);
        this.rock(x, f + 0.9 * big, z, 1.9 * big, 2.0 * big, 2.3, tints[i % 3], i, i * 1.3);
        this.rock(x + (x < 7 ? -0.3 : 0.3), f + 2.6 * big, z + 0.6, 1.3 * big, 1.5 * big, 1.6, tints[(i + 1) % 3], i + 1, i * 0.7);
      }
    }
    const kelp = this.game.ocean.geos.kelp;
    const kelpMat = this.game.ocean.mats.kelp;
    for (let i = 0; i < 3; i++) {
      const k = new THREE.Mesh(kelp, kelpMat);
      const z = 1 - i * 4;
      k.position.set(7.7 + (i % 2) * 0.4, this.floorAt(7.7, z) - 0.2, z);
      k.scale.setScalar(0.8);
      this.group.add(k);
    }
    this.struggle = 0;
    this.cycle = 0;
    this.gusting = false;
  }

  /** World point and flow direction somewhere inside the stream. */
  _streamPoint(u) {
    this.band.sample(this._sp, this._sd, u);
    this.band.group.localToWorld(this._sp);
    this._sd.transformDirection(this.band.group.matrixWorld);
    return this._sp;
  }

  update(dt, t) {
    super.update(dt);
    this.streaks.update(dt);
    this.band.update(dt);
    const g = this.game;
    // The stream carries sand, bubbles and bits of seaweed along and bends the plants.
    const near = Math.abs(this.pipLocal().z) < 30 && this.phase !== 'done';
    this.band.target = near || this.phase === 'idle' ? (this.lull ? 0.12 : 1) : 0;
    this.streaks.target = this.lull ? 0.06 : this.band.target;
    if (near && !this.lull) {
      g.currentPushTarget.set(0, this.phase === 'capture' || this.gusting ? 3.4 : 2.2);
      this.debrisT = (this.debrisT || 0) - dt;
      while (this.debrisT <= 0) {
        this.debrisT += this.gusting ? 0.018 : 0.045;
        const at = this._streamPoint(Math.random() * 0.45).clone();
        const dir = this._sd;
        const roll = Math.random();
        if (roll < 0.45) g.fx.dust.emit(at, { count: 1, spread: 0.6, speed: 10, dir, life: 2.4, size: 0.5, grow: 0.4, drag: 0.05, color: 0xd7c49a, alpha: 0.4 });
        else if (roll < 0.7) g.fx.dust.emit(at, { count: 1, spread: 0.4, speed: 9, dir, life: 2.6, size: 0.35, grow: 0.1, drag: 0.05, color: 0x4fa65e, alpha: 0.75 });
        else g.fx.bubbles.emit(at, { count: 1, spread: 0.4, speed: 11, dir, up: 0.3, life: 2.4, size: 0.16, drag: 0.05, color: 0xe8fbff });
      }
    }
    // While waiting, Pip fights the current: swims hard forward, gains a little, then a gust
    // shoves it back with a tumble; it rights itself and tries again.
    if ((this.phase === 'hold' || this.phase === 'approach') && g.drive === 'hover') {
      this.struggle = Math.min(1, this.struggle + dt);
      const T = 3.6;
      const prev = this.cycle;
      this.cycle = (this.cycle + dt) % T;
      const c = this.cycle;
      const back = 4.0; // how far a gust pushes Pip back
      let zOff;
      let roll = Math.sin(t * 2.4) * 0.12;
      let effort = 1;
      this.gusting = false;
      if (c < 2.1) {
        zOff = back - (back + 0.7) * Ease.inOutSine(c / 2.1); // fighting forward, slowly
      } else if (c < 2.8) {
        const k = (c - 2.1) / 0.7;
        zOff = -0.7 + (back + 0.7) * Ease.outCubic(k); // shoved back
        roll = Math.sin(k * Math.PI) * 1.3;
        effort = 0.4;
        this.gusting = true;
      } else {
        zOff = back; // shaking it off
        roll = Math.sin((c - 2.8) * 9) * 0.25 * (1 - (c - 2.8) / 0.8);
      }
      if (prev < 2.1 && c >= 2.1 && this.phase === 'hold') {
        g.audio.whoosh();
        g.shake(0.18);
      }
      // Distressed the whole time: a worried frown while fighting forward, terrified in a gust.
      this.distress(t, this.gusting ? 1.3 : 0.8, this.gusting || c >= 2.8 ? 'scared' : 'worried');
      this.streaks.flow = this.gusting ? 24 : 13;
      const H = this.holdWorld;
      const s = this.struggle;
      g.hoverPoint.set(H.x + Math.sin(t * 1.3) * 0.35 * s, H.y + Math.sin(t * 2.3) * 0.2 - (this.gusting ? 0.25 : 0), H.z + zOff * s);
      g.pip.swimmer.extraRoll = roll * s;
      g.pip.swimmer.effort = effort * s;
    } else if (this.struggle > 0 && this.phase !== 'near' && this.phase !== 'capture') {
      this.struggle = Math.max(0, this.struggle - dt * 2);
      this.gusting = false;
      this.streaks.flow = 13;
      g.pip.swimmer.effort = 0.9 * this.struggle;
      if (g.drive !== 'hover') g.pip.swimmer.extraRoll *= 0.9;
    }
  }

  async approach() {
    this.game.pip.setExpression('determined');
    await super.approach();
  }

  holdShot() {
    return { target: this.L(-0.8, 0.5, 8.6), yaw: -1.2, pitch: 0.18, radius: 5.2, rate: 1.5, rotRate: 1 };
  }

  async success() {
    const g = this.game;
    // The help: the current eases into a lull, and Pip makes a dash for it.
    this.calm();
    this.lull = true;
    this.gusting = false;
    g.pip.swimmer.extraRoll = 0;
    g.pip.setExpression('hopeful');
    g.audio.chime?.();
    await this.sched.wait(0.7);
    g.pip.setExpression('determined');
    g.audio.whoosh();
    g.rig.setShot(this.followShot({ yaw: 0.6, pitch: 0.25, radius: 4.6 }));
    await this.swim(
      [
        [this.hold.x, this.hold.y + 0.1, this.hold.z - 2.5],
        [0.4, 0.3, 0],
        [0, 0.1, -9],
        [0, 0, -this.exit],
      ],
      3.4,
      Ease.inOutSine,
      (k) => (g.pip.swimmer.effort = k < 0.6 ? 1 : 0.3),
    );
    g.pip.swimmer.effort = 0;
    g.pip.setExpression('happy', 2);
    this.lull = false;
  }

  async nearMiss() {
    const g = this.game;
    const H = this.holdWorld;
    g.pip.setExpression('scared');
    g.audio.whoosh();
    g.shake(0.45);
    this.gusting = true;
    this.streaks.flow = 28;
    g.drive = 'script';
    const P0 = g.pip.position.clone();
    await this.sched.tween(
      1.2,
      (k) => {
        g.pip.position.set(P0.x + Math.sin(k * 5) * 0.4, P0.y + Math.sin(k * Math.PI) * 0.6, P0.z + 6.5 * k);
        g.pip.swimmer.extraRoll = k * TAU * 1.5;
      },
      Ease.outCubic,
    );
    this.gusting = false;
    this.streaks.flow = 13;
    g.pip.swimmer.extraRoll = 0;
    this.calm();
    g.pip.setExpression('dizzy', 1.6);
    await this.sched.wait(0.5);
    g.pip.setExpression('worried');
    await this.swim([[this.hold.x, this.hold.y, this.hold.z + 4.0]], 1.3, Ease.inOutSine, () => (g.pip.swimmer.effort = 1));
    this.cycle = 0;
    g.hoverAt(H);
  }

  async capture() {
    const g = this.game;
    const P0 = this.pipLocal();
    this.streaks.flow = 20;
    this.band.u.uFlow.value = 2.6;
    g.audio.whoosh();
    g.pip.setExpression('scared');
    g.rig.setShot({ target: this.L(4, 1, 6), yaw: 0.25, pitch: 0.28, radius: 10, rate: 1, rotRate: 0.6 });
    g.drive = 'script';
    // Swept away down the stream: back the way Pip came, tumbling, out of sight.
    const P0w = g.pip.position.clone();
    const u0 = Math.min(0.9, Math.max(0, (P0.z - this.bandAt.z) / this.band.length + 0.5));
    const c = new THREE.Vector3();
    await this.sched.tween(
      3.2,
      (k) => {
        this.band.curve.getPointAt(Math.min(1, u0 + (1 - u0) * k), c);
        this.band.group.localToWorld(c);
        const off = (1 - k) * (1 - k);
        g.pip.position.set(lerp(P0w.x, c.x, 1 - off), lerp(P0w.y, c.y, 1 - off) + Math.sin(k * 20) * 0.3, lerp(P0w.z, c.z, 1 - off));
        g.pip.swimmer.extraRoll = k * 14;
        g.pip.group.scale.setScalar(1 - k * 0.55);
      },
      Ease.inQuad,
    );
    g.pip.group.visible = false;
  }
}

// ===========================================================================
// 2. Abandoned fishing net — a tangled net blocks the passage; Pip slips through a torn opening.
// ===========================================================================
function netTexture(holeU, holeV, holeR) {
  const W = 512;
  const H = 352;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(232, 214, 170, 1)';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  const step = 22;
  for (let d = -H; d < W + H; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(d, H);
    ctx.lineTo(d + H, 0);
    ctx.stroke();
  }
  // Knots.
  ctx.fillStyle = 'rgba(214, 190, 140, 1)';
  for (let y = 0; y < H; y += step / 2) {
    for (let x = ((y / (step / 2)) % 2) * (step / 2); x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
    }
  }
  // Torn opening with frayed strands (none while the net is still whole).
  if (holeR <= 0) {
    const whole = new THREE.CanvasTexture(c);
    whole.colorSpace = THREE.SRGBColorSpace;
    whole.anisotropy = 4;
    return whole;
  }
  const hx = holeU * W;
  const hy = (1 - holeV) * H;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(hx, hy, holeR * W, holeR * W * 0.85, 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(232, 214, 170, 1)';
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const rx = holeR * W * 1.05;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(a) * rx, hy + Math.sin(a) * rx * 0.85);
    ctx.quadraticCurveTo(hx + Math.cos(a + 0.3) * rx * 0.75, hy + Math.sin(a + 0.4) * rx * 0.6, hx + Math.cos(a + 0.5) * rx * 0.55, hy + Math.sin(a + 0.6) * rx * 0.5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class GhostNet extends Encounter {
  get title() {
    return 'Abandoned Net';
  }
  get icon() {
    return 'net';
  }
  hint() {
    return 'An old fishing net blocks the way. Answer to tear a gap in it.';
  }
  get captureText() {
    return 'Pip got trapped in the abandoned net.';
  }

  onBuild() {
    this.hold.set(0, 0.2, 6.5);
    const NW = 16;
    const NH = 11;
    const NY = 0.5; // centre height
    this.hole = V(-3, -2.0, 0);
    const holeU = (this.hole.x + NW / 2) / NW;
    const holeV = (this.hole.y - (NY - NH / 2)) / NH;
    const geo = new THREE.PlaneGeometry(NW, NH, 40, 28);
    geo.translate(0, NY, 0);
    this.netU = {
      uBillow: { value: 1 },
      uPush: { value: 0 },
      uPushAt: { value: new THREE.Vector2(0, 0) },
      uWrap: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uTop: { value: NY + NH / 2 },
    };
    // The net starts whole; a right answer tears the gap (see tear()).
    this.holeUV = [holeU, holeV];
    const mat = new THREE.MeshLambertMaterial({ map: netTexture(holeU, holeV, 0), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
    this.netMat = mat;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.netU, { uTime: globalUniforms.uTime });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime; uniform float uBillow; uniform float uPush; uniform vec2 uPushAt; uniform float uWrap; uniform vec3 uCenter; uniform float uTop;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float hang = smoothstep(0.0, 2.5, uTop - transformed.y);
          transformed.z += (sin(transformed.x * 0.6 + uTime * 1.3) * 0.32 + sin(transformed.y * 0.8 + uTime * 0.9) * 0.22) * uBillow * hang;
          vec2 dp = transformed.xy - uPushAt;
          transformed.z += uPush * hang * exp(-dot(dp, dp) * 0.09);
          vec3 d = transformed - uCenter;
          float L = length(d);
          vec3 wrapped = uCenter + normalize(d + vec3(0.0, 0.0, 0.001)) * (0.75 + 0.12 * sin(L * 3.0 + transformed.x));
          transformed = mix(transformed, wrapped, uWrap * (1.0 - smoothstep(4.0, 11.0, L) * 0.65));`,
        );
    };
    mat.customProgramCacheKey = () => 'ghost-net';
    this.net = new THREE.Group();
    this.netMesh = new THREE.Mesh(geo, mat);
    this.net.add(this.netMesh);
    this.group.add(this.net);
    // Floats along the top, weights along the bottom, ropes to the surface.
    const floatMat = new THREE.MeshLambertMaterial({ color: 0xe0874e });
    const weightMat = new THREE.MeshLambertMaterial({ color: 0x3d4250 });
    const ropeMat = new THREE.MeshLambertMaterial({ color: 0xcdb78a });
    for (let i = 0; i < 7; i++) {
      const x = -NW / 2 + 1 + i * ((NW - 2) / 6);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), floatMat);
      f.position.set(x, NY + NH / 2 + 0.1, 0);
      this.net.add(f);
    }
    for (const x of [-NW / 2 + 0.6, NW / 2 - 0.6]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 16, 6), ropeMat);
      rope.position.set(x, NY + NH / 2 + 8, 0);
      this.net.add(rope);
    }
    for (let i = 0; i < 6; i++) {
      const x = -NW / 2 + 1.4 + i * 2.6;
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), weightMat);
      w.position.set(x, this.floorAt(x, 0) + 0.15, 0.1);
      this.group.add(w);
    }
    this.ring = guideRing(this.hole.x, this.hole.y, 0.35, 1.0);
    this.group.add(this.ring);
  }

  update(dt) {
    super.update(dt);
  }

  holdShot() {
    return { target: this.L(-0.8, -0.2, 3.3), yaw: 0.55, pitch: 0.06, radius: 6.8, rate: 1.6, rotRate: 1.1 };
  }

  /** The help: a weak spot in the old net rips open, threads snapping. */
  async tear() {
    const g = this.game;
    g.audio.thud();
    g.shake(0.2);
    const at = this.L(this.hole.x, this.hole.y, 0.1);
    const steps = [0.018, 0.034, 0.05, 0.062, 0.07];
    for (const [i, r] of steps.entries()) {
      const old = this.netMat.map;
      this.netMat.map = netTexture(this.holeUV[0], this.holeUV[1], r);
      this.netMat.needsUpdate = true;
      old.dispose();
      g.fx.dust.emit(at, { count: 6, spread: 0.6 + i * 0.25, speed: 2.4, life: 1.4, size: 0.12, gravity: 0.6, drag: 1.2, color: 0xe8d6aa, alpha: 0.9 });
      g.fx.bubbleBurst(at, 3);
      this.netU.uPushAt.value.set(this.hole.x, this.hole.y);
      this.netU.uPush.value = -0.5 * (1 - i / steps.length);
      await this.sched.wait(0.11);
    }
    this.netU.uPush.value = 0;
  }

  async success() {
    const g = this.game;
    await this.tear();
    g.pip.setExpression('hopeful', 0.8);
    this.sched.tween(0.8, (k) => (this.ring.opacity = k)).catch(() => {});
    await this.sched.wait(0.6);
    g.audio.whoosh();
    g.rig.setShot(this.followShot({ yaw: 1.2, pitch: 0.05, radius: 3.4 }));
    const hz = this.origin.z;
    await this.swim(
      [
        [-1.8, -1.0, 3.8],
        [this.hole.x, this.hole.y, 1.3],
        [this.hole.x, this.hole.y, -1.3],
        [-1.6, -0.8, -5],
        [0, 0, -this.exit],
      ],
      4.2,
      Ease.inOutSine,
      () => {
        const zl = g.pip.position.z - hz;
        g.pip.squash = smoothstep(1.9, 0.2, Math.abs(zl)) * 0.85;
        this.netU.uBillow.value = 1 + smoothstep(2.5, 0, Math.abs(zl)) * 0.8;
      },
    );
    g.pip.squash = 0;
    this.netU.uBillow.value = 1;
    this.sched.tween(1, (k) => (this.ring.opacity = 1 - k)).catch(() => {});
  }

  async nearMiss() {
    const g = this.game;
    const P = this.pipLocal();
    this.netU.uPushAt.value.set(P.x, P.y);
    this.sched.tween(0.5, (k) => (this.netU.uPush.value = k * 1.6), Ease.outCubic).catch(() => {});
    await this.swim([[0, 0.2, 2.4]], 0.7, Ease.inQuad);
    g.pip.setExpression('scared', 2.5);
    g.pip.swimmer.effort = 1;
    g.drive = 'script';
    const base = g.pip.position.clone();
    await this.sched.tween(0.9, (k) => {
      g.pip.position.copy(base).add(V(Math.sin(k * 30) * 0.12, 0, 0));
      g.pip.swimmer.extraRoll = Math.sin(k * 26) * 0.4;
    });
    g.pip.swimmer.extraRoll = 0;
    g.shake(0.3);
    this.sched.tween(0.8, (k) => (this.netU.uPush.value = 1.6 * (1 - k)), Ease.inOutSine).catch(() => {});
    await this.swim([[0, 0.5, 9]], 0.45, Ease.outCubic);
    g.pip.swimmer.effort = 0;
    await this.swim([[this.hold.x, this.hold.y, this.hold.z]], 1.0, Ease.inOutSine);
    g.hoverAt(this.holdWorld);
  }

  async capture() {
    const g = this.game;
    g.rig.setShot({ target: this.L(0, 0.5, 1.5), yaw: 0.5, pitch: 0.12, radius: 7, rate: 1.2, rotRate: 0.8 });
    await this.swim([[0, 0, 0.9]], 1.0, Ease.inQuad);
    g.pip.setExpression('scared');
    g.pip.swimmer.effort = 1;
    const c = this.pipLocal();
    this.netU.uCenter.value.copy(c);
    g.drive = 'script';
    await this.sched.tween(1.6, (k) => (this.netU.uWrap.value = k), Ease.inOutCubic);
    g.audio.thud();
    const p0 = g.pip.position.clone();
    await this.sched.tween(
      3,
      (k) => {
        this.net.position.y = k * 14;
        g.pip.position.copy(p0).add(V(0, k * 14, 0));
      },
      Ease.inQuad,
    );
    g.pip.swimmer.effort = 0;
  }
}
