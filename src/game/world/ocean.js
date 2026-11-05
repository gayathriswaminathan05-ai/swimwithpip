import * as THREE from 'three';
import { paintVerts, mix } from '../gfx/geometry.js';
import { litMaterial, makeSwayUniforms, GlowPoints, globalUniforms, disposeTree, shared } from '../gfx/materials.js';
import { clamp, fbm2, lerp, rng, smoothstep, damp } from '../core/util.js';
import {
  rockGeo,
  branchCoralGeo,
  tubeCoralGeo,
  brainCoralGeo,
  spongeGeo,
  anemoneGeo,
  seaweedGeo,
  kelpGeo,
  grassGeo,
  starfishGeo,
} from './reef.js';

// The ocean: three painterly areas along the route (which runs toward -Z): a sunlit coral reef,
// a twilight reef, and a bioluminescent home reef. Sky dome, haze, water surface, light rays,
// marine snow, and a reef corridor generated in chunks (sandy path flanked by coral shelves).

export const ZONES = [
  {
    key: 'lost',
    name: 'The Lost Waters',
    bgTop: 0xd2f9ff,
    bgMid: 0x3cc0d3,
    bgBottom: 0x0f6d86,
    fog: 0x3cb6cb,
    fogNear: 9,
    fogFar: 72,
    hemiSky: 0xe6fcff,
    hemiGround: 0xf0cf98,
    hemi: 1.85,
    sun: 1.45,
    sunColor: 0xfff3d6,
    snow: 0xffffff,
    rimColor: 0xc4f9ff,
    rim: 0.42,
    caustic: 0.55,
    rays: 1,
    surface: 1,
    floorY: -4.6,
    pipLight: 3,
    sandA: 0xf6e1b0,
    sandB: 0xdcb984,
    corals: [0xff6a3d, 0xff7f96, 0xcc58c8, 0x8c5ad8, 0xffc94a, 0xff5f7e, 0x2fc2b0, 0xff8f5a],
    rocks: [0x3f9199, 0x357c8c, 0x4fa29e, 0x2f7183],
    weeds: [0x43b86c, 0x2f9c5f, 0x77c86a],
  },
  {
    key: 'depths',
    name: 'The Dangerous Depths',
    bgTop: 0x63a6cc,
    bgMid: 0x1f5a85,
    bgBottom: 0x081f38,
    fog: 0x22598a,
    fogNear: 7,
    fogFar: 60,
    hemiSky: 0xa8d6f4,
    hemiGround: 0x2d3958,
    hemi: 1.45,
    sun: 0.6,
    sunColor: 0xc4dcff,
    snow: 0xcfe6ff,
    rimColor: 0x79bcff,
    rim: 0.4,
    caustic: 0.16,
    rays: 0.35,
    surface: 0.25,
    floorY: -5.6,
    pipLight: 6,
    sandA: 0x88a0b2,
    sandB: 0x627d93,
    corals: [0x7563d6, 0x3fa8c2, 0xc4507c, 0x4d7ed8, 0x2f9c9c, 0x9c70d4],
    rocks: [0x2c5478, 0x274a6b, 0x375d82],
    weeds: [0x2f7d7a, 0x2a6c72],
  },
  {
    key: 'home',
    name: 'The Glowing Home',
    bgTop: 0x8a76e6,
    bgMid: 0x2e2680,
    bgBottom: 0x100b33,
    fog: 0x30288a,
    fogNear: 8,
    fogFar: 66,
    hemiSky: 0xdccaff,
    hemiGround: 0x3d2c66,
    hemi: 1.6,
    sun: 0.5,
    sunColor: 0xcdbaff,
    snow: 0xffd8fb,
    rimColor: 0xff9fea,
    rim: 0.5,
    caustic: 0,
    rays: 0.18,
    surface: 0.1,
    floorY: -4.6,
    pipLight: 5,
    sandA: 0x9a90d6,
    sandB: 0x6f66b0,
    corals: [0x5ff3ff, 0xff6bd5, 0xffd66b, 0x9b7bff, 0x6bffb5, 0xff8a6b],
    rocks: [0x41357e, 0x4a3d90, 0x372c6c],
    weeds: [0x5b52b8, 0x4170b8],
  },
];

const DARK = {
  bgTop: 0x080a16,
  bgMid: 0x03040c,
  bgBottom: 0x000000,
  fog: 0x03040b,
  hemiSky: 0x2a2e48,
  hemiGround: 0x06060a,
  hemi: 0.22,
  sun: 0.0,
  rim: 0.12,
  caustic: 0,
  rays: 0,
  surface: 0,
};

// Stirred-up, murky water (the intro after the current sweeps Pip away): dull, close and sandy.
const MURK = {
  bgTop: 0x7fa9ad,
  bgMid: 0x3e6f78,
  bgBottom: 0x163a44,
  fog: 0x4a7a80,
  hemiSky: 0xb9d4d2,
  hemiGround: 0x8d7f63,
  hemi: 1.15,
  sun: 0.55,
  rim: 0.3,
  caustic: 0.08,
  rays: 0.15,
  surface: 0.3,
  pipLight: 6,
};

