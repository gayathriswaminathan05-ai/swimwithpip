import * as THREE from 'three';
import { paintVerts, merge, mix } from '../gfx/geometry.js';
import { shared } from '../gfx/materials.js';
import { rng, fbm3, TAU } from '../core/util.js';
import { taperedTube, blob, branchCoralGeo } from './reef.js';

// Our own coral set, built entirely in code for this game: tube clusters, soft sprigs, staghorn,
// egg sponges and barrel sponges, each in several colour variants. Colours live in per-vertex
// colour data (base to tip / rim), so the reef can place them as instanced decoration exactly
// like any other model. Shapes are smooth and rounded to match the painterly reef.

export const CORAL_SETS = [
  { key: 'tube', height: 1.75 },
  { key: 'sprig', height: 1.35 },
  { key: 'stag', height: 2.4 },
  { key: 'egg', height: 1.2 },
  { key: 'barrel', height: 1.45 },
];

// [deep base, bright tip / rim] per colour variant.
const PALETTES = {
  tube: [
    [0x2a5fd0, 0x8fd8ff],
    [0xc9b416, 0xfff27a],
    [0xc63a26, 0xffa070],
    [0x86b02a, 0xd8a4ff],
    [0x22a0b0, 0xbafff0],
    [0xa8428e, 0xffb6e4],
  ],
  sprig: [
    [0xb84a72, 0xffc4dc],
    [0xc8581c, 0xffc878],
    [0x1d8a9c, 0xa4f8ff],
    [0xb81a98, 0xff92ea],
    [0x529230, 0xdcff90],
  ],
  stag: [
    [0xc4261c, 0xff9070],
    [0x2a9238, 0xb0f290],
    [0x2a78c8, 0xa4e8ff],
    [0xd0661a, 0xffd480],
    [0x8236c8, 0xe4acff],
    [0xaea428, 0xfff2a4],
  ],
  egg: [
    [0x9c2a1e, 0xffa464],
    [0x2a9238, 0xdcf25e],
    [0x2a54d0, 0x94e4ff],
    [0xd88a1c, 0xffe490],
  ],
  barrel: [
    [0x6070d0, 0xdcf25e],
    [0xc8a828, 0xffec88],
    [0xd0645a, 0xffd4a4],
    [0x6228d0, 0xff4c8e],
    [0x269486, 0xffe27e],
  ],
};

const _Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const sstep = THREE.MathUtils.smoothstep;

