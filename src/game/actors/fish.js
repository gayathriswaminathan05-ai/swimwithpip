import * as THREE from 'three';
import { paint, paintVerts, merge, finGeometry, warp, mix } from '../gfx/geometry.js';
import { litMaterial, makeSwimUniforms, GlowPoints } from '../gfx/materials.js';
import { clamp, damp, lerp, TAU } from '../core/util.js';

// Pip: a small lanternfish with big eyes, a glowing head sprout and a row of photophores.
// Model space: head points to +Z, up is +Y. Body length ≈ 3.4 units before scaling.

export const PIP_COLORS = {
  body: 0xff8a52,
  back: 0xe8522c,
  belly: 0xfff0d8,
  fin: 0xffb58c,
  finEdge: 0xffe1c8,
  glow: 0x7ff5ff,
  bulb: 0xffe98a,
  cheek: 0xff8fa6,
};

const BODY_RX = 0.62;
const BODY_RY = 0.74;
const BODY_RZ = 1.1;

function bodyTaper(z) {
  return z < 0 ? Math.max(0.2, 1 + z * 0.43) : 1 - z * 0.06;
}

/** Model-space z of a body vertex: the rear half is stretched into a slim tail stalk. */
function bodyZ(z) {
  return z >= 0 ? z * BODY_RZ : z * BODY_RZ * 1.55;
}

/** Approximate body surface half-width at (y, z). */
function bodyHalfWidth(y, z) {
  const k = bodyTaper(z);
  const zn = z >= 0 ? z / BODY_RZ : z / (BODY_RZ * 1.55);
  const t = 1 - (y / (BODY_RY * k)) ** 2 - zn ** 2;
  return BODY_RX * k * Math.sqrt(Math.max(0, t));
}

/**
 * Builds the merged fish body (body, tail, fins, photophores, sprout).
 * simple = true adds tiny merged eyes for instanced school fish.
 */
