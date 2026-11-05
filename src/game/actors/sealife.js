import * as THREE from 'three';
import { paint, paintVerts, merge, warp, mix } from '../gfx/geometry.js';
import { litMaterial } from '../gfx/materials.js';
import { School } from './school.js';
import { Jellies } from './creatures.js';
import { damp, fbm3, lerp, TAU } from '../core/util.js';

// Ambient sea life that makes each area feel alive: sea turtles, rays, schools of tropical fish,
// scuttling crabs, bobbing seahorses and drifting jellyfish. Creatures are recycled around Pip
// (spawned ahead, retired once behind), keep clear of the hurdle areas and hide in the dark cave.

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function faceAlong(obj, dir, rate, dt) {
  if (dir.lengthSq() < 1e-6) return;
  _m.lookAt(_v.copy(dir).normalize(), _zero, _up);
  _q.setFromRotationMatrix(_m);
  obj.quaternion.slerp(_q, rate === undefined ? 1 : damp(rate, dt));
}

// ---------------------------------------------------------------------------
class Turtle {
  constructor() {
    this.group = new THREE.Group();
    const parts = [];
    const shell = new THREE.SphereGeometry(1, 30, 18);
    warp(shell, (x, y, z) => [x * 1.0, y > 0 ? y * 0.48 : y * 0.16, z * 1.25]);
    parts.push(
      paintVerts(shell, (p) => {
        if (p.y < -0.02) return 0xeadfb4;
        const scute = Math.abs(Math.sin(p.x * 5.2 + Math.sin(p.z * 3) * 0.6) * Math.sin(p.z * 4.4));
        const base = mix(0x6f6235, 0x8f8045, fbm3(p.x * 3, p.y * 3, p.z * 3, 2));
        if (scute < 0.12) base.lerp(new THREE.Color(0x4a3f22), 0.7);
        if (Math.hypot(p.x, p.z * 0.8) > 0.92) base.lerp(new THREE.Color(0xc2b071), 0.6);
        return base;
      }),
    );
    const head = new THREE.SphereGeometry(0.3, 16, 12);
    head.scale(1, 0.85, 1.35);
    head.translate(0, 0.04, 1.42);
    parts.push(paintVerts(head, (p) => (Math.sin(p.x * 30) * Math.sin(p.z * 30) > 0.5 ? 0x6e8a4c : 0x93ad6c)));
    for (const s of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.05, 8, 6);
      eye.translate(s * 0.2, 0.12, 1.62);
      parts.push(paint(eye, 0x141414));
    }
    this.body = new THREE.Mesh(merge(parts), litMaterial({}));
    this.group.add(this.body);
    const finGeo = paintVerts(
      (() => {
        const g = new THREE.SphereGeometry(1, 16, 8);
        g.scale(0.85, 0.07, 0.3);
        g.translate(0.8, 0, -0.1);
        return g;
      })(),
      (p) => (Math.sin(p.x * 18) > 0.3 ? 0x6e8a4c : 0x93ad6c),
    );
    const mat = litMaterial({});
    this.flippers = [];
    for (const [s, z, k] of [
      [-1, 0.55, 1],
      [1, 0.55, 1],
      [-1, -0.95, 0.55],
      [1, -0.95, 0.55],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.72, -0.04, z);
      const f = new THREE.Mesh(finGeo, mat);
      f.scale.set(s * k, k, k);
      f.rotation.y = s * (k < 1 ? 0.9 : 0.35);
      pivot.add(f);
      pivot.userData = { s, front: k === 1 };
      this.group.add(pivot);
      this.flippers.push(pivot);
    }
    this.group.scale.setScalar(1.25);
    this.time = Math.random() * 10;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const p of this.flippers) {
      const { s, front } = p.userData;
      p.rotation.z = s * (front ? Math.sin(t * 1.5) * 0.55 : Math.sin(t * 1.5 + 1) * 0.3);
      p.rotation.x = front ? Math.sin(t * 1.5 - 0.6) * 0.25 : 0;
    }
    this.body.position.y = Math.sin(t * 1.5) * 0.04;
  }
}

