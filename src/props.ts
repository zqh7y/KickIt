// Map props for the floors: fences, trampolines, magnets, boost pads, bumpers,
// portals, conveyor belts and plank bridges. Chunky low-poly pieces in the
// ball and footballer's style: flat-shaded toon materials, an ink hull on
// every solid piece, colours only from the theme.
//
// Conventions
// - `root`'s origin is the point on the ground surface where the prop stands
//   (y = 0 is the surface). Local +x is its forward direction where it has one;
//   to point it along world (dx, dz) set root.rotation.y = Math.atan2(-dz, dx).
// - The game positions and rotates `root`, calls update(dt, time) every frame
//   (time: any running clock, seconds) and hit(strength) when the ball
//   triggers the prop. update() allocates nothing. Scaling `root` (a pop-in)
//   also scales the ink, up to its normal width at scale 1.
// - dispose() frees the geometries, materials and textures the prop owns and
//   detaches `root` from its parent.
//
// Sizes (tiles)                 footprint                 top
//   fence (0,0,0)→(length,0,0)   0.064 wide                0.20
//   trampoline                   radius 0.30 (pad)         0.054 rim, mat 0.034
//   magnet                       radius 0.13, field range  ≈0.34 (floats)
//   boost pad                    0.62 × 0.62               0.018
//   bumper                       radius 0.17               0.27
//   portal                       radius 0.33 (ring 0.28)   0.075
//   conveyor                     0.92 × 0.92 overlay       0.006
//   bridge                       x −0.5…0.5, z ±0.21       0 (deck), 0.08 deep
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BlobShadow } from './ball.ts';
import { color } from './theme.ts';
import { addOutlines, outlineMaterial, toonMaterial, type OutlineUniforms, type SkyFade } from './toon.ts';
import { clamp } from './util.ts';

export interface PropContext {
  fade: SkyFade;
  outline: OutlineUniforms;
}

export interface Prop {
  root: THREE.Group;
  update(dt: number, time: number): void;
  hit(strength?: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;

/** Decaying swing for hit reactions: 0 at t = 0, positive first, gone after a while. */
function wobble(t: number, freq: number, decay: number): number {
  return t < 0 || t * decay > 7 ? 0 : Math.exp(-t * decay) * Math.sin(t * freq);
}

// ------------------------------------------------------------------ shared

/** Owns one prop's root, ink hull material and textures, and frees them. */
class Kit {
  readonly root = new THREE.Group();
  /** Multiplies the width of this prop's ink hulls. */
  readonly ink = { value: 1 };
  private hullMat: THREE.ShaderMaterial | null = null;
  private textures: THREE.Texture[] = [];

  constructor(readonly ctx: PropContext) {}

  mat(hex: string): THREE.MeshLambertMaterial {
    return toonMaterial(hex, this.ctx.fade);
  }

  /** Unlit material that still fades into the sky below the floor. */
  flat(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    return fadeBasic(new THREE.MeshBasicMaterial(params), this.ctx.fade);
  }

  own<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  /** Ink hulls on every solid mesh under `node` (meshes named 'bare' stay bare). */
  outline(node: THREE.Object3D) {
    this.hullMat ??= outlineMaterial(this.ctx.outline, this.ctx.fade, this.ink);
    addOutlines(node, this.hullMat, (m) => m.name === 'bare' || m.name === 'outline');
  }

  /** Ink follows root's scale, so a prop popping in from 0 never shows as an ink blob. */
  sync() {
    this.ink.value = Math.min(1, Math.abs(this.root.scale.x));
  }

  /** Current ink width in world units (for flat ink pieces that track the hulls). */
  inkWidth(): number {
    return this.ctx.outline.uOutline.value * this.ink.value;
  }

  dispose() {
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      geos.add(m.geometry);
      if (Array.isArray(m.material)) for (const x of m.material) mats.add(x);
      else mats.add(m.material);
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
    this.root.removeFromParent();
  }
}

const FADE_GLSL = /* glsl */ `
uniform vec3 uBg;
uniform float uFadeTop;
uniform float uFadeBottom;
float skyK(float y) { return smoothstep(uFadeTop, uFadeBottom, y); }
`;

/** The toon height fade, for unlit materials (colour to the sky, alpha to 0). */
function fadeBasic<T extends THREE.Material>(m: T, fade: SkyFade): T {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fade);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vWorldY;\n${FADE_GLSL}`)
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nfloat skyF = skyK(vWorldY);\ngl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(uBg, 1.0)).rgb, skyF);\ngl_FragColor.a *= 1.0 - skyF;',
      );
  };
  m.customProgramCacheKey = () => 'prop-basic-fade';
  return m;
}

/** Ground-plane shader: `vP` is local (x, z) divided by uR. */
const GROUND_VERT = /* glsl */ `
uniform float uR;
varying vec2 vP;
varying float vY;
void main() {
  vP = position.xz / uR;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export type P2 = readonly [number, number];

/** Closed shape through `pts` with every corner rounded (one radius or one per corner). */
export function roundedShape(pts: readonly P2[], radius: number | readonly number[]): THREE.Shape {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i + n - 1) % n];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    const r = typeof radius === 'number' ? radius : radius[i];
    const d1 = Math.hypot(px - cx, py - cy);
    const d2 = Math.hypot(nx - cx, ny - cy);
    const k1 = Math.min(r, d1 * 0.5) / d1;
    const k2 = Math.min(r, d2 * 0.5) / d2;
    const ax = cx + (px - cx) * k1;
    const ay = cy + (py - cy) * k1;
    if (i === 0) s.moveTo(ax, ay);
    else s.lineTo(ax, ay);
    s.quadraticCurveTo(cx, cy, cx + (nx - cx) * k2, cy + (ny - cy) * k2);
  }
  s.closePath();
  return s;
}

