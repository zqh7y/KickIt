// Fixed isometric orthographic camera that frames the floor inside the
// screen area left free by the HUD, with smoothing and trauma-based shake.
// On top of that fitted view the player can zoom in (pinch, wheel, double-tap)
// and pan; the zoomed window never leaves the fitted one. In the lobby the
// view turns around the floor (spinBy) and eases back to its angle (unspin).
import * as THREE from 'three';
import { clamp, damp, easeInOutCubic } from './util.ts';

export const CAM_YAW = Math.PI / 4;
export const CAM_PITCH = THREE.MathUtils.degToRad(52);

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZOOM_CAP = 3; // at most 3x the fitted view
const MAX_ZOOMED_SCALE = 180; // CSS px per world unit: no point zooming past this

export class IsoCamera {
  readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  /** CSS pixels per world unit, as currently shown. */
  scale = 80;
  private goalScale = 80;
  private focus = new THREE.Vector3();
  private goalFocus = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private yaw = CAM_YAW;
  private yawTween: { from: number; to: number; t: number; dur: number } | null = null;
  private tween: { t: number; dur: number; focus: THREE.Vector3; scale: number } | null = null;
  /** The fitted view: the point it turns about, the screen centre's offset from it along (right, up), and the scale. */
  private base = { pivot: new THREE.Vector3(), x: 0, y: 0, s: 80 };
  /** The player's zoom on top of it, and the pan away from its centre (plane units). */
  private user = { zoom: 1, x: 0, y: 0 };
  private trauma = 0;
  private shakeT = 0;
  private w = 1;
  private h = 1;

  constructor() {
    this.setBasis(this.yaw);
  }

  private setBasis(yaw: number) {
    this.dir.set(Math.sin(yaw) * Math.cos(CAM_PITCH), Math.sin(CAM_PITCH), Math.cos(yaw) * Math.cos(CAM_PITCH));
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    this.up.crossVectors(this.dir, this.right).normalize();
  }

  /** The point the camera looks at now (world). */
  get lookAt(): THREE.Vector3 {
    return this.focus;
  }

  /** Screen right and screen up, as world directions. */
  get axes(): { right: THREE.Vector3; up: THREE.Vector3 } {
    return { right: this.right, up: this.up };
  }

  /** Unit vector from the scene toward the camera. */
  get viewDir(): THREE.Vector3 {
    return this.dir;
  }

  /** Turn the view around the floor by `d` radians (the lobby turntable). */
  spinBy(d: number) {
    const turn = Math.PI * 2;
    this.yaw = CAM_YAW + ((this.yaw + d - CAM_YAW) % turn);
    this.yawTween = null;
  }

  /** Ease back to the game's own angle, the shortest way round, over `dur` seconds. */
  unspin(dur: number) {
    const turn = Math.PI * 2;
    const to = CAM_YAW + Math.round((this.yaw - CAM_YAW) / turn) * turn;
    this.yawTween = Math.abs(to - this.yaw) < 1e-4 ? null : { from: this.yaw, to, t: 0, dur };
    if (!this.yawTween) this.yaw = CAM_YAW;
  }

  /** Screen-up and screen-right as ground (x, z) directions. */
  groundAxes() {
    const r = new THREE.Vector2(this.right.x, this.right.z).normalize();
    const u = new THREE.Vector2(-this.dir.x, -this.dir.z).normalize();
    return { r, u, foreshorten: Math.sin(CAM_PITCH) };
  }

