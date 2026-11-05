import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { paint, paintVerts, merge, mix } from '../gfx/geometry.js';
import { litMaterial, GlowPoints } from '../gfx/materials.js';
import { rng, TAU } from '../core/util.js';

// Human things on the sea floor: a half-buried treasure chest and scattered gold coins that
// catch Pip's eye in the opening story.

const GOLD = 0xf2c24a;
const GOLD_DARK = 0xc8962a;

function coinGeometry() {
  const g = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 20, 1);
  return paintVerts(g, (p, n) => (Math.abs(n.y) > 0.6 ? { color: GOLD, glow: 0.35 } : { color: GOLD_DARK, glow: 0.2 }));
}

export function buildTreasure(seed = 4) {
  const r = rng(seed);
  const group = new THREE.Group();

  // Chest: rounded wooden box with gold bands, lid tipped open, gold glowing inside.
  const parts = [];
  const body = new RoundedBoxGeometry(1.25, 0.72, 0.82, 3, 0.07);
  body.translate(0, 0.36, 0);
  parts.push(
    paintVerts(body, (p) => {
      const plank = Math.abs(Math.sin(p.y * 15)) < 0.12;
      return mix(0x6e3f1f, 0x8c5530, 0.5 + Math.sin(p.x * 9 + p.z * 5) * 0.25).multiplyScalar(plank ? 0.7 : 1);
    }),
  );
  for (const x of [-0.42, 0.42]) {
    const band = new RoundedBoxGeometry(0.1, 0.76, 0.86, 2, 0.03);
    band.translate(x, 0.36, 0);
    parts.push(paint(band, GOLD, 0.15));
  }
  const lock = new RoundedBoxGeometry(0.16, 0.2, 0.06, 2, 0.02);
  lock.translate(0, 0.55, 0.43);
  parts.push(paint(lock, GOLD, 0.2));
  const pile = new THREE.SphereGeometry(0.55, 20, 10, 0, TAU, 0, Math.PI / 2);
  pile.scale(1, 0.32, 0.65);
  pile.translate(0, 0.66, 0);
  parts.push(paintVerts(pile, (p) => ({ color: Math.sin(p.x * 40) * Math.sin(p.z * 40) > 0.3 ? 0xffe58a : GOLD, glow: 0.7 })));
  const chest = new THREE.Mesh(merge(parts), litMaterial({}));

  const lidParts = [];
  const lid = new THREE.CylinderGeometry(0.41, 0.41, 1.25, 20, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  lidParts.push(paintVerts(lid, (p) => mix(0x7a4724, 0x96603a, 0.5 + Math.sin(p.x * 9) * 0.3)));
  for (const x of [-0.42, 0.42]) {
    const band = new THREE.CylinderGeometry(0.43, 0.43, 0.1, 20, 1, false, 0, Math.PI);
    band.rotateZ(Math.PI / 2);
    band.translate(x, 0, 0);
    lidParts.push(paint(band, GOLD, 0.15));
  }
  const lidMesh = new THREE.Mesh(merge(lidParts), litMaterial({}));
  const hinge = new THREE.Group();
  hinge.position.set(0, 0.72, -0.41);
  lidMesh.position.set(0, 0, 0.41);
  hinge.add(lidMesh);
  hinge.rotation.x = -1.05; // lid tipped open
  const chestGroup = new THREE.Group();
  chestGroup.add(chest, hinge);
  chestGroup.rotation.set(0.12, 0.5, -0.1);
  chestGroup.position.y = -0.22; // half-buried in the sand
  group.add(chestGroup);

  // Coins scattered (and a few stacked) on the sand in front of the chest.
  const coinGeo = coinGeometry();
  const n = 16;
  const coins = new THREE.InstancedMesh(coinGeo, litMaterial({}), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const glints = [];
  const coinLocal = [];
  for (let i = 0; i < n; i++) {
    const stack = i < 4;
    const a = r() * TAU;
    const d = stack ? 1.0 : 0.7 + r() * 1.7;
    const x = stack ? 0.9 : Math.cos(a) * d;
    const z = stack ? 0.6 : Math.sin(a) * d + 0.5;
    const y = stack ? 0.02 + i * 0.04 : 0.02;
    q.setFromEuler(e.set((r() - 0.5) * (stack ? 0.05 : 0.5), r() * TAU, (r() - 0.5) * (stack ? 0.05 : 0.5)));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    coins.setMatrixAt(i, m);
    coinLocal.push({ x, y, z, q: q.clone() });
    if (i % 3 === 0) glints.push({ x, y: y + 0.12, z, size: 0.55, color: 0xfff1b0 });
  }
  group.add(coins);
  glints.push({ x: 0, y: 0.75, z: 0, size: 2.2, color: 0xffd36b });
  const glow = new GlowPoints(glints, 0.9);
  group.add(glow);
  group.userData.glints = glow;
  /** Rest every coin on the sand: heightAt(worldX, worldZ) gives the seabed height. */
  group.userData.ground = (heightAt) => {
    coinLocal.forEach((c, i) => {
      const y = heightAt(group.position.x + c.x, group.position.z + c.z) - group.position.y + c.y;
      coins.setMatrixAt(i, m.compose(new THREE.Vector3(c.x, y, c.z), c.q, new THREE.Vector3(1, 1, 1)));
    });
    coins.instanceMatrix.needsUpdate = true;
  };
  group.userData.time = 0;
  /** Twinkle the glints. */
  group.userData.update = (dt) => {
    group.userData.time += dt;
    const t = group.userData.time;
    for (let i = 0; i < glints.length - 1; i++) glow.setBrightness(i, 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.6 + i * 1.9)) ** 3);
  };
  return group;
}
