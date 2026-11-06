// The ball. A football is a truncated icosahedron (12 pentagons, 20 hexagons)
// pushed out onto a sphere, flat shaded. The other shop balls (tennis, basket,
// volley, base, beach, pool, cricket, bowling, golf, disco, a watermelon, the Earth,
// the Moon, a galaxy, a lava ball) are
// a smooth sphere whose pattern is painted per pixel from where the pixel lies
// on the ball, so lines and seams stay crisp at any size; the galaxy's stars
// twinkle and the lava's cracks glow and pulse. Ink outlined, rolling with
// real rotation.
import * as THREE from 'three';
import { CAM_PITCH, CAM_YAW } from './camera.ts';
import { BALL_R } from './physics.ts';
import type { BallKind } from './skins.ts';
import { color } from './theme.ts';
import { hullGeometry, makeSkyFade, outlineMaterial, toonMaterial, type OutlineUniforms, type SkyFade } from './toon.ts';

/** The resting tilt: how the ball sits until it rolls (and in the shop's pictures). */
const REST = new THREE.Euler(0.5, 0.3, 0.2);

// The side of the ball that faces the camera at rest, as a frame on the ball
// (the 8-ball's badge and the bowling ball's holes are painted there).
const toBall = new THREE.Quaternion().setFromEuler(REST).invert();
const FRONT = new THREE.Vector3(Math.sin(CAM_YAW) * Math.cos(CAM_PITCH), Math.sin(CAM_PITCH), Math.cos(CAM_YAW) * Math.cos(CAM_PITCH)).applyQuaternion(toBall).normalize();
const UP = new THREE.Vector3(0, 1, 0).applyQuaternion(toBall);
UP.sub(FRONT.clone().multiplyScalar(UP.dot(FRONT))).normalize();
const RIGHT = new THREE.Vector3().crossVectors(UP, FRONT).normalize();

const PATTERN: Record<Exclude<BallKind, 'soccer'>, number> = {
  tennis: 1, basket: 2, volley: 3, base: 4, beach: 5, pool: 6, bowling: 7, golf: 8, disco: 9, melon: 10, earth: 11, cricket: 12,
  moon: 13, galaxy: 14, lava: 15,
};

