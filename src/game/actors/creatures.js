import * as THREE from 'three';
import { paint, paintVerts, merge, finGeometry, warp, mix } from '../gfx/geometry.js';
import { litMaterial, makeSwimUniforms, makeSwayUniforms, GlowPoints } from '../gfx/materials.js';
import { Swimmer } from './fish.js';
import { damp, lerp, clamp, fbm3, TAU } from '../core/util.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Tentacle: a tapered cylinder skinned to a chain of bones. Curling each bone a little produces
// smooth, flowing curls; a travelling sine wave makes it undulate.

export class Tentacle {
  constructor({ length = 5, r0 = 0.32, r1 = 0.05, segs = 10, color = 0xe8552e, under = 0xffcdb8, material = null } = {}) {
    const geo = new THREE.CylinderGeometry(r1, r0, length, 14, segs * 3, false);
    geo.translate(0, length / 2, 0);
    const pos = geo.attributes.position;
    const n = pos.count;
    const colors = new Float32Array(n * 3);
    const ci = new THREE.Color(color);
    const cLight = new THREE.Color(0xf6874f);
    const cDark = new THREE.Color(0xc23c1c);
    const cu = new THREE.Color(under);
    const cSucker = new THREE.Color(0xfff4ee);
    const skinIndex = [];
    const skinWeight = [];
    const segH = length / segs;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const rad = Math.hypot(x, z) || 1;
      // The underside (-X, the inside of the curl) is pale with rows of white suckers.
      const inside = -x / rad;
      const c = new THREE.Color();
      if (inside > 0.35) {
        const row = Math.abs(Math.sin(y * 13.0)) > 0.72;
        const lane = Math.abs(z / rad) < 0.55;
        c.copy(row && lane ? cSucker : cu);
      } else {
        const mott = fbm3(x * 3 + y * 0.8, y * 1.6, z * 3, 2);
        c.copy(ci).lerp(cLight, Math.max(0, mott - 0.45) * 2.2);
        if (Math.sin(y * 7.3 + z * 9) * Math.sin(x * 11 - y * 3) > 0.82) c.lerp(cDark, 0.65);
        if (inside > 0.15) c.lerp(cu, (inside - 0.15) * 2.5);
      }
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      const b = Math.max(0, Math.min(segs - 1, Math.floor(y / segH + 1e-6)));
      const w = clamp((y - b * segH) / segH, 0, 1);
      skinIndex.push(b, Math.min(b + 1, segs - 1), 0, 0);
      skinWeight.push(1 - w, w, 0, 0);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    this.bones = [];
    let prev = null;
    for (let b = 0; b < segs; b++) {
      const bone = new THREE.Bone();
      bone.position.y = b === 0 ? 0 : segH;
      if (prev) prev.add(bone);
      this.bones.push(bone);
      prev = bone;
    }
    const mat = material || new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.frustumCulled = false;
    // Generous fixed bounds (the tentacle bends a lot); avoids per-frame skinned bounds work.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, length / 2, 0), length * 1.1);
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.length = length;
    this.segs = segs;
    this.curl = 0.12;
    this.curlTarget = 0.12;
    this.wave = 0.22;
    this.waveTarget = 0.22;
    this.speed = 1.8;
    this.phase = Math.random() * TAU;
    this.aimQ = new THREE.Quaternion();
    this.aimRate = 2;
    this.twist = 0;
    this.tipCurl = 1.0; // tips always curl into a little spiral
  }

  /** Point the tentacle's base toward a world-space point. */
  aimAt(world, rate) {
    const parent = this.root.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    _v.copy(world);
    parent.worldToLocal(_v).sub(this.root.position).normalize();
    this.aimQ.setFromUnitVectors(_Y, _v);
    if (rate !== undefined) this.aimRate = rate;
  }

  aimDir(localDir, rate) {
    this.aimQ.setFromUnitVectors(_Y, _v.copy(localDir).normalize());
    if (rate !== undefined) this.aimRate = rate;
  }

  snapAim() {
    this.root.quaternion.copy(this.aimQ);
  }

