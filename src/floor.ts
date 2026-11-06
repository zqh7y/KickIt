// Builds one floor: textured pitch tops with rounded outer corners, pillar
// sides that fade into the sky, and screen-space outlines. Three draw calls;
// every tile can rise or crumble on its own through the shared animation
// uniforms. Plank bridges have no pillar: their planks are props.
import * as THREE from 'three';
import { CORNER_R, cornerCentre, type Floor, type Tile } from './levels.ts';
import { animGlsl, fadeGlsl, makeFloorUniforms, type FloorUniforms } from './floorShaders.ts';
import { makePitchTexture } from './pitchTexture.ts';
import { color } from './theme.ts';
import { rng } from './util.ts';

const PILLAR_DEPTH = 9;
const ARC_STEPS = 7;
/** Arc start angle per corner (x0z0, x1z0, x1z1, x0z1), angle measured from +x toward +z. */
const ARC_START = [Math.PI, -Math.PI / 2, 0, Math.PI / 2];

export interface LineUniforms {
  [key: string]: THREE.IUniform;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uLineWidth: THREE.IUniform<number>;
  uInk: THREE.IUniform<THREE.Color>;
}

export function makeLineUniforms(): LineUniforms {
  return {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uLineWidth: { value: 3 },
    uInk: { value: new THREE.Color(color.ink) },
  };
}

type P3 = [number, number, number];
interface Seg {
  a: P3;
  b: P3;
  w: number;
  t: Tile;
}
interface Face {
  t: Tile;
  /** top and bottom points, two of each, in order along the face */
  top: [P3, P3];
  bot: [P3, P3];
  /** colour blend at each end: 0 = right-face colour, 1 = left-face colour */
  mix: [number, number];
}

const planeAt = (t: Tile, x: number, z: number) => t.c[0] + t.gx * (x - t.i) + t.gz * (z - t.j);
const solid = (f: Floor, i: number, j: number) => {
  const n = f.at(i, j);
  return n && n.bridge === 0 ? n : undefined;
};

export class FloorView {
  readonly floor: Floor;
  readonly group = new THREE.Group();
  readonly uniforms: FloorUniforms;
  readonly tileRand = new Map<Tile, number>();
  private texture: THREE.Texture;
  private meshes: THREE.Mesh[] = [];
  private faces: Face[] = [];
  private segs: Seg[] = [];

  constructor(floor: Floor, sky: THREE.Color, lineU: LineUniforms, maxTex: number, anisotropy: number) {
    this.floor = floor;
    this.uniforms = makeFloorUniforms(sky);
    this.uniforms.uFadeTop.value = floor.minTop - 0.35;
    this.uniforms.uFadeBottom.value = floor.minTop - 3.9;
    const R = rng(floor.def.seed * 7 + 3);
    for (const t of floor.tiles) this.tileRand.set(t, R());
    this.texture = makePitchTexture(floor, maxTex, anisotropy);
    this.outline();
    this.meshes.push(this.buildTops(), this.buildSides(), this.buildLines(lineU));
    for (const m of this.meshes) {
      m.frustumCulled = false; // vertices move in the shader
      this.group.add(m);
    }
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.texture.dispose();
    this.group.removeFromParent();
  }

