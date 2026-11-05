import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintVerts, merge, mix } from '../gfx/geometry.js';
import { rng, fbm3, TAU } from '../core/util.js';

// Procedural reef pieces with smooth, rounded forms. Each geometry is painted in light,
// neutral gradients and tinted per instance (InstancedMesh.instanceColor) so one geometry
// serves every area's palette.

const ss = THREE.MathUtils.smoothstep;
const _Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

function weld(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const w = mergeVertices(g, 1e-4);
  w.computeVertexNormals();
  return w;
}

/** Smooth noisy blob, optionally with a flat top (reef shelf). */
export function blob(seed, { w = 22, h = 15, amount = 0.3, freq = 1.5, flatTop = null, flatBottom = -0.42 } = {}) {
  const g = weld(new THREE.SphereGeometry(1, w, h));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * freq + seed * 3.1, v.y * freq + seed * 1.7, v.z * freq - seed * 2.3, 3);
    v.multiplyScalar(1 + (n - 0.5) * 2 * amount);
    if (flatTop !== null && v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.38;
    if (flatBottom !== null && v.y < flatBottom) v.y = flatBottom;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Reef rock / shelf: light mossy top, mid sides, dark underside. */
export function rockGeo(seed, opts = {}) {
  const g = blob(seed, { amount: 0.3, freq: 1.25, flatTop: opts.flatTop ?? 0.58, ...opts });
  return paintVerts(g, (p, n) => {
    const top = ss(n.y, 0.4, 0.85);
    const low = ss(-n.y, -0.1, 0.6);
    const k = fbm3(p.x * 2.5 + seed, p.y * 2.5, p.z * 2.5, 2);
    const c = mix(0xb7c6c7, 0xe8fff0, top);
    c.lerp(new THREE.Color(0x4f5a66), low * 0.85);
    return c.multiplyScalar(0.82 + k * 0.36);
  });
}

/**
 * A smooth tube along a gently curving path whose radius tapers from r0 to r1, with a rounded tip.
 */
export function taperedTube(points, r0, r1, { radial = 7, segs = 7, tip = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    // Ease the taper so branches stay plump and round off near the end.
    const r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  const parts = [g];
  if (tip) {
    const end = curve.getPointAt(1);
    const cap = new THREE.SphereGeometry(r1 * 1.02, radial, Math.max(4, Math.round(radial * 0.6)));
    cap.translate(end.x, end.y, end.z);
    parts.push(cap);
  }
  return { parts, end: curve.getPointAt(1), dir: curve.getTangentAt(1) };
}

const _ax = new THREE.Vector3();

/**
 * Branching coral grown from curved, tapering limbs (staghorn / tree coral / sea fan when planar).
 */
export function branchCoralGeo(seed, { thick = 0.15, depth = 3, len = 0.85, spread = 0.6, planar = false, tipGlow = 0.6, heightRef = 2.4 } = {}) {
  const r = rng(seed);
  const parts = [];
  const shade = (g, glowTip = false) =>
    paintVerts(g, (p) => {
      const t = Math.min(1, Math.max(0, p.y / heightRef));
      const c = mix(0xc9bcbc, 0xffffff, 0.4 + t * 0.6);
      return glowTip && t > 0.6 ? { color: c, glow: tipGlow * (t - 0.6) * 2.5 } : c;
    });
  const grow = (p, dir, L, rad, d) => {
    // A gently bending limb.
    const bend = planar ? new THREE.Vector3((r() - 0.5) * 0.25, 0, 0) : new THREE.Vector3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
    const mid = p.clone().addScaledVector(dir, L * 0.5).add(bend.multiplyScalar(L));
    const endDir = dir.clone().lerp(_Y, 0.35).normalize();
    const end = mid.clone().addScaledVector(endDir, L * 0.5);
    const tip = d === 0;
    const limb = taperedTube([p, mid, end], rad, rad * (tip ? 0.55 : 0.72), { radial: planar ? 5 : 6, segs: planar ? 3 : 4, tip });
    for (const g of limb.parts) parts.push(shade(g, tip));
    if (tip) return;
    const n = r() < 0.2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const nd = limb.dir.clone();
      if (planar) {
        const a = (i - (n - 1) / 2) * spread * 1.15 + (r() - 0.5) * 0.25;
        nd.applyAxisAngle(_ax.set(0, 0, 1), a);
      } else {
        nd.applyAxisAngle(_ax.set(1, 0, 0), (r() - 0.5) * spread * 2);
        nd.applyAxisAngle(_ax.set(0, 0, 1), (r() - 0.5) * spread * 2);
      }
      nd.lerp(_Y, 0.2).normalize();
      grow(limb.end.clone(), nd, L * (0.72 + r() * 0.15), rad * 0.72, d - 1);
    }
  };
  grow(new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, 1, 0), len, thick, depth);
  if (!planar) {
    grow(new THREE.Vector3(0.05, -0.15, 0), new THREE.Vector3(0.55, 0.8, 0.2).normalize(), len * 0.8, thick * 0.85, depth - 1);
  }
  return merge(parts);
}