  update(dt, t) {
    this.curl = lerp(this.curl, this.curlTarget, damp(4, dt));
    this.wave = lerp(this.wave, this.waveTarget, damp(3, dt));
    const n = this.bones.length;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const b = this.bones[i];
      const tip = Math.max(0, (k - 0.62) / 0.38);
      b.rotation.z = this.curl * (0.4 + k * 1.2) + this.tipCurl * tip * tip * 1.6 + this.wave * Math.sin(t * this.speed + this.phase - i * 0.55) * (0.3 + k);
      b.rotation.x = this.wave * 0.6 * Math.sin(t * this.speed * 0.73 + this.phase * 1.7 - i * 0.45) * (0.2 + k);
    }
    this.root.quaternion.slerp(this.aimQ, damp(this.aimRate, dt));
  }

  /** World position of the tentacle tip. */
  tip(out = new THREE.Vector3()) {
    const last = this.bones[this.bones.length - 1];
    last.updateWorldMatrix(true, false);
    return out.set(0, this.length / this.segs, 0).applyMatrix4(last.matrixWorld);
  }
}

// ---------------------------------------------------------------------------
// Octopus: a friendly-looking but sneaky orange-red octopus — big rounded head tilted back, a gold
// eye with a horizontal slit pupil on each side, a little siphon ring on the cheek, and eight
// skinned tentacles with pale undersides, white suckers and curled tips.

export class Octopus {
  constructor() {
    this.group = new THREE.Group();
    const base = new THREE.Color(0xe8552e);
    const light = new THREE.Color(0xf6874f);
    const dark = new THREE.Color(0xc23c1c);
    const pale = new THREE.Color(0xffcdb8);
    const mottled = (p, n) => {
      const c = base.clone().lerp(light, Math.max(0, fbm3(p.x * 1.6, p.y * 1.6, p.z * 1.6, 3) - 0.42) * 2);
      if (Math.sin(p.x * 9 + p.y * 4) * Math.sin(p.z * 8 - p.y * 5) > 0.86) c.lerp(dark, 0.6);
      if (n.y < -0.4) c.lerp(pale, (-n.y - 0.4) * 0.9);
      return c;
    };
    // Mantle (the big head bulb), tilted back and up behind the eyes.
    const mantle = new THREE.SphereGeometry(1.5, 40, 30);
    mantle.scale(1.0, 0.92, 1.32);
    mantle.rotateX(0.6);
    mantle.translate(0, 2.05, -1.25);
    const parts = [paintVerts(mantle, mottled)];
    // Head between the mantle and the arms.
    const head = new THREE.SphereGeometry(0.98, 32, 24);
    head.scale(1.05, 0.95, 1.0);
    head.translate(0, 0.95, 0.15);
    parts.push(paintVerts(head, mottled));
    // Eye sockets (bumps that hold the eyes).
    for (const side of [-1, 1]) {
      const sock = new THREE.SphereGeometry(0.36, 20, 16);
      sock.translate(side * 0.74, 1.28, 0.42);
      parts.push(paintVerts(sock, mottled));
    }
    // Siphon ring on the cheek, as in the reference.
    const siphon = new THREE.TorusGeometry(0.22, 0.07, 10, 22);
    siphon.rotateY(Math.PI / 2);
    siphon.translate(-0.98, 0.78, -0.05);
    parts.push(paint(siphon, 0xd04822));
    this.mantle = new THREE.Mesh(merge(parts), litMaterial({ emissive: 0x521606 }));
    this.group.add(this.mantle);

    // Eyes: gold with a dark horizontal slit; lids can narrow or close them.
    this.eyes = [];
    const eyeGeo = new THREE.SphereGeometry(0.27, 24, 18);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf3c54b });
    const slitGeo = new THREE.SphereGeometry(0.2, 16, 8);
    slitGeo.scale(1, 0.24, 0.35);
    const slitMat = new THREE.MeshBasicMaterial({ color: 0x24140a });
    const lidGeo = new THREE.SphereGeometry(0.3, 24, 12, 0, TAU, 0, Math.PI / 2);
    const lidMat = new THREE.MeshLambertMaterial({ color: 0xe0522c });
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.82, 1.3, 0.5);
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side * 0.75, 0.1, 0.65).normalize());
      const ball = new THREE.Mesh(eyeGeo, eyeMat);
      const slit = new THREE.Mesh(slitGeo, slitMat);
      slit.position.z = 0.2;
      const lid = new THREE.Mesh(lidGeo, lidMat);
      eye.add(ball, slit, lid);
      this.group.add(eye);
      this.eyes.push({ eye, slit, lid });
    }
    this.eyeOpen = 1;
    this.eyeNarrow = 0;
    this.halo = new GlowPoints(
      [
        { x: -0.92, y: 1.3, z: 0.62, size: 0.9, color: 0xffd36b },
        { x: 0.92, y: 1.3, z: 0.62, size: 0.9, color: 0xffd36b },
      ],
      0.5,
    );
    this.group.add(this.halo);

    const tentMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x461205 });
    this.tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const t = new Tentacle({ length: 6.6 - (i % 2) * 0.5, r0: 0.36, r1: 0.04, segs: 12, material: tentMat });
      t.root.position.set(Math.cos(a) * 0.68, 0.32, Math.sin(a) * 0.68 + 0.15);
      t.baseDir = new THREE.Vector3(Math.cos(a) * 0.9, -0.35, Math.sin(a) * 0.9 + 0.35).normalize();
      t.aimDir(t.baseDir);
      t.snapAim();
      t.phase = i * 0.9;
      this.group.add(t.root);
      this.tentacles.push(t);
    }
    this.time = 0;
  }

  setEyes(open, narrow = 0) {
    this.eyeOpen = open;
    this.eyeNarrow = narrow;
  }

  /** Turn the slit pupils toward a world point. */
  lookAt(world) {
    this._lookAt = world;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.mantle.scale.set(1 + Math.sin(t * 1.1) * 0.025, 1 + Math.sin(t * 1.1 + 1) * 0.03, 1);
    for (const tt of this.tentacles) tt.update(dt, t);
    const lid = clamp(1 - this.eyeOpen + this.eyeNarrow * 0.32, 0, 1);
    for (const e of this.eyes) {
      e.lid.rotation.x = -Math.PI / 2 + lid * Math.PI * 0.95;
      e.lid.visible = lid > 0.02;
    }
    this.halo.opacity = 0.5 * this.eyeOpen;
  }
}