// ---------------------------------------------------------------------------
class Ray {
  constructor(top = 0x2f425f, spots = 0x8fb1d6) {
    this.group = new THREE.Group();
    this.flapU = { uFlapPhase: { value: 0 }, uFlapAmp: { value: 0.32 } };
    const body = new THREE.SphereGeometry(1, 40, 14);
    warp(body, (x, y, z) => {
      const wing = 2.5 * (1 - 0.32 * Math.max(0, -z));
      return [x * wing, y * 0.2 * (1 - 0.65 * Math.abs(x)), z * 1.05 - x * x * 0.55];
    });
    const parts = [
      paintVerts(body, (p) => {
        if (p.y < 0) return 0xeef3f7;
        const sp = fbm3(p.x * 2.5, 0, p.z * 2.5, 2);
        return sp > 0.66 ? spots : mix(top, 0x445a7c, Math.abs(p.x) / 2.6);
      }),
    ];
    for (const s of [-1, 1]) {
      const lobe = new THREE.SphereGeometry(0.16, 10, 8);
      lobe.scale(0.7, 0.5, 2.0);
      lobe.translate(s * 0.42, 0, 1.12);
      parts.push(paint(lobe, top));
      const eye = new THREE.SphereGeometry(0.06, 8, 6);
      eye.translate(s * 0.55, 0.06, 0.82);
      parts.push(paint(eye, 0x10141c));
    }
    const tail = new THREE.ConeGeometry(0.07, 2.6, 8);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, 0, -2.3);
    parts.push(paint(tail, top));
    this.mesh = new THREE.Mesh(merge(parts), litMaterial({ flap: this.flapU }));
    this.group.add(this.mesh);
    this.group.scale.setScalar(1.1);
    this.phase = Math.random() * TAU;
  }

  update(dt) {
    this.phase += dt * 2.0;
    this.flapU.uFlapPhase.value = this.phase;
    this.mesh.position.y = -Math.cos(this.phase) * 0.12;
  }
}

// ---------------------------------------------------------------------------
function crabGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.36, 18, 12);
  body.scale(1.35, 0.55, 0.95);
  body.translate(0, 0.2, 0);
  parts.push(paintVerts(body, (p) => (p.y < 0.15 ? 0xf6a07a : mix(0xd9442b, 0xf06a43, (p.y - 0.15) * 4))));
  for (const s of [-1, 1]) {
    // Eye stalks.
    const stalk = new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6);
    stalk.translate(s * 0.13, 0.4, 0.22);
    parts.push(paint(stalk, 0xd9442b));
    const eye = new THREE.SphereGeometry(0.06, 10, 8);
    eye.translate(s * 0.13, 0.53, 0.23);
    parts.push(paint(eye, 0xffffff));
    const pupil = new THREE.SphereGeometry(0.035, 8, 6);
    pupil.translate(s * 0.13, 0.54, 0.28);
    parts.push(paint(pupil, 0x111111));
    // Claws.
    const arm = new THREE.CylinderGeometry(0.04, 0.05, 0.32, 6);
    arm.rotateZ(s * 1.0);
    arm.translate(s * 0.48, 0.2, 0.22);
    parts.push(paint(arm, 0xd9442b));
    const claw = new THREE.SphereGeometry(0.12, 12, 8);
    claw.scale(1.1, 0.75, 1.4);
    claw.translate(s * 0.62, 0.3, 0.36);
    parts.push(paintVerts(claw, (p) => (p.y > 0.3 ? 0xf06a43 : 0xd9442b)));
    // Legs.
    for (let i = 0; i < 3; i++) {
      const z = 0.1 - i * 0.16;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.4, 0.2, z), new THREE.Vector3(s * 0.65, 0.3, z - 0.04), new THREE.Vector3(s * 0.82, 0.02, z - 0.08)]);
      parts.push(paint(new THREE.TubeGeometry(curve, 6, 0.03, 5), 0xd9442b));
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------
function seahorseGeometry(color = 0xffb347) {
  const parts = [];
  const pts = [
    new THREE.Vector3(0, 0.95, 0.12),
    new THREE.Vector3(0, 0.75, -0.02),
    new THREE.Vector3(0, 0.45, 0.06),
    new THREE.Vector3(0, 0.15, 0.04),
    new THREE.Vector3(0, -0.12, -0.08),
    new THREE.Vector3(0, -0.32, -0.02),
    new THREE.Vector3(0, -0.38, 0.12),
    new THREE.Vector3(0, -0.28, 0.2),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = 40;
  const radial = 10;
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, c);
    const r = 0.03 + Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.13 * (t < 0.6 ? 1 : 0.6);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  parts.push(paintVerts(g, (p) => (Math.sin(p.y * 40) > 0.6 ? mix(color, 0xffffff, 0.35) : color)));
  const head = new THREE.SphereGeometry(0.12, 14, 10);
  head.scale(1, 0.9, 1.1);
  head.translate(0, 0.98, 0.1);
  parts.push(paint(head, color));
  const snout = new THREE.CylinderGeometry(0.035, 0.05, 0.28, 8);
  snout.rotateX(Math.PI / 2 - 0.3);
  snout.translate(0, 0.93, 0.3);
  parts.push(paint(snout, color));
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.035, 8, 6);
    eye.translate(s * 0.1, 1.0, 0.16);
    parts.push(paint(eye, 0x111111));
  }
  const fin = new THREE.SphereGeometry(0.12, 10, 6);
  fin.scale(0.15, 1, 0.8);
  fin.translate(0, 0.42, -0.12);
  parts.push(paint(fin, mix(color, 0xffffff, 0.5), 0.2));
  return merge(parts);
}