const roundedRect = (hx: number, hy: number, r: number) =>
  roundedShape(
    [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ],
    r,
  );

/**
 * Extrudes a shape (drawn in x, −z) into a slab lying on the ground, from
 * y = 0 to depth + 2·bevel. The bevel grows the outline by `bevelSize`.
 */
function slab(shape: THREE.Shape, depth: number, bevel: number, bevelSize = bevel, segments = 1, curve = 5): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize,
    bevelSegments: segments,
    curveSegments: curve,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/** Solid of revolution; list the profile from the outer bottom, up, over and in. */
function lathe(profile: readonly P2[], segments: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

function roundBox(w: number, h: number, d: number, r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 1, r);
  g.translate(x, y, z);
  return g;
}

/** One geometry from many (position + normal); the parts are disposed. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => {
    const f = g.index ? g.toNonIndexed() : g;
    if (f !== g) g.dispose();
    for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal') f.deleteAttribute(k);
    return f;
  });
  const out = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  if (!out) throw new Error('props: could not merge geometry');
  return out;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name = ''): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

/** A flat unit disc on the ground (scale it to size). */
function groundDisc(segments = 40): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, segments);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Flat ink piece on the ground under a prop: the ink line where it meets the
 * grass (an ink hull alone never shows below the surface). No polygon offset:
 * it grows as the camera zooms out and would push the plate over the swirl.
 */
function inkPlate(k: Kit, geo: THREE.BufferGeometry, y = 0.0015): THREE.Mesh {
  const m = mesh(geo, k.flat({ color: color.ink }), 'bare');
  m.position.y = y;
  return m;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, points: number, ro: number, ri: number, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = rot + (i * Math.PI) / points;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Chevron pointing +x, tip at (tip, 0), arms back to (tip − len, ±half), `thick` along x. */
function chevronPts(tip: number, len: number, half: number, thick: number): P2[] {
  return [
    [tip, 0],
    [tip - len, half],
    [tip - len - thick, half],
    [tip - thick, 0],
    [tip - len - thick, -half],
    [tip - len, -half],
  ];
}

// ------------------------------------------------------------------ fence

/**
 * White cartoon fence from (0,0,0) to (length,0,0): posts about every 0.3,
 * rounded caps on the end posts, two rails, 0.2 tall, 0.064 thin.
 * hit(): a quick decaying wobble.
 */
export function makeFence(ctx: PropContext, length: number): Prop {
  const k = new Kit(ctx);
  const body = new THREE.Group();
  k.root.add(body);
  const L = Math.max(0.12, length);
  const n = Math.max(1, Math.round(L / 0.3));
  const step = L / n;

  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i * step;
    if (i === 0 || i === n) {
      parts.push(roundBox(0.064, 0.17, 0.064, 0.014, x, 0.085, 0));
      const cap = new THREE.SphereGeometry(0.038, 8, 6);
      cap.translate(x, 0.162, 0);
      parts.push(cap);
    } else {
      parts.push(roundBox(0.05, 0.15, 0.05, 0.012, x, 0.075, 0));
      const tip = new THREE.ConeGeometry(0.0355, 0.036, 4, 1);
      tip.rotateY(Math.PI / 4);
      tip.translate(x, 0.168, 0);
      parts.push(tip);
    }
  }
  for (const y of [0.064, 0.126]) parts.push(roundBox(L, 0.036, 0.028, 0.01, L / 2, y, 0));
  body.add(mesh(merge(parts), k.mat(color.fence)));
  k.outline(body);

  // soft contact shadow along the base
  const shadow = new BlobShadow(1, 0.2);
  shadow.mesh.rotation.x = -Math.PI / 2;
  shadow.mesh.position.set(L / 2, 0.003, 0);
  shadow.mesh.scale.set(L / 2 + 0.07, 0.085, 1);
  k.root.add(shadow.mesh);

  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt) {
      k.sync();
      t += dt;
      const w = amp * wobble(t, 34, 7);
      body.rotation.x = w;
      body.scale.y = 1 - Math.abs(w) * 0.25;
    },
    hit(strength = 1) {
      t = 0;
      amp = 0.06 + 0.1 * clamp(strength, 0, 1.5);
    },
    dispose: () => k.dispose(),
  };
}