// ---------------------------------------------------------------------------
// Predator: a big deep-sea hunter with a hinged jaw, teeth and glowing eyes (no lure/antenna).

export class Predator {
  constructor({ scale = 1.9 } = {}) {
    this.group = new THREE.Group();
    this.model = new THREE.Group();
    this.model.scale.setScalar(scale);
    this.group.add(this.model);
    this.swimU = makeSwimUniforms({ amp: 0.14, k: 1.8, head: 0.0, len: 2.4 });

    const parts = [];
    const body = new THREE.SphereGeometry(1, 30, 22);
    warp(body, (x, y, z) => {
      const zz = z * 1.7;
      const k = zz > 0 ? 1.05 - zz * 0.08 : 1 + zz * 0.36;
      return [x * 1.0 * k, y * 0.95 * k + (zz > 0.6 ? -0.05 : 0), zz];
    });
    const cTop = new THREE.Color(0x1f2a40);
    const cMidP = new THREE.Color(0x34466a);
    const cBel = new THREE.Color(0x6a7fa2);
    parts.push(
      paintVerts(body, (p) => {
        const spot = fbm3(p.x * 4, p.y * 4, p.z * 4, 2);
        if (spot > 0.7 && p.y > -0.2) return { color: 0x6ff0ff, glow: 0.7 };
        const t = p.y;
        return t > 0 ? cMidP.clone().lerp(cTop, Math.min(1, t * 1.4)) : cMidP.clone().lerp(cBel, Math.min(1, -t * 1.5));
      }),
    );
    // Upper teeth.
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 2.1;
      const tooth = new THREE.ConeGeometry(0.07, 0.32 + (i % 2) * 0.12, 8);
      tooth.rotateX(Math.PI);
      tooth.translate(Math.sin(a) * 0.62, -0.2, 1.2 + Math.cos(a) * 0.3 - 0.3);
      parts.push(paint(tooth, 0xf4f1e6, 0.25));
    }
    // Tail and fins.
    const tail = finGeometry(
      [
        [0, 0.3],
        [0.6, 0.9],
        [1.0, 0.95],
        [0.75, 0],
        [1.0, -0.95],
        [0.6, -0.9],
        [0, -0.3],
      ],
      0.1,
    );
    tail.translate(0, 0, -1.6);
    parts.push(paint(tail, 0x1e283c));
    for (let i = 0; i < 5; i++) {
      const spine = new THREE.ConeGeometry(0.07, 0.6 - i * 0.07, 8);
      spine.rotateX(-0.5);
      spine.translate(0, 0.85 - i * 0.08, 0.2 - i * 0.32);
      parts.push(paint(spine, 0x3b4a66));
    }
    // Mouth interior (seen when the jaw opens).
    const maw = new THREE.SphereGeometry(0.62, 16, 12);
    maw.scale(1, 0.55, 0.6);
    maw.translate(0, -0.32, 1.05);
    parts.push(paint(maw, 0x2a0a14));
    const bodyGeo = merge(parts);
    this.body = new THREE.Mesh(bodyGeo, litMaterial({ swim: this.swimU }));
    this.body.frustumCulled = false;
    this.model.add(this.body);