// p: a point on the unit ball. Every distance is a chord, so it is smooth for fwidth.
const paintGlsl = /* glsl */ `
  uniform int uKind;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  uniform vec3 uFront;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uTime;
  uniform float uGlow;
  varying vec3 vBallPos;
  float bpHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float bpNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(bpHash(i), bpHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(bpHash(i + vec3(0.0, 1.0, 0.0)), bpHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(bpHash(i + vec3(0.0, 0.0, 1.0)), bpHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(bpHash(i + vec3(0.0, 1.0, 1.0)), bpHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float bpFbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * bpNoise(p);
      p = p * 2.03 + 1.7;
      a *= 0.5;
    }
    return s / 0.9375;
  }
  // a line's coverage: d from its middle, half width w, smoothed over one screen pixel
  float bpInk(float d, float w) {
    float aa = max(fwidth(d), 1e-4);
    return 1.0 - smoothstep(w - aa, w + aa, d);
  }
  // the tennis and baseball seam (it lies on the unit sphere)
  vec3 bpSeamAt(float t) {
    return vec3(0.75 * cos(t) + 0.25 * cos(3.0 * t), 0.75 * sin(t) - 0.25 * sin(3.0 * t), 0.8660254 * sin(2.0 * t));
  }
  // distance to the seam, and how far along it (0..1)
  vec2 bpSeam(vec3 p) {
    float best = -2.0;
    float bt = 0.0;
    for (int k = 0; k < 64; k++) {
      float t = float(k) * (PI2 / 64.0);
      float d = dot(p, bpSeamAt(t));
      if (d > best) { best = d; bt = t; }
    }
    float st = PI2 / 64.0;
    for (int k = 0; k < 7; k++) {
      st *= 0.5;
      float d1 = dot(p, bpSeamAt(bt - st));
      float d2 = dot(p, bpSeamAt(bt + st));
      if (d1 > best) { best = d1; bt -= st; }
      else if (d2 > best) { best = d2; bt += st; }
    }
    return vec2(length(p - bpSeamAt(bt)), fract(bt / PI2));
  }
  vec3 bpTennis(vec3 p) {
    vec3 c = uC0 * (0.92 + 0.1 * bpNoise(p * 60.0));
    return mix(c, uC1, bpInk(bpSeam(p).x, 0.045));
  }
  vec3 bpBasket(vec3 p) {
    vec3 c = uC0 * (0.92 + 0.09 * bpNoise(p * 80.0));
    float ax = abs(p.x);
    float d = min(min(ax, abs(p.y)), abs(asin(min(ax, 1.0)) - 0.8038));
    return mix(c, uC1, bpInk(d, 0.028));
  }
  vec3 bpVolley(vec3 p) {
    vec3 a = abs(p);
    float m;
    vec2 st;
    float face;
    if (a.x >= a.y && a.x >= a.z) { m = a.x; st = p.yz / a.x; face = p.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { m = a.y; st = p.zx / a.y; face = p.y > 0.0 ? 2.0 : 3.0; }
    else { m = a.z; st = p.xy / a.z; face = p.z > 0.0 ? 4.0 : 5.0; }
    float k = clamp(floor((st.x + 1.0) * 1.5), 0.0, 2.0);
    float idx = mod(face + k, 3.0);
    vec3 c = idx < 0.5 ? uC0 : (idx < 1.5 ? uC1 : uC2);
    float e = min(min(abs(st.x - 0.33333), abs(st.x + 0.33333)), min(1.0 - abs(st.x), 1.0 - abs(st.y)));
    return mix(c, uC3, bpInk(e * m, 0.012) * 0.7);
  }
  vec3 bpBaseball(vec3 p) {
    vec3 c = uC0 * (0.96 + 0.05 * bpNoise(p * 30.0));
    vec2 s = bpSeam(p);
    c = mix(c, uC0 * 0.78, bpInk(s.x, 0.007));
    // the 108 double stitches, slanted into a V on either side of the seam
    float along = abs(fract(s.y * 108.0 + s.x * 4.0) - 0.5);
    return mix(c, uC1, bpInk(abs(s.x - 0.065), 0.026) * bpInk(along, 0.22));
  }
  vec3 bpBeach(vec3 p) {
    float g = (atan(p.z, p.x) + PI) / PI2 * 6.0;
    float k = mod(floor(g), 6.0);
    vec3 c = k < 0.5 ? uC0 : (k < 1.5 ? uC3 : (k < 2.5 ? uC1 : (k < 3.5 ? uC3 : (k < 4.5 ? uC2 : uC3))));
    float f = fract(g);
    c = mix(c, uC3 * 0.82, bpInk(min(f, 1.0 - f) * (PI2 / 6.0) * sqrt(max(1.0 - p.y * p.y, 0.0)), 0.006));
    float cap = abs(p.y);
    float aa = fwidth(cap);
    return mix(c, uC3, smoothstep(0.935 - aa, 0.935 + aa, cap));
  }
  vec3 bpPool(vec3 p) {
    vec2 q = vec2(dot(p, uRight), dot(p, uUp));
    float badge = bpInk(length(p - uFront), 0.4) * step(0.0, dot(p, uFront));
    float d = min(abs(length(q - vec2(0.0, 0.088)) - 0.068), abs(length(q + vec2(0.0, 0.092)) - 0.084));
    return mix(uC0, mix(uC1, uC0, bpInk(d, 0.024)), badge);
  }
  vec3 bpBowling(vec3 p) {
    float n = bpFbm(p * 2.2 + 3.1);
    float sw = bpFbm(p * 3.4 + vec3(n * 2.4, -n * 1.6, n * 2.0));
    vec3 c = mix(uC0, uC1, smoothstep(0.38, 0.7, sw));
    vec2 q = vec2(dot(p, uRight), dot(p, uUp));
    float h = min(min(length(q - vec2(-0.14, 0.11)) - 0.06, length(q - vec2(0.14, 0.11)) - 0.06), length(q - vec2(0.0, -0.16)) - 0.075);
    return mix(c, uC2, bpInk(h, 0.0) * step(0.0, dot(p, uFront)));
  }
  vec3 bpGolf(vec3 p) {
    // dimples on a Fibonacci lattice: the nearest of the points around this height
    const float N = 180.0;
    float i0 = floor((1.0 - p.y) * N * 0.5);
    float best = -2.0;
    for (int k = -26; k <= 26; k++) {
      float i = i0 + float(k);
      if (i < 0.0 || i >= N) continue;
      float y = 1.0 - (i + 0.5) * 2.0 / N;
      float r = sqrt(max(1.0 - y * y, 0.0));
      float a = i * 2.39996323;
      best = max(best, dot(p, vec3(cos(a) * r, y, sin(a) * r)));
    }
    return mix(uC0, uC1, bpInk(sqrt(max(2.0 - 2.0 * best, 0.0)), 0.095));
  }
  vec3 bpDisco(vec3 p) {
    float th = acos(clamp(p.y, -1.0, 1.0));
    float rows = 20.0;
    float rf = th / PI * rows;
    float row = floor(rf);
    float n = max(4.0, floor(40.0 * sin((row + 0.5) / rows * PI) + 0.5));
    float cf = (atan(p.z, p.x) + PI) / PI2 * n;
    float col = floor(cf);
    float g = bpHash(vec3(col, row, 3.0));
    vec3 c = uC0 * (0.5 + 0.5 * bpHash(vec3(row, col, 7.0)));
    c = g > 0.93 ? uC1 : (g > 0.86 ? uC2 : c);
    float e = min(min(fract(rf), 1.0 - fract(rf)) * (PI / rows), min(fract(cf), 1.0 - fract(cf)) * (PI2 / n) * sin(th));
    return mix(c, uC3, bpInk(e, 0.007));
  }
  vec3 bpMelon(vec3 p) {
    float w = bpNoise(p * 4.0) - 0.5;
    float s = sin(atan(p.z, p.x) * 8.0 + w * 3.4 + (bpNoise(p * 12.0) - 0.5) * 1.3);
    float aa = fwidth(s);
    return mix(uC0, uC1, smoothstep(0.1 - aa, 0.1 + aa, s));
  }
  vec3 bpEarth(vec3 p) {
    float n = bpFbm(p * 1.7 + vec3(5.2, 1.3, 2.7));
    float aa = fwidth(n);
    vec3 sea = uC0 * (0.9 + 0.14 * smoothstep(0.3, 0.52, n));
    vec3 ground = mix(uC1, uC2, smoothstep(0.56, 0.72, n));
    vec3 c = mix(sea, ground, smoothstep(0.525 - aa, 0.525 + aa, n));
    float cap = abs(p.y) + (bpNoise(p * 7.0) - 0.5) * 0.05;
    float ca = fwidth(cap);
    return mix(c, uC3, smoothstep(0.86 - ca, 0.86 + ca, cap));
  }
  vec3 bpCricket(vec3 p) {
    vec3 c = uC0 * (0.9 + 0.12 * bpNoise(p * 40.0));
    float d = abs(p.y);
    c = mix(c, uC0 * 0.7, bpInk(d, 0.012));
    // a row of stitches either side of the seam
    float along = abs(fract((atan(p.z, p.x) + PI) / PI2 * 90.0) - 0.5);
    return mix(c, uC1, bpInk(abs(d - 0.045), 0.016) * bpInk(along, 0.3));
  }
  vec3 bpMoon(vec3 p) {
    vec3 c = mix(uC0, uC1, smoothstep(0.44, 0.6, bpFbm(p * 1.3 + 2.1)));
    c *= 0.9 + 0.18 * bpFbm(p * 2.5 + 7.3);
    // craters: a darker floor inside a bright rim
    vec3 g = p * 5.0;
    vec3 i = floor(g);
    float best = 9.0;
    for (int z = -1; z <= 1; z++)
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec3 cell = i + vec3(float(x), float(y), float(z));
          if (bpHash(cell) > 0.55) continue;
          vec3 fp = cell + 0.5 + 0.4 * (vec3(bpHash(cell + 11.0), bpHash(cell + 23.0), bpHash(cell + 37.0)) - 0.5);
          best = min(best, length(g - fp) / (0.18 + 0.22 * bpHash(cell + 5.0)));
        }
    c = mix(c, uC1 * 0.7, (1.0 - smoothstep(0.78, 0.9, best)) * 0.85);
    return mix(c, uC2, bpInk(abs(best - 0.94), 0.1));
  }
  vec3 bpGalaxy(vec3 p) {
    float n = bpFbm(p * 1.8 + vec3(1.0, 4.0, 2.0));
    vec3 c = mix(uC0, uC1, smoothstep(0.35, 0.75, n));
    return mix(c, uC2, smoothstep(0.55, 0.85, bpFbm(p * 3.2 + n * 1.5)) * 0.7);
  }
  vec3 bpGalaxyGlow(vec3 p) {
    // a few stars per cell, each twinkling at its own pace
    vec3 g = p * 14.0;
    vec3 i = floor(g);
    float h = bpHash(i);
    vec3 fp = 0.25 + 0.5 * vec3(bpHash(i + 3.0), bpHash(i + 9.0), bpHash(i + 15.0));
    float star = step(0.6, h) * (1.0 - smoothstep(0.02, 0.09, length(fract(g) - fp)));
    float tw = 0.55 + 0.45 * sin(uTime * (2.0 + 3.0 * h) + h * 40.0);
    return uC3 * star * tw * 1.6 + uC2 * 0.22 * smoothstep(0.6, 0.9, bpFbm(p * 3.2 + 1.0));
  }
  // distance to the nearest crack between rock cells
  float bpCrack(vec3 p) {
    vec3 i = floor(p);
    float d1 = 9.0;
    float d2 = 9.0;
    for (int z = -1; z <= 1; z++)
      for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec3 cell = i + vec3(float(x), float(y), float(z));
          vec3 fp = cell + 0.5 + 0.45 * (vec3(bpHash(cell), bpHash(cell + 13.0), bpHash(cell + 29.0)) - 0.5);
          float d = length(p - fp);
          if (d < d1) { d2 = d1; d1 = d; }
          else if (d < d2) { d2 = d; }
        }
    return d2 - d1;
  }
  vec3 bpLava(vec3 p) {
    vec3 rock = uC0 * (0.75 + 0.4 * bpFbm(p * 6.0));
    return mix(rock, uC1, bpInk(bpCrack(p * 4.2), 0.06));
  }
  vec3 bpLavaGlow(vec3 p) {
    float e = bpCrack(p * 4.2);
    float pulse = 0.7 + 0.3 * sin(uTime * 2.4 + bpNoise(p * 3.0) * 6.2831);
    return mix(uC1, uC2, pulse) * (bpInk(e, 0.07) + (1.0 - smoothstep(0.0, 0.22, e)) * 0.35) * pulse;
  }
  // the designs' own light: the galaxy's stars, the lava's cracks
  vec3 ballGlow(vec3 p) {
    if (uKind == 14) return bpGalaxyGlow(p) * uGlow;
    if (uKind == 15) return bpLavaGlow(p) * uGlow;
    return vec3(0.0);
  }
  vec3 ballPaint(vec3 p) {
    if (uKind == 1) return bpTennis(p);
    if (uKind == 2) return bpBasket(p);
    if (uKind == 3) return bpVolley(p);
    if (uKind == 4) return bpBaseball(p);
    if (uKind == 5) return bpBeach(p);
    if (uKind == 6) return bpPool(p);
    if (uKind == 7) return bpBowling(p);
    if (uKind == 8) return bpGolf(p);
    if (uKind == 9) return bpDisco(p);
    if (uKind == 10) return bpMelon(p);
    if (uKind == 11) return bpEarth(p);
    if (uKind == 12) return bpCricket(p);
    if (uKind == 13) return bpMoon(p);
    if (uKind == 14) return bpGalaxy(p);
    if (uKind == 15) return bpLava(p);
    return vec3(1.0);
  }
`;