// ------------------------------------------------------------- trampoline

function dishGeometry(radius: number, segments: number): THREE.BufferGeometry {
  // centre + rings; y = −(1 − f)^1.4 for unit sag (scale y by the depth)
  const rings = [0.34, 0.68, 1];
  const pos: number[] = [0, -1, 0];
  const uv: number[] = [0.5, 0.5];
  for (const f of rings) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * TAU;
      const x = Math.cos(a) * f * radius;
      const z = Math.sin(a) * f * radius;
      pos.push(x, -Math.pow(1 - f, 1.4), z);
      uv.push(0.5 + x / (2 * radius), 0.5 - z / (2 * radius));
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let r = 0; r < rings.length - 1; r++) {
    const a0 = 1 + r * segments;
    const b0 = a0 + segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      idx.push(a0 + s, a0 + s1, b0 + s1, a0 + s, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Round trampoline, pad radius 0.3: a coral frame with white segments, a dark
 * mat with a white star just below the rim top; 0.054 tall.
 * hit(s): the mat dips, then springs up past flat and settles (~0.35 s).
 */
export function makeTrampoline(ctx: PropContext): Prop {
  const k = new Kit(ctx);
  const body = new THREE.Group();
  k.root.add(body);
  const R = 0.3;

  // Frame: a rounded ring, painted coral with every fourth segment white.
  const SEG = 48;
  const rimGeo = lathe(
    [
      [R, 0],
      [R + 0.003, 0.026],
      [R - 0.006, 0.045],
      [R - 0.03, 0.054],
      [R - 0.052, 0.046],
      [R - 0.062, 0.03],
      [R - 0.064, 0],
    ],
    SEG,
  ).toNonIndexed();
  const p = rimGeo.getAttribute('position');
  const cols = new Float32Array(p.count * 3);
  const coral = new THREE.Color(color.trampolineRim);
  const white = new THREE.Color(color.paper);
  for (let i = 0; i < p.count; i += 3) {
    const cx = p.getX(i) + p.getX(i + 1) + p.getX(i + 2);
    const cz = p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2);
    const seg = Math.floor((((Math.atan2(cx, cz) + TAU) % TAU) / TAU) * SEG);
    const c = seg % 4 === 3 ? white : coral;
    for (let v = 0; v < 3; v++) c.toArray(cols, (i + v) * 3);
  }
  rimGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const rimMat = k.mat('#ffffff');
  rimMat.vertexColors = true;
  const rim = mesh(rimGeo, rimMat);
  body.add(rim);

  // Mat: a shallow dish whose sag is its y scale.
  const matTex = k.own(
    canvasTexture(256, 256, (g) => {
      g.fillStyle = color.trampolineMat;
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = color.paper;
      g.globalAlpha = 0.22;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU;
        g.moveTo(128 + Math.cos(a) * 106, 128 + Math.sin(a) * 106);
        g.lineTo(128 + Math.cos(a) * 122, 128 + Math.sin(a) * 122);
      }
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = color.paper;
      g.strokeStyle = color.paper;
      g.lineJoin = 'round';
      g.lineWidth = 8;
      starPath(g, 128, 128, 5, 50, 22);
      g.fill();
      g.stroke();
    }),
  );
  const matMat = k.mat('#ffffff');
  matMat.map = matTex;
  // the sag goes negative as the mat springs up past flat: the mirrored dish must still draw
  matMat.side = THREE.DoubleSide;
  const MAT_Y = 0.034;
  const REST = 0.006;
  const mat = mesh(dishGeometry(0.239, 24), matMat, 'bare');
  mat.position.y = MAT_Y;
  mat.scale.y = REST;
  body.add(mat);
  k.outline(body);

  const plate = inkPlate(k, groundDisc(48));
  k.root.add(plate);

  const glow = new THREE.Color(color.gold);
  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt) {
      k.sync();
      t += dt;
      // + = down. Peaks at 0.66·amp: the mat centre stays just above the ground.
      const d = amp * wobble(t, 34, 10);
      mat.scale.y = REST + d;
      body.scale.set(1 + d * 2, 1 - d * 4.5, 1 + d * 2);
      rimMat.emissive.copy(glow).multiplyScalar(t < 0.25 ? (1 - t / 0.25) * 0.3 * amp * 28 : 0);
      plate.scale.setScalar((R + k.inkWidth()) * (1 + d * 2));
    },
    hit(strength = 1) {
      t = 0;
      amp = 0.036 * clamp(strength, 0.3, 1);
    },
    dispose: () => k.dispose(),
  };
}