    // Lower jaw with teeth, hinged under the head.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, -0.35, 0.55);
    const jawParts = [];
    const jaw = new THREE.SphereGeometry(0.75, 20, 10, 0, TAU, Math.PI / 2, Math.PI / 2);
    jaw.scale(0.95, 0.5, 1.05);
    jaw.translate(0, 0, 0.45);
    jawParts.push(paint(jaw, 0x3d4c6a));
    for (let i = 0; i < 8; i++) {
      const a = (i / 7 - 0.5) * 2.0;
      const tooth = new THREE.ConeGeometry(0.06, 0.3 + (i % 2) * 0.1, 8);
      tooth.translate(Math.sin(a) * 0.62, 0.12, 0.45 + Math.cos(a) * 0.62 - 0.08);
      jawParts.push(paint(tooth, 0xf4f1e6, 0.25));
    }
    this.jaw.add(new THREE.Mesh(merge(jawParts), litMaterial({})));
    this.model.add(this.jaw);

    // Small, mean, glowing eyes.
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8ffb0 });
    const pupMat = new THREE.MeshBasicMaterial({ color: 0x0a0f08 });
    this.eyeMeshes = [];
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), eyeMat);
      e.position.set(side * 0.62, 0.42, 0.95);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), pupMat);
      p.position.set(side * 0.08, 0, 0.08);
      e.add(p);
      this.model.add(e);
      this.eyeMeshes.push(e);
    }
    this.eyeHalo = new GlowPoints(
      [
        { x: -0.66, y: 0.42, z: 1.0, size: 0.8, color: 0xb8ff9a },
        { x: 0.66, y: 0.42, z: 1.0, size: 0.8, color: 0xb8ff9a },
      ],
      0.7,
    );
    this.model.add(this.eyeHalo);

    this.swimmer = new Swimmer(this.group, this.swimU, { amp: 0.14, freq: 0.9, maxFreq: 5, turnSmoothing: 3, minSpeed: 1.2 });
    this.mouth = 0;
    this.mouthTarget = 0.1;
    this.time = 0;
  }

  get position() {
    return this.group.position;
  }

  /** Mouth position in world space (for the capture sequence). */
  mouthWorld(out = new THREE.Vector3()) {
    return out.set(0, -0.25, 1.35).applyMatrix4(this.model.matrixWorld);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.swimmer.update(dt);
    this.mouth = lerp(this.mouth, this.mouthTarget, damp(this.mouthTarget > this.mouth ? 10 : 14, dt));
    this.jaw.rotation.x = this.mouth * 0.95;
    this.eyeHalo.opacity = (this.eyeGlow ?? 0.7) * (0.85 + Math.sin(t * 2.3) * 0.15);
  }
}

// ---------------------------------------------------------------------------
// Jellyfish: instanced bells, glowing cores and trailing tentacles (3 draw calls for a group).
// They swim smoothly upward: each pulse gives a gentle surge, they glide between pulses with a
// soft sideways drift, and they fade in near the bottom of their climb and out near the top.

