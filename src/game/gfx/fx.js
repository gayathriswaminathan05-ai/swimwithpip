import * as THREE from 'three';
import { globalUniforms } from './materials.js';

// Lightweight CPU particle pools rendered as a single Points draw call each.
// styles: 'bubble' (ring sprites), 'dust' (soft opaque puffs), 'spark' (additive glow)

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uPointScale;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uPointScale / max(0.2, -mvPosition.z), 200.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = {
  bubble: /* glsl */ `
    varying float vAlpha; varying vec3 vColor;
    #include <fog_pars_fragment>
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float rim = smoothstep(0.6, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
      float shine = 1.0 - smoothstep(0.0, 0.22, length(c - vec2(-0.17, 0.17)) * 2.0);
      float a = (rim * 0.8 + shine * 0.9 + 0.06) * vAlpha;
      #ifdef USE_FOG
        a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor = vec4(vColor, a);
      #include <colorspace_fragment>
    }`,
  dust: /* glsl */ `
    varying float vAlpha; varying vec3 vColor;
    #include <fog_pars_fragment>
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha;
      gl_FragColor = vec4(vColor, a);
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  spark: /* glsl */ `
    varying float vAlpha; varying vec3 vColor;
    #include <fog_pars_fragment>
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float a = pow(1.0 - d, 2.0) * vAlpha;
      gl_FragColor = vec4(vColor * a, 1.0);
      #include <colorspace_fragment>
    }`,
};

export class ParticlePool extends THREE.Points {
  constructor(n, style = 'bubble') {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: VERT,
      fragmentShader: FRAG[style],
      transparent: true,
      depthWrite: false,
      blending: style === 'spark' ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    mat.uniforms.uPointScale = globalUniforms.uPointScale;
    super(geo, mat);
    this.n = n;
    this.style = style;
    this.frustumCulled = false;
    this.renderOrder = style === 'dust' ? 6 : 7;
    this.p = [];
    for (let i = 0; i < n; i++) {
      this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, grow: 0, gravity: 0, drag: 1, wob: 0, color: new THREE.Color(), alpha: 1 });
    }
    this.cursor = 0;
    this.active = 0;
  }

  /**
   * Emit particles. opts: { count, spread, speed, dir (Vector3), up, life, size, grow, color, gravity, drag, alpha }
   */
  emit(pos, opts = {}) {
    const count = opts.count ?? 6;
    for (let k = 0; k < count; k++) {
      const p = this.p[this.cursor];
      this.cursor = (this.cursor + 1) % this.n;
      const spread = opts.spread ?? 0.3;
      p.x = pos.x + (Math.random() - 0.5) * spread;
      p.y = pos.y + (Math.random() - 0.5) * spread;
      p.z = pos.z + (Math.random() - 0.5) * spread;
      const sp = opts.speed ?? 1;
      const dir = opts.dir;
      p.vx = (dir ? dir.x : 0) * sp + (Math.random() - 0.5) * sp;
      p.vy = (dir ? dir.y : 0) * sp + (Math.random() - 0.5) * sp + (opts.up ?? 0);
      p.vz = (dir ? dir.z : 0) * sp + (Math.random() - 0.5) * sp;
      p.max = (opts.life ?? 2) * (0.7 + Math.random() * 0.6);
      p.life = p.max;
      p.size = (opts.size ?? 0.15) * (0.6 + Math.random() * 0.8);
      p.grow = opts.grow ?? 0;
      p.gravity = opts.gravity ?? 0;
      p.drag = opts.drag ?? 0.6;
      p.wob = Math.random() * 6.28;
      p.alpha = opts.alpha ?? 1;
      p.color.set(opts.color ?? 0xdff8ff);
    }
  }

  update(dt) {
    const pos = this.geometry.attributes.position;
    const size = this.geometry.attributes.aSize;
    const alpha = this.geometry.attributes.aAlpha;
    const col = this.geometry.attributes.aColor;
    let active = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (p.life <= 0) {
        if (alpha.array[i] !== 0) alpha.array[i] = 0;
        continue;
      }
      active++;
      p.life -= dt;
      p.vy += p.gravity * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.vz *= dr;
      p.wob += dt * 6;
      const wob = this.style === 'bubble' ? Math.sin(p.wob) * 0.35 : 0;
      p.x += (p.vx + wob) * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      const k = Math.max(0, p.life / p.max);
      pos.setXYZ(i, p.x, p.y, p.z);
      size.array[i] = p.size;
      alpha.array[i] = p.alpha * Math.min(1, k * 3) * (this.style === 'dust' ? k : 1);
      col.setXYZ(i, p.color.r, p.color.g, p.color.b);
    }
    this.active = active;
    pos.needsUpdate = true;
    size.needsUpdate = true;
    alpha.needsUpdate = true;
    col.needsUpdate = true;
  }

  clear() {
    for (const p of this.p) p.life = 0;
    this.geometry.attributes.aAlpha.array.fill(0);
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

/** Bundle of the game's particle pools. */
export class FX {
  constructor(scene, quality) {
    const mul = quality.particles;
    this.bubbles = new ParticlePool(Math.round(140 * mul), 'bubble');
    this.dust = new ParticlePool(Math.round(240 * mul), 'dust');
    this.sparks = new ParticlePool(Math.round(140 * mul), 'spark');
    scene.add(this.bubbles, this.dust, this.sparks);
    this._v = new THREE.Vector3();
  }

  bubbleBurst(pos, count = 8, opts = {}) {
    this.bubbles.emit(pos, { count, spread: 0.4, speed: 0.8, up: 2.2, life: 2.4, size: 0.14, gravity: 0.6, drag: 0.8, color: 0xe8fbff, ...opts });
  }

  dustPuff(pos, count = 16, opts = {}) {
    this.dust.emit(pos, { count, spread: 1.2, speed: 3, up: 0.6, life: 2.2, size: 1.1, grow: 1.4, gravity: -0.2, drag: 1.6, color: 0x8f8a7c, alpha: 0.55, ...opts });
  }

  sparkBurst(pos, count = 14, opts = {}) {
    this.sparks.emit(pos, { count, spread: 0.4, speed: 4, life: 0.7, size: 0.35, drag: 3, color: 0xbfe9ff, ...opts });
  }

  update(dt) {
    this.bubbles.update(dt);
    this.dust.update(dt);
    this.sparks.update(dt);
  }

  clear() {
    this.bubbles.clear();
    this.dust.clear();
    this.sparks.clear();
  }
}