// ---------------------------------------------------------------------------
const SCHOOL_COLORS = {
  yellow: { body: 0xffd23f, back: 0xf2a900, belly: 0xfff3c4, fin: 0xffe27a, finEdge: 0xfff6d0 },
  tang: { body: 0x3a7bf0, back: 0x1d4fbf, belly: 0x8fc2ff, fin: 0xffd23f, finEdge: 0xffe9a0 },
  deep: { body: 0x7d97c8, back: 0x3f5a8f, belly: 0xd6e2f6, fin: 0x9fb6e0, finEdge: 0xd9e5fa },
  pink: { body: 0xff86c8, back: 0xd9509c, belly: 0xffe0f1, fin: 0xb59cff, finEdge: 0xe9deff },
};

export class SeaLife {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.turtle = { actor: new Turtle(), active: false, vel: new THREE.Vector3(), cool: 3 };
    this.ray = { actor: new Ray(), active: false, vel: new THREE.Vector3(), cool: 8 };
    scene.add(this.turtle.actor.group, this.ray.actor.group);
    this.turtle.actor.group.visible = false;
    this.ray.actor.group.visible = false;

    const crabGeo = crabGeometry();
    const crabMat = litMaterial({});
    this.crabs = Array.from({ length: 3 }, () => {
      const m = new THREE.Mesh(crabGeo, crabMat);
      m.visible = false;
      m.scale.setScalar(0.9);
      scene.add(m);
      return { mesh: m, active: false, dir: 1, timer: 0, x: 0, s: 0 };
    });
    const horseMat = litMaterial({});
    const horseGeos = [seahorseGeometry(0xffb347), seahorseGeometry(0xff7fa8)];
    this.seahorses = Array.from({ length: 2 }, (_, i) => {
      const m = new THREE.Mesh(horseGeos[i], horseMat);
      m.visible = false;
      m.scale.setScalar(1.3);
      scene.add(m);
      return { mesh: m, active: false, base: new THREE.Vector3(), phase: Math.random() * TAU };
    });

    this.schools = {};
    for (const [key, colors] of Object.entries(SCHOOL_COLORS)) {
      const sc = new School(scene, 10, { colors, scale: 0.42, haloOpacity: 0, glow: key === 'deep' ? 1.2 : 0.25, seed: key.length * 13 });
      sc.setVisible(false);
      sc.halo.visible = false;
      sc.gain = 1.4;
      sc.maxSpeed = 6;
      this.schools[key] = { school: sc, active: false, vel: new THREE.Vector3(), cool: 1 + Math.random() * 3 };
    }

