// Shared GLSL for floor pieces (tops, sides, outlines): the per-tile rise /
// crumble animation and the height fade that dissolves pillars into the sky.
import * as THREE from 'three';

export interface FloorUniforms {
  [key: string]: THREE.IUniform;
  uBg: THREE.IUniform<THREE.Color>;
  uFadeTop: THREE.IUniform<number>;
  uFadeBottom: THREE.IUniform<number>;
  uAnimMode: THREE.IUniform<number>; // 0 still, 1 rise, 2 crumble, 3 drop from mid-rise
  uFreeze: THREE.IUniform<number>; // rise time at which mode 3 took over
  uAnimT: THREE.IUniform<number>;
  uAnimOrigin: THREE.IUniform<THREE.Vector2>;
  uAnimSpread: THREE.IUniform<number>;
}

export function makeFloorUniforms(bg: THREE.Color): FloorUniforms {
  return {
    uBg: { value: bg },
    uFadeTop: { value: -0.4 },
    uFadeBottom: { value: -4.2 },
    uAnimMode: { value: 0 },
    uFreeze: { value: 0 },
    uAnimT: { value: 0 },
    uAnimOrigin: { value: new THREE.Vector2() },
    uAnimSpread: { value: 0.07 },
  };
}

// Keep in sync with tileAnimOffset() below (the ball and footballer ride their tile).
export const animGlsl = /* glsl */ `
uniform float uAnimMode;
uniform float uAnimT;
uniform float uFreeze;
uniform vec2 uAnimOrigin;
uniform float uAnimSpread;
attribute vec2 aCenter;
attribute float aRand;
float animDelay() {
  return length(aCenter - uAnimOrigin) * uAnimSpread + aRand * 0.09;
}
float riseOffset(float t) {
  float k = clamp(t / 0.5, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - k, 4.0);
  float bump = sin(clamp((k - 0.62) / 0.38, 0.0, 1.0) * 3.14159) * 0.05;
  return -9.0 * (1.0 - e) + bump;
}
float animOffset() {
  if (uAnimMode < 0.5) return 0.0;
  if (uAnimMode > 2.5) {
    // dropped while still rising: fall from wherever each tile was
    float t3 = max(uAnimT, 0.0);
    return riseOffset(uFreeze - animDelay()) - 1.2 * t3 - 16.0 * t3 * t3;
  }
  float t = uAnimT - animDelay();
  if (uAnimMode < 1.5) return riseOffset(t);
  t = max(t, 0.0);
  return -1.2 * t - 16.0 * t * t;
}
`;

/** CPU twin of animOffset() for objects standing on a tile. */
function riseOffset(t: number): number {
  const k = Math.min(1, Math.max(0, t / 0.5));
  const e = 1 - Math.pow(1 - k, 4);
  const bump = Math.sin(Math.min(1, Math.max(0, (k - 0.62) / 0.38)) * Math.PI) * 0.05;
  return -9 * (1 - e) + bump;
}

export function tileAnimOffset(u: FloorUniforms, cx: number, cz: number, rand: number): number {
  const mode = u.uAnimMode.value;
  if (mode < 0.5) return 0;
  const o = u.uAnimOrigin.value;
  const delay = Math.hypot(cx - o.x, cz - o.y) * u.uAnimSpread.value + rand * 0.09;
  if (mode > 2.5) {
    const t3 = Math.max(u.uAnimT.value, 0);
    return riseOffset(u.uFreeze.value - delay) - 1.2 * t3 - 16 * t3 * t3;
  }
  let t = u.uAnimT.value - delay;
  if (mode < 1.5) return riseOffset(t);
  t = Math.max(t, 0);
  return -1.2 * t - 16 * t * t;
}


/** 4x4 ordered-dither threshold in [0, 1) for a screen pixel. */
export const ditherGlsl = /* glsl */ `
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
`;

/**
 * Below the floor everything dissolves into the sky: a dithered fade (so the
 * clouds show through) that also takes on a little of the sky colour.
 */
export const fadeGlsl = /* glsl */ `
${ditherGlsl}
uniform vec3 uBg;
uniform float uFadeTop;
uniform float uFadeBottom;
vec3 skyFade(vec3 col, float y) {
  float k = smoothstep(uFadeBottom, uFadeTop, y);
  if (k < 0.999 && k <= bayer4(gl_FragCoord.xy) + 0.03) discard;
  return mix(uBg, col, 0.45 + 0.55 * k);
}
`;
