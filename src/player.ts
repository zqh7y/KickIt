// The footballer: a chibi low-poly player built from primitives, faceted
// and ink outlined, with procedural idle / aim / kick / celebrate poses.
// Local +z is forward; feet at y = 0; about one unit tall before scaling.
import * as THREE from 'three';
import { BlobShadow } from './ball.ts';
import { color } from './theme.ts';
import { addOutlines, outlineMaterial, toonMaterial, type OutlineUniforms, type SkyFade } from './toon.ts';
import { angleDelta, clamp, damp, easeInCubic, easeOutCubic, lerp } from './util.ts';

export const PLAYER_SCALE = 0.7;

type Pose = 'idle' | 'aim' | 'kick' | 'celebrate';

function numberTexture(text: string): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.font = `700 92px ${"'Fredoka', 'Trebuchet MS', sans-serif"}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(30,38,25,0.35)';
  g.strokeText(text, 64, 70);
  g.fillStyle = color.paper;
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Footballer {
  readonly root = new THREE.Group(); // feet on the ground, rotates to face
  readonly shadow = new BlobShadow(0.2, 0.28);
  readonly outlineScale = { value: 1 };
  /** Squash & stretch driven by teleport effects: x/z width, y height. */
  readonly stretch = new THREE.Vector2(1, 1);
  lift = 0; // extra height above the ground (jumps, teleports)
  /** Which leg strikes: 1 = the leg on local +x, -1 = the other. */
  kickLeg: 1 | -1 = 1;

  facing = 0;
  private goalFacing = 0;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private pose: Pose = 'idle';
  private poseT = 0;
  private windup = 0;
  private goalWindup = 0;
  private kickFrom = 0;
  private t = 0;
  private blinkAt = 2;
  private numberTex: THREE.Texture;

  constructor(fade: SkyFade, outlineU: OutlineUniforms) {
    const m = (hex: string) => toonMaterial(hex, fade);
    const skin = m(color.skin);
    const shirt = m(color.accent);
    const white = m(color.shorts);
    const ink = m(color.ink);
    const hair = m(color.hair);
    const cheek = m(color.cheek);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, name = '') => {
      const me = new THREE.Mesh(geo, mat);
      me.position.set(x, y, z);
      me.name = name;
      return me;
    };
    const sphere = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);

    this.root.add(this.body);

    // Legs: pivot at the hips.
    for (const [leg, side] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(0.075 * side, 0.3, 0);
      leg.add(mesh(new THREE.CylinderGeometry(0.047, 0.042, 0.17, 8), skin, 0, -0.085, 0));
      leg.add(mesh(new THREE.CylinderGeometry(0.052, 0.049, 0.11, 8), shirt, 0, -0.2, 0));
      const boot = mesh(sphere(1, 10, 7), ink, 0, -0.255, 0.025);
      boot.scale.set(0.066, 0.05, 0.105);
      leg.add(boot);
      this.body.add(leg);
    }

    // Shorts and jersey.
    this.body.add(mesh(new THREE.CylinderGeometry(0.152, 0.17, 0.12, 12), white, 0, 0.32, 0));
    this.body.add(mesh(new THREE.CylinderGeometry(0.148, 0.163, 0.25, 12), shirt, 0, 0.495, 0));
    const shoulders = mesh(sphere(0.149, 12, 6), shirt, 0, 0.615, 0);
    shoulders.scale.set(1, 0.42, 0.96);
    this.body.add(shoulders);
    const collar = mesh(new THREE.TorusGeometry(0.068, 0.018, 6, 14), white, 0, 0.665, 0);
    collar.rotation.x = Math.PI / 2;
    this.body.add(collar);
    // Shirt number on the back (the side you see most).
    this.numberTex = numberTexture('10');
    const back = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1555, 0.1605, 0.17, 8, 1, true, Math.PI - 0.55, 1.1),
      new THREE.MeshBasicMaterial({ map: this.numberTex, transparent: true, depthWrite: false }),
    );
    back.position.y = 0.5;
    back.name = 'number';
    this.body.add(back);

    // Arms: pivot at the shoulders.
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(0.168 * side, 0.6, 0);
      const sleeve = mesh(sphere(0.062, 8, 6), shirt, 0, -0.01, 0);
      sleeve.scale.set(1, 1.15, 1);
      arm.add(sleeve);
      arm.add(mesh(new THREE.CylinderGeometry(0.034, 0.031, 0.15, 6), skin, 0, -0.1, 0));
      arm.add(mesh(sphere(0.043, 8, 6), skin, 0, -0.185, 0));
      arm.rotation.z = 0.22 * side;
      this.body.add(arm);
    }

    // Head.
    this.head.position.set(0, 0.67, 0);
    this.body.add(this.head);
    const H = 0.235;
    const hy = 0.215;
    this.head.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.06, 8), skin, 0, 0.0, 0));
    this.head.add(mesh(sphere(H, 13, 10), skin, 0, hy, 0));
    for (const side of [-1, 1]) {
      const ear = mesh(sphere(0.048, 6, 5), skin, side * (H - 0.008), hy - 0.01, -0.005);
      ear.scale.set(0.55, 1, 0.8);
      this.head.add(ear);
      const eye = mesh(sphere(0.028, 8, 6), ink, side * 0.083, hy + 0.005, H - 0.022, 'face');
      eye.scale.set(0.85, 1.3, 0.55);
      this.eyes.push(eye);
      this.head.add(eye);
      const ch = mesh(sphere(0.034, 8, 6), cheek, side * 0.135, hy - 0.06, H - 0.05, 'face');
      ch.scale.set(1.2, 0.65, 0.4);
      this.head.add(ch);
    }
    const mouth = mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 10, Math.PI), ink, 0, hy - 0.072, H - 0.012, 'face');
    mouth.rotation.set(0, 0, Math.PI);
    this.head.add(mouth);
    // Hair: a cap tipped back to clear the forehead, plus a swept quiff.
    const cap = mesh(new THREE.SphereGeometry(H + 0.02, 13, 9, 0, Math.PI * 2, 0, 1.38), hair, 0, hy, 0);
    cap.rotation.x = -0.42;
    this.head.add(cap);
    const quiff = mesh(sphere(0.1, 8, 6), hair, 0.045, hy + 0.17, 0.12);
    quiff.scale.set(1.55, 0.62, 0.95);
    quiff.rotation.set(0.35, 0, -0.22);
    this.head.add(quiff);
    const sideburnL = mesh(sphere(0.05, 6, 5), hair, -0.2, hy + 0.04, 0.06);
    sideburnL.scale.set(0.5, 1, 0.8);
    this.head.add(sideburnL);
    const sideburnR = sideburnL.clone();
    sideburnR.position.x = 0.2;
    this.head.add(sideburnR);

    addOutlines(this.root, outlineMaterial(outlineU, fade, this.outlineScale), (me) => me.name === 'face' || me.name === 'number');
    this.root.scale.setScalar(PLAYER_SCALE);
  }

  /** Face toward world direction (dx, dz). */
  faceDir(dx: number, dz: number, instant = false) {
    if (Math.hypot(dx, dz) < 1e-6) return;
    this.goalFacing = Math.atan2(dx, dz);
    if (instant) this.facing = this.goalFacing;
  }

  setPose(p: Pose) {
    if (p === 'kick') this.kickFrom = this.windup;
    this.pose = p;
    this.poseT = 0;
  }

  get currentPose() {
    return this.pose;
  }

  /** Wind-up amount while aiming (0..1). */
  setWindup(w: number) {
    this.goalWindup = clamp(w);
  }

  update(dt: number) {
    this.t += dt;
    this.poseT += dt;
    this.facing += angleDelta(this.facing, this.goalFacing) * damp(14, dt);
    this.root.rotation.y = this.facing;
    this.windup += (this.goalWindup - this.windup) * damp(18, dt);

    const t = this.t;
    let legL = 0;
    let legR = 0;
    let strike: number | null = null;
    let armLx = 0;
    let armRx = 0;
    let armLz = -0.22;
    let armRz = 0.22;
    let lean = 0;
    let bob = Math.sin(t * 3.2) * 0.012;
    let hop = 0;
    let headTilt = Math.sin(t * 1.3) * 0.05;

    switch (this.pose) {
      case 'idle':
        armLz -= Math.sin(t * 3.2) * 0.04;
        armRz += Math.sin(t * 3.2) * 0.04;
        break;
      case 'aim': {
        const w = this.windup;
        strike = 0.95 * w;
        lean = -0.14 * w;
        armLx = -0.7 * w;
        armLz = -0.22 - 0.35 * w;
        armRx = 0.45 * w;
        armRz = 0.22 + 0.25 * w;
        bob *= 1 - w;
        headTilt *= 1 - w;
        break;
      }
      case 'kick': {
        // fast swing through the ball, then follow through
        const k = this.poseT;
        const swing = easeInCubic(k / 0.075);
        const follow = easeOutCubic((k - 0.075) / 0.2);
        const w = this.kickFrom;
        strike = k < 0.075 ? lerp(0.95 * w, -1.05, swing) : lerp(-1.05, -1.25, follow);
        lean = k < 0.075 ? lerp(-0.14 * w, 0.12, swing) : 0.12;
        armLx = -0.7;
        armLz = -0.65;
        armRx = 0.6;
        armRz = 0.5;
        bob = 0;
        break;
      }
      case 'celebrate': {
        const k = this.poseT;
        const jump = Math.abs(Math.sin(k * 6.2)) * Math.exp(-k * 0.9);
        hop = jump * 0.42;
        armLz = -2.5 - Math.sin(k * 12) * 0.25;
        armRz = 2.5 + Math.sin(k * 12 + 1) * 0.25;
        legL = -0.3 * jump;
        legR = 0.3 * jump;
        headTilt = Math.sin(k * 10) * 0.12;
        break;
      }
    }

    if (strike !== null) {
      if (this.kickLeg === 1) legR = strike;
      else legL = strike;
    }
    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.armL.rotation.set(armLx, 0, armLz);
    this.armR.rotation.set(armRx, 0, armRz);
    this.body.rotation.x = lean;
    this.body.position.y = bob + hop;
    this.head.rotation.z = headTilt;

    // Blink now and then.
    if (t > this.blinkAt) {
      const b = t - this.blinkAt;
      const s = b < 0.12 ? 0.15 : 1;
      for (const e of this.eyes) e.scale.y = 1.3 * s;
      if (b > 0.12) this.blinkAt = t + 2 + Math.random() * 3;
    }

    this.root.scale.set(PLAYER_SCALE * this.stretch.x, PLAYER_SCALE * this.stretch.y, PLAYER_SCALE * this.stretch.x);
    this.outlineScale.value = Math.min(1, this.stretch.x * 1.2);
  }

  dispose() {
    this.numberTex.dispose();
  }
}