    // Jellyfish rising smoothly in loose columns off to the sides of the path.
    const jellyColors = [0xff9fe0, 0xa98cff, 0x8fefff, 0xffb7d0, 0xc9a2ff, 0x9ff7ff];
    this.jellies = new Jellies(
      jellyColors.map((color, i) => ({ x: 0, z: 1e5, scale: 0.55 + (i % 3) * 0.12, color })),
      { bottom: -3.5, top: 9 },
    );
    scene.add(this.jellies.group);
    this.jellyActive = jellyColors.map(() => false);
  }

  reset() {
    this.quiet = false;
    for (const c of [this.turtle, this.ray]) {
      c.active = false;
      c.actor.group.visible = false;
      c.cool = 2 + Math.random() * 4;
    }
    for (const c of this.crabs) (c.active = false), (c.mesh.visible = false);
    for (const h of this.seahorses) (h.active = false), (h.mesh.visible = false);
    for (const k of Object.keys(this.schools)) {
      const s = this.schools[k];
      s.active = false;
      s.school.setVisible(false);
      s.school.halo.visible = false;
      s.cool = 1 + Math.random() * 3;
    }
    this.jellyActive.fill(false);
    for (const j of this.jellies.list) j.lane.set(0, 0, 1e5);
  }

  _clear(s, x) {
    const hw = this.game.ocean.clearHalf(s);
    return hw === 0 || Math.abs(x) > hw + 2;
  }

  update(dt) {
    const g = this.game;
    const pz = g.pip.position.z;
    const ps = -pz;
    const zone = g.ocean.zoneIndex(ps);
    // Creatures keep away in the dark, and while `quiet` is set (Pip alone in the intro).
    const dark = g.ocean.darkness > 0.4 || this.quiet;
    const r = Math.random;

    // --- Gliders: turtle (sunlit + home) and ray (sunlit + depths) ---
    const glide = (c, zones, spawn) => {
      const a = c.actor;
      if (c.active) {
        a.group.position.addScaledVector(c.vel, dt);
        faceAlong(a.group, c.vel, 2, dt);
        a.update(dt);
        const p = a.group.position;
        if (p.z > pz + 14 || Math.abs(p.x - g.pip.position.x) > 34 || dark) {
          c.active = false;
          a.group.visible = false;
          c.cool = 6 + r() * 8;
        }
      } else {
        c.cool -= dt;
        if (c.cool <= 0 && zones.includes(zone) && !dark && g.state !== 'loading') {
          spawn(c);
          c.active = true;
          a.group.visible = true;
          faceAlong(a.group, c.vel);
        }
      }
    };
    glide(this.turtle, [0, 2], (c) => {
      const side = r() < 0.5 ? -1 : 1;
      c.actor.group.position.set(g.pip.position.x + side * (10 + r() * 4), 2 + r() * 3, pz - 16 - r() * 14);
      c.vel.set(-side * (1.5 + r() * 0.5), (r() - 0.5) * 0.2, 0.5 + r() * 0.5);
    });
    glide(this.ray, [0, 1], (c) => {
      const side = r() < 0.5 ? -1 : 1;
      c.actor.group.position.set(g.pip.position.x + side * (12 + r() * 4), 3.5 + r() * 3, pz - 20 - r() * 14);
      c.vel.set(-side * (2.2 + r() * 0.6), (r() - 0.5) * 0.3, 0.6 + r() * 0.6);
    });

    // --- Schools of fish crossing the reef ---
    const keys = zone === 0 ? ['yellow', 'tang'] : zone === 1 ? ['deep'] : ['pink', 'tang'];
    for (const [k, s] of Object.entries(this.schools)) {
      const sc = s.school;
      if (s.active) {
        sc.center.addScaledVector(s.vel, dt);
        sc.update(dt);
        if (sc.center.z > pz + 12 || Math.abs(sc.center.x - g.pip.position.x) > 28 || dark) {
          s.active = false;
          sc.setVisible(false);
          sc.halo.visible = false;
          s.cool = 4 + r() * 6;
        }
      } else if (keys.includes(k) && !dark) {
        s.cool -= dt;
        if (s.cool <= 0) {
          const side = r() < 0.5 ? -1 : 1;
          s.vel.set(-side * (2.6 + r()), 0, 0.4 + r() * 0.6);
          sc.forward.copy(s.vel).normalize();
          sc.mode = 'escort';
          sc.spread = 0.6;
          sc.snapTo(_v.set(g.pip.position.x + side * 13, 1 + r() * 3, pz - 9 - r() * 12));
          for (const f of sc.fish) f.vel.copy(s.vel);
          sc.setVisible(true);
          sc.halo.visible = false;
          s.active = true;
        }
      }
    }

    // --- Crabs scuttling sideways along the sand (sunlit + home) ---
    for (const c of this.crabs) {
      if (c.active) {
        c.timer -= dt;
        if (c.timer <= 0) {
          c.dir *= -1;
          c.timer = 1.2 + r() * 2.2;
        }
        c.x += c.dir * dt * 0.9;
        const y = g.ocean.surfaceHeight(c.x, c.s);
        c.mesh.position.set(c.x, y + 0.05 + Math.abs(Math.sin(g.clock * 14)) * 0.03, -c.s);
        c.mesh.rotation.z = Math.sin(g.clock * 14) * 0.06;
        if (-c.s > pz + 6 || dark) {
          c.active = false;
          c.mesh.visible = false;
        }
      } else if ((zone === 0 || zone === 2) && !dark && r() < dt * 0.6) {
        const s = ps + 8 + r() * 24;
        const x = (r() < 0.5 ? -1 : 1) * (1.4 + r() * 2.4);
        if (!this._clear(s, x)) continue;
        Object.assign(c, { active: true, s, x, dir: r() < 0.5 ? -1 : 1, timer: 1 + r() * 2 });
        c.mesh.rotation.y = r() * 0.6 - 0.3;
        c.mesh.visible = true;
      }
    }

    // --- Seahorses bobbing near the reef edges (sunlit + home) ---
    for (const h of this.seahorses) {
      if (h.active) {
        h.phase += dt;
        h.mesh.position.set(h.base.x + Math.sin(h.phase * 0.5) * 0.3, h.base.y + Math.sin(h.phase * 1.3) * 0.25, h.base.z);
        h.mesh.rotation.z = Math.sin(h.phase * 1.3) * 0.08;
        if (h.base.z > pz + 6 || dark) {
          h.active = false;
          h.mesh.visible = false;
        }
      } else if ((zone === 0 || zone === 2) && !dark && r() < dt * 0.3) {
        const s = ps + 10 + r() * 24;
        const side = r() < 0.5 ? -1 : 1;
        const x = side * (2.8 + r() * 2.4);
        if (!this._clear(s, x)) continue;
        h.base.set(x, g.ocean.surfaceHeight(x, s) + 1.6 + r() * 1.2, -s);
        h.mesh.rotation.y = side > 0 ? -1.2 : 1.2;
        h.active = true;
        h.mesh.visible = true;
      }
    }

    // --- Jellyfish rising off to the sides (a new lane opens ahead as one falls behind) ---
    this.jellies.list.forEach((j, i) => {
      if (this.jellyActive[i]) {
        if (j.lane.z > pz + 8 || dark) {
          this.jellyActive[i] = false;
          j.lane.set(0, 0, 1e5);
        }
      } else if (!dark && r() < dt * 0.35) {
        const side = r() < 0.5 ? -1 : 1;
        j.lane.set(g.pip.position.x + side * (5.5 + r() * 9), 0, pz - 12 - r() * 28);
        j.y = this.jellies.bottom + r() * 2; // starts low and fades in as it rises
        this.jellyActive[i] = true;
      }
    });
    this.jellies.update(dt);
  }
}
