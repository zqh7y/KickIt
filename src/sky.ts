// What lies below the floating floors: a giant football stadium, far down.
// - A huge surface lying in the world under the floors (it turns with the map
//   in the lobby and moves with it as the camera pans or zooms), drawn first,
//   behind everything.
// - A full-size pitch: mowing stripes with a faint cross-cut, every marking
//   (touchlines, halfway line, centre circle and spot, penalty and goal areas,
//   penalty spots and arcs, corner arcs) and goals with nets; around it a
//   run-off, a running track with lanes, then rows of seats.
// - It is far below, so a soft haze lies over it, a little thicker up the
//   screen; the centre circle sits behind the floors in play.
// - `mist` is the colour the floors' pillars dissolve into; `deep` is the
//   scene's clear colour.
import * as THREE from 'three';
import type { IsoCamera } from './camera.ts';
import { color } from './theme.ts';
import { damp } from './util.ts';

const DEPTH = 26; // the stadium lies this far under the floor's lowest top
const SIZE = 900; // world units: reaches past every screen edge at any zoom
const CENTRE = new THREE.Vector2(-10, -9); // the centre spot: behind the floors at the game's angle

// a 105 x 68 m pitch at 0.65 world units per metre
const M = 0.65;
const PITCH = /* glsl */ `
  const float L = ${(52.5 * M).toFixed(3)};   // half length
  const float W = ${(34 * M).toFixed(3)};     // half width
  const float CIRCLE = ${(9.15 * M).toFixed(3)};
  const float BOX_D = ${(16.5 * M).toFixed(3)};
  const float BOX_W = ${(20.16 * M).toFixed(3)};
  const float SIX_D = ${(5.5 * M).toFixed(3)};
  const float SIX_W = ${(9.16 * M).toFixed(3)};
  const float PEN = ${(11 * M).toFixed(3)};
  const float CORNER = ${(1.2 * M).toFixed(3)};
  const float GOAL_W = ${(3.66 * M).toFixed(3)};
  const float GOAL_D = ${(2.2 * M).toFixed(3)};
  const float STRIPE = ${((105 / 18) * M).toFixed(3)};
  const float LINE = 0.16;   // half the paint width
  const float RUNOFF = 5.0;
  const float TRACK = 4.4;
  const float SEATS = 12.0;
`;

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vScreen;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 clip = projectionMatrix * viewMatrix * wp;
    vScreen = clip.xy / clip.w * 0.5 + 0.5;
    gl_Position = clip;
  }`;

const fragmentShader = /* glsl */ `
  ${PITCH}
  uniform vec2 uCentre;
  uniform vec3 uStripeA;
  uniform vec3 uStripeB;
  uniform vec3 uRunoff;
  uniform vec3 uPaint;
  uniform vec3 uNet;
  uniform vec3 uTrack;
  uniform vec3 uSeats;
  uniform vec3 uHaze;
  varying vec3 vWorld;
  varying vec2 vScreen;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // a painted line: distance d from its centre, half width w, anti-aliased
  float paint(float d, float w) {
    float aa = fwidth(d);
    return 1.0 - smoothstep(w - aa, w + aa, d);
  }
  // signed distance to a rounded rectangle
  float rbox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  void main() {
    vec2 p = vWorld.xz - uCentre;
    vec2 a = abs(p);
    float wear = 0.95 + 0.06 * noise(vWorld.xz * 0.3) + 0.04 * noise(vWorld.xz * 1.7);
    // grass: stripes along the length, a faint cross-cut
    float stripe = mod(floor(p.x / STRIPE), 2.0);
    float cut = mod(floor(p.y / STRIPE), 2.0);
    vec3 col = mix(uStripeA, uStripeB, stripe) * (1.0 + (cut - 0.5) * 0.035) * wear;
    // beyond the pitch: run-off, track, seats
    float edge = rbox(p, vec2(L + RUNOFF, W + RUNOFF), 6.0);
    if (max(a.x - L - RUNOFF, a.y - W - RUNOFF) > 0.0 || edge > 0.0) col = uRunoff * wear;
    if (edge > 0.0) {
      col = uTrack * (0.96 + 0.05 * noise(vWorld.xz * 0.8));
      for (int i = 1; i < 4; i++) col = mix(col, uPaint, paint(abs(edge - TRACK * float(i) / 4.0), 0.06) * 0.85);
    }
    if (edge > TRACK) {
      float rows = fract((edge - TRACK) / 0.75);
      col = mix(uSeats, uSeats * 0.82, step(0.62, rows));
      col = mix(col, uSeats * 1.12, step(0.5, fract(atan(p.y, p.x) * 18.0)) * 0.25);
    }
    if (edge > TRACK + SEATS) col = uSeats * 0.7;
    // the markings
    float m = 0.0;
    m = max(m, paint(abs(a.x - L), LINE) * step(a.y, W + LINE));
    m = max(m, paint(abs(a.y - W), LINE) * step(a.x, L + LINE));
    m = max(m, paint(abs(p.x), LINE) * step(a.y, W));
    m = max(m, paint(abs(length(p) - CIRCLE), LINE));
    m = max(m, paint(length(p), LINE * 2.2));
    m = max(m, paint(abs(a.x - (L - BOX_D)), LINE) * step(a.y, BOX_W));
    m = max(m, paint(abs(a.y - BOX_W), LINE) * step(L - BOX_D, a.x) * step(a.x, L));
    m = max(m, paint(abs(a.x - (L - SIX_D)), LINE) * step(a.y, SIX_W));
    m = max(m, paint(abs(a.y - SIX_W), LINE) * step(L - SIX_D, a.x) * step(a.x, L));
    vec2 spot = vec2(a.x - (L - PEN), p.y);
    m = max(m, paint(length(spot), LINE * 2.0));
    m = max(m, paint(abs(length(spot) - CIRCLE), LINE) * step(a.x, L - BOX_D));
    m = max(m, paint(abs(length(vec2(a.x - L, a.y - W)) - CORNER), LINE) * step(a.x, L) * step(a.y, W));
    col = mix(col, uPaint, m * 0.95);
    // goals: a net behind each goal line, framed
    vec2 g = vec2(a.x - L, a.y);
    float inGoal = step(0.0, g.x) * step(g.x, GOAL_D) * step(g.y, GOAL_W);
    float mesh = max(paint(abs(fract(g.x * 3.0) - 0.5), 0.08), paint(abs(fract(g.y * 3.0) - 0.5), 0.08));
    col = mix(col, uNet, inGoal * (0.45 + 0.4 * mesh));
    float frame = paint(abs(g.y - GOAL_W), LINE * 0.8) * step(0.0, g.x) * step(g.x, GOAL_D);
    frame = max(frame, paint(abs(g.x - GOAL_D), LINE * 0.8) * step(g.y, GOAL_W));
    col = mix(col, uPaint, frame);
    // far below: a soft haze, a little thicker up the screen
    col = mix(col, uHaze, 0.16 + 0.2 * smoothstep(0.25, 1.1, vScreen.y));
    gl_FragColor = linearToOutputTexel(vec4(col, 1.0));
  }`;

export class SkyView {
  readonly group = new THREE.Group();
  /** The hazy ground's tone: the scene's clear colour. */
  readonly deep = new THREE.Color(color.groundHaze);
  /** The colour the floors' pillars dissolve into, high above the stadium. */
  readonly mist = new THREE.Color(color.groundMist);
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly ground: THREE.Mesh;
  private level = 0;
  private levelGoal = 0;

  constructor(_sky: THREE.Color, _reduced: boolean) {
    this.uniforms = {
      uCentre: { value: CENTRE },
      uStripeA: { value: new THREE.Color(color.stadiumStripeA) },
      uStripeB: { value: new THREE.Color(color.stadiumStripeB) },
      uRunoff: { value: new THREE.Color(color.stadiumRunoff) },
      uPaint: { value: new THREE.Color(color.paint) },
      uNet: { value: new THREE.Color(color.stadiumNet) },
      uTrack: { value: new THREE.Color(color.stadiumTrack) },
      uSeats: { value: new THREE.Color(color.stadiumSeats) },
      uHaze: { value: new THREE.Color(color.groundHaze) },
    };
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    geo.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false }),
    );
    this.ground.frustumCulled = false;
    this.ground.renderOrder = -1000; // first of all: everything else is above it
    this.group.add(this.ground);
  }

  /** Settle under a floor whose lowest top is `minTop` (eased unless `instant`). */
  setLevel(minTop: number, instant = false) {
    this.levelGoal = minTop;
    if (instant) this.level = minTop;
  }

  /** Keep the stadium under the camera (it stays put in the world). */
  update(dt: number, cam: IsoCamera) {
    this.level += (this.levelGoal - this.level) * damp(1.2, dt);
    const focus = cam.lookAt;
    const view = cam.viewDir;
    const y = this.level - DEPTH;
    const t = (focus.y - y) / Math.max(0.1, view.y);
    this.ground.position.set(focus.x - view.x * t, y, focus.z - view.z * t);
  }
}
