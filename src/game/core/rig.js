import * as THREE from 'three';
import { clamp, damp, lerp, angleLerp, smoothstep } from './util.js';

// Camera rig built around "shots": a focus point, a viewing direction (yaw / pitch) and a
// framing radius that must stay visible. Distance is derived from the radius and the *free*
// part of the screen (the area not covered by the quiz panel / HUD), and the projection is
// shifted with setViewOffset so the focus sits in the middle of that free area. This keeps the
// fish and the danger visible above the question panel on a narrow portrait phone.

const _v = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.W = 1;
    this.H = 1;
    this.focus = new THREE.Vector3();
    this.yaw = 0.5;
    this.pitch = 0.2;
    this.radius = 3;
    this.shot = {
      target: null,
      offset: new THREE.Vector3(),
      yaw: 0.5,
      pitch: 0.2,
      radius: 3,
      rate: 2.4,
      rotRate: 1.6,
    };
    // Free region in normalised screen units (0..1).
    this.free = { x: 0, y: 0, w: 1, h: 1 };
    this.freeCur = { x: 0, y: 0, w: 1, h: 1 };
    this.shakeAmt = 0;
    this.reducedMotion = false;
    this.time = 0;
    this.extraRoll = 0;
  }

  setSize(w, h) {
    this.W = Math.max(1, w);
    this.H = Math.max(1, h);
    this.camera.aspect = this.W / this.H;
  }

  /**
   * shot: { target: Vector3 | Object3D | () => Vector3, offset?, yaw?, pitch?, radius?, rate?, rotRate? }
   * Missing fields keep their previous value.
   */
  setShot(shot, immediate = false) {
    const s = this.shot;
    if (shot.target !== undefined) s.target = shot.target;
    if (shot.offset) s.offset.copy(shot.offset);
    else if (shot.target !== undefined) s.offset.set(0, 0, 0);
    if (shot.yaw !== undefined) s.yaw = shot.yaw;
    if (shot.pitch !== undefined) s.pitch = shot.pitch;
    if (shot.radius !== undefined) s.radius = shot.radius;
    s.rate = shot.rate ?? 2.4;
    s.rotRate = shot.rotRate ?? 1.6;
    if (immediate) this.snap();
  }

  snap() {
    this._resolveTarget(this.focus);
    this.yaw = this.shot.yaw;
    this.pitch = this.shot.pitch;
    this.radius = this.shot.radius;
    Object.assign(this.freeCur, this.free);
    this._apply();
  }

  /** Free region given in CSS pixels relative to the canvas; null = whole screen. */
  setFreeRegion(rect) {
    if (!rect) {
      this.free = { x: 0, y: 0, w: 1, h: 1 };
      return;
    }
    const x = clamp(rect.x / this.W, 0, 1);
    const y = clamp(rect.y / this.H, 0, 1);
    const w = clamp(rect.w / this.W, 0.25, 1 - x);
    const h = clamp(rect.h / this.H, 0.25, 1 - y);
    this.free = { x, y, w, h };
  }

  shake(amount) {
    if (this.reducedMotion) return;
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  _resolveTarget(out) {
    const t = this.shot.target;
    if (!t) out.set(0, 0, 0);
    else if (typeof t === 'function') out.copy(t());
    else if (t.isObject3D) t.getWorldPosition(out);
    else out.copy(t);
    out.add(this.shot.offset);
    return out;
  }

  update(dt) {
    this.time += dt;
    const s = this.shot;
    // Reduced motion: calmer, slower camera moves.
    const rm = this.reducedMotion ? 0.55 : 1;
    this._resolveTarget(_v);
    this.focus.lerp(_v, damp(s.rate * rm, dt));
    const kr = damp(s.rotRate * rm, dt);
    this.yaw = angleLerp(this.yaw, s.yaw, kr);
    this.pitch = lerp(this.pitch, s.pitch, kr);
    this.radius = lerp(this.radius, s.radius, kr);
    const kf = damp(5, dt);
    for (const key of ['x', 'y', 'w', 'h']) this.freeCur[key] = lerp(this.freeCur[key], this.free[key], kf);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.8);
    this._apply();
  }

  _apply() {
    const cam = this.camera;
    const aspect = this.W / this.H;
    // Wider vertical FOV in portrait so the horizontal view does not get too narrow.
    const vfov = lerp(64, 48, smoothstep(0.6, 1.7, aspect));
    cam.fov = vfov;
    const tanV = Math.tan(THREE.MathUtils.degToRad(vfov) / 2);
    const tanH = tanV * aspect;
    const f = this.freeCur;
    const half = Math.atan(Math.min(tanV * f.h, tanH * f.w));
    const dist = this.radius / Math.sin(half);

    const cp = Math.cos(this.pitch);
    cam.position.set(
      this.focus.x + Math.sin(this.yaw) * cp * dist,
      this.focus.y + Math.sin(this.pitch) * dist,
      this.focus.z + Math.cos(this.yaw) * cp * dist,
    );
    if (this.shakeAmt > 0.001) {
      const a = this.shakeAmt * this.shakeAmt * 0.35;
      const t = this.time * 31;
      cam.position.x += (Math.sin(t * 1.3) + Math.sin(t * 2.7)) * a;
      cam.position.y += (Math.sin(t * 1.7 + 1) + Math.sin(t * 3.1)) * a;
    }
    cam.up.set(Math.sin(this.extraRoll), Math.cos(this.extraRoll), 0);
    cam.lookAt(this.focus);

    // Shift the projection so the focus lands in the centre of the free region.
    const cx = (f.x + f.w / 2) * this.W;
    const cy = (f.y + f.h / 2) * this.H;
    cam.setViewOffset(this.W, this.H, this.W / 2 - cx, this.H / 2 - cy, this.W, this.H);
    cam.updateProjectionMatrix();
  }
}