/** A cluster of soft tubes of different heights, each with a rounded lip and a dark mouth. */
function tubeCluster(seed, [base, lip]) {
  const r = rng(seed);
  const parts = [];
  const n = 5;
  const dark = new THREE.Color(base).multiplyScalar(0.3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r() * 0.5;
    const d = i === 0 ? 0 : 0.22 + r() * 0.1;
    const h = i === 0 ? 1.55 : 0.85 + r() * 0.55;
    const rad = 0.14 + r() * 0.04;
    const b = new THREE.Vector3(Math.cos(a) * d * 0.5, -0.05, Math.sin(a) * d * 0.5);
    const top = new THREE.Vector3(Math.cos(a) * (d + 0.12 + r() * 0.1), h, Math.sin(a) * (d + 0.12 + r() * 0.1));
    const mid = b.clone().lerp(top, 0.5).add(new THREE.Vector3((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08));
    const tube = taperedTube([b, mid, top], rad, rad * 1.22, { radial: 12, segs: 7, tip: false });
    parts.push(
      paintVerts(tube.parts[0], (p) => {
        const t = Math.max(0, p.y) / h;
        const c = mix(base, lip, sstep(t, 0.45, 0.97));
        return t > 0.9 ? { color: c, glow: 0.3 } : c;
      }),
    );
    // Rounded lip ring and a dark mouth, both turned to the tube's end direction.
    _q.setFromUnitVectors(_Y, tube.dir);
    const ring = new THREE.TorusGeometry(rad * 1.18, rad * 0.26, 8, 16);
    ring.rotateX(Math.PI / 2);
    ring.applyQuaternion(_q);
    ring.translate(top.x, top.y, top.z);
    parts.push(paintVerts(ring, () => ({ color: new THREE.Color(lip), glow: 0.35 })));
    const mouth = new THREE.CircleGeometry(rad * 1.12, 14);
    mouth.rotateX(-Math.PI / 2);
    mouth.applyQuaternion(_q);
    mouth.translate(top.x, top.y - 0.04, top.z);
    parts.push(paintVerts(mouth, () => dark));
  }
  return merge(parts);
}

/** A soft coral sprig: a curving stem with puffy polyp buds on short side stalks. */
function sprig(seed, [stem, bud]) {
  const r = rng(seed);
  const parts = [];
  const lean = (r() - 0.5) * 0.2;
  const pts = [
    new THREE.Vector3(0, -0.05, 0),
    new THREE.Vector3(0.07 + lean, 0.45, 0.02),
    new THREE.Vector3(-0.05 + lean * 1.5, 0.9, -0.02),
    new THREE.Vector3(0.05 + lean * 2, 1.3, 0.03),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const main = taperedTube(pts, 0.075, 0.04, { radial: 9, segs: 12, tip: false });
  parts.push(paintVerts(main.parts[0], (p) => mix(stem, bud, sstep(p.y / 1.3, 0.1, 1.1))));
  // Puffy crown at the top of the stem.
  const crown = blob(seed * 3 + 1, { w: 12, h: 9, amount: 0.12, freq: 3, flatTop: null, flatBottom: null });
  crown.scale(0.11, 0.13, 0.11);
  crown.translate(main.end.x, main.end.y + 0.06, main.end.z);
  parts.push(paintVerts(crown, () => ({ color: new THREE.Color(bud), glow: 0.3 })));
  const buds = 5;
  for (let i = 0; i < buds; i++) {
    const t = 0.25 + (i / buds) * 0.6 + r() * 0.04;
    const at = curve.getPointAt(t);
    const a = i * 2.4 + r() * 0.6;
    const dir = new THREE.Vector3(Math.cos(a), 0.9 + r() * 0.4, Math.sin(a)).normalize();
    const L = 0.18 + r() * 0.1;
    const end = at.clone().addScaledVector(dir, L);
    const midP = at.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, L * 0.12, 0));
    const stalk = taperedTube([at, midP, end], 0.035, 0.025, { radial: 6, segs: 4, tip: false });
    parts.push(paintVerts(stalk.parts[0], () => mix(stem, bud, 0.35 + t * 0.5)));
    const puff = blob(seed * 11 + i, { w: 10, h: 8, amount: 0.12, freq: 3, flatTop: null, flatBottom: null });
    const s = 0.065 + r() * 0.03;
    puff.scale(s, s * 1.15, s);
    puff.translate(end.x, end.y + s * 0.4, end.z);
    parts.push(paintVerts(puff, () => ({ color: new THREE.Color(bud), glow: 0.25 })));
  }
  return merge(parts);
}

/** Staghorn: curving, tapering limbs that fork upward, darker at the base and bright at the tips. */
function staghorn(seed, [base, tip]) {
  const g = branchCoralGeo(seed, { thick: 0.17, depth: 3, len: 0.78, spread: 0.7, tipGlow: 0, heightRef: 2.4 });
  g.computeBoundingBox();
  const h = g.boundingBox.max.y;
  return paintVerts(g, (p) => {
    const t = Math.max(0, p.y) / h;
    const c = mix(base, tip, sstep(t, 0.15, 1.0));
    return t > 0.82 ? { color: c, glow: 0.35 * (t - 0.82) * 5 } : c;
  });
}

/** Egg sponges: one plump, gently lumpy egg (with a smaller one beside it on some) and a crown of short rounded nubs. */
function eggSponge(seed, [body, nub], withBuddy) {
  const r = rng(seed);
  const parts = [];
  const egg = (s, x, z, crown) => {
    const g = blob(seed * 5 + s * 10, { w: 22, h: 18, amount: 0.06, freq: 2.6, flatTop: null, flatBottom: -0.9 });
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = 1 - 0.16 * Math.max(0, v.y); // narrower towards the top: an egg, not a ball
      pos.setXYZ(i, v.x * 0.42 * k * s, (v.y + 0.9) * 0.6 * s, v.z * 0.42 * k * s);
    }
    g.computeVertexNormals();
    g.translate(x, 0, z);
    const top = 1.9 * 0.6 * s;
    parts.push(
      paintVerts(g, (p) => {
        const t = p.y / top;
        const spot = fbm3(p.x * 9 + seed, p.y * 9, p.z * 9, 2);
        return mix(body, nub, sstep(t, 0.2, 1.15) * 0.55).multiplyScalar(0.86 + spot * 0.24);
      }),
    );
    if (!crown) return;
    const nubs = 5;
    for (let i = 0; i < nubs; i++) {
      const a = (i / nubs) * TAU + r() * 0.4;
      const rr = 0.09 * s;
      const at = new THREE.Vector3(x + Math.cos(a) * rr, top - 0.03 * s, z + Math.sin(a) * rr);
      const dir = new THREE.Vector3(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45).normalize();
      const L = (0.1 + r() * 0.06) * s;
      const end = at.clone().addScaledVector(dir, L);
      const n = taperedTube([at, at.clone().lerp(end, 0.5), end], 0.045 * s, 0.035 * s, { radial: 7, segs: 3, tip: true });
      for (const part of n.parts) parts.push(paintVerts(part, () => ({ color: new THREE.Color(nub), glow: 0.3 })));
    }
  };
  egg(1, 0, 0, true);
  if (withBuddy) egg(0.55 + r() * 0.1, 0.36, 0.12, r() < 0.5);
  return merge(parts);
}