export function buildFishGeometry(opts = {}) {
  const c = { ...PIP_COLORS, ...opts.colors };
  const parts = [];

  // Body: egg-shaped low-poly ellipsoid with a darker back and a pale belly.
  const body = new THREE.SphereGeometry(1, opts.simple ? 14 : 30, opts.simple ? 10 : 22);
  warp(body, (x, y, z) => {
    const zz = bodyZ(z);
    const k = bodyTaper(zz);
    return [x * BODY_RX * k, y * BODY_RY * k, zz];
  });
  const cBack = new THREE.Color(c.back);
  const cBody = new THREE.Color(c.body);
  const cBelly = new THREE.Color(c.belly);
  parts.push(
    paintVerts(body, (p) => {
      const t = p.y / BODY_RY;
      if (t > 0) return cBody.clone().lerp(cBack, Math.min(1, t * 1.25));
      return cBody.clone().lerp(cBelly, Math.min(1, -t * 1.6));
    }),
  );

  // Forked tail fin (the body itself tapers into the tail stalk).

  const tail = finGeometry(
    [
      [0, 0.24],
      [0.35, 0.5, 0.95, 0.95],
      [0.72, 0.34],
      [0.56, 0],
      [0.72, -0.34],
      [0.95, -0.95],
      [0.35, -0.5, 0, -0.24],
    ],
    0.08,
    !opts.simple,
  );
  tail.translate(0, 0.0, -1.5);
  parts.push(paintVerts(tail, (p) => mix(c.fin, c.finEdge, Math.min(1, (-p.z - 1.5) / 0.95))));

  // Dorsal fin.
  const dorsal = finGeometry(
    [
      [0, 0],
      [0.15, 0.4, 0.55, 0.52],
      [0.95, 0.12],
      [1.0, 0],
    ],
    0.06,
    !opts.simple,
  );
  dorsal.translate(0, 0.6, 0.38);
  parts.push(paintVerts(dorsal, (p) => mix(c.fin, c.finEdge, (p.y - 0.6) / 0.5)));

  // Small anal fin.
  const anal = finGeometry(
    [
      [0, 0],
      [0.55, 0],
      [0.45, -0.32],
    ],
    0.05,
    !opts.simple,
  );
  anal.translate(0, -0.4, -0.45);
  parts.push(paint(anal, c.fin));

  // Photophores: a glowing row along each lower flank plus two near the tail.
  const photoSpots = [];
  const dots = opts.simple ? 4 : 6;
  for (const side of [-1, 1]) {
    for (let i = 0; i < dots; i++) {
      // A gentle row of photophores along the lower flank, starting behind the cheek.
      const z = 0.3 - i * (1.3 / dots);
      const y = -0.36 + i * 0.02;
      const x = side * (bodyHalfWidth(y, z) + 0.005);
      const dot = opts.simple ? new THREE.IcosahedronGeometry(0.06, 0) : new THREE.SphereGeometry(0.055, 8, 6);
      dot.translate(x, y, z);
      parts.push(paint(dot, c.glow, 0.9));
      photoSpots.push(new THREE.Vector3(x * 1.05, y, z));
    }
  }

  // Head sprout with a glowing bulb (Pip only — the school has none).
  const bulbPos = new THREE.Vector3(0, 1.05, 1.3);
  if (opts.sprout !== false) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.62, 0.5),
    new THREE.Vector3(0, 0.98, 0.7),
    new THREE.Vector3(0, 1.16, 1.0),
    new THREE.Vector3(0, 1.08, 1.26),
  ]);
  parts.push(paint(new THREE.TubeGeometry(curve, opts.simple ? 5 : 12, 0.04, opts.simple ? 4 : 6), c.back));
  const bulb = opts.simple ? new THREE.IcosahedronGeometry(0.15, 1) : new THREE.SphereGeometry(0.14, 12, 10);
  bulb.translate(bulbPos.x, bulbPos.y, bulbPos.z);
  parts.push(paint(bulb, c.bulb, 1.6));
  }

  if (opts.cheeks !== false) {
    for (const side of [-1, 1]) {
      const cheek = new THREE.SphereGeometry(0.13, 12, 8);
      cheek.scale(0.5, 0.75, 1);
      const y = -0.12;
      const z = 0.72;
      cheek.translate(side * (bodyHalfWidth(y, z) - 0.02), y, z);
      parts.push(paint(cheek, c.cheek, 0.15));
    }
  }

  if (opts.simple) {
    // Merged eyes for the instanced school.
    for (const side of [-1, 1]) {
      const white = new THREE.SphereGeometry(0.27, 10, 8);
      white.translate(side * 0.42, 0.2, 0.6);
      parts.push(paint(white, 0xffffff, 0.25));
      const pupil = new THREE.SphereGeometry(0.17, 8, 6);
      pupil.scale(0.45, 1, 1);
      pupil.translate(side * 0.62, 0.21, 0.66);
      parts.push(paint(pupil, 0x1a1030));
    }
  }

  const geo = merge(parts);
  geo.userData.photoSpots = photoSpots;
  geo.userData.bulbPos = bulbPos;
  return geo;
}

// ---------------------------------------------------------------------------
// Swimmer: turns position changes into believable fish motion — heading follows velocity,
// the body banks into turns, tail beat speeds up with speed and acceleration.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

export class Swimmer {
  constructor(object, swimUniforms, opts = {}) {
    this.object = object;
    this.u = swimUniforms;
    this.pos = object.position;
    this.prev = new THREE.Vector3().copy(object.position);
    this.vel = new THREE.Vector3();
    this.speed = 0;
    this.prevSpeed = 0;
    this.heading = new THREE.Vector3(0, 0, -1);
    this.faceDir = null; // override when hovering
    this.turnRate = 0;
    this.roll = 0;
    this.extraRoll = 0; // scripted spins / tumbles
    this.extraPitch = 0;
    this.effort = 0; // extra tail beat (struggling against current)
    this.phase = Math.random() * TAU;
    this.baseAmp = opts.amp ?? 0.22;
    this.baseFreq = opts.freq ?? 1.6;
    this.maxFreq = opts.maxFreq ?? 9;
    this.speedScale = opts.speedScale ?? 1;
    this.turnSmoothing = opts.turnSmoothing ?? 6;
    this.minSpeedForHeading = opts.minSpeed ?? 0.6;
    this.beat = 0;
  }

  teleport(p, dir) {
    this.pos.copy(p);
    this.prev.copy(p);
    this.vel.set(0, 0, 0);
    if (dir) {
      this.heading.copy(dir).normalize();
      this._orient(1);
    }
  }