// ----------------------------------------------------------------- magnet

/**
 * Floating cartoon horseshoe magnet, poles up, about 0.34 tall, footprint
 * radius 0.13; it bobs and sways. A ground field indicator shows `range`:
 * soft rings drifting inward (attract) or outward (repel).
 * The U faces the camera when root.rotation.y = 0. hit(): a shake and a
 * brighter field for a moment.
 */
export function makeMagnet(ctx: PropContext, range: number, repel = false): Prop {
  const k = new Kit(ctx);
  const fieldR = Math.max(0.2, range);

  // Field rings on the ground.
  const fieldU = {
    ...ctx.fade,
    uR: { value: fieldR },
    uTime: { value: 0 },
    uDir: { value: repel ? -1 : 1 },
    uAlpha: { value: 0.26 },
    uColor: { value: new THREE.Color(repel ? color.accent : color.paper) },
  };
  const fieldMat = new THREE.ShaderMaterial({
    uniforms: fieldU,
    transparent: true,
    depthWrite: false,
    vertexShader: GROUND_VERT,
    fragmentShader: /* glsl */ `
      ${FADE_GLSL}
      uniform float uTime;
      uniform float uDir;
      uniform float uAlpha;
      uniform vec3 uColor;
      varying vec2 vP;
      varying float vY;
      void main() {
        float r = length(vP);
        float ph = fract(r * 2.4 + uDir * uTime * 0.45);
        float q = uDir > 0.0 ? ph : 1.0 - ph;
        float aa = fwidth(r) * 2.4;
        float band = smoothstep(0.0, 0.02 + aa, q) * (1.0 - smoothstep(0.035 + aa, 0.2, q));
        float edge = (1.0 - smoothstep(0.8, 1.0, r)) * smoothstep(0.16, 0.36, r);
        float a = band * edge * uAlpha * (1.0 - skyK(vY));
        gl_FragColor = linearToOutputTexel(vec4(uColor, a));
      }`,
  });
  const fieldGeo = new THREE.CircleGeometry(fieldR, 64);
  fieldGeo.rotateX(-Math.PI / 2);
  const field = mesh(fieldGeo, fieldMat, 'bare');
  field.position.y = 0.01;
  field.renderOrder = 1;
  k.root.add(field);

  const shadow = new BlobShadow(0.12, 0.32);
  k.root.add(shadow.mesh);

  // The magnet: an extruded U with silver tips, hovering.
  const hover = new THREE.Group();
  const spin = new THREE.Group();
  k.root.add(hover);
  hover.add(spin);
  const Ro = 0.112;
  const Ri = 0.05;
  const cy = Ro;
  const top = 0.27;
  const tipH = 0.064;
  const D = 0.07;
  const B = 0.012;
  const u = new THREE.Shape();
  u.moveTo(-Ro, top - tipH);
  u.lineTo(-Ro, cy);
  u.absarc(0, cy, Ro, Math.PI, TAU, false);
  u.lineTo(Ro, top - tipH);
  u.lineTo(Ri, top - tipH);
  u.lineTo(Ri, cy);
  u.absarc(0, cy, Ri, 0, -Math.PI, true);
  u.lineTo(-Ri, top - tipH);
  u.closePath();
  const extrude = (shape: THREE.Shape, depth: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.014, bevelSize: B, bevelSegments: 2, curveSegments: 12 });
    g.translate(0, B, -depth / 2);
    return g;
  };
  const bodyMat = k.mat(color.magnetBody);
  spin.add(mesh(extrude(u, D), bodyMat));
  const tipMat = k.mat(color.magnetTip);
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -Ro - 0.004 : Ri - 0.004;
    const tip = roundedShape(
      [
        [x0, top - tipH],
        [x0 + Ro - Ri + 0.008, top - tipH],
        [x0 + Ro - Ri + 0.008, top],
        [x0, top],
      ],
      [0.004, 0.004, 0.012, 0.012],
    );
    spin.add(mesh(extrude(tip, D + 0.012), tipMat));
  }
  // cartoon gloss down the front of the left arm
  const shine = roundedShape(
    [
      [-Ro + 0.016, cy - 0.01],
      [-Ro + 0.032, cy - 0.01],
      [-Ro + 0.032, top - tipH - 0.022],
      [-Ro + 0.016, top - tipH - 0.022],
    ],
    0.008,
  );
  const shineGeo = new THREE.ShapeGeometry(shine, 3);
  shineGeo.translate(0, B, D / 2 + 0.0145);
  spin.add(mesh(shineGeo, k.flat({ color: color.paper, transparent: true, opacity: 0.75 }), 'bare'));
  k.outline(spin);

  const BASE_YAW = Math.PI / 4 + 0.32;
  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt, time) {
      k.sync();
      t += dt;
      const s = amp * wobble(t, 42, 6);
      hover.position.y = 0.05 + Math.sin(time * 2.3) * 0.016;
      spin.rotation.set(0, BASE_YAW + Math.sin(time * 0.9) * 0.38 + s * 0.6, Math.sin(time * 1.7) * 0.06 + s * 0.3);
      shadow.set(0, 0, 0, hover.position.y * 1.4);
      fieldU.uTime.value = time;
      // brighter for a moment after a hit, never above 0.35
      fieldU.uAlpha.value = 0.26 + 0.09 * (t < 1 ? Math.min(1, Math.exp(-t * 4) * amp * 2) : 0);
    },
    hit(strength = 1) {
      t = 0;
      amp = 0.5 * clamp(strength, 0.3, 1.5);
    },
    dispose: () => k.dispose(),
  };
}

