// The shop's balls in 3D: every design as a real ball (the game's own BallView),
// drawn by the main renderer over the frame in one extra pass, like the HUD's
// kick ball. Each one stands on its grid cell, seen from the game's own angle,
// with a soft shadow on the ground under it. Unlocked balls turn and bob, the
// one you play with rolls, a picked one hops; a locked ball is its own shadow.
import * as THREE from 'three';
import { BallView, BlobShadow } from './ball.ts';
import { CAM_PITCH, CAM_YAW } from './camera.ts';
import { BALL_R } from './physics.ts';
import { SKINS } from './skins.ts';
import { color, ui } from './theme.ts';
import { makeOutlineUniforms, makeSkyFade, sceneLights } from './toon.ts';
import { damp, hump } from './util.ts';

const HOP_T = 0.45; // s, the hop of a ball just picked
const HOP_H = 0.12; // world units
const BOB_H = 0.035; // world units, the idle bob
const LOCKED = 0.07; // a locked ball's light (linear): little more than its shadow
const Y = new THREE.Vector3(0, 1, 0);

interface Item {
  ball: BallView;
  shadow: BlobShadow;
  axis: THREE.Vector3;
  phase: number;
  hopT: number;
  boost: number;
  locked: boolean;
  selected: boolean;
}

export class ShopBalls {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  private outline = makeOutlineUniforms();
  private items: Item[] = [];
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private t = 0;

  constructor(private readonly reduced: boolean) {
    // no sky fade here: the fade band sits far below
    const fade = makeSkyFade(new THREE.Color(color.paper));
    fade.uFadeTop.value = -1e4;
    fade.uFadeBottom.value = -1e4 - 1;
    this.scene.add(...sceneLights());
    // the game camera's view, so the balls shade (and their shadows lie) as on the pitch
    const dir = new THREE.Vector3(Math.sin(CAM_YAW) * Math.cos(CAM_PITCH), Math.sin(CAM_PITCH), Math.cos(CAM_YAW) * Math.cos(CAM_PITCH));
    this.cam.position.copy(dir).multiplyScalar(10);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.cam.matrixWorld, 1);
    SKINS.forEach((skin, i) => {
      const ball = new BallView(fade, this.outline);
      ball.setSkin(skin);
      const shadow = new BlobShadow(BALL_R * 1.05, 0.45);
      this.scene.add(ball.group, shadow.mesh);
      const axis = new THREE.Vector3(Math.sin(i * 2.1) * 0.6, 1, Math.cos(i * 1.7) * 0.6).normalize();
      this.items.push({ ball, shadow, axis, phase: i * 0.83, hopT: 9, boost: 0, locked: false, selected: false });
    });
  }

  /** Which balls are locked (shown as their shadow) and which one is played with, in the order of SKINS. */
  setState(cells: { unlocked: boolean; selected: boolean }[]) {
    cells.forEach((c, i) => {
      const it = this.items[i];
      if (!it) return;
      it.locked = !c.unlocked;
      it.selected = c.selected;
      it.ball.setLight(it.locked ? LOCKED : 1);
    });
  }

  /** The ball at `index` was just picked: a hop and a fast spin. */
  hop(index: number) {
    const it = this.items[index];
    if (!it || this.reduced) return;
    it.hopT = 0;
    it.boost = 14;
  }

  update(dt: number) {
    this.t += dt;
    for (const it of this.items) {
      it.hopT += dt;
      it.boost *= 1 - damp(2.6, dt);
      if (this.reduced || it.locked) continue;
      this.q.setFromAxisAngle(it.axis, ((it.selected ? 2.2 : 0.6) + it.boost) * dt);
      it.ball.spin.quaternion.premultiply(this.q);
    }
  }

  /**
   * Draw every ball over its cell. `rects`: each cell's ball box (CSS px, in
   * the order of SKINS); `box`: that box's size at rest; the canvas is `w`×`h` CSS px.
   */
  render(renderer: THREE.WebGLRenderer, rects: DOMRect[], box: number, w: number, h: number) {
    if (!rects.length || box < 1) return;
    const s = (box * ui.shopBallFill) / (2 * BALL_R); // CSS px per world unit
    const c = this.cam;
    c.left = -w / 2 / s;
    c.right = w / 2 / s;
    c.top = h / 2 / s;
    c.bottom = -h / 2 / s;
    c.updateProjectionMatrix();
    this.outline.uOutline.value = ui.kickOutline / s;
    const rise = Math.cos(CAM_PITCH); // how much of a lift shows on the screen
    this.items.forEach((it, i) => {
      const r = rects[i];
      const g = it.ball.group;
      const show = !!r && r.width >= 1;
      g.visible = show;
      it.shadow.mesh.visible = show;
      if (!r || !show) return;
      const k = r.width / box; // the cell's own scale (its entrance, its shake)
      const radius = BALL_R * k;
      // the ball at rest sits in the box's middle, a little high, its shadow below it
      const sx = r.left + r.width / 2 - w / 2;
      const sy = h / 2 - (r.top + r.height / 2) + radius * rise * s * 0.45;
      this.p.copy(this.right).multiplyScalar(sx / s).addScaledVector(this.up, sy / s);
      const lift = (it.locked || this.reduced ? 0 : (Math.sin(this.t * 2.2 + it.phase) * 0.5 + 0.5) * BOB_H) + (it.hopT < HOP_T ? hump(it.hopT / HOP_T) * HOP_H : 0);
      g.scale.setScalar(k);
      g.position.copy(this.p).addScaledVector(Y, lift * k);
      it.shadow.set(this.p.x, this.p.y - radius, this.p.z, lift * k);
    });
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, c);
    renderer.autoClear = auto;
  }
}