  update(dt) {
    if (dt <= 0) return;
    // Velocity from the actual movement this frame (smoothed).
    _fwd.subVectors(this.pos, this.prev).divideScalar(dt);
    this.prev.copy(this.pos);
    this.vel.lerp(_fwd, damp(10, dt));
    this.prevSpeed = this.speed;
    this.speed = this.vel.length();
    const accel = (this.speed - this.prevSpeed) / dt;

    // Desired heading.
    let desired;
    if (this.speed > this.minSpeedForHeading) desired = _fwd.copy(this.vel).normalize();
    else if (this.faceDir) desired = _fwd.copy(this.faceDir).normalize();
    else desired = _fwd.copy(this.heading);
    const oldYaw = Math.atan2(this.heading.x, this.heading.z);
    this.heading.lerp(desired, damp(this.turnSmoothing, dt)).normalize();
    const newYaw = Math.atan2(this.heading.x, this.heading.z);
    let dy = newYaw - oldYaw;
    if (dy > Math.PI) dy -= TAU;
    if (dy < -Math.PI) dy += TAU;
    this.turnRate = lerp(this.turnRate, dy / dt, damp(6, dt));
    // Bank into turns.
    this.roll = lerp(this.roll, clamp(-this.turnRate * 0.35, -0.9, 0.9), damp(5, dt));
    this._orient(dt);

    // Tail beat.
    const s = this.speed * this.speedScale;
    const freq = clamp(this.baseFreq + s * 0.9 + Math.max(0, accel) * 0.25 + this.effort * 5, 0, this.maxFreq);
    this.phase += freq * dt * TAU * 0.5;
    this.beat = freq;
    if (this.u) {
      this.u.uPhase.value = this.phase;
      this.u.uAmp.value = lerp(this.u.uAmp.value, this.baseAmp * (0.75 + Math.min(1.1, s * 0.08) + this.effort * 0.5), damp(4, dt));
      // The body curves into the turn.
      this.u.uBend.value = lerp(this.u.uBend.value, clamp(this.turnRate * 0.18, -0.6, 0.6), damp(6, dt));
    }
  }

  _orient() {
    // m.lookAt(eye, target, up) makes the z-axis point eye - target, so eye = heading gives +Z forward.
    _m.lookAt(this.heading, _zero, _up);
    _q.setFromRotationMatrix(_m);
    _qRoll.setFromAxisAngle(_zAxis, this.roll + this.extraRoll);
    _q.multiply(_qRoll);
    if (this.extraPitch) {
      _qRoll.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.extraPitch);
      _q.multiply(_qRoll);
    }
    this.object.quaternion.copy(_q);
  }
}

// ---------------------------------------------------------------------------
// Pip: the hero fish with expressive eyes, mouth, fins and glow.

// Eye proportions: the white's radius, and the pupil's radius and (flattened) depth.
const EYE_R = 0.3;
const PUPIL_R = 0.2;
const PUPIL_D = 0.084;

const EXPRESSIONS = {
  neutral: { lid: 0, white: 1, pupil: 1, mouth: 'smile', look: [0, 0] },
  happy: { lid: 0.4, white: 1, pupil: 1.1, mouth: 'grin', look: [0, 0.25] },
  scared: { lid: 0, white: 1.16, pupil: 0.62, mouth: 'o', look: [0, 0] },
  sad: { lid: 0.42, white: 1, pupil: 1, mouth: 'frown', look: [0, -0.35] },
  determined: { lid: 0.32, white: 1, pupil: 0.95, mouth: 'flat', look: [0, 0] },
  dizzy: { lid: 0.2, white: 1.05, pupil: 0.8, mouth: 'o', look: [0, 0] },
  hopeful: { lid: 0.05, white: 1.08, pupil: 1.15, mouth: 'smile', look: [0, 0.3] },
  worried: { lid: 0.06, white: 1.14, pupil: 0.78, mouth: 'frown', look: [0, 0] },
};

export class Pip {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Pip';
    this.model = new THREE.Group();
    this.model.scale.setScalar(0.55);
    this.group.add(this.model);