/** The round balls' material: the toon look (and sky fade), smooth, painted by the pattern. */
function paintedMaterial(fade: SkyFade, paint: Record<string, THREE.IUniform>): THREE.MeshLambertMaterial {
  const m = toonMaterial('#ffffff', fade);
  m.flatShading = false;
  const toon = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    toon.call(m, sh, r);
    Object.assign(sh.uniforms, paint);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBallPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + paintGlsl)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= ballPaint(normalize(vBallPos));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ballGlow(normalize(vBallPos));');
  };
  m.customProgramCacheKey = () => 'ball-paint';
  return m;
}

function footballGeometry(radius: number): THREE.BufferGeometry {
  const phi = (1 + Math.sqrt(5)) / 2;
  const V = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const adj = (a: number, b: number) => Math.abs(V[a].distanceTo(V[b]) - 2) < 1e-6;
  const third = (a: number, b: number) => V[a].clone().lerp(V[b], 1 / 3);
  const pos: number[] = [];
  const col: number[] = [];
  const white = new THREE.Color(color.ballWhite);
  const black = new THREE.Color(color.ink);
  const poly = (pts: THREE.Vector3[], c: THREE.Color) => {
    const centre = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const n = centre.clone().normalize();
    const t1 = pts[0].clone().sub(centre).normalize();
    const t2 = n.clone().cross(t1);
    const ang = (p: THREE.Vector3) => {
      const d = p.clone().sub(centre);
      return Math.atan2(d.dot(t2), d.dot(t1));
    };
    pts.sort((p, q) => ang(p) - ang(q));
    const cs = n.clone().multiplyScalar(radius);
    const ps = pts.map((p) => p.clone().normalize().multiplyScalar(radius));
    for (let k = 0; k < ps.length; k++) {
      const a = ps[k];
      const b = ps[(k + 1) % ps.length];
      pos.push(cs.x, cs.y, cs.z, a.x, a.y, a.z, b.x, b.y, b.z);
      for (let m = 0; m < 3; m++) col.push(c.r, c.g, c.b);
    }
  };
  for (let v = 0; v < 12; v++) {
    const ring: THREE.Vector3[] = [];
    for (let u = 0; u < 12; u++) if (u !== v && adj(u, v)) ring.push(third(v, u));
    poly(ring, black);
  }
  for (let a = 0; a < 12; a++)
    for (let b = a + 1; b < 12; b++)
      for (let c = b + 1; c < 12; c++)
        if (adj(a, b) && adj(b, c) && adj(a, c))
          poly([third(a, b), third(b, a), third(b, c), third(c, b), third(c, a), third(a, c)], white);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

let blobTexture: THREE.Texture | null = null;
function blobTex(): THREE.Texture {
  if (blobTexture) return blobTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTexture = new THREE.CanvasTexture(cv);
  return blobTexture;
}

/** Soft contact shadow that lies on the surface below an object. */
export class BlobShadow {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private static up = new THREE.Vector3(0, 0, 1);
  private n = new THREE.Vector3();

  constructor(private readonly size: number, private readonly strength = 0.26) {
    this.mat = new THREE.MeshBasicMaterial({
      map: blobTex(),
      color: color.ink,
      transparent: true,
      depthWrite: false,
      opacity: strength,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 20), this.mat);
    this.mesh.renderOrder = 1;
  }

  /** Place on the ground at (x, groundY, z) under an object `height` above it. */
  set(x: number, groundY: number, z: number, height: number, gx = 0, gz = 0, fade = 1) {
    if (!Number.isFinite(groundY)) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.n.set(-gx, 1, -gz).normalize();
    this.mesh.quaternion.setFromUnitVectors(BlobShadow.up, this.n);
    this.mesh.position.set(x, groundY + 0.003, z);
    const h = Math.max(0, height);
    this.mesh.scale.setScalar(this.size * (1 + h * 0.9));
    this.mat.opacity = (this.strength * fade) / (1 + h * 2.2);
  }
}

export class BallView {
  readonly group = new THREE.Group(); // at the ball centre
  readonly spin = new THREE.Group(); // rolls
  readonly shadow = new BlobShadow(BALL_R * 1.15, 0.3);
  readonly outlineScale = { value: 1 };
  private axis = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private readonly mesh: THREE.Mesh; // the football
  private readonly round: THREE.Mesh; // every other ball
  private readonly paint: Record<string, THREE.IUniform> = {
    uKind: { value: 0 },
    uC0: { value: new THREE.Color() },
    uC1: { value: new THREE.Color() },
    uC2: { value: new THREE.Color() },
    uC3: { value: new THREE.Color() },
    uFront: { value: FRONT },
    uRight: { value: RIGHT },
    uUp: { value: UP },
    uTime: { value: 0 },
    uGlow: { value: 1 },
  };

  constructor(fade: SkyFade, outlineU: OutlineUniforms) {
    const geo = footballGeometry(BALL_R);
    const mat = toonMaterial('#ffffff', fade);
    mat.vertexColors = true;
    const mesh = new THREE.Mesh(geo, mat);
    this.mesh = mesh;
    this.spin.add(mesh);
    this.round = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 48, 32), paintedMaterial(fade, this.paint));
    this.round.visible = false;
    this.spin.add(this.round);
    const hull = new THREE.Mesh(hullGeometry(new THREE.IcosahedronGeometry(BALL_R, 2)), outlineMaterial(outlineU, fade, this.outlineScale));
    hull.renderOrder = -1;
    this.spin.add(hull);
    this.group.add(this.spin);
    // a resting tilt so the design reads at rest
    this.spin.rotation.copy(REST);
  }

  /**
   * Dress the ball in a shop design. A football colours its hexagons and
   * pentagons (the geometry lists the 12 pentagons first, 5 triangles each,
   * then the 20 hexagons, 6 each); any other ball switches to the painted
   * sphere. Either way it settles at its resting tilt, its face to the camera.
   */
  setSkin(skin: { kind: BallKind; colors: string[] }) {
    const round = skin.kind !== 'soccer';
    this.mesh.visible = !round;
    this.round.visible = round;
    if (skin.kind !== 'soccer') {
      this.paint.uKind.value = PATTERN[skin.kind];
      for (let i = 0; i < 4; i++) (this.paint[`uC${i}`].value as THREE.Color).set(skin.colors[i] ?? skin.colors[0]);
    } else {
      const col = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const c = new THREE.Color(skin.colors[1]);
      let v = 0;
      for (let f = 0; f < 12; f++) for (let k = 0; k < 15; k++, v++) col.setXYZ(v, c.r, c.g, c.b);
      c.set(skin.colors[0]);
      for (let f = 0; f < 20; f++) for (let k = 0; k < 18; k++, v++) col.setXYZ(v, c.r, c.g, c.b);
      col.needsUpdate = true;
    }
    this.spin.rotation.copy(REST);
  }

  /** Light the ball at `k` (1 as usual; low: in shadow, as a locked shop ball). */
  setLight(k: number) {
    (this.mesh.material as THREE.MeshLambertMaterial).color.setScalar(k);
    (this.round.material as THREE.MeshLambertMaterial).color.setScalar(k);
    this.paint.uGlow.value = k;
  }

  /** Moving designs (the galaxy's stars, the lava's cracks) follow `t`, in seconds. */
  tick(t: number) {
    this.paint.uTime.value = t;
  }

  /** Rotate as if rolling with ground velocity (vx, vz) for dt. */
  roll(vx: number, vz: number, dt: number) {
    const sp = Math.hypot(vx, vz);
    if (sp < 1e-4) return;
    this.axis.set(vz, 0, -vx).divideScalar(sp);
    this.q.setFromAxisAngle(this.axis, (sp * dt) / BALL_R);
    this.spin.quaternion.premultiply(this.q);
  }
}

export { makeSkyFade };