// ------------------------------------------------------------- boost pad

/**
 * Flat boost pad, 0.62 × 0.62 with rounded corners, under 0.02 tall; three
 * gold chevrons pointing along +x light up in a running sequence.
 * hit(): all chevrons flash.
 */
export function makeBoost(ctx: PropContext): Prop {
  const k = new Kit(ctx);
  const body = new THREE.Group();
  k.root.add(body);
  const H = 0.31; // half size
  const bev = 0.012;
  const pad = mesh(slab(roundedRect(H - bev, H - bev, 0.09), 0.004, 0.004, bev, 2, 6), k.mat(color.boostPad), 'bare');
  body.add(pad);
  // a thin raised lip just inside the edge
  const lipShape = roundedRect(H - 0.035, H - 0.035, 0.07);
  lipShape.holes.push(roundedRect(H - 0.055, H - 0.055, 0.055));
  const lipCol = new THREE.Color(color.boostPad).lerp(new THREE.Color(color.paper), 0.16);
  const lip = mesh(slab(lipShape, 0.002, 0, 0, 1, 6), k.mat('#' + lipCol.getHexString()), 'bare');
  lip.position.y = 0.012;
  body.add(lip);

  const dim = new THREE.Color(color.boostArrow).lerp(new THREE.Color(color.boostPad), 0.3);
  const lit = new THREE.Color(color.boostArrow);
  const glow = new THREE.Color(color.boostArrow);
  const paper = new THREE.Color(color.paper);
  const chevMats: THREE.MeshLambertMaterial[] = [];
  const chevrons = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = k.mat(color.boostArrow);
    chevMats.push(m);
    const g = slab(roundedShape(chevronPts(-0.0515 + i * 0.14, 0.105, 0.14, 0.072), 0.012), 0.0025, 0.0015, 0.003, 1, 4);
    g.translate(0, 0.012, 0);
    chevrons.add(mesh(g, m));
  }
  body.add(chevrons);
  k.outline(chevrons);

  const plateGeo = new THREE.ShapeGeometry(roundedRect(H, H, 0.09), 6);
  plateGeo.rotateX(-Math.PI / 2);
  const plate = inkPlate(k, plateGeo);
  k.root.add(plate);

  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt, time) {
      k.sync();
      t += dt;
      const flash = t < 0.4 ? (1 - t / 0.4) * amp : 0;
      for (let i = 0; i < 3; i++) {
        // a light runs along +x, one chevron after another
        const ph = time * 1.6 - i / 3;
        const c = 0.5 + 0.5 * Math.cos((ph - Math.floor(ph)) * TAU);
        const on = Math.max(c * c * c, flash);
        const m = chevMats[i];
        m.color.copy(dim).lerp(lit, on);
        if (flash > 0) m.color.lerp(paper, flash * 0.45);
        m.emissive.copy(glow).multiplyScalar(on * 0.45);
      }
      const pop = 1 + 0.06 * flash;
      body.scale.set(pop, 1, pop);
      plate.scale.setScalar(((H + k.inkWidth()) / H) * pop);
    },
    hit(strength = 1) {
      t = 0;
      amp = clamp(strength, 0.4, 1.2);
    },
    dispose: () => k.dispose(),
  };
}

// ----------------------------------------------------------------- bumper