/** Cluster of soft, slightly curved tube sponges with flared lips and dark mouths. */
export function tubeCoralGeo(seed) {
  const r = rng(seed);
  const parts = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r() * 0.5;
    const d = i === 0 ? 0 : 0.3 + r() * 0.15;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 0.8 + r() * 1.0;
    const rad = 0.15 + r() * 0.05;
    const lean = new THREE.Vector3(x * 0.5, 0, z * 0.5);
    const base = new THREE.Vector3(x, -0.1, z);
    const mid = base.clone().add(new THREE.Vector3(0, h * 0.5, 0)).addScaledVector(lean, 0.3);
    const top = base.clone().add(new THREE.Vector3(0, h, 0)).add(lean);
    const tube = taperedTube([base, mid, top], rad * 0.85, rad * 1.25, { radial: 10, segs: 5, tip: false });
    parts.push(paintVerts(tube.parts[0], (p) => (p.distanceTo(top) < 0.14 ? { color: 0xffffff, glow: 0.35 } : mix(0xcbbfd6, 0xffffff, p.y / 1.8))));
    _q.setFromUnitVectors(_Y, tube.dir);
    const hole = new THREE.CircleGeometry(rad * 1.2, 10);
    hole.rotateX(-Math.PI / 2);
    hole.applyQuaternion(_q);
    hole.translate(top.x, top.y - 0.03, top.z);
    parts.push(paintVerts(hole, () => 0x3a2a40));
  }
  return merge(parts);
}

/** Rounded brain coral with meandering grooves. */
export function brainCoralGeo(seed) {
  const g = weld(new THREE.SphereGeometry(1, 26, 11, 0, TAU, 0, Math.PI * 0.55));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const groove = Math.sin(a * 9 + v.y * 9 + fbm3(v.x * 2 + seed, v.y * 2, v.z * 2, 2) * 7);
    v.multiplyScalar(1 + groove * 0.035);
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y - 0.08, v.z);
  }
  g.computeVertexNormals();
  return paintVerts(g, (p) => {
    const a = Math.atan2(p.z, p.x);
    const groove = Math.sin(a * 9 + (p.y / 0.72) * 9 + fbm3(p.x * 2 + seed, p.y * 2, p.z * 2, 2) * 7);
    return mix(0xb9a9b6, 0xffffff, 0.55 + groove * 0.3 + p.y * 0.4);
  });
}

/** A cluster of soft round sponges. */
export function spongeGeo(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = blob(seed * 7 + i, { w: 14, h: 10, amount: 0.14, freq: 2.2, flatTop: null, flatBottom: -0.3 });
    const s = i === 0 ? 0.6 : 0.3 + r() * 0.25;
    g.scale(s, s * 0.9, s);
    g.translate((r() - 0.5) * 0.9, s * 0.5 - 0.05, (r() - 0.5) * 0.9);
    parts.push(paintVerts(g, (p, n) => mix(0xb7a3b8, 0xffffff, 0.45 + n.y * 0.45)));
  }
  return merge(parts);
}

/** Sea anemone: a soft column topped with plump, curling tentacles (glowing tips). */
export function anemoneGeo(seed) {
  const r = rng(seed);
  const parts = [];
  const col = new THREE.CylinderGeometry(0.32, 0.38, 0.45, 16, 2);
  col.translate(0, 0.2, 0);
  parts.push(paintVerts(col, () => 0xd8c8c0));
  const n = 12;
  for (let i = 0; i < n; i++) {
    const ring = i < 4 ? 0.12 : 0.27;
    const a = (i / n) * TAU * 2.4 + r() * 0.3;
    const len = 0.6 + r() * 0.35;
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const base = new THREE.Vector3(out.x * ring, 0.4, out.z * ring);
    const mid = base.clone().add(new THREE.Vector3(0, len * 0.55, 0)).addScaledVector(out, 0.12 + ring * 0.4);
    const end = base.clone().add(new THREE.Vector3(0, len * 0.85, 0)).addScaledVector(out, 0.35 + ring * 0.9);
    const t = taperedTube([base, mid, end], 0.06, 0.032, { radial: 5, segs: 3 });
    for (const g of t.parts) parts.push(paintVerts(g, (p) => ({ color: mix(0xe8d4dc, 0xffffff, (p.y - 0.4) / len), glow: p.distanceTo(end) < 0.12 ? 0.9 : 0.1 })));
  }
  return merge(parts);
}