const CHUNK = 40;
// Seabed mesh layout per chunk (surfaceHeight() mirrors exactly what is drawn).
const FLOOR_W = 140;
const FLOOR_GX = 36;
const FLOOR_GZ = 12;
const _down = new THREE.Vector3(0, -1, 0);
const _up = new THREE.Vector3(0, 1, 0);
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

export class Ocean {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.chunks = new Map();
    this.zoneEdges = [
      [235, 270],
      [612, 640],
    ];
    this.clearZones = [];
    this.darkness = 0;
    this.darkTarget = 0;
    this.murk = 0; // 0..1: stirred-up, murky water (intro)
    this.murkTarget = 0;
    this.clarity = 0; // 0..1: thins the fog so a hurdle's danger reads clearly
    this.clarityTarget = 0;
    this.tint = new THREE.Color(0xff6a2a);
    this.tintAmount = 0;
    this.tintTarget = 0;
    this.time = 0;
    this.s = 0;
    this.emitters = [];

    this.pal = {};
    for (const k of ['bgTop', 'bgMid', 'bgBottom', 'fog', 'hemiSky', 'hemiGround', 'sunColor', 'snow', 'rimColor']) this.pal[k] = new THREE.Color();

    this.fog = new THREE.Fog(0x45c2d2, 5, 64);
    scene.fog = this.fog;
    scene.background = null;