/**
 * Pinball bumper, radius 0.17, about 0.26 tall: white base, coral dome cap,
 * white ring. hit(s): squash and stretch with a bright flash.
 */
export function makeBumper(ctx: PropContext): Prop {
  const k = new Kit(ctx);
  const body = new THREE.Group();
  k.root.add(body);
  const R = 0.17;
  const baseMat = k.mat(color.bumperBase);
  const capMat = k.mat(color.bumperTop);
  const ringMat = k.mat(color.bumperBase);
  body.add(
    mesh(
      lathe(
        [
          [R, 0],
          [R + 0.002, 0.022],
          [R - 0.01, 0.042],
          [R - 0.032, 0.052],
          [0.09, 0.054],
          [0, 0.054],
        ],
        28,
      ),
      baseMat,
    ),
  );
  body.add(
    mesh(
      lathe(
        [
          [0.122, 0.046],
          [0.124, 0.142],
          [0.152, 0.154],
          [0.15, 0.185],
          [0.132, 0.214],
          [0.097, 0.237],
          [0.052, 0.249],
          [0, 0.252],
        ],
        28,
      ),
      capMat,
    ),
  );
  const ringGeo = new THREE.TorusGeometry(0.128, 0.024, 6, 28);
  ringGeo.rotateX(Math.PI / 2);
  ringGeo.translate(0, 0.122, 0);
  body.add(mesh(ringGeo, ringMat));
  const pipGeo = new THREE.SphereGeometry(0.042, 10, 6);
  pipGeo.scale(1, 0.5, 1);
  pipGeo.translate(0, 0.247, 0);
  const pipMat = k.mat(color.paper);
  body.add(mesh(pipGeo, pipMat));
  k.outline(body);

  const plate = inkPlate(k, groundDisc(40));
  body.add(plate);
  const shadow = new BlobShadow(0.25, 0.22);
  shadow.set(0, 0, 0, 0);
  k.root.add(shadow.mesh);

  const gold = new THREE.Color(color.gold);
  const white = new THREE.Color(color.paper);
  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt, time) {
      k.sync();
      t += dt;
      const w = amp * wobble(t, 30, 9);
      body.scale.set(1 + w * 0.55, 1 - w, 1 + w * 0.55);
      const f = t < 0.3 ? (1 - t / 0.3) * Math.min(1, amp * 4) : 0;
      capMat.emissive.copy(gold).multiplyScalar(f * 0.65);
      ringMat.emissive.copy(gold).multiplyScalar(f * 0.4);
      pipMat.emissive.copy(white).multiplyScalar(0.1 + 0.1 * Math.sin(time * 3.2) + f * 0.6);
      plate.scale.setScalar(R + k.inkWidth());
    },
    hit(strength = 1) {
      t = 0;
      amp = 0.24 * clamp(strength, 0.4, 1.5);
    },
    dispose: () => k.dispose(),
  };
}

// ----------------------------------------------------------------- portal

/**
 * Portal: a chunky ring (radius 0.28) lying flat in `colorHex`, an animated
 * swirl inside and a few glints spiralling up. hit(): pulse and flash.
 */
