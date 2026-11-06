// The goal: a flat cartoon bullseye on the pitch with a chunky gold arrow
// bobbing above it, so it reads at a glance as "stop the ball here". It warms
// to gold while the ball settles inside it and pops when the floor is cleared.
//
// group's origin is the bullseye centre on the surface. The bullseye is a
// single flat disc (no thickness, so the ball rolls over it); setRadius()
// scales only the bullseye. The arrow hovers about 0.7 above the centre.
import * as THREE from 'three';
import { BlobShadow } from './ball.ts';
import { roundedShape } from './props.ts';
import { color, skies } from './theme.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addOutlines, makeOutlineUniforms, makeSkyFade, outlineMaterial, toonMaterial, type OutlineUniforms, type SkyFade } from './toon.ts';
import { clamp, damp } from './util.ts';

const TAU = Math.PI * 2;
/** The bullseye disc mesh is this many radii wide, for the pulse rings outside it. */
const DISC_SPAN = 2.05;
/** Camera tilt (see camera.ts): heights show at cos, ground depths at sin. */
const UP = Math.cos(THREE.MathUtils.degToRad(52));
const DEEP = Math.sin(THREE.MathUtils.degToRad(52));

// Arrow, pointing down with the tip at the origin.
const HW = 0.215; // head half width
const HH = 0.2; // head height
const SW = 0.098; // shaft half width
const AH = 0.46; // total height
const AD = 0.075; // depth before the bevel
const BEVEL = 0.026;

function arrowGeometry(): THREE.BufferGeometry {
  const hw = HW;
  const hh = HH;
  const sw = SW;
  const H = AH;
  const shape = roundedShape(
    [
      [0, 0],
      [hw, hh],
      [sw, hh],
      [sw, H],
      [-sw, H],
      [-sw, hh],
      [-hw, hh],
    ],
    [0.045, 0.034, 0.024, 0.04, 0.04, 0.024, 0.034],
  );
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: AD,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: 0.02,
    bevelSegments: 3,
    curveSegments: 4,
  });
  g.translate(0, 0.018, -AD / 2);
  return g;
}

/** A gloss strip on both faces of the shaft. */
function shineGeometry(): THREE.BufferGeometry {
  const x0 = -SW + 0.02;
  const x1 = -SW + 0.044;
  const front = new THREE.ShapeGeometry(
    roundedShape(
      [
        [x0, HH + 0.035],
        [x1, HH + 0.035],
        [x1, AH - 0.045],
        [x0, AH - 0.045],
      ],
      0.011,
    ),
    3,
  );
  front.translate(0, 0.018, AD / 2 + BEVEL + 0.0012);
  const back = front.clone();
  back.rotateY(Math.PI);
  const g = mergeGeometries([front, back])!;
  front.dispose();
  back.dispose();
  return g;
}

export class TargetView {
  readonly group = new THREE.Group();
  private readonly outlineU: OutlineUniforms;
  private readonly disc: THREE.Mesh;
  private readonly u = {
    uCoral: { value: new THREE.Color(color.accent) },
    uWhite: { value: new THREE.Color(color.paper) },
    uGold: { value: new THREE.Color(color.gold) },
    uCream: { value: new THREE.Color(color.gold).lerp(new THREE.Color(color.paper), 0.62) },
    uInk: { value: new THREE.Color(color.ink) },
    uWarm: { value: 0 },
    uFlash: { value: 0 },
    uInkW: { value: 0.05 },
    uPulse: { value: 0 },
    uPulseA: { value: 0 },
    uBurst: { value: 1 },
  };
  private readonly marker = new THREE.Group(); // hover height
  private readonly arrow: THREE.Mesh; // spin, squash, pop
  /** Faces, then sides (ExtrudeGeometry's groups): bright faces read best. */
  private readonly faceMat: THREE.MeshLambertMaterial;
  private readonly sideMat: THREE.MeshLambertMaterial;
  /** Tip height at rest: just above the bullseye's far rim as the camera sees it. */
  private arrowY = 0.56;
  private readonly shadow = new BlobShadow(0.11, 0.28);
  private readonly ink = { value: 1 };
  private readonly gold = new THREE.Color(color.gold);
  private radius = 0.4;
  private decor = true;
  private hot = 0;
  private goalHot = 0;
  private t = 0;
  private bob = 0;
  private spin = 0;
  private flashT = 9;
  private partyT = 9;

