import * as THREE from 'three';

// Shared uniforms updated once per frame by the game.
export const globalUniforms = {
  uTime: { value: 0 },
  uPointScale: { value: 400 }, // pixels per world unit at distance 1 (set from camera each frame)
  uRimColor: { value: new THREE.Color(0x9ff3ff) }, // soft water-coloured rim light (set per area)
  uRim: { value: 0.35 },
  uCaustic: { value: 1 }, // strength of dappled sunlight on upward-facing surfaces
  uCausticColor: { value: new THREE.Color(0xfff4d6) },
  uCurrentPush: { value: new THREE.Vector2() }, // water current bending swaying plants (x, z)
};

/**
 * Flat-shaded Lambert material with optional:
 *  - per-vertex glow (aGlow attribute → emissive from vertex colour), scaled by `glowUniform`
 *  - swim deformation (body undulation + turning bend) driven by `swim` uniforms
 *  - per-instance swim phase (aPhase instanced attribute)
 *  - sway (vegetation / tentacles hanging below): displacement grows with height
 */
export function litMaterial({
  swim = null,
  sway = null,
  flap = null,
  instancePhase = false,
  glowUniform = null,
  vertexColors = true,
  flat = false,
  rim = true,
  caustics = true,
  ...opts
} = {}) {
  const mat = new THREE.MeshLambertMaterial({ flatShading: flat, vertexColors, ...opts });
  const glow = glowUniform || { value: 1 };
  mat.userData.glow = glow;
  mat.defines = mat.defines || {};
  if (swim) mat.defines.SWIM = '';
  if (sway) mat.defines.SWAY = '';
  if (flap) mat.defines.FLAP = '';
  if (instancePhase) mat.defines.INST_PHASE = '';
  if (rim) mat.defines.RIM = '';
  if (caustics) mat.defines.CAUSTICS = '';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.uniforms.uGlow = glow;
    shader.uniforms.uRimColor = globalUniforms.uRimColor;
    shader.uniforms.uRim = globalUniforms.uRim;
    shader.uniforms.uCaustic = globalUniforms.uCaustic;
    shader.uniforms.uCausticColor = globalUniforms.uCausticColor;
    shader.uniforms.uCurrentPush = globalUniforms.uCurrentPush;
    if (swim) Object.assign(shader.uniforms, swim);
    if (sway) Object.assign(shader.uniforms, sway);
    if (flap) Object.assign(shader.uniforms, flap);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_PARS)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_PARS)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
  };
  mat.customProgramCacheKey = () => 'pip-lit-2';
  return mat;
}

const FRAG_PARS = /* glsl */ `#include <common>
varying float vGlow;
uniform float uGlow;
uniform float uTime;
#ifdef RIM
uniform vec3 uRimColor;
uniform float uRim;
#endif
#ifdef CAUSTICS
uniform float uCaustic;
uniform vec3 uCausticColor;
varying vec3 vCWorld;
float causticPattern(vec2 q, float t) {
  vec2 p = mod(q, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.6);
}
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlow;
#ifdef RIM
{
  float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uRimColor * pow(1.0 - ndv, 3.0) * uRim;
}
#endif
#ifdef CAUSTICS
if (uCaustic > 0.001) {
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  float up = smoothstep(0.1, 0.85, wN.y);
  float c = causticPattern(vCWorld.xz * 0.3, uTime * 0.55);
  totalEmissiveRadiance += diffuseColor.rgb * uCausticColor * c * up * uCaustic;
}
#endif
`;

const VERT_PARS = /* glsl */ `#include <common>
attribute float aGlow;
varying float vGlow;
uniform float uTime;
#ifdef SWIM
uniform float uPhase;
uniform float uAmp;
uniform float uBend;
uniform float uK;
uniform float uHead;
uniform float uLen;
#endif
#ifdef INST_PHASE
attribute float aPhase;
#endif
#ifdef FLAP
uniform float uFlapPhase;
uniform float uFlapAmp;
#endif
#ifdef SWAY
uniform float uSwayAmp;
uniform float uSwayHeight;
uniform float uSwaySpeed;
uniform float uSwayPhase;
uniform vec2 uCurrentPush;
#endif
#ifdef CAUSTICS
varying vec3 vCWorld;
#endif
`;