export function makePortal(ctx: PropContext, colorHex: string): Prop {
  const k = new Kit(ctx);
  const body = new THREE.Group();
  k.root.add(body);
  const R = 0.28;
  const tube = 0.05;
  const FLAT = 0.75;

  const ringGeo = new THREE.TorusGeometry(R, tube, 7, 36);
  ringGeo.rotateX(Math.PI / 2);
  ringGeo.scale(1, FLAT, 1);
  ringGeo.translate(0, tube * FLAT, 0);
  const ringMat = k.mat(colorHex);
  const ring = mesh(ringGeo, ringMat);
  body.add(ring);
  k.outline(ring);

  const base = new THREE.Color(colorHex);
  const ink = new THREE.Color(color.ink);
  const paper = new THREE.Color(color.paper);
  const swirlR = R - tube * 0.2;
  const swirlU = {
    ...ctx.fade,
    uR: { value: swirlR },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uColor: { value: base.clone() },
    uDeep: { value: base.clone().lerp(ink, 0.6) },
    uLight: { value: base.clone().lerp(paper, 0.65) },
  };
  const swirlGeo = new THREE.CircleGeometry(swirlR, 48);
  swirlGeo.rotateX(-Math.PI / 2);
  const swirl = mesh(
    swirlGeo,
    new THREE.ShaderMaterial({
      uniforms: swirlU,
      transparent: true,
      depthWrite: false,
      vertexShader: GROUND_VERT,
      fragmentShader: /* glsl */ `
        ${FADE_GLSL}
        uniform float uTime;
        uniform float uFlash;
        uniform vec3 uColor;
        uniform vec3 uDeep;
        uniform vec3 uLight;
        varying vec2 vP;
        varying float vY;
        void main() {
          float r = length(vP);
          float a = atan(vP.y, vP.x);
          float arms = smoothstep(0.15, 0.8, sin(a * 3.0 + r * 9.0 - uTime * 4.5));
          vec3 col = mix(uDeep, uColor, smoothstep(0.0, 0.95, r));
          col = mix(col, uLight, arms * smoothstep(0.1, 0.75, r) * 0.9);
          col = mix(col, vec3(1.0), uFlash * 0.75);
          float aa = fwidth(r) * 1.5;
          float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);
          float k = skyK(vY);
          gl_FragColor = linearToOutputTexel(vec4(mix(col, uBg, k), alpha * (1.0 - k)));
        }`,
    }),
    'bare',
  );
  swirl.position.y = 0.006;
  body.add(swirl);

  const plate = inkPlate(k, groundDisc(48));
  body.add(plate);

  // Glints spiralling up out of the swirl.
  const glintGeo = new THREE.OctahedronGeometry(1, 0);
  const glintMat = k.flat({ color: '#' + base.clone().lerp(paper, 0.7).getHexString() });
  const glints: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const g = mesh(glintGeo, glintMat, 'bare');
    glints.push(g);
    body.add(g);
  }

  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt, time) {
      k.sync();
      t += dt;
      const flash = t < 0.5 ? (1 - t / 0.5) * amp : 0;
      const pulse = 1 + 0.12 * amp * wobble(t, 22, 7) + 0.015 * Math.sin(time * 3);
      ring.scale.set(pulse, 1, pulse);
      ringMat.emissive.copy(base).multiplyScalar(flash * 0.5);
      swirlU.uTime.value = time;
      swirlU.uFlash.value = flash;
      plate.scale.setScalar((R + tube + k.inkWidth()) * pulse);
      for (let i = 0; i < glints.length; i++) {
        const u = (time * 0.45 + i / glints.length) % 1;
        const a = time * 2.2 + i * 2.39996 + u * 3;
        const rr = 0.2 * (1 - u * 0.55);
        const g = glints[i];
        g.position.set(Math.cos(a) * rr, 0.03 + u * 0.42, Math.sin(a) * rr);
        g.rotation.set(0, a * 2, 0);
        const s = 0.026 * Math.sin(u * Math.PI) * (1 + flash);
        g.scale.set(s * 0.7, s, s * 0.7);
      }
    },
    hit(strength = 1) {
      t = 0;
      amp = clamp(strength, 0.4, 1.4);
    },
    dispose: () => k.dispose(),
  };
}

// --------------------------------------------------------------- conveyor

/**
 * Conveyor belt overlay for one tile, centred on the origin and lying on the
 * surface: a dark rounded plate (0.92 × 0.92) with rails along the sides,
 * rollers at both ends and gold chevrons gliding along +x at `speed` tiles/s.
 * Belts laid end to end line up. hit(): a brief brighter flash.
 */