/** Barrel sponges: a big ridged vase and two small ones, open at the top with a bright rim and a dark inside. */
function barrelCluster(seed, [body, rim]) {
  const r = rng(seed);
  const parts = [];
  const dark = new THREE.Color(body).multiplyScalar(0.28);
  const vase = (h, R, x, z) => {
    // Profile: closed base, bulging belly, narrower neck, rolled lip, then down the inside wall.
    const prof = [
      [0, 0],
      [R * 0.62, 0],
      [R * 0.9, h * 0.15],
      [R, h * 0.42],
      [R * 0.9, h * 0.72],
      [R * 0.8, h * 0.9],
      [R * 0.86, h * 0.98],
      [R * 0.8, h * 1.02],
      [R * 0.68, h * 0.97],
      [R * 0.64, h * 0.85],
      [R * 0.6, h * 0.45],
      [0, h * 0.42],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    const g = new THREE.LatheGeometry(prof, 22);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    const ridges = 7 + Math.floor(r() * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const rad = Math.hypot(v.x, v.z);
      const outer = rad > R * 0.7 && v.y < h * 0.95;
      if (outer && rad > 1e-4) {
        const ang = Math.atan2(v.z, v.x);
        const k = 1 + 0.045 * Math.sin(ang * ridges) * sstep(v.y, 0, h * 0.25);
        v.x *= k;
        v.z *= k;
      }
      pos.setXYZ(i, v.x + x, v.y, v.z + z);
    }
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    parts.push(
      paintVerts(g, (p) => {
        const rad = Math.hypot(p.x - x, p.z - z);
        const inside = rad < R * 0.7 && p.y > h * 0.4 && p.y < h * 0.96;
        if (inside) return dark;
        if (p.y > h * 0.93) return { color: new THREE.Color(rim), glow: 0.3 };
        return mix(body, rim, sstep(p.y / h, 0.25, 1.4) * 0.5).multiplyScalar(0.85 + 0.25 * (p.y / h));
      }),
    );
  };
  vase(1.0, 0.42, 0, 0);
  const a = r() * TAU;
  vase(0.62 + r() * 0.1, 0.27, Math.cos(a) * 0.52, Math.sin(a) * 0.52);
  vase(0.5 + r() * 0.1, 0.23, Math.cos(a + 2.1) * 0.5, Math.sin(a + 2.1) * 0.5);
  return merge(parts);
}

/** Stand a model on its base, centre it, and scale it to `height`. */
function normalise(g, height) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const h = Math.max(1e-4, bb.max.y - bb.min.y);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  const s = height / h;
  g.scale(s, s, s);
  g.computeBoundingSphere();
  return shared(g);
}

/** Builds every coral type and colour variant. Returns { texture: null, sets: { key: BufferGeometry[] } }. */
export function buildCoralKit() {
  const build = {
    tube: (pal, i) => tubeCluster(101 + i * 17, pal),
    sprig: (pal, i) => sprig(203 + i * 13, pal),
    stag: (pal, i) => staghorn(307 + i * 19, pal),
    egg: (pal, i) => eggSponge(401 + i * 23, pal, i % 2 === 1),
    barrel: (pal, i) => barrelCluster(503 + i * 29, pal),
  };
  const sets = {};
  for (const { key, height } of CORAL_SETS) sets[key] = PALETTES[key].map((pal, i) => normalise(build[key](pal, i), height));
  return { texture: null, sets };
}