  /**
   * Pass the game's sky fade and outline uniforms so the arrow's ink matches
   * everything else; without them it uses its own defaults.
   */
  constructor(ctx?: { fade: SkyFade; outline: OutlineUniforms }) {
    const fade = ctx?.fade ?? makeSkyFade(new THREE.Color(skies[0]));
    this.outlineU = ctx?.outline ?? makeOutlineUniforms();

    // Bullseye: painted rings with ink edges, a soft contact shadow and the
    // pulse rings, all in one flat disc.
    const discGeo = new THREE.CircleGeometry(DISC_SPAN, 96);
    discGeo.rotateX(-Math.PI / 2);
    this.disc = new THREE.Mesh(
      discGeo,
      new THREE.ShaderMaterial({
        uniforms: { ...this.u, ...fade },
        transparent: true,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec2 vP;
          varying float vY;
          void main() {
            vP = position.xz;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vY = wp.y;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uCoral;
          uniform vec3 uWhite;
          uniform vec3 uGold;
          uniform vec3 uCream;
          uniform vec3 uInk;
          uniform float uWarm;
          uniform float uFlash;
          uniform float uInkW;
          uniform float uPulse;
          uniform float uPulseA;
          uniform float uBurst;
          uniform vec3 uBg;
          uniform float uFadeTop;
          uniform float uFadeBottom;
          varying vec2 vP;
          varying float vY;
          float line(float d, float r, float hw, float aa) {
            return 1.0 - smoothstep(hw - aa, hw + aa, abs(d - r));
          }
          void main() {
            float d = length(vP);
            float aa = fwidth(d) * 0.7;
            vec3 coral = mix(uCoral, uGold, uWarm);
            vec3 white = mix(uWhite, uCream, uWarm);
            // painted bands, bull outward
            vec3 col = coral;
            col = mix(col, white, smoothstep(0.33 - aa, 0.33 + aa, d));
            col = mix(col, coral, smoothstep(0.57 - aa, 0.57 + aa, d));
            col = mix(col, white, smoothstep(0.8 - aa, 0.8 + aa, d));
            col = mix(col, vec3(1.0), uFlash);
            // ink: a bold outer edge and a fine line round the bull
            float edge = 1.0 - uInkW;
            col = mix(col, uInk, smoothstep(edge - aa, edge + aa, d));
            col = mix(col, uInk, line(d, 0.33, uInkW * 0.3, aa) * 0.85);
            float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
            // outside: a soft contact shadow and the pulse rings
            float shade = (1.0 - smoothstep(1.0, 1.13, d)) * 0.15;
            float ring = line(d, 1.04 + uPulse * 0.5, 0.032, aa) * uPulseA;
            float burst = uBurst < 1.0 ? line(d, 1.02 + uBurst * 0.9, 0.025 + 0.07 * (1.0 - uBurst), aa) * (1.0 - uBurst) : 0.0;
            float halo = max(ring, burst);
            vec3 haloCol = mix(uWhite, uGold, max(uWarm, 1.0 - uBurst));
            vec3 outCol = mix(uInk, haloCol, halo / max(halo + shade, 1e-4));
            float outA = max(halo, shade);
            vec3 c = mix(outCol, col, inside);
            float a = mix(outA, 1.0, inside);
            float k = smoothstep(uFadeTop, uFadeBottom, vY);
            gl_FragColor = linearToOutputTexel(vec4(mix(c, uBg, k), a * (1.0 - k)));
          }`,
      }),
    );
    this.disc.renderOrder = 0;
    this.group.add(this.disc);

    // Floating arrow with an ink hull and a blob shadow on the bullseye.
    this.faceMat = toonMaterial(color.gold, fade);
    this.sideMat = toonMaterial(color.gold, fade);
    this.arrow = new THREE.Mesh(arrowGeometry(), [this.faceMat, this.sideMat]);
    addOutlines(this.arrow, outlineMaterial(this.outlineU, fade, this.ink));
    const shine = new THREE.Mesh(shineGeometry(), toonMaterial(color.paper, fade, { emissive: color.paper }));
    shine.name = 'shine';
    this.arrow.add(shine);
    this.marker.add(this.arrow);
    this.group.add(this.marker, this.shadow.mesh);
    this.setRadius(this.radius);
  }

  setRadius(r: number) {
    this.radius = r;
    this.disc.scale.set(r, 1, r);
    this.arrowY = Math.max(0.55, (r * DEEP) / UP + 0.15);
    this.marker.position.y = this.arrowY;
  }

  /** Show or hide the arrow and pulse rings (still renders keep them off). */
  setDecor(on: boolean) {
    this.decor = on;
    this.marker.visible = on;
    this.shadow.mesh.visible = on;
  }

  /** 0 = idle, 1 = ball settling inside. */
  setHot(h: number) {
    this.goalHot = clamp(h);
  }

  /** Celebratory pop: the bullseye flashes, the arrow pops and spins, a ring bursts out. */
  flash() {
    this.flashT = 0;
  }

  /** A bigger celebration: flash() plus a happy hop of the arrow. */
  celebrate() {
    this.flashT = 0;
    this.partyT = 0;
  }

  update(dt: number) {
    this.t += dt;
    this.flashT += dt;
    this.partyT += dt;
    this.hot += (this.goalHot - this.hot) * damp(10, dt);
    const flash = this.flashT < 0.6 ? 1 - this.flashT / 0.6 : 0;
    const warm = Math.max(this.hot, flash);
    const u = this.u;
    u.uWarm.value = warm;
    u.uFlash.value = flash * flash * flash * 0.7; // a white pop, then gold
    u.uInkW.value = this.outlineU.uOutline.value / Math.max(0.05, this.radius);
    const p = (this.t / 1.6) % 1;
    u.uPulse.value = p;
    u.uPulseA.value = this.decor ? (1 - p) * (1 - p) * (0.45 + 0.35 * warm) : 0;
    u.uBurst.value = this.decor ? Math.min(1, this.flashT / 0.75) : 1;
    if (!this.decor) return;

    // The arrow floats, and bounces faster and higher while the ball settles.
    this.bob += dt * TAU * (0.8 + 1.7 * this.hot);
    const b = 0.5 + 0.5 * Math.sin(this.bob); // 0 bottom … 1 top
    const party = this.partyT < 0.9 ? Math.sin((this.partyT / 0.9) * Math.PI) : 0;
    this.marker.position.y = this.arrowY + b * (0.06 + 0.05 * this.hot) + party * 0.3;
    // spin, lingering face-on to the camera and sweeping past edge-on
    this.spin += dt * (1.0 + 2.2 * this.hot + 14 * flash * flash);
    const pop = this.flashT < 1.2 ? 1 + 0.42 * Math.exp(-this.flashT * 6) * Math.cos(this.flashT * 17) : 1;
    const sq = (1 - b) * (1 - b) * (0.05 + 0.12 * this.hot); // squash near the bottom
    this.arrow.rotation.y = Math.PI / 4 + this.spin - 0.36 * Math.sin(2 * this.spin);
    this.arrow.scale.set(pop * (1 + sq * 0.6), pop * (1 - sq), pop * (1 + sq * 0.6));
    const glow = 0.16 * this.hot + 0.45 * flash;
    this.faceMat.emissive.copy(this.gold).multiplyScalar(0.42 + glow);
    this.sideMat.emissive.copy(this.gold).multiplyScalar(0.08 + glow);
    this.ink.value = Math.min(1, this.group.scale.x * pop);
    this.shadow.set(0, 0.002, 0, 0.3 + (this.marker.position.y - this.arrowY) * 1.5);
  }
}