  /**
   * Frame `points` (world) inside the viewport minus `insets` (CSS px).
   * `zoom` < 1 pulls the camera back (the lobby shows the floor from afar).
   * `glide` > 0 eases to the new framing over that many seconds instead of
   * the default spring.
   */
  frame(points: THREE.Vector3[], w: number, h: number, insets: Insets, instant = false, maxScale = 150, zoom = 1, glide = 0, pivot?: THREE.Vector3) {
    this.w = w;
    this.h = h;
    // fit at the angle the view is settling on
    this.setBasis(this.yawTween ? this.yawTween.to : this.yaw);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const x = p.dot(this.right);
      const y = p.dot(this.up);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const availW = Math.max(50, w - insets.left - insets.right);
    const availH = Math.max(50, h - insets.top - insets.bottom);
    const s = clamp(Math.min(availW / (maxX - minX), availH / (maxY - minY)), 10, maxScale) * zoom;
    // centre of the free area, relative to the screen centre, in world units
    const offX = (insets.left + availW / 2 - w / 2) / s;
    const offY = -(insets.top + availH / 2 - h / 2) / s;
    const P = pivot ? pivot.clone() : this.right.clone().multiplyScalar((minX + maxX) / 2).addScaledVector(this.up, (minY + maxY) / 2);
    this.base = { pivot: P, x: (minX + maxX) / 2 - offX - P.dot(this.right), y: (minY + maxY) / 2 - offY - P.dot(this.up), s };
    this.setBasis(this.yaw);
    this.clampUser();
    this.applyGoal();
    if (instant) {
      this.snap();
    } else if (glide > 0) {
      this.tween = { t: 0, dur: glide, focus: this.focus.clone(), scale: this.scale };
    }
  }

  /** How far the player has zoomed in (1 = the fitted view). */
  get zoom() {
    return this.user.zoom;
  }

  /** The fitted view's scale (px per world unit), before the player's own zoom. */
  get fitScale() {
    return this.base.s;
  }

  /** How far the player may zoom in on this view (1 = not at all: the floor is already big). */
  get maxZoom() {
    return clamp(MAX_ZOOMED_SCALE / this.base.s, 1, ZOOM_CAP);
  }

  /** Zoom by `factor` keeping the screen point (`px`, `py`, CSS px) still. `instant`: no easing. */
  zoomAt(factor: number, px: number, py: number, instant = true) {
    const z0 = this.user.zoom;
    const z1 = clamp(z0 * factor, 1, this.maxZoom);
    if (z1 === z0) return;
    const k = 1 / (this.base.s * z0) - 1 / (this.base.s * z1);
    this.user.x += (px - this.w / 2) * k;
    this.user.y -= (py - this.h / 2) * k;
    this.user.zoom = z1;
    this.clampUser();
    this.applyGoal();
    if (instant) this.snap();
  }

  /** Drag the view by (`dx`, `dy`) CSS px: the scene follows the finger. */
  panBy(dx: number, dy: number) {
    const s = this.base.s * this.user.zoom;
    this.user.x -= dx / s;
    this.user.y += dy / s;
    this.clampUser();
    this.applyGoal();
    this.snap();
  }