    this.swimU = makeSwimUniforms({ amp: 0.22, k: 2.6, head: 0.3, len: 2.5 });
    this.glowU = { value: 1 };
    const geo = buildFishGeometry({ sprout: false });
    this.body = new THREE.Mesh(geo, litMaterial({ swim: this.swimU, glowUniform: this.glowU }));
    this.body.frustumCulled = false;
    this.model.add(this.body);

    // Pectoral fins (separate so they can flutter).
    const pecGeo = paint(
      finGeometry(
        [
          [0, 0.06],
          [0.25, 0.25, 0.6, 0.12],
          [0.5, -0.12],
          [0.15, -0.14],
        ],
        0.04,
      ),
      PIP_COLORS.fin,
    );
    const finMat = litMaterial({ transparent: true, opacity: 0.92 });
    this.pecs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.56, -0.16, 0.2);
      const fin = new THREE.Mesh(pecGeo, finMat);
      fin.rotation.y = side * 0.5;
      pivot.add(fin);
      pivot.userData.side = side;
      this.model.add(pivot);
      this.pecs.push(pivot);
    }

    // Eyes.
    this.eyes = [];
    const whiteGeo = new THREE.SphereGeometry(EYE_R, 20, 16);
    const pupilGeo = new THREE.SphereGeometry(PUPIL_R, 18, 12);
    pupilGeo.scale(1, 1, PUPIL_D / PUPIL_R);
    const hiGeo = new THREE.CircleGeometry(0.055, 10);
    const lidGeo = new THREE.SphereGeometry(0.335, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a4a55 });
    const pupilMat = new THREE.MeshLambertMaterial({ color: 0x1a1030, emissive: 0x05030a });
    const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lidMat = new THREE.MeshLambertMaterial({ color: PIP_COLORS.back });
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.42, 0.2, 0.58);
      // Face outward (mostly sideways, a little forward) so the eyes read from the side and front.
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side * 0.8, 0.12, 0.58).normalize());
      const white = new THREE.Mesh(whiteGeo, whiteMat);
      eye.add(white);
      const gaze = new THREE.Group();
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.235;
      const hi = new THREE.Mesh(hiGeo, hiMat);
      hi.position.set(0.07 * -side, 0.075, 0.318);
      gaze.add(pupil, hi);
      eye.add(gaze);
      const lid = new THREE.Mesh(lidGeo, lidMat);
      eye.add(lid);
      this.model.add(eye);
      this.eyes.push({ eye, white, gaze, pupil, hi, lid, side });
    }

    // Mouth: a small arc (smile / frown / flat) or an "O".
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x5a1d1a });
    this.mouthArc = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.028, 6, 14, Math.PI), mouthMat);
    this.mouthArc.position.set(0, -0.2, 1.05);
    this.mouthArc.rotation.x = -0.25;
    this.mouthO = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mouthMat);
    this.mouthO.scale.set(1, 1.25, 0.5);
    this.mouthO.position.set(0, -0.2, 1.05);
    this.model.add(this.mouthArc, this.mouthO);

    // Glow halos: bulb + photophores.
    const spots = geo.userData.photoSpots;
    const items = [];
    for (const s of spots) items.push({ x: s.x, y: s.y, z: s.z, size: 0.26, color: 0x6fefff });
    this.halo = new GlowPoints(items, 0.9);
    this.model.add(this.halo);
    this.haloBase = 0.9;

    this.light = null; // assigned by the game (a point light that follows Pip)

    this.swimmer = new Swimmer(this.group, this.swimU, { amp: 0.22, freq: 1.6 });
    this.expr = { ...EXPRESSIONS.neutral };
    this.exprTarget = EXPRESSIONS.neutral;
    this.exprName = 'neutral';
    this.exprTimer = 0;
    this.blinkT = 2;
    this.blink = 0;
    this.time = 0;
    this.squash = 0;
    this.shiver = 0;
    this.flash = 0;
    this.glowBoost = 1;
    this.lookOverride = null;
    this.setExpression('neutral');
  }

  get position() {
    return this.group.position;
  }

  /** Change facial expression; optionally revert to neutral after `hold` seconds. */
  setExpression(name, hold = 0) {
    this.exprTarget = EXPRESSIONS[name] || EXPRESSIONS.neutral;
    this.exprName = name;
    this.exprTimer = hold;
    this.mouthArc.visible = this.exprTarget.mouth !== 'o';
    this.mouthO.visible = this.exprTarget.mouth === 'o';
    const m = this.exprTarget.mouth;
    // Torus arc spans the upper half by default (∩). Rotate for ∪ (smile).
    this.mouthArc.rotation.z = m === 'frown' ? 0 : Math.PI;
    this.mouthArc.scale.set(m === 'grin' ? 1.25 : m === 'flat' ? 1.1 : 1, m === 'flat' ? 0.25 : m === 'grin' ? 1.2 : 0.8, 1);
  }

  /** A bright pulse of all photophores (signal to the school). */
  pulse(amount = 3) {
    this.flash = amount;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.swimmer.update(dt);

    if (this.exprTimer > 0) {
      this.exprTimer -= dt;
      if (this.exprTimer <= 0) this.setExpression('neutral');
    }
    const e = this.expr;
    const tg = this.exprTarget;
    const k = damp(9, dt);
    e.lid = lerp(e.lid, tg.lid, k);
    e.white = lerp(e.white, tg.white, k);
    e.pupil = lerp(e.pupil, tg.pupil, k);

    // Blinking.
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = 2.5 + Math.random() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const blinkK = Math.sin(this.blink * Math.PI);

    const look = this.lookOverride || tg.look;
    for (const eye of this.eyes) {
      const lid = clamp(e.lid + (1 - e.lid) * blinkK, 0, 1);
      eye.lid.visible = lid > 0.03;
      eye.lid.rotation.x = -Math.PI / 2 + lid * Math.PI;
      eye.white.scale.setScalar(e.white);
      eye.lid.scale.setScalar(e.white);
      let lx = look[0];
      let ly = look[1];
      if (this.exprName === 'dizzy') {
        lx = Math.cos(t * 9) * 0.45;
        ly = Math.sin(t * 9) * 0.45;
      }
      eye.gaze.rotation.y = lerp(eye.gaze.rotation.y, lx * 0.6, k);
      eye.gaze.rotation.x = lerp(eye.gaze.rotation.x, -ly * 0.6, k);
      // Keep the pupil sitting on the surface of the white at any size. (A fixed depth buried it
      // inside the white when an expression widened the eyes, leaving blank white eyeballs.)
      const p = e.pupil;
      const r = EYE_R * e.white;
      const rim = PUPIL_R * p;
      const pz = Math.sqrt(Math.max(0, r * r - rim * rim));
      eye.pupil.scale.setScalar(p);
      eye.pupil.position.z = pz;
      eye.hi.position.set(0.07 * -eye.side * p, 0.075 * p, pz + PUPIL_D * p * 0.9 + 0.004);
      eye.hi.scale.setScalar(0.75 + 0.25 * p);
    }

    // Pectoral flutter: faster when swimming hard.
    const flutter = 5 + this.swimmer.beat * 0.6;
    for (const p of this.pecs) {
      const s = p.userData.side;
      p.rotation.z = s * (0.25 + Math.sin(t * flutter + (s > 0 ? 0 : 1.3)) * 0.35);
      p.rotation.y = s * (0.15 + Math.sin(t * flutter * 0.5) * 0.15);
    }

    // Idle breathing, squash for squeezing through gaps, shivers when scared.
    const breathe = 1 + Math.sin(t * 2.2) * 0.015;
    const sq = this.squash;
    this.model.scale.set(0.55 * breathe * (1 - sq * 0.3), 0.55 * breathe * (1 - sq * 0.12), 0.55 * (1 + sq * 0.2));
    this.shiver = Math.max(0, this.shiver - dt * 1.5);
    this.model.position.x = this.shiver > 0 ? Math.sin(t * 60) * 0.03 * this.shiver : 0;

    // Glow: gentle shimmer plus signal flashes.
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const glow = (0.9 + Math.sin(t * 2.7) * 0.1) * this.glowBoost * (0.45 + 0.55 * this.haloBase) + this.flash;
    this.glowU.value = glow;
    this.halo.opacity = this.haloBase * glow;
    if (this.light) this.light.intensity = this.lightBase * (0.6 + 0.4 * glow);
  }
}
