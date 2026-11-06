// Materials for the ball and footballer: faceted Lambert shading, an
// inverted-hull ink outline, and the same height fade the pillars use (so a
// falling ball dissolves into the sky).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ditherGlsl } from './floorShaders.ts';
import { color } from './theme.ts';

export interface SkyFade {
  uBg: THREE.IUniform<THREE.Color>;
  uFadeTop: THREE.IUniform<number>;
  uFadeBottom: THREE.IUniform<number>;
}

export function makeSkyFade(bg: THREE.Color): SkyFade {
  return { uBg: { value: bg }, uFadeTop: { value: -0.4 }, uFadeBottom: { value: -4 } };
}

/** Faceted Lambert material that fades into the sky below the floor. */
export function toonMaterial(hex: string, fade: SkyFade, opts: { emissive?: string } = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
  if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, fade);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vWorldY;\nuniform vec3 uBg;\nuniform float uFadeTop;\nuniform float uFadeBottom;\n' + ditherGlsl,
      )
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nfloat kFade = smoothstep(uFadeBottom, uFadeTop, vWorldY);\nif (kFade < 0.999 && kFade <= bayer4(gl_FragCoord.xy) + 0.03) discard;\ngl_FragColor.rgb = mix(linearToOutputTexel(vec4(uBg, 1.0)).rgb, gl_FragColor.rgb, 0.45 + 0.55 * kFade);',
      );
  };
  m.customProgramCacheKey = () => 'toon-fade';
  return m;
}

/** The scene's light rig: sky/grass hemisphere and the sun (the HUD kick ball uses it too). */
export function sceneLights(): THREE.Light[] {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9cc864, 1.85);
  const sun = new THREE.DirectionalLight(0xffffff, 1.55);
  sun.position.set(-2, 5, 3);
  return [hemi, sun];
}

export interface OutlineUniforms {
  [key: string]: THREE.IUniform;
  uOutline: THREE.IUniform<number>; // world units
  uInk: THREE.IUniform<THREE.Color>;
}

export function makeOutlineUniforms(): OutlineUniforms {
  return { uOutline: { value: 0.02 }, uInk: { value: new THREE.Color(color.ink) } };
}

/** Back-face hull pushed out along smooth normals, in world space. */
export function outlineMaterial(u: OutlineUniforms, fade: SkyFade, scale: THREE.IUniform<number>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, ...fade, uScale: scale },
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      uniform float uOutline;
      uniform float uScale;
      varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        wp.xyz += wn * uOutline * uScale;
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      uniform vec3 uBg;
      uniform float uFadeTop;
      uniform float uFadeBottom;
      varying float vY;
      ${ditherGlsl}
      void main() {
        float k = smoothstep(uFadeBottom, uFadeTop, vY);
        if (k < 0.999 && k <= bayer4(gl_FragCoord.xy) + 0.03) discard;
        vec3 c = mix(uBg, uInk, 0.45 + 0.55 * k);
        gl_FragColor = linearToOutputTexel(vec4(c, 1.0));
      }`,
  });
}

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Geometry with merged vertices and smooth normals, so the hull has no cracks. */
export function hullGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let h = hullCache.get(geo);
  if (h) return h;
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  h = mergeVertices(g, 1e-4);
  h.computeVertexNormals();
  hullCache.set(geo, h);
  return h;
}

/** Adds an outline hull next to every mesh under `root`. */
export function addOutlines(root: THREE.Object3D, mat: THREE.ShaderMaterial, skip: (m: THREE.Mesh) => boolean = () => false) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !skip(o as THREE.Mesh)) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    const hull = new THREE.Mesh(hullGeometry(m.geometry), mat);
    hull.name = 'outline';
    hull.renderOrder = -1;
    m.add(hull);
  }
}
