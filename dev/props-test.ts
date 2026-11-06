// Every map prop and the goal on a small grass floor, rendered like the game.
// Query: ?scale=60 (CSS px per tile) &focus=x,z&r=1.2 (frame a spot)
//        &solo=<name> (one prop, close up: fence trampoline magnet repel boost
//                      bumper portal portalB conveyor bridge target)
//        &t=1.3 (seconds simulated) &hit=1.0 (call hit() then) &hot=0..1
//        &decor=0 (target still render) &pop=0.2 (all props mid pop-in scale)
//        &live=1 (keep animating)
import * as THREE from 'three';
import { floorFromDef } from '../src/levels.ts';
import { FloorView, makeLineUniforms } from '../src/floor.ts';
import { IsoCamera } from '../src/camera.ts';
import { BallView } from '../src/ball.ts';
import { Footballer } from '../src/player.ts';
import { TargetView } from '../src/target.ts';
import { makeSkyFade, makeOutlineUniforms } from '../src/toon.ts';
import { BALL_R } from '../src/physics.ts';
import { color, outlinePx } from '../src/theme.ts';
import { clamp } from '../src/util.ts';
import {
  makeBoost,
  makeBridge,
  makeBumper,
  makeConveyor,
  makeFence,
  makeMagnet,
  makePortal,
  makeTrampoline,
  type Prop,
  type PropContext,
} from '../src/props.ts';

const q = new URLSearchParams(location.search);
const T = Number(q.get('t') ?? 1.3);
const hitAt = q.has('hit') ? Number(q.get('hit')) : -1;
const hot = Number(q.get('hot') ?? 0);
const live = q.get('live') === '1';
const solo = q.get('solo');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
const dpr = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(dpr);
const w = innerWidth;
const h = innerHeight;
renderer.setSize(w, h, false);

// x across, rows along +z. The full layout has a gap at (1, 2) for the bridge;
// solo mode uses a 3 × 3 floor (gap in the middle for the bridge).
const floor = floorFromDef(
  {
    name: 'props',
    kicks: 1,
    time: 1,
    map: solo
      ? solo === 'bridge'
        ? ['0 0 0', '0 . 0', '0 0 0']
        : ['0 0 0', '0 0 0', '0 0 0']
      : ['0 0 0 0', '0 0 0 0', '0 . 0 0', '0 0 0 0', '0 0 0 0', '0 0 0 0'],
    start: solo ? [2.3, 2.3] : [2.5, 4.6],
    target: solo ? [1.5, 1.5] : [0.5, 0.5],
    radius: 0.38,
    seed: 4,
  },
  0,
);
const sky = new THREE.Color(floor.sky);
const scene = new THREE.Scene();
scene.background = sky;
scene.add(new THREE.HemisphereLight(0xffffff, 0x9cc864, 1.85));
const sun = new THREE.DirectionalLight(0xffffff, 1.55);
sun.position.set(-2, 5, 3);
scene.add(sun);
const lineU = makeLineUniforms();
lineU.uResolution.value.set(w * dpr, h * dpr);
const view = new FloorView(floor, sky, lineU, 1024, renderer.capabilities.getMaxAnisotropy());
scene.add(view.group);
const fade = makeSkyFade(sky);
fade.uFadeTop.value = floor.minTop - 0.35;
fade.uFadeBottom.value = floor.minTop - 3.9;
const outU = makeOutlineUniforms();
const ctx: PropContext = { fade, outline: outU };