  /**
   * Ease in to frame world `points` inside the screen minus `margin` (CSS px),
   * centred on them: at least `minZoom`, at most what the floor allows.
   */
  zoomToFit(points: THREE.Vector3[], margin: Insets, minZoom = 1) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      const x = p.dot(this.right);
      const y = p.dot(this.up);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const availW = Math.max(50, this.w - margin.left - margin.right);
    const availH = Math.max(50, this.h - margin.top - margin.bottom);
    const fit = Math.min(availW / Math.max(1e-3, x1 - x0), availH / Math.max(1e-3, y1 - y0));
    this.user.zoom = clamp(Math.max(minZoom, fit / this.base.s), 1, this.maxZoom);
    const s = this.base.s * this.user.zoom;
    // the middle of the points sits in the middle of the free area
    const cx = (x0 + x1) / 2 - (margin.left + availW / 2 - this.w / 2) / s;
    const cy = (y0 + y1) / 2 + (margin.top + availH / 2 - this.h / 2) / s;
    this.user.x = cx - this.base.pivot.dot(this.right) - this.base.x;
    this.user.y = cy - this.base.pivot.dot(this.up) - this.base.y;
    this.clampUser();
    this.applyGoal();
  }

  /** Ease back to the fitted view. */
  resetZoom() {
    this.user = { zoom: 1, x: 0, y: 0 };
    this.applyGoal();
  }

  /** While zoomed in, pan (eased) so world point `p` stays `margin` CSS px inside the screen edges. */
  keepInView(p: THREE.Vector3, margin: Insets) {
    if (this.user.zoom <= 1) return;
    const s = this.base.s * this.user.zoom;
    const cx = this.base.pivot.dot(this.right) + this.base.x + this.user.x;
    const cy = this.base.pivot.dot(this.up) + this.base.y + this.user.y;
    const shift = (v: number, lo: number, hi: number) => (lo > hi ? v - (lo + hi) / 2 : v < lo ? v - lo : v > hi ? v - hi : 0);
    const dx = shift(p.dot(this.right), cx + (margin.left - this.w / 2) / s, cx + (this.w / 2 - margin.right) / s);
    const dy = shift(p.dot(this.up), cy + (margin.bottom - this.h / 2) / s, cy + (this.h / 2 - margin.top) / s);
    if (!dx && !dy) return;
    this.user.x += dx;
    this.user.y += dy;
    this.clampUser();
    this.applyGoal();
  }

  /** The zoomed window stays inside the fitted one. */
  private clampUser() {
    const u = this.user;
    u.zoom = clamp(u.zoom, 1, this.maxZoom);
    const s0 = this.base.s;
    const s = s0 * u.zoom;
    const mx = Math.max(0, this.w / 2 / s0 - this.w / 2 / s);
    const my = Math.max(0, this.h / 2 / s0 - this.h / 2 / s);
    u.x = clamp(u.x, -mx, mx);
    u.y = clamp(u.y, -my, my);
  }

  private applyGoal() {
    this.goalScale = this.base.s * this.user.zoom;
    this.goalFocus
      .copy(this.base.pivot)
      .addScaledVector(this.right, this.base.x + this.user.x)
      .addScaledVector(this.up, this.base.y + this.user.y);
  }

  /** Show the goal now (a finger is moving the view: no lag). */
  private snap() {
    this.focus.copy(this.goalFocus);
    this.scale = this.goalScale;
    this.tween = null;
  }

  addShake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number) {
    if (this.yawTween) {
      const yt = this.yawTween;
      yt.t += dt;
      const a = clamp(yt.t / yt.dur);
      this.yaw = yt.from + (yt.to - yt.from) * easeInOutCubic(a);
      if (a >= 1) {
        this.yaw = CAM_YAW;
        this.yawTween = null;
      }
    }
    this.setBasis(this.yaw);
    this.applyGoal();
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const a = clamp(tw.t / tw.dur);
      const e = a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
      this.focus.lerpVectors(tw.focus, this.goalFocus, e);
      // ease the zoom in log space so it feels even
      this.scale = Math.exp(Math.log(tw.scale) + (Math.log(this.goalScale) - Math.log(tw.scale)) * e);
      if (a >= 1) this.tween = null;
    } else {
      const k = damp(4.5, dt);
      this.focus.lerp(this.goalFocus, k);
      this.scale += (this.goalScale - this.scale) * k;
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.shakeT += dt;
    const sh = this.trauma * this.trauma * 0.09;
    const ox = sh * Math.sin(this.shakeT * 61.3) * Math.cos(this.shakeT * 17.1);
    const oy = sh * Math.sin(this.shakeT * 53.7 + 1.3);

    const halfW = this.w / 2 / this.scale;
    const halfH = this.h / 2 / this.scale;
    const cam = this.cam;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    const f = this.focus.clone().addScaledVector(this.right, ox).addScaledVector(this.up, oy);
    cam.position.copy(f).addScaledVector(this.dir, 120);
    cam.up.set(0, 1, 0);
    cam.lookAt(f);
    cam.updateMatrixWorld();
  }
}
