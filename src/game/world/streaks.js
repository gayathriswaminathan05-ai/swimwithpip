import * as THREE from 'three';
import { rng, damp, lerp, TAU } from '../core/util.js';
import { globalUniforms } from '../gfx/materials.js';

// Visible water current: long, soft ribbon streamers that whip along a spiral (like stylised
// wind trails). Each ribbon is a camera-facing strip that tapers and fades toward its tail, so
// there are no hard lines. Used by the intro and the "Powerful current" hurdle.
// API: center, flow (units/s along +X), spin, squeeze, target/strength (0..1), mesh, update(dt).

const N = 20; // points per ribbon
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _side = new THREE.Vector3();
const _view = new THREE.Vector3();
const _cam = new THREE.Vector3();

export class CurrentStreaks {
  /** Set once by the game so ribbons can face the camera. */
  static camera = null;

  constructor(count = 34, { color = 0xe6fdff, length = 36, radius = [1.0, 6.5], seed = 3, opacity = 0.75, width = 0.32 } = {}) {
    this.count = count;
    const verts = count * N * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const aT = new Float32Array(verts);
    const aSide = new Float32Array(verts);
    const aAlpha = new Float32Array(verts);
    const idx = [];
    for (let r = 0; r < count; r++) {
      for (let j = 0; j < N; j++) {
        const v = (r * N + j) * 2;
        aT[v] = aT[v + 1] = j / (N - 1);
        aSide[v] = -1;
        aSide[v + 1] = 1;
        if (j < N - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } }]);
    this.u.uTime = globalUniforms.uTime;
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: true,
      vertexShader: /* glsl */ `
        attribute float aT; attribute float aSide; attribute float aAlpha;
        varying float vT; varying float vSide; varying float vA; varying float vDepth;
        #include <fog_pars_vertex>
        void main() {
          vT = aT; vSide = aSide; vA = aAlpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
        varying float vT; varying float vSide; varying float vA; varying float vDepth;
        #include <fog_pars_fragment>
        void main() {
          // Bright, rounded head fading into a long soft tail; soft across the width.
          float along = smoothstep(0.0, 0.07, vT) * pow(1.0 - vT, 1.3);
          float across = 1.0 - vSide * vSide;
          float shimmer = 0.85 + 0.15 * sin(vT * 18.0 - uTime * 9.0);
          float a = along * across * shimmer * vA * uOpacity;
          a *= smoothstep(1.5, 7.0, vDepth); // no giant ribbons right in front of the camera
          #ifdef USE_FOG
            a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.baseOpacity = opacity;
    this.length = length;
    this.width = width;
    this.radius = radius;
    this.rand = rng(seed);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const it = {};
      this._respawn(it, true);
      this.items.push(it);
    }
    this.strength = 0;
    this.target = 0;
    this.flow = 14;
    this.spin = 1;
    this.squeeze = 1;
    this.center = new THREE.Vector3();
    this.mesh.visible = false;
  }

  _respawn(it, initial = false) {
    const r = this.rand;
    it.tau = initial ? r() * 3 : 0;
    it.theta0 = r() * TAU;
    it.r0 = lerp(this.radius[0], this.radius[1], Math.sqrt(r()));
    it.w = (0.9 + r() * 1.1) * (r() < 0.2 ? -1 : 1);
    it.speed = 0.8 + r() * 0.5;
    it.wob = r() * TAU;
    it.alpha = 0.55 + r() * 0.45;
    it.dt = 0.03 + r() * 0.016; // spacing in time between trail points (ribbon length)
  }

  _point(it, tau, out) {
    const L = this.length;
    const x = -L / 2 + this.flow * it.speed * tau;
    const th = it.theta0 + it.w * this.spin * tau;
    const rad = it.r0 * this.squeeze * (1 + 0.18 * Math.sin(tau * 1.7 + it.wob));
    return out.set(x, Math.cos(th) * rad + Math.sin(tau * 2.3 + it.wob) * 0.25, Math.sin(th) * rad);
  }

  update(dt) {
    this.strength = lerp(this.strength, this.target, damp(2.2, dt));
    this.mesh.visible = this.strength > 0.01;
    if (!this.mesh.visible) return;
    const pos = this.mesh.geometry.attributes.position;
    const alpha = this.mesh.geometry.attributes.aAlpha;
    const L = this.length;
    // Camera position in the ribbons' local space (groups here only translate).
    const cam = CurrentStreaks.camera;
    if (cam) {
      this.mesh.updateWorldMatrix(true, false);
      _cam.copy(cam.position);
      this.mesh.worldToLocal(_cam);
    } else _cam.set(0, 5, 30);
    const c = this.center;
    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      it.tau += dt;
      const tailX = -L / 2 + this.flow * it.speed * (it.tau - (N - 1) * it.dt);
      if (tailX > L / 2) this._respawn(it);
      for (let j = 0; j < N; j++) {
        const tau = it.tau - j * it.dt;
        this._point(it, tau, _p);
        this._point(it, tau - 0.01, _t);
        _t.subVectors(_p, _t).normalize(); // tangent
        _p.add(c);
        _view.subVectors(_cam, _p).normalize();
        _side.crossVectors(_t, _view).normalize();
        const w = this.width * (1 - 0.65 * (j / (N - 1))) * (0.6 + 0.4 * this.strength);
        const x = _p.x - c.x;
        const edge = tau < 0 ? 0 : Math.max(0, 1 - Math.pow(Math.abs(x) / (L / 2), 4));
        const v = (i * N + j) * 2;
        pos.setXYZ(v, _p.x - _side.x * w, _p.y - _side.y * w, _p.z - _side.z * w);
        pos.setXYZ(v + 1, _p.x + _side.x * w, _p.y + _side.y * w, _p.z + _side.z * w);
        const a = it.alpha * edge * this.strength;
        alpha.array[v] = a;
        alpha.array[v + 1] = a;
      }
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }
}
