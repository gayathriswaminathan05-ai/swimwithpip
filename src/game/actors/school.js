import * as THREE from 'three';
import { buildFishGeometry } from './fish.js';
import { litMaterial, makeSwimUniforms, GlowPoints } from '../gfx/materials.js';
import { clamp, damp, lerp, rng, TAU } from '../core/util.js';

// A school of fish rendered as one InstancedMesh. Each fish steers toward a target given by the
// current mode (escort, scatter, swirl, formation, wander), and its heading follows its velocity.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _t = new THREE.Vector3();
const _bulb = new THREE.Vector3(0, -0.3, 0.1);

export class School {
  constructor(scene, count, opts = {}) {
    this.scene = scene;
    this.count = count;
    this.scale = opts.scale ?? 0.62;
    const geo = buildFishGeometry({ simple: true, sprout: false, colors: opts.colors });
    const r = rng(opts.seed ?? 5);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) phases[i] = r() * TAU;
    this.phaseAttr = new THREE.InstancedBufferAttribute(phases, 1);
    this.basePhases = phases.slice();
    geo.setAttribute('aPhase', this.phaseAttr);
    this.swimU = makeSwimUniforms({ amp: 0.2, k: 2.6, head: 0.3, len: 2.5 });
    this.glowU = { value: opts.glow ?? 1 };
    this.mesh = new THREE.InstancedMesh(geo, litMaterial({ swim: this.swimU, instancePhase: true, glowUniform: this.glowU }), count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.fish = [];
    for (let i = 0; i < count; i++) {
      // Formation offsets: a tidy, staggered school — rows stacked in depth and height,
      // spaced out along the swimming direction so nobody overlaps.
      const col = i % 6;
      const row = Math.floor(i / 6);
      this.fish.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(0, 0, -3),
        heading: new THREE.Vector3(0, 0, -1),
        offset: new THREE.Vector3(
          ((row % 2) - 0.5) * 0.9 + (r() - 0.5) * 0.2,
          (row - 1.5) * 1.15 + (col % 2) * 0.35 + (r() - 0.5) * 0.2,
          (col - 2.5) * 1.75 + (row % 2) * 0.85 + (r() - 0.5) * 0.3,
        ),
        form: new THREE.Vector3(),
        wob: r() * TAU,
        speed: 0.85 + r() * 0.3,
        orbitA: r() * TAU,
        orbitR: 2.4 + r() * 3.2,
        orbitY: (r() - 0.5) * 2.6,
        orbitW: (0.7 + r() * 0.6) * (r() < 0.15 ? -1 : 1),
        scatterVel: new THREE.Vector3(),
        size: this.scale * (0.85 + r() * 0.3),
        visible: true,
      });
    }
    // A tidy travelling formation (used once everyone is reunited).
    this.fish.forEach((f, i) => {
      const row = Math.floor(i / 6);
      const colI = (i % 6) - 2.5;
      f.form.set(colI * 1.35 + (row % 2) * 0.6, ((i * 7) % 5) * 0.6 - 1.2, 1.8 + row * 1.5);
    });

    // Soft glow under each fish (their photophores) — only noticeable in dark water.
    this.halo = new GlowPoints(
      this.fish.map(() => ({ x: 0, y: 0, z: 0, size: 0.9, color: 0x7ff5ff })),
      opts.haloOpacity ?? 0.4,
    );
    scene.add(this.halo);

    this.mode = 'escort';
    this.spread = 1;
    this.center = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.anchor = null; // Object3D / Vector3 the swirl / formation follows
    this.maxSpeed = 7;
    this.gain = 1.6;
    this.phase = 0;
    this.sync = 0; // 0 = individual tail beats, 1 = all in sync
    this.time = 0;
    this.visible = true;
    this.anchorVel = new THREE.Vector3();
    this.prevAnchor = null;
  }

  _anchorPos() {
    if (this.anchor && (this.mode === 'swirl' || this.mode === 'formation')) return this.anchor.isObject3D ? this.anchor.position : this.anchor;
    return this.center;
  }

  setVisible(v) {
    this.visible = v;
    this.mesh.visible = v;
    this.halo.visible = v;
  }

  /** Place every fish at its escort slot immediately. */
  snapTo(center) {
    this.center.copy(center);
    this.prevAnchor = null;
    this.anchorVel.set(0, 0, 0);
    for (const f of this.fish) {
      f.pos.copy(center).addScaledVector(f.offset, this.spread);
      f.vel.copy(this.forward).multiplyScalar(3);
      f.heading.copy(this.forward);
      f.visible = true;
    }
    this._write(0);
  }

  /** The current sweeps the school away: push everyone in `dir` with some spread. */
  scatter(dir, strength = 14) {
    this.mode = 'scatter';
    const r = rng(99);
    for (const f of this.fish) {
      f.scatterVel
        .copy(dir)
        .multiplyScalar(strength * (0.7 + r() * 0.6))
        .add(_d.set((r() - 0.5) * 6, (r() - 0.5) * 4, -2 - r() * 6));
    }
  }

  /** Put fish far ahead (in the dark) so they can rush in. */
  placeAround(center, spread = 18) {
    const r = rng(17);
    for (const f of this.fish) {
      f.pos.set(center.x + (r() - 0.5) * spread, center.y + (r() - 0.5) * spread * 0.4, center.z + (r() - 0.5) * spread * 0.6);
      f.vel.set(0, 0, 2);
      f.visible = true;
    }
  }

  _target(f, t, out) {
    const anchor = this.anchor ? (this.anchor.isObject3D ? this.anchor.position : this.anchor) : this.center;
    switch (this.mode) {
      case 'swirl': {
        f.orbitA += f.orbitW * this._dt * 1.3;
        return out.set(
          anchor.x + Math.cos(f.orbitA) * f.orbitR,
          anchor.y + f.orbitY + Math.sin(f.orbitA * 2 + f.wob) * 0.5,
          anchor.z + Math.sin(f.orbitA) * f.orbitR,
        );
      }
      case 'formation':
        return out.set(
          anchor.x + f.form.x + Math.sin(t * 1.1 + f.wob) * 0.12,
          anchor.y + f.form.y + Math.sin(t * 0.9 + f.wob) * 0.12,
          anchor.z + f.form.z,
        );
      case 'escort':
      case 'wander':
      default:
        return out.set(
          this.center.x + f.offset.x * this.spread + Math.sin(t * 0.5 + f.wob) * 0.25,
          this.center.y + f.offset.y * this.spread + Math.sin(t * 0.7 + f.wob * 1.3) * 0.22,
          this.center.z + f.offset.z * this.spread + Math.cos(t * 0.4 + f.wob) * 0.3,
        );
    }
  }

  update(dt) {
    if (!this.visible || dt <= 0) return;
    this.time += dt;
    this._dt = dt;
    const t = this.time;
    const ap = this._anchorPos();
    if (this.prevAnchor) this.anchorVel.subVectors(ap, this.prevAnchor).divideScalar(dt);
    else this.prevAnchor = new THREE.Vector3();
    if (this.anchorVel.length() > 40) this.anchorVel.set(0, 0, 0);
    this.prevAnchor.copy(ap);
    let avgSpeed = 0;
    for (const f of this.fish) {
      if (this.mode === 'scatter') {
        f.pos.addScaledVector(f.scatterVel, dt);
        f.scatterVel.multiplyScalar(1 - dt * 0.25);
        f.vel.lerp(f.scatterVel, damp(4, dt));
      } else {
        this._target(f, t, _t);
        _d.subVectors(_t, f.pos).multiplyScalar(this.gain).add(this.anchorVel);
        const max = this.maxSpeed * f.speed + this.anchorVel.length();
        if (_d.length() > max) _d.setLength(max);
        f.vel.lerp(_d, damp(2.5, dt));
        f.pos.addScaledVector(f.vel, dt);
      }
      const sp = f.vel.length();
      avgSpeed += sp;
      if (this.mode === 'escort' || this.mode === 'formation') {
        // A tidy school: everyone faces the shared swimming direction, nudged by their own motion.
        _d.copy(this.forward).multiplyScalar(4).add(f.vel).normalize();
        f.heading.lerp(_d, damp(4, dt)).normalize();
      } else if (sp > 0.4) f.heading.lerp(_d.copy(f.vel).divideScalar(sp), damp(5, dt)).normalize();
      else f.heading.lerp(this.forward, damp(2, dt)).normalize();
    }
    avgSpeed /= this.count;
    this.phase += clamp(1.8 + avgSpeed * 0.8, 0, 9) * dt * Math.PI;
    this.swimU.uPhase.value = this.phase;
    this.swimU.uAmp.value = 0.18 + Math.min(0.12, avgSpeed * 0.015);

    // Tail beats drift into sync for the reunion.
    if (this.sync > 0) {
      const a = this.phaseAttr.array;
      for (let i = 0; i < this.count; i++) a[i] = lerp(this.basePhases[i], 0, this.sync);
      this.phaseAttr.needsUpdate = true;
    }
    this._write(dt);
  }

  _write() {
    for (let i = 0; i < this.count; i++) {
      const f = this.fish[i];
      _m.lookAt(f.heading, _zero, _up);
      _q.setFromRotationMatrix(_m);
      _s.setScalar(f.visible ? f.size : 0.0001);
      _m.compose(f.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      _d.copy(_bulb).multiplyScalar(f.size).applyQuaternion(_q).add(f.pos);
      this.halo.setPoint(i, _d.x, _d.y, _d.z);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.geometry.setDrawRange(0, this.mesh.count);
  }

  dispose() {
    this.scene.remove(this.mesh, this.halo);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.halo.geometry.dispose();
    this.halo.material.dispose();
  }
}
