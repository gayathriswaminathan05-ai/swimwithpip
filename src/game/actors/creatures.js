import * as THREE from 'three';
import { paint, paintVerts, merge, finGeometry, warp, mix } from '../gfx/geometry.js';
import { litMaterial, makeSwimUniforms, makeSwayUniforms, GlowPoints } from '../gfx/materials.js';
import { Swimmer } from './fish.js';
import { damp, lerp, clamp, fbm3, TAU } from '../core/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Tentacle: a chunky tapered arm in three bold, flat colours (red-orange top, salmon underside,
// white sucker rings with deep-red centres). The underside is flattened so the big paired suckers
// stand proud of it. Skinned to a chain of bones. Instead of bending blindly, an arm follows a path (a list of points in its parent's space):
// over a rock edge, down a face and into a spiral curl. Each bone is aligned to the path, and the
// suckers face the inside of every bend, so curled tips show their suckers like the reference.

const ARM = { top: 0xe8401a, light: 0xf2602e, dot: 0xc4300f, under: 0xff9a7c, rim: 0xf7f5f3, cup: 0xb3200f };
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();

export class Tentacle {
  constructor({ length = 6.4, r0 = 0.36, r1 = 0.03, segs = 22, radial = 16, material = null } = {}) {
    this.length = length;
    this.segs = segs;
    const segH = length / segs;
    this.segH = segH;
    const radiusAt = (k) => r1 + (r0 - r1) * (1 - k) ** 0.8; // stays thick, then thins to the tip
    const FLAT = 0.7;

    // Tube: rings along +Y, closed at the tip. The underside is -X.
    const rings = segs * 3;
    const pos = [];
    const col = [];
    const idx = [];
    const cTop = new THREE.Color(ARM.top);
    const cLight = new THREE.Color(ARM.light);
    const cDot = new THREE.Color(ARM.dot);
    const cUnder = new THREE.Color(ARM.under);
    const c = new THREE.Color();
    for (let r = 0; r <= rings; r++) {
      const k = r / rings;
      const y = length * k;
      const rad = radiusAt(k);
      for (let j = 0; j < radial; j++) {
        const th = (j / radial) * TAU;
        const cx = Math.cos(th);
        const x = cx * rad * (cx < 0 ? FLAT : 1); // flatter underside for the suckers
        const z = Math.sin(th) * rad;
        pos.push(x, y, z);
        const inside = -cx; // 1 on the underside
        c.copy(cTop).lerp(cUnder, smooth(0.12, 0.3, inside)); // crisp edge between the two colours
        col.push(c.r, c.g, c.b);
      }
    }
    const tipIdx = pos.length / 3;
    pos.push(0, length + r1 * 0.6, 0);
    col.push(cTop.r, cTop.g, cTop.b);
    for (let r = 0; r < rings; r++) {
      for (let j = 0; j < radial; j++) {
        const a0 = r * radial + j, a1 = r * radial + ((j + 1) % radial);
        const b0 = a0 + radial, b1 = a1 + radial;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
    for (let j = 0; j < radial; j++) idx.push(rings * radial + j, tipIdx, rings * radial + ((j + 1) % radial));
    const tube = new THREE.BufferGeometry();
    tube.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tube.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    tube.setIndex(idx);
    tube.computeVertexNormals();

    // Suckers: big raised rings in pairs across the flat underside (one row near the thin tip).
    const cups = [tube];
    const cRim = new THREE.Color(ARM.rim);
    const cCup = new THREE.Color(ARM.cup);
    let y = length * 0.04;
    while (y < length * 0.95) {
      const rad = radiusAt(y / length);
      const paired = rad > 0.1;
      const rs = rad * (paired ? 0.4 : 0.55);
      for (const side of paired ? [-1, 1] : [0]) {
        const zOff = side * rad * 0.47;
        const xs = -rad * FLAT * Math.sqrt(Math.max(0, 1 - (zOff / rad) ** 2)); // on the flat face
        const nrm = new THREE.Vector3(-1, 0, side * 0.35).normalize();
        // A sucker: a raised white rim around a slightly sunken deep-red centre.
        const h = rs * 0.85;
        const cup = new THREE.LatheGeometry(
          [
            // From the outer base up over the rim and down into the centre (faces point outward).
            new THREE.Vector2(rs * 1.05, 0),
            new THREE.Vector2(rs, h * 0.85),
            new THREE.Vector2(rs * 0.8, h),
            new THREE.Vector2(rs * 0.58, h * 0.9),
            new THREE.Vector2(rs * 0.5, h * 0.62),
            new THREE.Vector2(0, h * 0.62),
          ],
          12,
        );
        cup.deleteAttribute('uv');
        const cpos = cup.attributes.position;
        const cc = [];
        for (let i = 0; i < cpos.count; i++) {
          const d = Math.hypot(cpos.getX(i), cpos.getZ(i)) / rs;
          const cl = d < 0.54 ? cCup : cRim;
          cc.push(cl.r, cl.g, cl.b);
        }
        cup.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
        cup.applyQuaternion(_q.setFromUnitVectors(_Y, nrm));
        cup.translate(xs + nrm.x * rs * 0.1, y, zOff + nrm.z * rs * 0.1);
        cups.push(cup);
      }
      y += rs * 2.25;
    }
    const geo = mergeGeometries(cups, false);
    // Skin every vertex to the bone at its height.
    const P = geo.attributes.position;
    const skinIndex = [];
    const skinWeight = [];
    const glow = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const yy = clamp(P.getY(i), 0, length);
      const b = Math.max(0, Math.min(segs - 1, Math.floor(yy / segH + 1e-6)));
      const w = clamp((yy - b * segH) / segH, 0, 1);
      skinIndex.push(b, Math.min(b + 1, segs - 1), 0, 0);
      skinWeight.push(1 - w, w, 0, 0);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));

    this.bones = [];
    let prev = null;
    for (let i = 0; i < segs; i++) {
      const bone = new THREE.Bone();
      bone.position.y = i === 0 ? 0 : segH;
      if (prev) prev.add(bone);
      this.bones.push(bone);
      prev = bone;
    }
    this.mesh = new THREE.SkinnedMesh(geo, material || litMaterial({}));
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.frustumCulled = false;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, length / 2, 0), length * 1.1);
    this.root = new THREE.Group();
    this.root.add(this.mesh);

    // Path following state.
    this.rate = 4;
    this._p = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
    this._d = Array.from({ length: segs }, () => new THREE.Vector3());
    this._Q = Array.from({ length: segs }, () => new THREE.Quaternion());
    this._local = Array.from({ length: segs }, () => new THREE.Quaternion());
    this._curve = null;
    this._under = new THREE.Vector3(0, -1, 0);
  }

  /**
   * Follow a path given in the parent's space; the first point should be the arm's root.
   * underHint: which way the suckers face at the root. rate: how quickly the arm gets there.
   */
  setPath(points, underHint, rate, face = null) {
    if (!this._curve || this._curve.points.length !== points.length) this._curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()), false, 'centripetal');
    else this._curve.points.forEach((p, i) => p.copy(points[i]));
    if (underHint) this._under.copy(underHint);
    if (rate !== undefined) this.rate = rate;
    // face: keep the suckers turned toward this direction (e.g. the camera) along the whole arm.
    this._face = face;
    this._solve();
  }

  _solve() {
    const curve = this._curve;
    const L = curve.getLength();
    const segs = this.segs;
    const last = new THREE.Vector3();
    const lastT = new THREE.Vector3();
    curve.getPointAt(1, last);
    curve.getTangentAt(1, lastT);
    for (let i = 0; i <= segs; i++) {
      const s = i * this.segH;
      if (s <= L) curve.getPointAt(s / L, this._p[i]);
      else this._p[i].copy(last).addScaledVector(lastT, s - L);
    }
    const N = _x.copy(this._under);
    for (let i = 0; i < segs; i++) {
      const d = this._d[i].subVectors(this._p[i + 1], this._p[i]).normalize();
      // Suckers face the inside of each bend (or a chosen direction); on straight stretches keep
      // the previous facing.
      if (this._face) N.lerp(this._face, 0.5);
      else if (i > 0) {
        const kv = _z.subVectors(d, this._d[i - 1]);
        if (kv.lengthSq() > 0.0016) {
          kv.addScaledVector(d, -kv.dot(d)).normalize();
          N.lerp(kv, 0.6);
        }
      }
      N.addScaledVector(d, -N.dot(d)).normalize();
      // Basis: Y along the arm, X away from the suckers (they sit on -X).
      const X = _v.copy(N).negate();
      const Z = new THREE.Vector3().crossVectors(X, d);
      _m.makeBasis(X, d, Z);
      this._Q[i].setFromRotationMatrix(_m);
    }
    for (let i = 0; i < segs; i++) {
      if (i === 0) this._local[0].identity();
      else this._local[i].copy(this._Q[i - 1]).invert().multiply(this._Q[i]);
    }
  }

  /** Jump straight to the current path. */
  snap() {
    if (!this._curve) return;
    this.root.position.copy(this._p[0]);
    this.root.quaternion.copy(this._Q[0]);
    this.bones.forEach((b, i) => b.quaternion.copy(this._local[i]));
  }

  update(dt) {
    if (!this._curve) return;
    const k = damp(this.rate, dt);
    this.root.position.lerp(this._p[0], k);
    this.root.quaternion.slerp(this._Q[0], k);
    this.bones.forEach((b, i) => b.quaternion.slerp(this._local[i], k));
  }

  /** World position of the tip. */
  tip(out = new THREE.Vector3()) {
    const lastBone = this.bones[this.bones.length - 1];
    lastBone.updateWorldMatrix(true, false);
    return out.set(0, this.segH, 0).applyMatrix4(lastBone.matrixWorld);
  }
}