const _jv = new THREE.Vector3();

export class Jellies {
  constructor(list, { bottom = -3, top = 9 } = {}) {
    this.group = new THREE.Group();
    this.bottom = bottom;
    this.top = top;
    this.list = list.map((j, i) => ({
      lane: new THREE.Vector3(j.x, 0, j.z),
      y: j.y ?? lerp(bottom, top, Math.random()),
      vy: 0.3,
      speed: 0.42 + Math.random() * 0.22,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      scale: j.scale ?? 1,
      color: new THREE.Color(j.color ?? 0xff8fd8),
      phase: i * 1.37 + Math.random(),
      pulse: 0,
      vis: 1,
    }));
    const n = this.list.length;

    const bellParts = [];
    const dome = new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI * 0.52);
    warp(dome, (x, y, z) => [x, y * 0.85, z]);
    bellParts.push(paint(dome, 0xffffff, 0.45));
    const skirt = new THREE.CylinderGeometry(1.0, 1.12, 0.22, 20, 1, true);
    skirt.translate(0, -0.08, 0);
    bellParts.push(paint(skirt, 0xffffff, 0.7));
    this.bells = new THREE.InstancedMesh(merge(bellParts), litMaterial({ transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }), n);

    const core = paint(new THREE.SphereGeometry(0.42, 12, 10), 0xffffff, 1.6);
    core.translate(0, 0.25, 0);
    this.cores = new THREE.InstancedMesh(core, litMaterial({}), n);

    const tParts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const len = 3.2 + (i % 3) * 0.6;
      const c = new THREE.CylinderGeometry(0.025, 0.04, len, 4, 14);
      c.translate(Math.cos(a) * 0.85, -len / 2 - 0.1, Math.sin(a) * 0.85);
      tParts.push(paint(c, 0xffffff, 0.55));
    }
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.PlaneGeometry(0.28, 2.4, 1, 10);
      warp(arm, (x, y, z) => [x * (1 - Math.abs(y) * 0.2) + Math.sin(y * 3) * 0.12, y, Math.cos(y * 3) * 0.1]);
      arm.translate(0, -1.3, 0);
      arm.rotateY((i / 4) * Math.PI);
      tParts.push(paint(arm, 0xffffff, 0.8));
    }
    // Tentacles use an accumulated phase (uSwaySpeed 0) so the wave never jumps.
    this.sway = makeSwayUniforms({ amp: 0.4, height: -4, speed: 0 });
    this.tentacles = new THREE.InstancedMesh(merge(tParts), litMaterial({ sway: this.sway, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), n);

    for (const m of [this.bells, this.cores, this.tentacles]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.list.forEach((j, i) => m.setColorAt(i, j.color));
      this.group.add(m);
    }
    this.bells.renderOrder = 2;
    this.tentacles.renderOrder = 1;
    this.halo = new GlowPoints(
      this.list.map((j) => ({ x: 0, y: -999, z: 0, size: 3.4 * j.scale, color: j.color })),
      0.55,
    );
    this.group.add(this.halo);
    this.time = 0;
    this.swayPhase = 0;
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this._r = new THREE.Quaternion();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    // Gentle, steady tentacle wave.
    this.swayPhase += dt * 1.5;
    this.sway.uSwayPhase.value = this.swayPhase;
    this.sway.uSwaySpeed.value = 0;
    const range = this.top - this.bottom;
    this.list.forEach((j, i) => {
      // Pulse: a soft contraction (surge) followed by a long relaxation (glide).
      const cyc = (((t * 0.5 + j.phase * 0.17) % 1) + 1) % 1;
      const p = cyc < 0.3 ? Math.sin((cyc / 0.3) * Math.PI * 0.5) : Math.cos(((cyc - 0.3) / 0.7) * Math.PI * 0.5);
      j.pulse = p;
      const surge = cyc < 0.3 ? Math.sin((cyc / 0.3) * Math.PI) : 0;
      // Velocity eases toward its target, so the rise is always smooth and never stops.
      const target = j.speed * (0.55 + 1.3 * surge);
      j.vy += (target - j.vy) * damp(2.5, dt);
      j.y += j.vy * dt;
      if (j.y > this.top) j.y -= range;
      // Soft sideways drift along the lane.
      const ax = t * 0.23 + j.phase;
      const az = t * 0.19 + j.phase * 1.3;
      const pos = j.pos.set(j.lane.x + Math.sin(ax) * 0.6, j.y, j.lane.z + Math.cos(az) * 0.45);
      // Tilt into the direction of travel.
      _jv.set(Math.cos(ax) * 0.6 * 0.23, j.vy, -Math.sin(az) * 0.45 * 0.19).normalize();
      j.quat.setFromUnitVectors(_Y, _jv);
      this._r.setFromAxisAngle(_Y, j.phase).premultiply(j.quat);
      // Fade (by size) at the bottom and top of the climb.
      const vis = smoothstepJ(this.bottom, this.bottom + 1.6, j.y) * (1 - smoothstepJ(this.top - 2, this.top, j.y));
      j.vis = vis;
      const s = j.scale * Math.max(0.0001, vis);
      this._s.set(s * (1 - p * 0.14), s * (1 + p * 0.12), s * (1 - p * 0.14));
      this.bells.setMatrixAt(i, this._m.compose(pos, this._r, this._s));
      this.cores.setMatrixAt(i, this._m.compose(pos, this._r, this._s));
      // Tentacles stretch a little as the bell surges.
      this._s.set(s, s * (1 + surge * 0.12), s);
      this.tentacles.setMatrixAt(i, this._m.compose(pos, this._r, this._s));
      this.halo.setPoint(i, pos.x, pos.y + 0.2 * s, pos.z);
      this.halo.setSize(i, 3.4 * j.scale * vis);
    });
    this.bells.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    this.tentacles.instanceMatrix.needsUpdate = true;
  }
}

