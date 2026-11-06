// Aim guide: a dotted line from the ball along the kick direction, lying on
// the terrain, growing and warming with power, capped with an arrowhead.
import * as THREE from 'three';
import { type Floor, heightAt } from './levels.ts';
import { BALL_R } from './physics.ts';
import { color } from './theme.ts';

const MAX_DOTS = 24;

export class AimView {
  readonly group = new THREE.Group();
  private dots: THREE.InstancedMesh;
  private rims: THREE.InstancedMesh;
  private head: THREE.Mesh;
  private headRim: THREE.Mesh;
  private headMat: THREE.MeshBasicMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private c = new THREE.Color();
  private white = new THREE.Color(color.paper);
  private gold = new THREE.Color(color.gold);
  private hotC = new THREE.Color(color.accent);
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private dotC = new THREE.Color();
  /** World point at the tip of the guide (for the power label). */
  readonly tip = new THREE.Vector3();

  constructor() {
    const disc = new THREE.CircleGeometry(1, 14);
    this.rims = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: color.ink, depthWrite: false }), MAX_DOTS);
    this.dots = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false }), MAX_DOTS);
    this.dots.setColorAt(0, this.white);
    this.rims.renderOrder = 5;
    this.dots.renderOrder = 6;
    for (const im of [this.rims, this.dots]) {
      im.frustumCulled = false;
      im.count = 0;
    }
    const tri = new THREE.Shape();
    tri.moveTo(0, 1);
    tri.lineTo(0.8, -0.55);
    tri.lineTo(0, -0.25);
    tri.lineTo(-0.8, -0.55);
    tri.closePath();
    const headGeo = new THREE.ShapeGeometry(tri);
    headGeo.rotateX(-Math.PI / 2); // lie flat, pointing -z
    headGeo.rotateY(Math.PI); // point +z
    this.headMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false });
    this.head = new THREE.Mesh(headGeo, this.headMat);
    this.headRim = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ color: color.ink, depthWrite: false }));
    this.head.renderOrder = 6;
    this.headRim.renderOrder = 5;
    // depthTest off: the guide reads over walls and pillars it crosses
    for (const o of [this.rims, this.dots, this.head, this.headRim]) {
      const m = o.material as THREE.Material;
      m.depthTest = false;
      m.transparent = true; // drawn after the opaque ball and the target's decals
    }
    this.group.add(this.rims, this.dots, this.headRim, this.head);
    this.group.visible = false;
  }

  hide() {
    this.group.visible = false;
  }

  show(floor: Floor, bx: number, by: number, bz: number, dx: number, dz: number, power: number) {
    this.group.visible = true;
    const len = 0.5 + power * 2.6;
    const start = BALL_R + 0.2;
    const step = 0.15;
    const n = Math.min(MAX_DOTS, Math.max(1, Math.floor((len - start) / step)));
    const tint = this.c;
    if (power < 0.5) tint.copy(this.white).lerp(this.gold, power / 0.5);
    else tint.copy(this.gold).lerp(this.hotC, (power - 0.5) / 0.5);
    let lastY = by;
    for (let k = 0; k < n; k++) {
      const d = start + k * step;
      const x = bx + dx * d;
      const z = bz + dz * d;
      const h = heightAt(floor, x, z);
      const y = (Number.isFinite(h) ? h : by) + 0.02;
      lastY = y;
      const s = 0.03 + (k / Math.max(1, n - 1)) * 0.014;
      this.m.compose(this.v.set(x, y, z), this.q, this.sc.setScalar(s));
      this.dots.setMatrixAt(k, this.m);
      this.m.compose(this.v.set(x, y - 0.001, z), this.q, this.sc.setScalar(s * 1.55));
      this.rims.setMatrixAt(k, this.m);
      this.dotC.copy(this.white).lerp(tint, Math.min(1, (k + 1) / n + 0.25));
      this.dots.setColorAt(k, this.dotC);
    }
    this.dots.count = this.rims.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    const hd = start + n * step + 0.02;
    const hx = bx + dx * hd;
    const hz = bz + dz * hd;
    const hh = heightAt(floor, hx, hz);
    const hy = (Number.isFinite(hh) ? hh : lastY - 0.02) + 0.021;
    const ang = Math.atan2(dx, dz);
    const size = 0.085 + power * 0.03;
    this.head.position.set(hx, hy, hz);
    this.head.rotation.set(0, ang, 0);
    this.head.scale.setScalar(size);
    this.headRim.position.set(hx, hy - 0.001, hz);
    this.headRim.rotation.set(0, ang, 0);
    this.headRim.scale.setScalar(size * 1.45);
    this.headMat.color.copy(tint);
    this.tip.set(hx, hy, hz);
  }
}