export function makeConveyor(ctx: PropContext, speed = 0.5): Prop {
  const k = new Kit(ctx);
  const S = 0.92;
  const px = 256 / S; // canvas pixels per tile unit
  const INK = 0.022;
  const RAIL = 0.085; // side rail width
  const ROLL = 0.07; // end roller width
  const baseCol = new THREE.Color(color.beltBase);
  const light = '#' + baseCol.clone().lerp(new THREE.Color(color.paper), 0.18).getHexString();
  const dark = '#' + baseCol.clone().lerp(new THREE.Color(color.ink), 0.4).getHexString();
  const baseTex = k.own(
    canvasTexture(256, 256, (g) => {
      const ink = INK * px;
      const r = RAIL * px;
      const ro = ROLL * px;
      g.fillStyle = color.ink;
      roundRectPath(g, 1, 1, 254, 254, 0.1 * px);
      g.fill();
      g.save();
      roundRectPath(g, 1 + ink, 1 + ink, 254 - 2 * ink, 254 - 2 * ink, 0.1 * px - ink);
      g.clip();
      g.fillStyle = color.beltBase;
      g.fillRect(0, 0, 256, 256);
      // rollers at both ends: a dark drum with a highlight
      for (const x of [1 + ink, 255 - ink - ro]) {
        g.fillStyle = dark;
        g.fillRect(x, 0, ro, 256);
        g.fillStyle = light;
        g.fillRect(x + ro * 0.3, 0, ro * 0.22, 256);
      }
      // side rails with rivets
      g.fillStyle = light;
      g.fillRect(0, 0, 256, r);
      g.fillRect(0, 256 - r, 256, r);
      g.fillStyle = dark;
      g.fillRect(0, r - 3, 256, 3);
      g.fillRect(0, 256 - r, 256, 3);
      for (let i = 0; i < 6; i++) {
        const x = 26 + i * 40.8;
        for (const y of [ink + (r - ink) * 0.45, 256 - ink - (r - ink) * 0.45]) {
          g.beginPath();
          g.arc(x, y, 3.2, 0, TAU);
          g.fill();
        }
      }
      g.restore();
    }),
  );
  const planeGeo = new THREE.PlaneGeometry(S, S);
  planeGeo.rotateX(-Math.PI / 2);
  const baseMat = k.flat({ map: baseTex, transparent: true, depthWrite: false });
  const base = mesh(planeGeo, baseMat, 'bare');
  base.position.y = 0.004;
  base.renderOrder = -1;
  k.root.add(base);

  // Chevrons between the rollers, three per tile, scrolled by the texture offset.
  const W = S - 2 * (INK + ROLL);
  const D = S - 2 * RAIL - 0.04;
  const N = 3;
  const chevTex = k.own(
    canvasTexture(128, 256, (g) => {
      g.lineJoin = 'round';
      g.beginPath();
      chevronPts(98, 50, 82, 36).forEach(([x, y], i) => (i === 0 ? g.moveTo(x, 128 + y) : g.lineTo(x, 128 + y)));
      g.closePath();
      g.strokeStyle = color.ink;
      g.lineWidth = 11;
      g.stroke();
      g.fillStyle = color.beltArrow;
      g.fill();
    }),
  );
  chevTex.wrapS = THREE.RepeatWrapping;
  chevTex.repeat.set(N, 1);
  const chevGeo = new THREE.PlaneGeometry(W, D);
  chevGeo.rotateX(-Math.PI / 2);
  const chevMat = k.flat({ map: chevTex, transparent: true, depthWrite: false });
  const chev = mesh(chevGeo, chevMat, 'bare');
  chev.position.y = 0.006;
  k.root.add(chev);

  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt, time) {
      k.sync();
      t += dt;
      // texture units per second: N repeats span W tiles
      const shift = (time * speed * N) / W;
      chevTex.offset.x = -(shift - Math.floor(shift));
      const f = 1 + (t < 0.3 ? (1 - t / 0.3) * 0.6 * amp : 0);
      chevMat.color.setScalar(f);
      baseMat.color.setScalar(f);
    },
    hit(strength = 1) {
      t = 0;
      amp = clamp(strength, 0.3, 1.2);
    },
    dispose: () => k.dispose(),
  };
}

// ----------------------------------------------------------------- bridge

/**
 * One tile of wooden plank bridge along +x, from x = −0.5 to 0.5, 0.42 wide
 * (z ±0.21): deck top at y = 0, 0.08 deep. Bridges laid end to end tile
 * seamlessly. hit(): a small springy dip.
 */
export function makeBridge(ctx: PropContext): Prop {
  const k = new Kit(ctx);
  const body = new THREE.Group();
  k.root.add(body);
  const N = 6;
  const pitch = 1 / N;
  const jitter = [
    [0.006, -0.012, 0.02],
    [-0.004, 0.008, -0.025],
    [0.01, 0.004, 0.015],
    [-0.008, -0.006, -0.012],
    [0.003, 0.01, 0.03],
    [-0.006, -0.004, -0.02],
  ];
  const planks: THREE.BufferGeometry[][] = [[], []];
  for (let i = 0; i < N; i++) {
    const [dz, dl, yaw] = jitter[i];
    const g = new RoundedBoxGeometry(pitch - 0.026, 0.044, 0.41 + dl, 1, 0.011);
    g.rotateY(yaw);
    g.translate(-0.5 + (i + 0.5) * pitch, -0.022, dz * 0.6);
    planks[i % 2].push(g);
  }
  const woodB = '#' + new THREE.Color(color.wood).lerp(new THREE.Color(color.woodDark), 0.32).getHexString();
  body.add(mesh(merge(planks[0]), k.mat(color.wood)));
  body.add(mesh(merge(planks[1]), k.mat(woodB)));
  body.add(mesh(merge([roundBox(1, 0.036, 0.05, 0.011, 0, -0.062, -0.13), roundBox(1, 0.036, 0.05, 0.011, 0, -0.062, 0.13)]), k.mat(color.woodDark)));
  k.outline(body);

  let t = 9;
  let amp = 0;
  return {
    root: k.root,
    update(dt) {
      k.sync();
      t += dt;
      body.position.y = -amp * wobble(t, 26, 8);
    },
    hit(strength = 1) {
      t = 0;
      amp = 0.012 * clamp(strength, 0.3, 1.5);
    },
    dispose: () => k.dispose(),
  };
}