  /** Top outline of a block tile: points around it, rounded corners as arcs. */
  private ring(t: Tile): [number, number][] {
    const pts: [number, number][] = [];
    const corner: [number, number][] = [
      [t.i, t.j],
      [t.i + 1, t.j],
      [t.i + 1, t.j + 1],
      [t.i, t.j + 1],
    ];
    for (let k = 0; k < 4; k++) {
      if (!t.round[k]) {
        pts.push(corner[k]);
        continue;
      }
      const [cx, cz] = cornerCentre(t, k);
      for (let s = 0; s <= ARC_STEPS; s++) {
        const a = ARC_START[k] + (s / ARC_STEPS) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * CORNER_R, cz + Math.sin(a) * CORNER_R]);
      }
    }
    return pts;
  }

  /**
   * Works out every side face and every outline segment, on all four sides,
   * so the floor holds up from any angle (the lobby turns around it). Faces
   * and lines on the far side are hidden by the depth test.
   */
  private outline() {
    const f = this.floor;
    const deep = f.minTop - PILLAR_DEPTH;
    const seen = new Set<string>();
    const vline = (p: P3, bottom: number, t: Tile) => {
      const key = `${p[0].toFixed(3)},${p[2].toFixed(3)},${p[1].toFixed(3)}`;
      if (seen.has(key) || p[1] - bottom < 1e-4) return;
      seen.add(key);
      this.segs.push({ a: p, b: [p[0], bottom, p[2]], w: 0.85, t });
    };
    const same = (p: number, q: number) => Math.abs(p - q) < 1e-4;

    for (const t of f.tiles) {
      if (t.bridge) continue;
      const r = t.round;
      const R0 = (k: number) => (r[k] ? CORNER_R : 0);
      // straight parts of the four edges: [start, end, neighbour, corner at start, corner at end]
      const edges: { a: [number, number]; b: [number, number]; n: Tile | undefined; ka: number; kb: number; nx: number; nz: number }[] = [
        { a: [t.i + R0(0), t.j], b: [t.i + 1 - R0(1), t.j], n: solid(f, t.i, t.j - 1), ka: 0, kb: 1, nx: 0, nz: -1 },
        { a: [t.i + 1, t.j + R0(1)], b: [t.i + 1, t.j + 1 - R0(2)], n: solid(f, t.i + 1, t.j), ka: 1, kb: 2, nx: 1, nz: 0 },
        { a: [t.i + R0(3), t.j + 1], b: [t.i + 1 - R0(2), t.j + 1], n: solid(f, t.i, t.j + 1), ka: 3, kb: 2, nx: 0, nz: 1 },
        { a: [t.i, t.j + R0(0)], b: [t.i, t.j + 1 - R0(3)], n: solid(f, t.i - 1, t.j), ka: 0, kb: 3, nx: -1, nz: 0 },
      ];
      for (const e of edges) {
        const ta = planeAt(t, e.a[0], e.a[1]);
        const tb = planeAt(t, e.b[0], e.b[1]);
        const na = e.n ? planeAt(e.n, e.a[0], e.a[1]) : -Infinity;
        const nb = e.n ? planeAt(e.n, e.b[0], e.b[1]) : -Infinity;
        const A: P3 = [e.a[0], ta, e.a[1]];
        const B: P3 = [e.b[0], tb, e.b[1]];
        // outline where the surface does not continue across the edge
        if (!(e.n && same(ta, na) && same(tb, nb)) && Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) > 1e-4) {
          this.segs.push({ a: A, b: B, w: 1, t });
        }
        // Every wall goes all the way down: hidden inside the floor at rest, it
        // closes the gaps while tiles rise and crumble apart. Shade: the sun
        // side (+z, -x) light, the other two dark.
        const m = (e.nz - e.nx + 1) / 2;
        this.faces.push({ t, top: [A, B], bot: [[A[0], deep, A[2]], [B[0], deep, B[2]]], mix: [m, m] });
        // outlines only where the wall really shows at rest
        const ba = e.n ? Math.min(na, ta) : deep;
        const bb = e.n ? Math.min(nb, tb) : deep;
        if (ta - ba < 1e-4 && tb - bb < 1e-4) continue;
        // vertical edges where the face ends sharply (not into a rounded corner)
        if (!r[e.ka]) vline(A, ba, t);
        if (!r[e.kb]) vline(B, bb, t);
      }
      // rounded corners: curved top outline, curved sides, silhouettes
      for (let k = 0; k < 4; k++) {
        if (!r[k]) continue;
        const [cx, cz] = cornerCentre(t, k);
        let prev: P3 | null = null;
        let prevA = 0;
        for (let s = 0; s <= ARC_STEPS; s++) {
          const a = ARC_START[k] + (s / ARC_STEPS) * (Math.PI / 2);
          const x = cx + Math.cos(a) * CORNER_R;
          const z = cz + Math.sin(a) * CORNER_R;
          const p: P3 = [x, planeAt(t, x, z), z];
          if (prev) {
            this.segs.push({ a: prev, b: p, w: 1, t });
            // shade by the outward normal, as the straight walls are
            const mixOf = (ang: number) => Math.min(1, Math.max(0, (Math.sin(ang) - Math.cos(ang) + 1) / 2));
            this.faces.push({
              t,
              top: [prev, p],
              bot: [[prev[0], deep, prev[2]], [p[0], deep, p[2]]],
              mix: [mixOf(prevA), mixOf(a)],
            });
          }
          prev = p;
          prevA = a;
        }
        // silhouette of the curved side against the sky
        const sil = k === 1 ? -Math.PI / 4 : k === 3 ? (3 * Math.PI) / 4 : null;
        if (sil !== null) {
          const x = cx + Math.cos(sil) * CORNER_R;
          const z = cz + Math.sin(sil) * CORNER_R;
          vline([x, planeAt(t, x, z), z], deep, t);
        }
      }
    }
  }

  // ---------------------------------------------------------------- tops
  private buildTops(): THREE.Mesh {
    const f = this.floor;
    const pos: number[] = [];
    const uv: number[] = [];
    const center: number[] = [];
    const rand: number[] = [];
    for (const t of f.tiles) {
      if (t.bridge) continue;
      const ring = this.ring(t);
      const cx = t.i + 0.5;
      const cz = t.j + 0.5;
      const r = this.tileRand.get(t)!;
      const push = (x: number, z: number) => {
        pos.push(x, planeAt(t, x, z), z);
        uv.push(x / f.w, z / f.d);
        center.push(cx, cz);
        rand.push(r);
      };
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k];
        const q = ring[(k + 1) % ring.length];
        // wound for an upward normal
        push(cx, cz);
        push(q[0], q[1]);
        push(p[0], p[1]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(center, 2));
    geo.setAttribute('aRand', new THREE.Float32BufferAttribute(rand, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, map: { value: this.texture } },
      vertexShader: /* glsl */ `
        ${animGlsl}
        varying vec2 vUv;
        varying float vY;
        void main() {
          vec3 p = position;
          p.y += animOffset();
          vY = p.y;
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${fadeGlsl}
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vY;
        void main() {
          vec3 col = texture2D(map, vUv).rgb;
          gl_FragColor = linearToOutputTexel(vec4(skyFade(col, vY), 1.0));
        }`,
    });
    return new THREE.Mesh(geo, mat);
  }

  // --------------------------------------------------------------- sides
  private buildSides(): THREE.Mesh {
    const pos: number[] = [];
    const col: number[] = [];
    const center: number[] = [];
    const rand: number[] = [];
    const grassR = new THREE.Color(color.sideRight);
    const grassL = new THREE.Color(color.sideLeft);
    const iceL = new THREE.Color(color.iceSide);
    const iceR = new THREE.Color(color.iceSide).multiplyScalar(0.82);
    const c = new THREE.Color();
    for (const face of this.faces) {
      const ice = face.t.surface === 'ice';
      const [A, B] = face.top;
      const [a, b] = face.bot;
      const colA = c.copy(ice ? iceR : grassR).lerp(ice ? iceL : grassL, face.mix[0]).toArray([]) as number[];
      const colB = c.copy(ice ? iceR : grassR).lerp(ice ? iceL : grassL, face.mix[1]).toArray([]) as number[];
      // the face runs A -> B; wind so its outward normal faces the camera
      const verts: [P3, number[]][] = [
        [a, colA], [B, colB], [b, colB],
        [a, colA], [A, colA], [B, colB],
      ];
      // pick the winding from the geometry: normal = (B - a) x (A - a) must point outward
      const ex = B[0] - a[0];
      const ez = B[2] - a[2];
      const outward = this.outwardOf(face);
      const flip = ex * outward[1] - ez * outward[0] > 0;
      const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
      const r = this.tileRand.get(face.t)!;
      for (const k of order) {
        const [p, cc] = verts[k];
        pos.push(p[0], p[1], p[2]);
        col.push(cc[0], cc[1], cc[2]);
        center.push(face.t.i + 0.5, face.t.j + 0.5);
        rand.push(r);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(center, 2));
    geo.setAttribute('aRand', new THREE.Float32BufferAttribute(rand, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${animGlsl}
        attribute vec3 aColor;
        varying vec3 vColor;
        varying float vY;
        void main() {
          vec3 p = position;
          p.y += animOffset();
          vY = p.y;
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${fadeGlsl}
        varying vec3 vColor;
        varying float vY;
        void main() {
          gl_FragColor = linearToOutputTexel(vec4(skyFade(vColor, vY), 1.0));
        }`,
    });
    return new THREE.Mesh(geo, mat);
  }

  /** Outward horizontal normal of a side face (from the tile centre outward). */
  private outwardOf(face: Face): [number, number] {
    const [A, B] = face.top;
    const mx = (A[0] + B[0]) / 2 - (face.t.i + 0.5);
    const mz = (A[2] + B[2]) / 2 - (face.t.j + 0.5);
    // the face direction's perpendicular that points away from the centre
    const dx = B[0] - A[0];
    const dz = B[2] - A[2];
    let nx = dz;
    let nz = -dx;
    if (nx * mx + nz * mz < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [nx, nz];
  }

  // --------------------------------------------------------------- lines
  private buildLines(lineU: LineUniforms): THREE.Mesh {
    const segs = this.segs;
    const n = segs.length;
    const aStart = new Float32Array(n * 4 * 3);
    const aEnd = new Float32Array(n * 4 * 3);
    const aSide = new Float32Array(n * 4);
    const aAlong = new Float32Array(n * 4);
    const aWidth = new Float32Array(n * 4);
    const aCenter = new Float32Array(n * 4 * 2);
    const aRand = new Float32Array(n * 4);
    const index: number[] = [];
    segs.forEach((s, k) => {
      const r = this.tileRand.get(s.t)!;
      for (let v = 0; v < 4; v++) {
        const o = k * 4 + v;
        aStart.set(s.a, o * 3);
        aEnd.set(s.b, o * 3);
        aSide[o] = v % 2 === 0 ? -1 : 1;
        aAlong[o] = v < 2 ? 0 : 1;
        aWidth[o] = s.w;
        aCenter.set([s.t.i + 0.5, s.t.j + 0.5], o * 2);
        aRand[o] = r;
      }
      const b = k * 4;
      index.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    // `position` is required by three; the shader builds positions itself.
    geo.setAttribute('position', new THREE.BufferAttribute(aStart, 3));
    geo.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(aAlong, 1));
    geo.setAttribute('aWidth', new THREE.BufferAttribute(aWidth, 1));
    geo.setAttribute('aCenter', new THREE.BufferAttribute(aCenter, 2));
    geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));
    geo.setIndex(index);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...lineU },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${animGlsl}
        attribute vec3 aStart;
        attribute vec3 aEnd;
        attribute float aSide;
        attribute float aAlong;
        attribute float aWidth;
        uniform vec2 uResolution;
        uniform float uLineWidth;
        varying float vY;
        void main() {
          float off = animOffset();
          vec3 s = aStart; s.y += off;
          vec3 e = aEnd; e.y += off;
          vec4 cs = projectionMatrix * modelViewMatrix * vec4(s, 1.0);
          vec4 ce = projectionMatrix * modelViewMatrix * vec4(e, 1.0);
          vec2 half_ = uResolution * 0.5;
          vec2 ss = cs.xy / cs.w * half_;
          vec2 se = ce.xy / ce.w * half_;
          vec2 d = se - ss;
          float len = length(d);
          vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float w = uLineWidth * aWidth * 0.5;
          vec4 c = mix(cs, ce, aAlong);
          vec2 o = nrm * aSide * w + dir * (aAlong * 2.0 - 1.0) * w; // square caps close the joints
          c.xy += o / half_ * c.w;
          c.z -= 0.00008 * c.w; // about 0.016 tiles toward the camera: clears the faces they outline
          gl_Position = c;
          vY = mix(s.y, e.y, aAlong);
        }`,
      fragmentShader: /* glsl */ `
        ${fadeGlsl}
        uniform vec3 uInk;
        varying float vY;
        void main() {
          gl_FragColor = linearToOutputTexel(vec4(skyFade(uInk, vY), 1.0));
        }`,
    });
    return new THREE.Mesh(geo, mat);
  }
}