const VERT_BEGIN = /* glsl */ `#include <begin_vertex>
vGlow = aGlow;
#ifdef SWIM
{
  float sw = clamp((uHead - transformed.z) / uLen, 0.0, 1.0);
  sw *= sw;
  float ph = uPhase;
  #ifdef INST_PHASE
  ph += aPhase;
  #endif
  transformed.x += (uAmp * sin(ph + transformed.z * uK) + uBend) * sw;
}
#endif
#ifdef FLAP
{
  // Wings flap in a wave travelling out from the body (rays) or paddle (flippers).
  float ax = abs(transformed.x);
  transformed.y += sin(uFlapPhase - ax * 1.25) * pow(ax, 1.35) * uFlapAmp;
}
#endif
#ifdef SWAY
{
  float h = clamp(transformed.y / uSwayHeight, 0.0, 1.0);
  vec3 ip = vec3(0.0);
  #ifdef USE_INSTANCING
  ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #endif
  // uSwayPhase lets animated creatures accumulate their own phase (changing speed stays smooth).
  float ph = uTime * uSwaySpeed + uSwayPhase + ip.x * 0.37 + ip.z * 0.23;
  #ifdef INST_PHASE
  ph += aPhase;
  #endif
  transformed.x += sin(ph + transformed.y * 0.45) * h * h * uSwayAmp;
  transformed.z += cos(ph * 0.8 + transformed.y * 0.3) * h * h * uSwayAmp * 0.6;
  // Bend with the water current (stronger flutter while pushed). The push is a world-space
  // direction, so undo each instance's own rotation/scale to make every plant lean the same way.
  float pushLen = length(uCurrentPush);
  vec3 push = vec3(uCurrentPush.x, 0.0, uCurrentPush.y);
  #ifdef USE_INSTANCING
  mat3 im = mat3(instanceMatrix);
  push = transpose(im) * push / max(dot(im[0], im[0]), 1e-4);
  #endif
  transformed += push * h * h;
  transformed.x += sin(ph * 3.0) * 0.25 * pushLen * h * h;
  // A hard push also bows the plant over a little instead of only stretching it.
  transformed.y -= min(dot(push, push), 9.0) * h * h * 0.06;
}
#endif
#ifdef CAUSTICS
{
  vec4 cw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  cw = instanceMatrix * cw;
  #endif
  vCWorld = (modelMatrix * cw).xyz;
}
#endif
`;

export function makeSwimUniforms({ amp = 0.22, k = 2.6, head = 0.3, len = 2.4 } = {}) {
  return {
    uPhase: { value: 0 },
    uAmp: { value: amp },
    uBend: { value: 0 },
    uK: { value: k },
    uHead: { value: head },
    uLen: { value: len },
  };
}

export function makeSwayUniforms({ amp = 0.6, height = 6, speed = 1.1 } = {}) {
  return { uSwayAmp: { value: amp }, uSwayHeight: { value: height }, uSwaySpeed: { value: speed }, uSwayPhase: { value: 0 } };
}

/** Unlit glowing material (bulbs, markers, eyes that shine in the dark). */
export function glowMaterial(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

// ---------- Glow halos (additive point sprites around bioluminescent parts) ----------

const GLOW_VERT = /* glsl */ `
attribute float size;
attribute vec3 aColor;
uniform float uPointScale;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(size * uPointScale / max(0.1, -mvPosition.z), 256.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 2.2) * 0.85 + (1.0 - smoothstep(0.0, 0.22, d)) * 0.6;
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar * 1.15, vFogDepth);
  #endif
  gl_FragColor = vec4(vColor * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}`;

export function glowPointsMaterial(opacity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uOpacity: { value: opacity } }]),
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

/**
 * A set of glowing halos. Positions are local to the returned Points object.
 * items: [{ x, y, z, size, color }]
 */
export class GlowPoints extends THREE.Points {
  constructor(items, opacity = 1) {
    const n = items.length;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const c = new THREE.Color();
    items.forEach((it, i) => {
      pos[i * 3] = it.x;
      pos[i * 3 + 1] = it.y;
      pos[i * 3 + 2] = it.z;
      c.set(it.color ?? 0xffffff);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
      size[i] = it.size ?? 1;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = glowPointsMaterial(opacity);
    mat.uniforms.uPointScale = globalUniforms.uPointScale;
    super(geo, mat);
    this.baseSizes = size.slice();
    this.baseColors = col.slice();
    this.frustumCulled = false;
    this.renderOrder = 5;
  }

  setPoint(i, x, y, z) {
    const p = this.geometry.attributes.position;
    p.setXYZ(i, x, y, z);
    p.needsUpdate = true;
  }

  setSize(i, s) {
    const a = this.geometry.attributes.size;
    a.setX(i, s);
    a.needsUpdate = true;
  }

  setColor(i, color) {
    const a = this.geometry.attributes.aColor;
    const c = color.isColor ? color : new THREE.Color(color);
    a.setXYZ(i, c.r, c.g, c.b);
    a.needsUpdate = true;
  }

  setBrightness(i, k) {
    const a = this.geometry.attributes.aColor;
    a.setXYZ(i, this.baseColors[i * 3] * k, this.baseColors[i * 3 + 1] * k, this.baseColors[i * 3 + 2] * k);
    a.needsUpdate = true;
  }

  set opacity(v) {
    this.material.uniforms.uOpacity.value = v;
  }

  get opacity() {
    return this.material.uniforms.uOpacity.value;
  }
}

/** Disposes geometries and materials under an object (skips resources marked userData.shared). */
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData.shared) continue;
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
  });
}

/** Mark a material / geometry as shared so disposeTree leaves it alone. */
export function shared(resource) {
  resource.userData.shared = true;
  return resource;
}
