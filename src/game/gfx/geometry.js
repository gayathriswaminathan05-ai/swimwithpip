import * as THREE from 'three';
import { hash3, fbm3 } from '../core/util.js';

// Low-poly geometry helpers. Every "painted" geometry is non-indexed and carries
// `position`, `normal`, `color` and `aGlow` attributes so pieces can be merged into a single
// draw call while keeping per-part colours and glow (bioluminescence).

const _c = new THREE.Color();

function strip(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color' && name !== 'aGlow') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Paint the whole geometry one colour (optionally glowing). Returns a new non-indexed geometry. */
export function paint(geo, color, glow = 0) {
  const g = strip(geo);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
    gl[i] = glow;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return g;
}

/**
 * Paint per triangle. fn(centroid: Vector3, index) => { color, glow } | colorValue
 */
export function paintFaces(geo, fn) {
  const g = strip(geo);
  const pos = g.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n);
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    c.set(
      (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3,
      (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3,
      (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3,
    );
    let r = fn(c, i / 3);
    let glow = 0;
    if (r && typeof r === 'object' && 'color' in r) {
      glow = r.glow || 0;
      r = r.color;
    }
    _c.set(r);
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = _c.r;
      col[(i + k) * 3 + 1] = _c.g;
      col[(i + k) * 3 + 2] = _c.b;
      gl[i + k] = glow;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return g;
}

/**
 * Paint per vertex for smooth gradients. fn(position: Vector3, normal: Vector3, index) =>
 * colour | { color, glow }. Works on indexed geometry (normals stay smooth), returns non-indexed.
 */
export function paintVerts(geo, fn) {
  const g = geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n);
  const p = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nor, i);
    let r = fn(p, nn, i);
    let glow = 0;
    if (r && typeof r === 'object' && !r.isColor && 'color' in r) {
      glow = r.glow || 0;
      r = r.color;
    }
    if (r && r.isColor) _c.copy(r);
    else _c.set(r);
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
    gl[i] = glow;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  return strip(g);
}

/** Blend between colours by t (0..1) — helper for gradients. */
export function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));
}

/**
 * Smooth organic blob: a sphere displaced by 3D noise along its normals.
 * flatTop (in unit space) clips the top into a ledge, like a tabletop reef shelf.
 */
export function organicBlob({ seed = 1, w = 24, h = 16, amount = 0.32, freq = 1.6, flatTop = null, flatBottom = -0.45 } = {}) {
  const g = new THREE.SphereGeometry(1, w, h);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm3(v.x * freq + seed * 3.1, v.y * freq + seed * 1.7, v.z * freq - seed * 2.3, 3);
    v.multiplyScalar(1 + (n - 0.5) * 2 * amount);
    if (flatTop !== null && v.y > flatTop) v.y = flatTop + (v.y - flatTop) * 0.12;
    if (flatBottom !== null && v.y < flatBottom) v.y = flatBottom;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Merge painted geometries into one. */
export function merge(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const glow = new Float32Array(total);
  let o = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    glow.set(g.attributes.aGlow.array, o);
    o += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * Displace vertices with a hash of their (quantised) position, so shared corners move together
 * and the surface stays closed. Works on indexed or non-indexed geometry.
 */
export function jitter(geo, amount, seed = 1) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const qx = Math.round(x * 1000);
    const qy = Math.round(y * 1000);
    const qz = Math.round(z * 1000);
    pos.setXYZ(
      i,
      x + (hash3(qx + seed, qy, qz) - 0.5) * amount,
      y + (hash3(qx, qy + seed * 7, qz) - 0.5) * amount,
      z + (hash3(qx, qy, qz + seed * 13) - 0.5) * amount,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Apply a per-vertex function (x, y, z) => [x, y, z]. */
export function warp(geo, fn) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, r[0], r[1], r[2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A lumpy low-poly rock. */
export function rockGeometry(radius = 1, detail = 1, seed = 1, squash = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  g.scale(1, squash, 1);
  return jitter(g, radius * 0.45, seed);
}

/** Flat fin/shape extruded thinly and turned so it lies in the YZ plane (thickness along X). */
export function finGeometry(points, thickness = 0.06, smooth = true) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.length === 4) shape.quadraticCurveTo(p[0], p[1], p[2], p[3]);
    else shape.lineTo(p[0], p[1]);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(
    shape,
    smooth
      ? { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.4, bevelSize: thickness * 0.5, bevelSegments: 1, curveSegments: 8 }
      : { depth: thickness, bevelEnabled: false, curveSegments: 4 },
  );
  g.translate(0, 0, -thickness / 2);
  // Shape u (x) runs backwards along -Z, v (y) stays up, extrusion becomes X thickness.
  g.rotateY(Math.PI / 2);
  return g;
}
