// The HUD's kick counter ball: the game's own 3D football (BallView), drawn by
// the main renderer into the HUD slot (#kick-ball) right after the scene, so it
// costs one tiny extra pass and no second WebGL context. It spins and bobs,
// does a little flourish now and then, hops on every kick, wobbles on the last
// one and deflates when none are left. With reduced motion it only deflates.
import * as THREE from 'three';
import { BallView } from './ball.ts';
import type { Skin } from './skins.ts';
import { CAM_PITCH, CAM_YAW } from './camera.ts';
import { BALL_R } from './physics.ts';
import { color, ui } from './theme.ts';
import { makeOutlineUniforms, makeSkyFade, sceneLights } from './toon.ts';
import { damp, easeOutBack, hump } from './util.ts';

const HOP_T = 0.42; // s, one hop
const LAND_T = 0.18; // s, the squash after it
const POP_T = 0.5; // s, popping back in for a new floor
const WOBBLE_T = 0.7; // s, the last-kick wobble
const FLOURISH = [3.8, 6.5]; // s between idle flourishes

export class KickBall {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  private outline = makeOutlineUniforms();
  private ball: BallView;
  private axis = new THREE.Vector3(0.35, 1, -0.25).normalize();
  private right = new THREE.Vector3(Math.cos(CAM_YAW), 0, -Math.sin(CAM_YAW));
  private q = new THREE.Quaternion();
  private t = 0;
  private boost = 0; // extra spin, decays
  private hopT = 9;
  private hopH = 0;
  private popT = 9;
  private wobbleT = 9;
  private shrink = 1;
  private left = 1;
  private nextFlourish = FLOURISH[0];

  constructor(private readonly reduced: boolean) {
    // no sky fade up here: the fade band sits far below the ball
    const fade = makeSkyFade(new THREE.Color(color.paper));
    fade.uFadeTop.value = -1e4;
    fade.uFadeBottom.value = -1e4 - 1;
    this.ball = new BallView(fade, this.outline);
    this.scene.add(this.ball.group, ...sceneLights());
    // the game camera's view, so it shades like the ball on the pitch
    const dir = new THREE.Vector3(Math.sin(CAM_YAW) * Math.cos(CAM_PITCH), Math.sin(CAM_PITCH), Math.cos(CAM_YAW) * Math.cos(CAM_PITCH));
    this.cam.position.copy(dir).multiplyScalar(5);
    this.cam.lookAt(0, 0, 0);
  }

  /** Wear the shop design the player picked. */
  setSkin(skin: Skin) {
    this.ball.setSkin(skin);
  }

  /** A fresh floor: the ball pops back in with a spin. */
  refill(left: number) {
    this.left = left;
    if (this.reduced) return;
    this.popT = 0;
    this.boost = 10;
  }

  /** A kick spent: a hop and a fast spin. */
  spend(left: number) {
    this.left = left;
    if (this.reduced) return;
    this.hopT = 0;
    this.hopH = 0.05;
    this.boost = 16;
    if (left === 1) this.wobbleT = 0;
  }

  /** Advance the animation; true when an idle flourish starts (the HUD twinkles then). */
  update(dt: number): boolean {
    this.t += dt;
    this.hopT += dt;
    this.popT += dt;
    this.wobbleT += dt;
    this.boost *= 1 - damp(2.6, dt);
    let flourish = false;
    if (!this.reduced && this.left > 0) {
      this.nextFlourish -= dt;
      if (this.nextFlourish <= 0) {
        this.nextFlourish = FLOURISH[0] + Math.random() * (FLOURISH[1] - FLOURISH[0]);
        this.boost = 14;
        this.hopT = 0;
        this.hopH = 0.035;
        flourish = true;
      }
    }
    this.ball.tick(this.t);
    const idleSpin = this.reduced ? 0 : this.left > 0 ? 1.2 : 0.25;
    this.q.setFromAxisAngle(this.axis, (idleSpin + this.boost) * dt);
    this.ball.spin.quaternion.premultiply(this.q);

    const g = this.ball.group;
    g.position.set(0, this.reduced ? 0 : Math.sin(this.t * 2.4) * 0.008, 0);
    if (this.hopT < HOP_T) g.position.y += hump(this.hopT / HOP_T) * this.hopH;
    if (this.wobbleT < WOBBLE_T) {
      const k = 1 - this.wobbleT / WOBBLE_T;
      g.position.addScaledVector(this.right, Math.sin(this.wobbleT * 34) * 0.022 * k);
    }
    // pop in, squash on landing, deflate with no kicks left
    this.shrink += ((this.left > 0 ? 1 : 0.8) - this.shrink) * damp(6, dt);
    const pop = this.popT < POP_T ? easeOutBack(this.popT / POP_T) : 1;
    const land = this.hopT - HOP_T;
    const squash = land >= 0 && land < LAND_T ? hump(land / LAND_T) * 0.14 : 0;
    const s = Math.max(0.001, pop * this.shrink);
    g.scale.set(s * (1 + squash), s * (1 - squash), s * (1 + squash));
    return flourish;
  }

  /** Draw into `rect` (CSS px in the viewport) of a `w`×`h` CSS px canvas, over the frame already there. */
  render(renderer: THREE.WebGLRenderer, rect: DOMRect, w: number, h: number) {
    if (rect.width < 1 || rect.bottom <= 0 || rect.top >= h) return;
    const s = (rect.height * ui.kickBallFill) / (2 * BALL_R); // CSS px per world unit
    const c = this.cam;
    c.left = -rect.width / 2 / s;
    c.right = rect.width / 2 / s;
    c.top = rect.height / 2 / s;
    c.bottom = -rect.height / 2 / s;
    c.updateProjectionMatrix();
    this.outline.uOutline.value = ui.kickOutline / s;
    const x = rect.left;
    const y = h - rect.bottom;
    const auto = renderer.autoClear;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, rect.width, rect.height);
    renderer.setViewport(x, y, rect.width, rect.height);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, c);
    renderer.autoClear = auto;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }
}