function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Builds an arm path: root → via points → end, then a spiral curl that uses up the rest of the
 * arm's length. curlSide is the direction the tip curls toward (the curl's plane contains it and
 * the arm's direction at the end). All points share one space.
 */
export function armPath(points, length, { curlR = 0.6, curlSide = new THREE.Vector3(1, 0, 0), maxTurns = 1.8 } = {}) {
  const pts = points.map((p) => p.clone());
  let used = 0;
  for (let i = 1; i < pts.length; i++) used += pts[i].distanceTo(pts[i - 1]);
  let left = length - used;
  if (left < 0.2) return pts;
  const end = pts[pts.length - 1];
  const t = new THREE.Vector3().subVectors(end, pts[pts.length - 2]).normalize();
  const u = curlSide.clone().addScaledVector(t, -curlSide.dot(t)).normalize(); // toward the centre
  const centre = end.clone().addScaledVector(u, curlR);
  // Spiral: start at `end` heading along t, wind toward the centre with a shrinking radius.
  const steps = 24;
  const total = TAU * maxTurns;
  let prev = end.clone();
  for (let i = 1; i <= steps && left > 0; i++) {
    const th = (i / steps) * total;
    const r = curlR * (1 - 0.72 * (i / steps));
    const p = centre.clone().addScaledVector(u, -Math.cos(th) * r).addScaledVector(t, Math.sin(th) * r);
    left -= p.distanceTo(prev);
    pts.push(p);
    prev = p;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Octopus: bold and clean, a bright red-orange body, a big rounded mantle tilted back, gold eyes with dark horizontal slits in raised sockets, a siphon ring,
// and eight arms with pale pink undersides lined with suckers, curling into spirals.

export class Octopus {
  constructor() {
    this.group = new THREE.Group();
    const base = new THREE.Color(ARM.top);
    const light = new THREE.Color(ARM.light);
    const dot = new THREE.Color(ARM.dot);
    const pale = new THREE.Color(ARM.under);
    // Clean, bold colour (no noise): a touch lighter where the light catches the top, salmon below.
    const mottled = (p, n) => {
      const c = base.clone().lerp(light, clamp(n.y, 0, 1) * 0.35);
      if (n.y < -0.45) c.lerp(pale, (-n.y - 0.45) * 0.9);
      return c;
    };
    // Mantle: the big rounded bulb, tilted back and up behind the eyes.
    const mantle = new THREE.SphereGeometry(1.45, 44, 32);
    mantle.scale(1.0, 0.9, 1.35);
    mantle.rotateX(0.7);
    mantle.translate(0, 2.0, -1.2);
    const parts = [paintVerts(mantle, mottled)];
    // Head between the mantle and the arms.
    const head = new THREE.SphereGeometry(0.95, 36, 26);
    head.scale(1.08, 0.92, 1.0);
    head.translate(0, 0.92, 0.12);
    parts.push(paintVerts(head, mottled));
    // Raised eye sockets with a ring around each eye, like the reference.
    for (const side of [-1, 1]) {
      const sock = new THREE.SphereGeometry(0.38, 24, 18);
      sock.translate(side * 0.72, 1.3, 0.42);
      parts.push(paintVerts(sock, mottled));
    }
    // Siphon ring on the cheek.
    const siphon = new THREE.TorusGeometry(0.2, 0.065, 10, 24);
    siphon.rotateY(Math.PI / 2);
    siphon.translate(-0.99, 0.8, -0.05);
    parts.push(paint(siphon, 0xd8441f));
    this.mantle = new THREE.Mesh(merge(parts), litMaterial({ emissive: 0x7a2509 }));
    this.group.add(this.mantle);

    // Eyes: gold iris, dark horizontal slit, a darker ring around, and lids that narrow or close.
    this.eyes = [];
    const eyeGeo = new THREE.SphereGeometry(0.27, 24, 18);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf7c94a });
    const slitGeo = new THREE.SphereGeometry(0.21, 18, 8);
    slitGeo.scale(1, 0.22, 0.32);
    const slitMat = new THREE.MeshBasicMaterial({ color: 0x24140a });
    const ringGeo = new THREE.TorusGeometry(0.3, 0.045, 10, 28);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0xc8401c, emissive: 0x3a1004 });
    const lidGeo = new THREE.SphereGeometry(0.3, 24, 12, 0, TAU, 0, Math.PI / 2);
    const lidMat = new THREE.MeshLambertMaterial({ color: 0xe9542a, emissive: 0x4a1606 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.8, 1.32, 0.52);
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side * 0.75, 0.12, 0.65).normalize());
      const ball = new THREE.Mesh(eyeGeo, eyeMat);
      const slit = new THREE.Mesh(slitGeo, slitMat);
      slit.position.z = 0.2;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.z = 0.1;
      const lid = new THREE.Mesh(lidGeo, lidMat);
      eye.add(ball, slit, ring, lid);
      this.group.add(eye);
      this.eyes.push({ eye, slit, lid });
    }
    this.eyeOpen = 1;
    this.eyeNarrow = 0;
    this.halo = new GlowPoints(
      [
        { x: -0.92, y: 1.32, z: 0.64, size: 0.8, color: 0xffd36b },
        { x: 0.92, y: 1.32, z: 0.64, size: 0.8, color: 0xffd36b },
      ],
      0.45,
    );
    this.group.add(this.halo);

    // Eight arms around the base of the head. attach = root position; out = outward direction.
    const armMat = litMaterial({ emissive: 0x76230a });
    this.tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const t = new Tentacle({ length: 6.4 - (i % 2) * 0.4, r0: 0.42, r1: 0.03, segs: 22, material: armMat });
      t.attach = new THREE.Vector3(Math.cos(a) * 0.62, 0.36, Math.sin(a) * 0.62 + 0.12);
      t.out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      t.index = i;
      this.group.add(t.root);
      this.tentacles.push(t);
    }
    this.time = 0;
  }

  setEyes(open, narrow = 0) {
    this.eyeOpen = open;
    this.eyeNarrow = narrow;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.mantle.scale.set(1 + Math.sin(t * 1.1) * 0.025, 1 + Math.sin(t * 1.1 + 1) * 0.03, 1);
    for (const tt of this.tentacles) tt.update(dt);
    const lid = clamp(1 - this.eyeOpen + this.eyeNarrow * 0.32, 0, 1);
    for (const e of this.eyes) {
      e.lid.rotation.x = -Math.PI / 2 + lid * Math.PI * 0.95;
      e.lid.visible = lid > 0.02;
    }
    this.halo.opacity = 0.45 * this.eyeOpen;
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