    this._buildDome();
    this._buildLights();
    this._buildSnow();
    this._buildSurface();
    this._buildRays();
    this._buildShared();
  }

  // ---------- Zones ----------
  zoneWeights(s) {
    const a = smoothstep(this.zoneEdges[0][0], this.zoneEdges[0][1], s);
    const b = smoothstep(this.zoneEdges[1][0], this.zoneEdges[1][1], s);
    return [1 - a, a * (1 - b), b];
  }

  zoneIndex(s) {
    const w = this.zoneWeights(s);
    return w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2;
  }

  floorY(s) {
    const w = this.zoneWeights(s);
    return w[0] * ZONES[0].floorY + w[1] * ZONES[1].floorY + w[2] * ZONES[2].floorY;
  }

  // ---------- Build: sky, lights, particles ----------
  _buildDome() {
    const geo = new THREE.SphereGeometry(400, 40, 24);
    this.domeU = {
      uTop: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSurface: { value: 1 },
      uTime: globalUniforms.uTime,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.domeU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
          gl_Position.z = p.w * 0.99999;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform float uSurface; uniform float uTime;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.85, h)) : mix(uMid, uBottom, smoothstep(0.0, -0.5, h));
          // Bright, rippling surface light far above.
          float ang = atan(vDir.x, vDir.z);
          float rays = sin(ang * 11.0 + uTime * 0.22) * sin(ang * 17.0 - uTime * 0.16);
          c += vec3(1.0) * max(0.0, rays) * smoothstep(0.2, 0.9, h) * 0.12 * uSurface;
          c += vec3(1.0, 0.98, 0.9) * pow(max(h, 0.0), 10.0) * 0.55 * uSurface;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.scene.add(this.sun, this.sun.target);
    this.pipLight = new THREE.PointLight(0xffd59a, 3, 11, 1.6);
    this.hazardLight = new THREE.PointLight(0xff7a33, 0, 18, 1.6);
    this.scene.add(this.pipLight, this.hazardLight);
  }

  _buildSnow() {
    const n = this.quality.snow;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const r = rng(7);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() - 0.5) * 40;
      pos[i * 3 + 1] = (r() - 0.5) * 26;
      pos[i * 3 + 2] = (r() - 0.5) * 40;
      seed[i] = r();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.snowU = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.7 } },
    ]);
    this.snowU.uTime = globalUniforms.uTime;
    this.snowU.uPointScale = globalUniforms.uPointScale;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.snowU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform vec3 uCam; uniform float uTime; uniform float uPointScale;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec3 box = vec3(40.0, 26.0, 40.0);
          vec3 p = position;
          p.y -= uTime * (0.1 + aSeed * 0.18);
          p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.6;
          p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (0.05 + aSeed * 0.07) * uPointScale / max(0.5, -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
          vA = 0.3 + 0.7 * fract(aSeed * 13.7);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vA;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.2, 1.0, d)) * vA * uOpacity;
          #ifdef USE_FOG
            a *= 1.0 - smoothstep(fogNear, fogFar * 0.7, vFogDepth);
          #endif
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 4;
    this.scene.add(this.snow);
  }

  _buildSurface() {
    // The water surface far overhead, rippling with light (visible when looking up).
    this.surfU = { uTime: globalUniforms.uTime, uStrength: { value: 1 }, uColor: { value: new THREE.Color(0xeafcff) }, uCam: { value: new THREE.Vector3() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.surfU,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uStrength; uniform vec3 uColor; uniform vec3 uCam;
        varying vec3 vW;
        void main() {
          vec2 p = vW.xz * 0.07;
          float t = uTime * 0.35;
          float w = sin(p.x * 3.1 + t) * sin(p.y * 2.7 - t * 0.8) + 0.6 * sin((p.x + p.y) * 4.3 + t * 1.4) + 0.4 * sin((p.x - p.y) * 6.1 - t * 1.1);
          float bright = smoothstep(0.35, 1.5, w);
          float d = length(vW.xz - uCam.xz);
          float a = (0.08 + bright * 0.42) * (1.0 - smoothstep(40.0, 190.0, d)) * uStrength;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(420, 420, 1, 1);
    geo.rotateX(Math.PI / 2);
    this.surface = new THREE.Mesh(geo, mat);
    this.surface.frustumCulled = false;
    this.surface.renderOrder = -5;
    this.scene.add(this.surface);
  }

  _buildRays() {
    // Slanted god-rays from the surface: camera-facing quads recycled around the viewer.
    const n = 14;
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.translate(0, -0.5, 0); // top edge at the origin
    this.rayU = { uStrength: { value: 1 }, uColor: { value: new THREE.Color(0xeffcff) }, uTime: globalUniforms.uTime };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rayU,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vDepth; varying float vSeed;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * w;
          vDepth = -mv.z;
          vSeed = instanceMatrix[3][0] * 0.13 + instanceMatrix[3][2] * 0.07;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uStrength; uniform vec3 uColor; uniform float uTime;
        varying vec2 vUv; varying float vDepth; varying float vSeed;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          across = pow(across, 2.2);
          float along = smoothstep(0.0, 0.55, vUv.y) * (0.35 + 0.65 * vUv.y);
          float flicker = 0.75 + 0.25 * sin(uTime * 0.8 + vSeed * 9.0);
          float fade = smoothstep(2.0, 9.0, vDepth) * (1.0 - smoothstep(45.0, 95.0, vDepth));
          float a = across * along * flicker * fade * 0.12 * uStrength;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.rays = new THREE.InstancedMesh(geo, mat, n);
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 8;
    this.rays.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const r = rng(31);
    this.rayItems = [];
    for (let i = 0; i < n; i++) {
      this.rayItems.push({ x: (r() - 0.5) * 60, z: -r() * 90, w: 1.2 + r() * 3.2, slant: 0.22 + r() * 0.1, placed: false });
    }
    this.scene.add(this.rays);
  }

  _buildShared() {
    const mk = (opts) => shared(litMaterial({ nearFade: true, ...opts }));
    this.coralGlowU = { value: 0.35 };
    this.homeGlowU = { value: 1.5 };
    this.mats = {
      floor: mk({ nearFade: false }),
      rock: mk({}),
      coral: mk({ glowUniform: this.coralGlowU }),
      coralGlow: mk({ glowUniform: this.homeGlowU }),
      fan: mk({ glowUniform: this.coralGlowU, sway: makeSwayUniforms({ amp: 0.1, height: 2.5, speed: 1.2 }) }),
      fanGlow: mk({ glowUniform: this.homeGlowU, sway: makeSwayUniforms({ amp: 0.1, height: 2.5, speed: 1.2 }) }),
      anemone: mk({ glowUniform: this.coralGlowU, sway: makeSwayUniforms({ amp: 0.16, height: 1.3, speed: 2.0 }) }),
      weed: mk({ side: THREE.DoubleSide, glowUniform: { value: 0.1 }, sway: makeSwayUniforms({ amp: 0.55, height: 5, speed: 1.1 }) }),
      kelp: mk({ glowUniform: { value: 0.1 }, sway: makeSwayUniforms({ amp: 0.75, height: 6, speed: 0.9 }) }),
      grass: mk({ side: THREE.DoubleSide, sway: makeSwayUniforms({ amp: 0.18, height: 1.6, speed: 1.6 }) }),
      small: mk({ caustics: true }),
    };
    const g = (geo) => shared(geo);
    this.geos = {
      rocks: [g(rockGeo(3)), g(rockGeo(11)), g(rockGeo(23))],
      bush: [g(branchCoralGeo(7, { depth: 2, len: 0.95, thick: 0.17 })), g(branchCoralGeo(19, { depth: 2, thick: 0.14, len: 0.85, spread: 0.8 }))],
      fan: [g(branchCoralGeo(41, { planar: true, depth: 3, thick: 0.085, len: 0.8, spread: 0.55, tipGlow: 0.4 })), g(branchCoralGeo(43, { planar: true, depth: 3, thick: 0.075, len: 0.72, spread: 0.7, tipGlow: 0.4 }))],
      tube: g(tubeCoralGeo(9)),
      brain: g(brainCoralGeo(13)),
      sponge: g(spongeGeo(21)),
      anemone: g(anemoneGeo(29)),
      weed: [g(seaweedGeo(33)), g(seaweedGeo(35, { height: 3.2, width: 0.32 }))],
      kelp: g(kelpGeo(37)),
      grass: g(grassGeo(39)),
      star: g(starfishGeo()),
    };
  }

  /** Adds the MiniPoly coral kit (loaded GLB models) to the reef generator. */
  setKit(kit) {
    if (!kit || !kit.texture) return;
    this.kit = kit;
    const tex = kit.texture;
    // vertexColors: true — each model variant's colour is stored per vertex.
    this.mats.kit = shared(litMaterial({ map: tex, vertexColors: true, nearFade: true }));
    this.mats.kitSway = shared(litMaterial({ map: tex, vertexColors: true, nearFade: true, sway: makeSwayUniforms({ amp: 0.12, height: 1.2, speed: 1.4 }) }));
    this.mats.kitGlow = shared(litMaterial({ map: tex, vertexColors: true, nearFade: true, emissive: 0x9a8aff, emissiveIntensity: 0.35 }));
  }

  // ---------- Chunks ----------
  setClearZones(zones) {
    this.clearZones = zones;
  }

  /** Half-width that must stay clear of decor at distance s (0 when none). */
  clearHalf(s) {
    let hw = 0;
    for (const z of this.clearZones) if (s > z.s0 && s < z.s1) hw = Math.max(hw, z.halfWidth);
    return hw;
  }

  floorHeight(x, s) {
    const base = this.floorY(s);
    const n = fbm2(x * 0.05, s * 0.05, 3);
    const ax = Math.abs(x);
    const bank = smoothstep(2.5, 12, ax) * 1.6 + smoothstep(14, 46, ax) * 6;
    return base + (n - 0.5) * 1.8 * smoothstep(1, 8, ax) + (n - 0.5) * 0.5 + bank;
  }

  /**
   * Height of the seabed exactly as drawn (interpolated over the same triangles as the chunk mesh),
   * so anything placed with it sits on the sand instead of hovering or sinking.
   */
  surfaceHeight(x, s) {
    const half = FLOOR_W / 2;
    if (x <= -half || x >= half) return this.floorHeight(x, s);
    const s0 = Math.floor(s / CHUNK) * CHUNK;
    const segW = FLOOR_W / FLOOR_GX;
    const segH = CHUNK / FLOOR_GZ;
    const fx = (x + half) / segW;
    const ix = Math.min(FLOOR_GX - 1, Math.max(0, Math.floor(fx)));
    const tx = fx - ix;
    const fy = (s0 + CHUNK - s) / segH;
    const iy = Math.min(FLOOR_GZ - 1, Math.max(0, Math.floor(fy)));
    const ty = fy - iy;
    const xa = -half + ix * segW;
    const xd = xa + segW;
    const sa = s0 + CHUNK - iy * segH;
    const sb = sa - segH;
    const ha = this.floorHeight(xa, sa);
    const hb = this.floorHeight(xa, sb);
    const hc = this.floorHeight(xd, sb);
    const hd = this.floorHeight(xd, sa);
    if (tx + ty <= 1) return ha + (hd - ha) * tx + (hb - ha) * ty;
    return hc + (hb - hc) * (1 - tx) + (hd - hc) * (1 - ty);
  }

  /** Lowest seabed point under a circular footprint (so rocks on slopes never float). */
  footprintLow(x, s, radius) {
    let low = this.surfaceHeight(x, s);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      low = Math.min(low, this.surfaceHeight(x + Math.cos(a) * radius, s + Math.sin(a) * radius));
    }
    return low;
  }

  /** Drop a ray onto an (instanced) shape and return { y, ny } of the surface hit, or null. */
  _surfaceOn(geo, pos, rotY, scale, x, z) {
    if (!this._probe) {
      this._probe = new THREE.Mesh(geo, this.mats.rock);
      this._ray = new THREE.Raycaster();
      this._pq = new THREE.Quaternion();
      this._pp = new THREE.Vector3();
      this._ps = new THREE.Vector3();
    }
    const probe = this._probe;
    probe.geometry = geo;
    this._pq.setFromAxisAngle(_up, rotY);
    probe.matrixWorld.compose(this._pp.copy(pos), this._pq, this._ps.set(scale[0], scale[1], scale[2]));
    this._ray.set(this._pp.set(x, pos.y + scale[1] * 2 + 2, z), _down);
    this._ray.far = scale[1] * 4 + 4;
    const hits = this._ray.intersectObject(probe, false);
    if (!hits.length) return null;
    const h = hits[0];
    _nm.getNormalMatrix(probe.matrixWorld);
    const ny = h.face.normal.clone().applyMatrix3(_nm).normalize().y;
    return { y: h.point.y, ny };
  }

  _sandColor(x, s, y, out) {
    const w = this.zoneWeights(s);
    const n = fbm2(x * 0.18, s * 0.18, 2);
    const ripple = 0.5 + 0.5 * Math.sin(x * 1.7 + s * 0.35 + n * 6);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 3; i++) {
      if (w[i] <= 0) continue;
      _c.set(ZONES[i].sandA).lerp(_c2.set(ZONES[i].sandB), clamp(n * 1.2 - 0.1 + Math.abs(x) * 0.01, 0, 1));
      r += _c.r * w[i];
      g += _c.g * w[i];
      b += _c.b * w[i];
    }
    out.setRGB(r, g, b).multiplyScalar(0.93 + ripple * 0.09);
    return out;
  }

  _buildChunk(c) {
    const s0 = c * CHUNK;
    const group = new THREE.Group();
    group.userData.emitters = [];
    const r = rng(c * 7919 + 13);
    const density = this.quality.decor;
    const zi = this.zoneIndex(s0 + CHUNK / 2);
    const Z = ZONES[zi];
    const glowZone = zi === 2;

    // Sand floor (smooth, with ripples and a paler path down the middle).
    const plane = new THREE.PlaneGeometry(FLOOR_W, CHUNK, FLOOR_GX, FLOOR_GZ);
    plane.rotateX(-Math.PI / 2);
    const pos = plane.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const s = s0 + CHUNK / 2 - pos.getZ(i);
      pos.setY(i, this.floorHeight(x, s));
      pos.setZ(i, -s);
    }
    plane.computeVertexNormals();
    const tmp = new THREE.Color();
    const floorGeo = paintVerts(plane, (p) => {
      this._sandColor(p.x, -p.z, p.y, tmp);
      const path = 1 - smoothstep(1.5, 7, Math.abs(p.x));
      return tmp.clone().multiplyScalar(0.9 + path * 0.16);
    });
    group.add(new THREE.Mesh(floorGeo, this.mats.floor));

    // Instance collectors.
    const lists = {};
    const add = (key, x, y, z, s, tint, scale = null) => {
      (lists[key] = lists[key] || []).push({ x, y, z, s, rotY: r() * 6.283, tint, scale });
    };
    const pickColor = (arr) => arr[Math.floor(r() * arr.length)];
    const offsetX = (s, side, min, span) => {
      const hw = this.clearHalf(s);
      const m = hw > 0 ? Math.max(min, hw + 1.5) : min;
      return side * (m + r() * span);
    };
    const kit = this.kit;
    // Kit corals keep their own painted colours; deeper water cools them a little.
    const kitTint = zi === 1 ? 0xb4c6ee : 0xffffff;
    const coralOnTop = (x, y, z, big) => {
      const roll = r();
      const tint = pickColor(Z.corals);
      const k = big ? 1.3 : 1;
      if (kit) {
        if (roll < 0.17) add('bush', x, y - 0.05, z, (1.0 + r() * 0.9) * k, tint);
        else if (roll < 0.3) add('k_stag', x, y - 0.1, z, (0.9 + r() * 0.6) * k, kitTint);
        else if (roll < 0.41) add('fan', x, y - 0.05, z, (1.2 + r() * 1.0) * k, tint);
        else if (roll < 0.51) add('k_tube', x, y - 0.05, z, (0.9 + r() * 0.5) * k, kitTint);
        else if (roll < 0.62) add('k_barrel', x, y - 0.12, z, (0.8 + r() * 0.5) * k, kitTint);
        else if (roll < 0.75) add('k_egg', x, y - 0.12, z, (0.8 + r() * 0.5) * k, kitTint);
        else if (roll < 0.82) add('brain', x, y - 0.12, z, (0.6 + r() * 0.5) * k, tint);
        else if (roll < 0.9) add('anemone', x, y - 0.05, z, (0.9 + r() * 0.5) * k, tint);
        else if (roll < 0.96) add('k_sprig', x, y - 0.05, z, (0.9 + r() * 0.5) * k, kitTint);
        else add('weed', x, y - 0.1, z, 0.7 + r() * 0.5, pickColor(Z.weeds));
        return;
      }
      if (roll < 0.27) add('bush', x, y - 0.05, z, (1.0 + r() * 1.0) * k, tint);
      else if (roll < 0.45) add('fan', x, y - 0.05, z, (1.2 + r() * 1.1) * k, tint);
      else if (roll < 0.58) add('tube', x, y - 0.05, z, (0.9 + r() * 0.6) * k, tint);
      else if (roll < 0.7) add('brain', x, y - 0.12, z, (0.6 + r() * 0.5) * k, tint);
      else if (roll < 0.8) add('sponge', x, y - 0.05, z, (0.8 + r() * 0.6) * k, tint);
      else if (roll < 0.9) add('anemone', x, y - 0.05, z, (0.9 + r() * 0.5) * k, tint);
      else add('weed', x, y - 0.1, z, 0.7 + r() * 0.5, pickColor(Z.weeds));
    };
    // Rocks are set into the lowest ground under their footprint, so no edge floats on a slope.
    // Chunks before the start line have negative indices, so use a positive modulo.
    const mod = (a, n) => ((a % n) + n) % n;
    const rockVariant = mod(c, 3);
    const rockGeo = this.geos.rocks[rockVariant];
    const placeRock = (x, s, sx, sy, sz) => {
      const low = this.footprintLow(x, s, Math.max(sx, sz) * 0.85);
      const rk = { x, s, sx, sy, sz, rotY: r() * 6.283, y: low + sy * 0.2 };
      rk.pos = new THREE.Vector3(x, rk.y, -s);
      (lists.rock = lists.rock || []).push({ x, y: rk.y, z: -s, s: 1, rotY: rk.rotY, tint: pickColor(Z.rocks), scale: [sx, sy, sz] });
      return rk;
    };
    // Corals are dropped onto the rock's actual surface (and skipped on steep sides).
    const coralsOn = (rk, count, big) => {
      let topY = rk.y + rk.sy * 0.45;
      for (let j = 0; j < count; j++) {
        for (let tries = 0; tries < 5; tries++) {
          const a = r() * 6.283;
          const d = Math.sqrt(r()) * Math.min(rk.sx, rk.sz) * 0.75;
          const x = rk.x + Math.cos(a) * d;
          const z = -rk.s + Math.sin(a) * d;
          const hit = this._surfaceOn(rockGeo, rk.pos, rk.rotY, [rk.sx, rk.sy, rk.sz], x, z);
          if (hit && hit.ny > 0.6) {
            coralOnTop(x, hit.y - 0.04, z, big);
            topY = hit.y;
            break;
          }
        }
      }
      return topY;
    };
    const ground = (x, s, sink = 0) => this.surfaceHeight(x, s) - sink;

    // Reef walls: an inner ledge and a taller outer wall at regular intervals on both sides of the
    // sandy path, each crowned with coral — the corridor look of a living reef.
    for (const side of [-1, 1]) {
      const clumps = Math.max(3, Math.round(5 * density));
      for (let i = 0; i < clumps; i++) {
        const s = s0 + ((i + 0.2 + r() * 0.6) / clumps) * CHUNK;
        const xi = offsetX(s, side, 3.9, 2.4);
        const si = placeRock(xi, s, 1.8 + r() * 1.8, 1.3 + r() * 1.4, 1.8 + r() * 1.6);
        const xo = xi + side * (2.6 + r() * 2.5);
        const so = placeRock(xo, s + (r() - 0.5) * 3, 2.6 + r() * 2.4, 3 + r() * 3.2, 2.4 + r() * 2.2);
        const topI = coralsOn(si, Math.max(1, Math.round((2 + r() * 1.5) * density)), false);
        coralsOn(so, Math.max(1, Math.round((1.2 + r() * 1.4) * density)), true);
        // Something at the foot of the ledge, facing the path.
        const xb = xi - side * (si.sx * 0.8 + 0.3);
        const zb = s + (r() - 0.5) * 2;
        const roll = r();
        if (roll < 0.3) add('anemone', xb, ground(xb, zb, 0.08), -zb, 0.8 + r() * 0.5, pickColor(Z.corals));
        else if (roll < 0.55) add('brain', xb, ground(xb, zb, 0.12), -zb, 0.5 + r() * 0.4, pickColor(Z.corals));
        else if (roll < 0.75) add('grass', xb, ground(xb, zb, 0.08), -zb, 0.9 + r() * 0.6, pickColor(Z.weeds));
        else add('star', xb, ground(xb, zb, 0.03), -zb, 0.5 + r() * 0.5, pickColor([0xff7a3d, 0xff5a6e, 0xffb84a, 0xb85ad8]));
        if (r() < 0.3) group.userData.emitters.push(new THREE.Vector3(xi, topI, -s));
        // Small coral heads spilling onto the edge of the sand path.
        if (r() < 0.6 && this.clearHalf(s) === 0) {
          const xe = side * (2.3 + r() * 1.2);
          const ze = s + (r() - 0.5) * 3;
          const pick = r();
          const tint = pickColor(Z.corals);
          if (kit && pick < 0.2) add('k_egg', xe, ground(xe, ze, 0.1), -ze, 0.5 + r() * 0.3, kitTint);
          else if (kit && pick < 0.35) add('k_sprig', xe, ground(xe, ze, 0.08), -ze, 0.6 + r() * 0.4, kitTint);
          else if (pick < 0.35) add('sponge', xe, ground(xe, ze, 0.1), -ze, 0.35 + r() * 0.25, tint);
          else if (pick < 0.65) add('brain', xe, ground(xe, ze, 0.1), -ze, 0.35 + r() * 0.3, tint);
          else add('grass', xe, ground(xe, ze, 0.08), -ze, 0.7 + r() * 0.5, pickColor(Z.weeds));
        }
      }
      // Tall seaweed / kelp behind and between the walls.
      const w = Math.max(1, Math.round(4 * density));
      for (let i = 0; i < w; i++) {
        const s = s0 + r() * CHUNK;
        const x = offsetX(s, side, 7, 9);
        const y = ground(x, s, 0.3);
        if (zi === 0 && r() < 0.5) add('kelp', x, y, -s, 0.8 + r() * 0.6, pickColor(Z.weeds));
        else add('weed', x, y, -s, 1.0 + r() * 0.8, pickColor(Z.weeds));
      }
    }
    // Scattered sand details along the open path.
    for (let i = 0; i < Math.round(5 * density); i++) {
      const s = s0 + r() * CHUNK;
      const x = (r() - 0.5) * 6;
      if (this.clearHalf(s) > 0) continue;
      if (r() < 0.5) add('star', x, ground(x, s, 0.03), -s, 0.4 + r() * 0.4, pickColor([0xff7a3d, 0xff5a6e, 0xffb84a]));
      else {
        const ps = 0.2 + r() * 0.3;
        add('pebble', x, ground(x, s, ps * 0.15), -s, ps, pickColor(Z.rocks));
      }
    }

    // Distant reef outcrops in the haze: low, wide mounds of stacked rounded rock with coral on top
    // (no tall columns), kept well away from the path and the camera.
    const outcrops = Math.max(1, Math.round(2 * density));
    for (let i = 0; i < outcrops; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const s = s0 + ((i + 0.3 + r() * 0.4) / outcrops) * CHUNK;
      const x = side * (34 + r() * 22);
      const w = 6 + r() * 5;
      const base = placeRock(x, s, w, 3 + r() * 2.5, w * (0.7 + r() * 0.3));
      // A smaller rock or two piled on top, set back toward the far side.
      const stack = r() < 0.6 ? 2 : 1;
      let top = base;
      for (let k = 0; k < stack; k++) {
        const kx = top.x + side * (0.6 + r() * 1.2);
        const ks = top.s + (r() - 0.5) * 2;
        const hit = this._surfaceOn(rockGeo, top.pos, top.rotY, [top.sx, top.sy, top.sz], kx, -ks);
        if (!hit) break;
        const sx = top.sx * (0.5 + r() * 0.15);
        const sy = top.sy * (0.6 + r() * 0.2);
        const rk = { x: kx, s: ks, sx, sy, sz: sx * 0.9, rotY: r() * 6.283, y: hit.y + sy * 0.15 };
        rk.pos = new THREE.Vector3(kx, rk.y, -ks);
        lists.rock.push({ x: kx, y: rk.y, z: -ks, s: 1, rotY: rk.rotY, tint: pickColor(Z.rocks), scale: [sx, sy, rk.sz] });
        top = rk;
      }
      coralsOn(top, 2, true);
      coralsOn(base, 2, true);
    }

    // Build instanced meshes.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const geoFor = {
      rock: [this.geos.rocks[rockVariant], this.mats.rock],
      pebble: [this.geos.rocks[(rockVariant + 1) % 3], this.mats.rock],
      bush: [this.geos.bush[c & 1], glowZone ? this.mats.coralGlow : this.mats.coral],
      fan: [this.geos.fan[(c >> 1) & 1], glowZone ? this.mats.fanGlow : this.mats.fan],
      tube: [this.geos.tube, glowZone ? this.mats.coralGlow : this.mats.coral],
      brain: [this.geos.brain, glowZone ? this.mats.coralGlow : this.mats.coral],
      sponge: [this.geos.sponge, glowZone ? this.mats.coralGlow : this.mats.coral],
      anemone: [this.geos.anemone, this.mats.anemone],
      weed: [this.geos.weed[c & 1], this.mats.weed],
      kelp: [this.geos.kelp, this.mats.kelp],
      grass: [this.geos.grass, this.mats.grass],
      star: [this.geos.star, this.mats.small],
    };
    if (kit) {
      const kmat = glowZone ? this.mats.kitGlow : this.mats.kit;
      for (const key of ['tube', 'stag', 'egg', 'barrel', 'sprig']) {
        const list = kit.sets[key];
        if (!list || !list.length) continue;
        // One colour variant per type per chunk keeps draw calls low; chunks vary.
        const variant = list[(((c * 7 + key.length * 3) % list.length) + list.length) % list.length];
        geoFor['k_' + key] = [variant, key === 'sprig' && !glowZone ? this.mats.kitSway : kmat];
      }
    }
    const halos = [];
    for (const key of Object.keys(lists)) {
      const items = lists[key];
      if (!items.length) continue;
      const [geo, mat] = geoFor[key];
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((it, i) => {
        v.set(it.x, it.y, it.z);
        q.setFromEuler(e.set(key === 'fan' ? (r() - 0.5) * 0.3 : 0, it.rotY, 0));
        if (it.scale) sc.set(it.scale[0], it.scale[1], it.scale[2]);
        else sc.setScalar(it.s);
        im.setMatrixAt(i, m.compose(v, q, sc));
        _c.set(it.tint ?? 0xffffff);
        im.setColorAt(i, _c);
        if (glowZone && (key === 'bush' || key === 'fan' || key === 'anemone' || key === 'tube' || key === 'k_stag' || key === 'k_tube') && i % 2 === 0) {
          halos.push({ x: it.x, y: it.y + it.s * 1.2, z: it.z, size: 2.6 * it.s, color: it.tint });
        }
      });
      im.computeBoundingSphere();
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      group.add(im);
    }
    if (halos.length) group.add(new GlowPoints(halos, 0.5));

    this.scene.add(group);
    return group;
  }

  /** Ensure chunks around distance s exist; drop the ones far behind. */
  updateChunks(s) {
    const c0 = Math.floor((s - 45) / CHUNK);
    const c1 = Math.floor((s + 115) / CHUNK);
    let built = 0;
    for (let c = c0; c <= c1; c++) {
      if (!this.chunks.has(c)) {
        // Spread chunk building over frames (except when nothing is around yet).
        if (built > 0 && this.chunks.size > 2) break;
        this.chunks.set(c, this._buildChunk(c));
        built++;
      }
    }
    for (const [c, g] of this.chunks) {
      if (c < c0 - 1 || c > c1 + 1) {
        this.scene.remove(g);
        disposeTree(g);
        this.chunks.delete(c);
      }
    }
    if (built) {
      this.emitters = [];
      for (const [, g] of this.chunks) this.emitters.push(...g.userData.emitters);
    }
  }

  reset() {
    for (const [, g] of this.chunks) {
      this.scene.remove(g);
      disposeTree(g);
    }
    this.chunks.clear();
    this.emitters = [];
    this.darkness = this.darkTarget = 0;
    this.murk = this.murkTarget = 0;
    this.clarity = this.clarityTarget = 0;
    this.tintAmount = this.tintTarget = 0;
    this.hazardLight.intensity = 0;
    for (const it of this.rayItems) it.placed = false;
  }

  /** Build everything around s immediately (used after resets). */
  prime(s) {
    const c0 = Math.floor((s - 45) / CHUNK);
    const c1 = Math.floor((s + 115) / CHUNK);
    for (let c = c0; c <= c1; c++) if (!this.chunks.has(c)) this.chunks.set(c, this._buildChunk(c));
    this.emitters = [];
    for (const [, g] of this.chunks) this.emitters.push(...g.userData.emitters);
  }

  setQuality(q) {
    this.quality = q;
    this.scene.remove(this.snow);
    this.snow.geometry.dispose();
    this.snow.material.dispose();
    this._buildSnow();
    const s = this.s;
    this.reset();
    this.prime(s);
  }

  // ---------- Per frame ----------
  update(dt, s, camera) {
    this.time += dt;
    this.s = s;
    this.updateChunks(s);

    this.darkness = lerp(this.darkness, this.darkTarget, damp(1.6, dt));
    this.murk = lerp(this.murk, this.murkTarget, damp(1.2, dt));
    this.clarity = lerp(this.clarity, this.clarityTarget, damp(1.5, dt));
    this.tintAmount = lerp(this.tintAmount, this.tintTarget, damp(3, dt));

    const w = this.zoneWeights(s);
    const P = this.pal;
    const tmp = new THREE.Color();
    const blendColor = (key) => {
      const out = P[key];
      out.setRGB(0, 0, 0);
      for (let i = 0; i < 3; i++) {
        if (w[i] <= 0) continue;
        tmp.set(ZONES[i][key]);
        out.r += tmp.r * w[i];
        out.g += tmp.g * w[i];
        out.b += tmp.b * w[i];
      }
      if (this.murk > 0.001 && MURK[key] !== undefined) out.lerp(tmp.set(MURK[key]), this.murk);
      if (this.darkness > 0 && DARK[key] !== undefined) out.lerp(tmp.set(DARK[key]), this.darkness);
      if (this.tintAmount > 0 && key !== 'snow') out.lerp(tmp.copy(this.tint).multiplyScalar(key === 'bgTop' ? 0.8 : 0.4), this.tintAmount * 0.35);
      return out;
    };
    const blendNum = (key) => {
      let v = w[0] * ZONES[0][key] + w[1] * ZONES[1][key] + w[2] * ZONES[2][key];
      if (this.murk > 0.001 && MURK[key] !== undefined) v = lerp(v, MURK[key], this.murk);
      if (this.darkness > 0 && DARK[key] !== undefined) v = lerp(v, DARK[key], this.darkness);
      return v;
    };

    this.domeU.uTop.value.copy(blendColor('bgTop'));
    this.domeU.uMid.value.copy(blendColor('bgMid'));
    this.domeU.uBottom.value.copy(blendColor('bgBottom'));
    const surface = blendNum('surface');
    this.domeU.uSurface.value = surface;
    this.surfU.uStrength.value = surface;
    this.rayU.uStrength.value = blendNum('rays') * (this.quality.shafts ? 1 : 0.6);
    this.fog.color.copy(blendColor('fog'));
    const clear = 1 + this.clarity * 0.7;
    const murkNear = lerp(blendNum('fogNear') * clear, 3, this.murk * 0.85);
    const murkFar = lerp(blendNum('fogFar') * this.quality.fogScale * clear, 30, this.murk * 0.9);
    this.fog.near = lerp(murkNear, 1.5, this.darkness * 0.8);
    this.fog.far = lerp(murkFar, 24, this.darkness * 0.85);
    this.hemi.color.copy(blendColor('hemiSky'));
    this.hemi.groundColor.copy(blendColor('hemiGround'));
    this.hemi.intensity = blendNum('hemi');
    this.sun.color.copy(blendColor('sunColor'));
    this.sun.intensity = blendNum('sun');
    this.snowU.uColor.value.copy(blendColor('snow'));
    globalUniforms.uRimColor.value.copy(blendColor('rimColor'));
    globalUniforms.uRim.value = blendNum('rim');
    globalUniforms.uCaustic.value = blendNum('caustic') * (this.quality.caustics ? 1 : 0);
    this.pipLightBase = lerp(blendNum('pipLight'), 14, this.darkness);

    if (camera) {
      const cp = camera.position;
      this.dome.position.copy(cp);
      this.snowU.uCam.value.copy(cp);
      this.sun.position.set(cp.x + 6, cp.y + 14, cp.z + 2);
      this.sun.target.position.copy(cp);
      const fy = this.floorY(s);
      this.surface.position.set(cp.x, fy + 28, cp.z);
      this.surfU.uCam.value.copy(cp);
      this._updateRays(cp, fy);
    }
  }

  _updateRays(cp, floorY) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qs = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const top = floorY + 28;
    const len = 30;
    const r = Math.random;
    this.rayItems.forEach((it, i) => {
      if (!it.placed || it.z > cp.z + 12 || it.z < cp.z - 110 || Math.abs(it.x - cp.x) > 45) {
        it.x = cp.x + (r() - 0.5) * 70;
        it.z = cp.z - 10 - r() * 90;
        it.placed = true;
      }
      // Face the camera around the vertical axis, then lean like slanted sunlight.
      const yaw = Math.atan2(cp.x - it.x, cp.z - it.z);
      q.setFromAxisAngle(v.set(0, 1, 0), yaw);
      qs.setFromAxisAngle(v.set(0, 0, 1), it.slant);
      q.multiply(qs);
      sc.set(it.w, len, 1);
      m.compose(v.set(it.x, top, it.z), q, sc);
      this.rays.setMatrixAt(i, m);
    });
    this.rays.instanceMatrix.needsUpdate = true;
  }
}
