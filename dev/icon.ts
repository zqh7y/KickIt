// Renders the app icon art: one pitch block with the bullseye and the ball.
// ?size=432&bg=0|1&zoom=1
import * as THREE from 'three';
import { floorFromDef } from '../src/levels.ts';
import { FloorView, makeLineUniforms } from '../src/floor.ts';
import { IsoCamera } from '../src/camera.ts';
import { BallView } from '../src/ball.ts';
import { TargetView } from '../src/target.ts';
import { makeSkyFade, makeOutlineUniforms } from '../src/toon.ts';
import { BALL_R } from '../src/physics.ts';
import { skies } from '../src/theme.ts';

const q = new URLSearchParams(location.search);
const size = Number(q.get('size') ?? 512);
const withBg = q.get('bg') !== '0';
const fill = Number(q.get('fill') ?? 0.62); // share of the canvas the art spans
const BALL = 2; // the icon's ball is twice the game's size, so it reads at launcher size
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(size, size, false);
const sky = new THREE.Color(skies[0]);
const scene = new THREE.Scene();
if (withBg) scene.background = sky;
scene.add(new THREE.HemisphereLight(0xffffff, 0x9cc864, 1.85));
const sun = new THREE.DirectionalLight(0xffffff, 1.55);
sun.position.set(-2, 5, 3);
scene.add(sun);
const floor = floorFromDef({ name: 'icon', kicks: 1, time: 1, map: ['0'], start: [0.5, 0.5], target: [0.5, 0.5], radius: 0.36, seed: 5, plain: true }, 0);
const lineU = makeLineUniforms();
lineU.uResolution.value.set(size, size);
const view = new FloorView(floor, sky, lineU, 512, 8);
view.uniforms.uFadeTop.value = -0.25;
view.uniforms.uFadeBottom.value = -1.25;
scene.add(view.group);
const target = new TargetView();
target.setRadius(0.36);
target.group.position.set(0.5, 0.004, 0.5);
target.setDecor(false);
target.update(0.5);
scene.add(target.group);
const fade = makeSkyFade(sky);
const outU = makeOutlineUniforms();
const ball = new BallView(fade, outU);
ball.group.scale.setScalar(BALL);
ball.group.position.set(0.52, BALL_R * BALL, 0.47);
ball.spin.rotation.set(0.2, 0.9, 0.1);
ball.shadow.set(0.52, 0, 0.47, 0);
ball.shadow.mesh.scale.multiplyScalar(BALL);
scene.add(ball.group, ball.shadow.mesh);
const cam = new IsoCamera();
const pts = [
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, -0.9, 1), new THREE.Vector3(0, -0.9, 1), new THREE.Vector3(1, -0.9, 0),
  new THREE.Vector3(0.52, BALL_R * BALL * 2 + 0.04, 0.47), // the ball's top
];
const m = size * (1 - fill) / 2;
cam.frame(pts, size, size, { top: m, bottom: m, left: m, right: m }, true, 100000);
cam.update(0);
const css = Math.max(1, cam.scale * 0.03);
lineU.uLineWidth.value = css;
outU.uOutline.value = (css * 0.9) / cam.scale;
renderer.render(scene, cam.cam);
(window as any).__ready = true;