/** Wavy seaweed ribbon (double-sided material). */
export function seaweedGeo(seed, { height = 4.5, width = 0.42 } = {}) {
  const r = rng(seed);
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const h = height * (0.65 + r() * 0.45);
    const g = new THREE.PlaneGeometry(width, h, 1, 12);
    g.translate(0, h / 2, 0);
    const pos = g.attributes.position;
    const ph = r() * TAU;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = y / h;
      const x = pos.getX(i) * (1 - t * 0.55);
      const tw = y * 0.55 + ph;
      pos.setXYZ(i, x * Math.cos(tw) + Math.sin(y * 1.2 + ph) * 0.22, y, x * Math.sin(tw));
    }
    g.computeVertexNormals();
    g.rotateY(r() * TAU);
    g.translate((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
    parts.push(paintVerts(g, (p) => mix(0x9fb8a6, 0xffffff, p.y / height)));
  }
  return merge(parts);
}

/** Leafy kelp frond with rounded leaves. */
export function kelpGeo(seed, { height = 6 } = {}) {
  const r = rng(seed);
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.04, 0.08, height, 5, 6);
  stem.translate(0, height / 2, 0);
  parts.push(paintVerts(stem, (p) => mix(0x8fae92, 0xdfffe6, p.y / height)));
  const leaves = Math.round(height * 1.6);
  for (let i = 0; i < leaves; i++) {
    const y = 0.5 + (i / leaves) * (height - 0.6);
    const leaf = new THREE.SphereGeometry(0.2, 6, 4);
    leaf.scale(1, 2.4 - (i / leaves), 0.22);
    leaf.translate(0.22, 0.25, 0);
    leaf.rotateZ(-0.7 + r() * 0.3);
    leaf.rotateY(i * 2.4);
    leaf.translate(0, y, 0);
    parts.push(paintVerts(leaf, (p) => mix(0xa6c8a8, 0xffffff, p.y / height)));
  }
  return merge(parts);
}

/** Tuft of curved grass blades. */
export function grassGeo(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.7 + r() * 0.9;
    const g = new THREE.PlaneGeometry(0.09, h, 1, 3);
    g.translate(0, h / 2, 0);
    const pos = g.attributes.position;
    const lean = (r() - 0.5) * 0.8;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      pos.setXYZ(k, pos.getX(k) * (1 - y / h) + (y / h) ** 2 * lean, y, 0);
    }
    g.computeVertexNormals();
    g.rotateY(r() * TAU);
    g.translate((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
    parts.push(paintVerts(g, (p) => mix(0x9cb79a, 0xffffff, p.y / 1.6)));
  }
  return merge(parts);
}

/** Five-armed starfish lying on the sand. */
export function starfishGeo() {
  const shape = new THREE.Shape();
  const N = 5;
  for (let i = 0; i <= N * 2; i++) {
    const a = (i / (N * 2)) * TAU + Math.PI / 2;
    const rad = i % 2 === 0 ? 0.5 : 0.2;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1, curveSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.05, 0);
  g.computeVertexNormals();
  return paintVerts(g, (p) => (Math.sin(p.x * 30) * Math.sin(p.z * 30) > 0.6 ? 0xfff1dc : 0xffffff));
}

/** Tall distant rock pillar silhouette. */
export function pillarGeo(seed) {
  // A soft, tapering rock spire (no flat top).
  const g = blob(seed, { amount: 0.26, freq: 1.2, flatTop: null, flatBottom: -0.6, w: 20, h: 16 });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = 1 - Math.max(0, y) * 0.32;
    pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return paintVerts(g, (p, n) => {
    const top = ss(n.y, 0.5, 0.9);
    const k = fbm3(p.x * 2 + seed, p.y * 2, p.z * 2, 2);
    return mix(0xb0bfc2, 0xdcf5e8, top).multiplyScalar(0.85 + k * 0.3);
  });
}