function smoothstepJ(a, b, x) {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

// ---------------------------------------------------------------------------
// Whale: a gentle giant for a discovery moment. Built with the swim shader rotated so the
// undulation is vertical (whales beat their flukes up and down).

export class Whale {
  constructor() {
    this.group = new THREE.Group();
    this.swimU = makeSwimUniforms({ amp: 0.35, k: 0.9, head: 1.0, len: 6.5 });
    const parts = [];
    const body = new THREE.SphereGeometry(1, 30, 18);
    warp(body, (x, y, z) => {
      const zz = z * 5.5;
      const k = zz > 0 ? 1 - (zz / 5.5) ** 2 * 0.35 : 1 + zz * 0.13;
      return [x * 1.6 * Math.max(0.15, k), y * 1.4 * Math.max(0.15, k), zz];
    });
    parts.push(paintVerts(body, (p) => mix(0x3e5c7a, 0xb4c8d8, clamp((-p.y + 0.1) * 1.2, 0, 1))));
    const fluke = new THREE.SphereGeometry(1, 10, 4);
    warp(fluke, (x, y, z) => [x * 2.6 + Math.abs(x) * 0, y * 0.12, z * 1.0 - Math.abs(x) * 0.5]);
    fluke.translate(0, 0, -6.2);
    parts.push(paint(fluke, 0x35506c));
    for (const side of [-1, 1]) {
      const fin = new THREE.SphereGeometry(1, 8, 4);
      warp(fin, (x, y, z) => [x * 1.8, y * 0.12, z * 0.6]);
      fin.rotateZ(side * -0.5);
      fin.rotateY(side * 0.6);
      fin.translate(side * 1.9, -0.6, 1.4);
      parts.push(paint(fin, 0x3a5674));
    }
    const eye = new THREE.SphereGeometry(0.12, 6, 4);
    eye.translate(1.25, 0.05, 3.6);
    parts.push(paint(eye, 0x0d1520));
    const eye2 = eye.clone();
    eye2.translate(-2.5, 0, 0);
    parts.push(paint(eye2, 0x0d1520));
    const geo = merge(parts);
    // Rotate so the shader's lateral (x) wave becomes vertical once the mesh is rolled back.
    geo.rotateZ(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, litMaterial({ swim: this.swimU }));
    this.mesh.rotation.z = Math.PI / 2;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.phase = 0;
  }

  update(dt) {
    this.phase += dt * 1.6;
    this.swimU.uPhase.value = this.phase;
  }
}