const props: Prop[] = [];
const place = (p: Prop, x: number, z: number, yaw = 0) => {
  p.root.position.set(x, 0, z); // the test floor is flat at level 0 (heightAt is -Infinity over the gap)
  p.root.rotation.y = yaw;
  scene.add(p.root);
  props.push(p);
  return p;
};
const make: Record<string, () => Prop> = {
  fence: () => makeFence(ctx, 1),
  trampoline: () => makeTrampoline(ctx),
  magnet: () => makeMagnet(ctx, 0.85, false),
  repel: () => makeMagnet(ctx, 0.85, true),
  boost: () => makeBoost(ctx),
  bumper: () => makeBumper(ctx),
  portal: () => makePortal(ctx, color.portalA),
  portalB: () => makePortal(ctx, color.portalB),
  conveyor: () => makeConveyor(ctx),
  bridge: () => makeBridge(ctx),
};
if (solo) {
  if (solo === 'fence') place(make.fence(), 1, 1.5);
  else if (make[solo]) place(make[solo](), 1.5, 1.5);
} else {
  place(makeTrampoline(ctx), 1.5, 0.5);
  place(makeBumper(ctx), 2.5, 0.5);
  place(makeMagnet(ctx, 0.85, false), 3.5, 0.5);
  place(makePortal(ctx, color.portalA), 0.5, 1.5);
  place(makeBoost(ctx), 1.5, 1.5);
  place(makePortal(ctx, color.portalB), 3.5, 1.5);
  place(makeBridge(ctx), 1.5, 2.5, -Math.PI / 2); // runs along +z over the gap
  place(makeConveyor(ctx), 0.5, 3.5);
  place(makeConveyor(ctx), 1.5, 3.5);
  place(makeConveyor(ctx), 1.5, 4.5, -Math.PI / 2);
  place(makeMagnet(ctx, 0.85, true), 3.5, 3.5);
  place(makeFence(ctx, 1.7), 0.3, 5.9); // along the near-left edge
  place(makeFence(ctx, 1), 3, 2, -Math.PI / 2); // a short one across the floor, along +z
  place(makeFence(ctx, 0.6), 2.2, 4.2, 0.6);
}

const target = new TargetView(ctx);
target.setRadius(floor.def.radius);
const [tx, tz] = floor.def.target;
target.group.position.set(tx, 0.004, tz);
target.setDecor(q.get('decor') !== '0');
target.setHot(hot);
target.group.visible = !solo || solo === 'target';
scene.add(target.group);

const ball = new BallView(fade, outU);
const [sx, sz] = floor.def.start;
ball.group.position.set(sx, BALL_R, sz);
ball.shadow.set(sx, 0, sz, 0);
scene.add(ball.group, ball.shadow.mesh);
const player = new Footballer(fade, outU);
player.root.position.set(sx + 0.32, 0, sz + 0.02);
player.faceDir(-1, -0.2, true);
player.update(0.016);
player.shadow.set(sx + 0.32, 0, sz + 0.02, 0);
player.root.visible = player.shadow.mesh.visible = !solo;
scene.add(player.root, player.shadow.mesh);

const cam = new IsoCamera();
const pts: THREE.Vector3[] = [];
const focus = q.get('focus') ?? (solo ? '1.5,1.5' : null);
if (focus) {
  const [fx, fz] = focus.split(',').map(Number);
  const r = Number(q.get('r') ?? (solo ? 0.62 : 0.9));
  pts.push(new THREE.Vector3(fx - r, 0, fz - r), new THREE.Vector3(fx + r, 0, fz + r), new THREE.Vector3(fx, 0.7, fz));
} else {
  for (const t of floor.tiles) {
    pts.push(new THREE.Vector3(t.i, 0, t.j), new THREE.Vector3(t.i + 1, 0, t.j + 1), new THREE.Vector3(t.i, 0.8, t.j));
  }
}
const scale = Number(q.get('scale') ?? 0);
cam.frame(pts, w, h, { top: 16, bottom: 16, left: 16, right: 16 }, true, scale || 1000);
if (scale) {
  // fixed zoom (the game's typical scale), centred on the framed area
  (cam as unknown as { scale: number; goalScale: number }).goalScale = scale;
  cam.scale = scale;
}

let time = 0;
let hitDone = false;
function step(dt: number) {
  time += dt;
  if (hitAt >= 0 && !hitDone && time >= hitAt) {
    hitDone = true;
    for (const p of props) p.hit(1);
    target.flash();
  }
  for (const p of props) p.update(dt, time);
  target.update(dt);
  player.update(dt);
}
if (q.has('pop')) {
  const s = Number(q.get('pop'));
  for (const p of props) p.root.scale.setScalar(s);
  target.group.scale.setScalar(s);
}
const DT = 1 / 60;
while (time < T - 1e-6) step(DT);

function render() {
  cam.update(0);
  const css = clamp(outlinePx * (cam.scale / 60), 1.05, 2.6);
  lineU.uLineWidth.value = css * dpr;
  outU.uOutline.value = (css * 0.95) / cam.scale;
  renderer.render(scene, cam.cam);
}
render();
// the outline width changed after the first update: settle once more
for (const p of props) p.update(0, time);
target.update(0);
render();
(window as unknown as Record<string, unknown>).__dbg = { scene, props, target, THREE, renderer, cam };
(window as unknown as Record<string, unknown>).__ready = true;

if (live) {
  let last = performance.now();
  const loop = (now: number) => {
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
