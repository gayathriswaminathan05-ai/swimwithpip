import * as THREE from 'three';
import { globalUniforms } from '../gfx/materials.js';
import { damp, lerp } from '../core/util.js';

// A visible ocean current: a broad, gently winding stream of moving water. It is drawn as a soft
// translucent tube with a bright rim and long flowing dashes travelling along it, fading out at
// both ends. Local space: the stream runs along +X (flow direction) through the group's origin.
// `front` (0..1) lets the water visibly rush in along the stream; `boost` makes it bolder.

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime; uniform float uFlow; uniform float uStrength;
uniform float uFront; uniform float uBoost;
uniform vec3 uColor; uniform vec3 uDeep;
varying vec2 vUv; varying vec3 vN; varying vec3 vView;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  // uFront < 1 while the water is still rushing in: only the part behind the front is drawn,
  // with a bright, churning leading edge.
  float behind = 1.0 - smoothstep(uFront - 0.07, uFront, vUv.x);
  float foam = (1.0 - smoothstep(0.0, 0.045, abs(vUv.x - uFront + 0.03))) * (1.0 - step(1.02, uFront));
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float rim = pow(1.0 - facing, 2.2);
  // Long dashes of moving water: lanes around the tube, each with its own drifting dash pattern.
  float lanes = 26.0;
  float lane = floor(vUv.y * lanes);
  float inLane = fract(vUv.y * lanes);
  float laneMask = smoothstep(0.0, 0.3, inLane) * smoothstep(0.75, 0.35, inLane);
  float speed = 0.8 + h21(vec2(lane, 3.1)) * 0.6;
  float along = vUv.x * 9.0 - uTime * uFlow * speed + h21(vec2(lane, 7.7)) * 10.0;
  float dash = smoothstep(0.52 - 0.1 * uBoost, 0.85, vnoise(vec2(along, lane * 1.37)));
  float streak = laneMask * dash;
  // Softer, broader ripples moving through the body of the water.
  float ripple = smoothstep(0.55, 1.0, vnoise(vec2(vUv.x * 5.0 - uTime * uFlow * 0.55, vUv.y * 6.0)));
  float a = (0.05 + rim * 0.22 + ripple * 0.1 + streak * 0.55) * ends * uStrength * behind;
  a += foam * ends * uStrength * (0.35 + 0.4 * vnoise(vec2(vUv.y * 24.0, uTime * 7.0)));
  a = min(a * (1.0 + uBoost), 0.9);
  // Fade out right in front of the camera so a close or inside view never turns into a white wash.
  a *= smoothstep(2.0, 9.0, length(vView));
  vec3 c = mix(uDeep, uColor, clamp(streak + rim * 0.6 + ripple * 0.4 + foam, 0.0, 1.0));
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

export class CurrentBand {
  constructor({ length = 46, width = 3.4, height = 2.4, wiggle = 1.1, flow = 1.6, boost = 0 } = {}) {
    this.group = new THREE.Group();
    this.length = length;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -length / 2 + (i / 8) * length;
      pts.push(new THREE.Vector3(x, Math.sin(i * 0.9) * 0.45, Math.sin(i * 0.7 + 1) * wiggle));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const segs = 90;
    const radial = 28;
    const geo = new THREE.TubeGeometry(this.curve, segs, 1, radial, false);
    // Flatten the round tube into a broad, slightly flattened stream.
    const pos = geo.attributes.position;
    const c = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      this.curve.getPointAt(i / segs, c);
      const taper = 0.75 + 0.25 * Math.sin((i / segs) * Math.PI);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        v.fromBufferAttribute(pos, k).sub(c);
        v.y *= height * taper;
        v.z *= width * taper;
        v.x *= width * taper;
        pos.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
      }
    }
    geo.computeVertexNormals();
    this.u = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uFlow: { value: flow }, uStrength: { value: 0 }, uFront: { value: 2 }, uBoost: { value: boost }, uColor: { value: new THREE.Color(0xeafdff) }, uDeep: { value: new THREE.Color(0x7fd8ea) } },
    ]);
    this.u.uTime = globalUniforms.uTime;
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.strength = 0;
    this.target = 0;
    this.front = 2; // 0..1 while the water rushes in along the stream; 2 = fully there
    this.width = width;
    this.height = height;
    this.group.visible = false;
    this._t = new THREE.Vector3();
  }

  /** A random point inside the stream (local space) and the flow direction there. */
  sample(out, dirOut, u = Math.random() * 0.25) {
    this.curve.getPointAt(u, out);
    this.curve.getTangentAt(u, dirOut);
    out.y += (Math.random() - 0.5) * this.height * 1.2;
    out.z += (Math.random() - 0.5) * this.width * 1.4;
    return out;
  }

  update(dt) {
    this.strength = lerp(this.strength, this.target, damp(2, dt));
    this.group.visible = this.strength > 0.01;
    this.u.uStrength.value = this.strength;
    this.u.uFront.value = this.front;
  }
}
