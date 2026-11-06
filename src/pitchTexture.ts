// Paints a floor's top surface: mowing stripes, tile seams, white pitch lines,
// slope arrows on ramps and little grass tufts. Mapped from above in world x/z.
import * as THREE from 'three';
import type { Floor } from './levels.ts';
import { color } from './theme.ts';
import { rng } from './util.ts';

// Real pitch geometry in metres; the floor shows a random window of it.
const PITCH = { len: 105, wid: 68, circle: 9.15, boxD: 16.5, boxW: 40.32, goalD: 5.5, goalW: 18.32, spot: 11, corner: 1 };

export function makePitchTexture(floor: Floor, maxSize: number, anisotropy: number) {
  const ppt = Math.floor(Math.min(128, maxSize / Math.max(floor.w, floor.d)));
  const cv = document.createElement('canvas');
  cv.width = floor.w * ppt;
  cv.height = floor.d * ppt;
  const g = cv.getContext('2d')!;
  const R = rng(floor.def.seed);
  g.scale(ppt, ppt); // draw in tile units from here on

  // Clip to the floor's footprint.
  g.save();
  g.beginPath();
  for (const t of floor.tiles) g.rect(t.i, t.j, 1, 1);
  g.clip();

  // Mowing stripes, half a tile wide, running along x.
  g.fillStyle = color.grassA;
  g.fillRect(0, 0, floor.w, floor.d);
  g.fillStyle = color.grassB;
  for (let z = 0; z < floor.d; z += 1) g.fillRect(0, z + 0.5, floor.w, 0.5);

  // Tile seams.
  g.strokeStyle = color.grassSeam;
  g.lineWidth = 0.022;
  g.beginPath();
  for (const t of floor.tiles) {
    if (floor.at(t.i + 1, t.j)) {
      g.moveTo(t.i + 1, t.j);
      g.lineTo(t.i + 1, t.j + 1);
    }
    if (floor.at(t.i, t.j + 1)) {
      g.moveTo(t.i, t.j + 1);
      g.lineTo(t.i + 1, t.j + 1);
    }
  }
  g.stroke();

  if (!floor.def.plain) drawPitchLines(g, floor, R);
  drawSurfaces(g, floor, R);
  drawRampArrows(g, floor);
  drawTufts(g, floor, R);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = anisotropy;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function drawPitchLines(g: CanvasRenderingContext2D, floor: Floor, R: () => number) {
  const metresPerTile = 6.8 + R() * 1.4;
  // Pick a feature of the pitch and drop it onto the floor, away from the target.
  const P = PITCH;
  const features: [number, number][] = [
    [P.len / 2, P.wid / 2], // centre circle
    [P.spot, P.wid / 2], // penalty spot
    [P.boxD, P.wid / 2 - P.boxW / 2], // penalty area corner
    [0, 0], // corner flag
  ];
  const [fx, fz] = features[Math.floor(R() * features.length) % features.length];
  const [tx, tz] = floor.def.target;
  const candidates = floor.tiles.filter((t) => Math.hypot(t.i + 0.5 - tx, t.j + 0.5 - tz) > 2.2 && t.ramp === -1);
  const anchor = candidates[Math.floor(R() * candidates.length)] ?? floor.tiles[0];
  const rot = Math.floor(R() * 4) * (Math.PI / 2);

  g.save();
  g.translate(anchor.i + 0.5, anchor.j + 0.5);
  g.rotate(rot);
  g.scale(1 / metresPerTile, 1 / metresPerTile);
  g.translate(-fx, -fz);
  g.strokeStyle = color.paint;
  g.fillStyle = color.paint;
  g.globalAlpha = 0.93;
  g.lineWidth = 0.05 * metresPerTile;
  g.lineCap = 'butt';

  const line = (x1: number, z1: number, x2: number, z2: number) => {
    g.beginPath();
    g.moveTo(x1, z1);
    g.lineTo(x2, z2);
    g.stroke();
  };
  const arc = (x: number, z: number, r: number, a0 = 0, a1 = Math.PI * 2) => {
    g.beginPath();
    g.arc(x, z, r, a0, a1);
    g.stroke();
  };
  const spot = (x: number, z: number) => {
    g.beginPath();
    g.arc(x, z, 0.06 * metresPerTile, 0, Math.PI * 2);
    g.fill();
  };

  // Touchlines and goal lines.
  g.strokeRect(0, 0, P.len, P.wid);
  // Halfway line, centre circle, centre spot.
  line(P.len / 2, 0, P.len / 2, P.wid);
  arc(P.len / 2, P.wid / 2, P.circle);
  spot(P.len / 2, P.wid / 2);
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : P.len;
    const s = side === 0 ? 1 : -1;
    // Penalty area, goal area, spot, arc.
    g.strokeRect(Math.min(gx, gx + s * P.boxD), P.wid / 2 - P.boxW / 2, P.boxD, P.boxW);
    g.strokeRect(Math.min(gx, gx + s * P.goalD), P.wid / 2 - P.goalW / 2, P.goalD, P.goalW);
    spot(gx + s * P.spot, P.wid / 2);
    const a = Math.acos((P.boxD - P.spot) / P.circle);
    if (side === 0) arc(gx + s * P.spot, P.wid / 2, P.circle, -a, a);
    else arc(gx + s * P.spot, P.wid / 2, P.circle, Math.PI - a, Math.PI + a);
  }
  // Corner arcs.
  arc(0, 0, P.corner, 0, Math.PI / 2);
  arc(P.len, 0, P.corner, Math.PI / 2, Math.PI);
  arc(P.len, P.wid, P.corner, Math.PI, Math.PI * 1.5);
  arc(0, P.wid, P.corner, Math.PI * 1.5, Math.PI * 2);
  g.restore();
}

/** Ice, sand and conveyor-belt tiles paint over the grass. */
function drawSurfaces(g: CanvasRenderingContext2D, floor: Floor, R: () => number) {
  for (const t of floor.tiles) {
    if (t.belt) {
      g.fillStyle = color.beltBase;
      g.fillRect(t.i, t.j, 1, 1);
      continue;
    }
    if (t.surface === 'ice') {
      g.fillStyle = color.ice;
      g.fillRect(t.i, t.j, 1, 1);
      // shine streaks
      g.save();
      g.globalAlpha = 0.55;
      g.strokeStyle = color.iceLine;
      g.lineCap = 'round';
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(t.i + 0.18, t.j + 0.42);
      g.lineTo(t.i + 0.42, t.j + 0.18);
      g.moveTo(t.i + 0.3, t.j + 0.58);
      g.lineTo(t.i + 0.58, t.j + 0.3);
      g.stroke();
      // a few cracks
      g.globalAlpha = 0.8;
      g.lineWidth = 0.014;
      g.beginPath();
      for (let k = 0; k < 2; k++) {
        let x = t.i + 0.25 + R() * 0.5;
        let z = t.j + 0.25 + R() * 0.5;
        g.moveTo(x, z);
        for (let s = 0; s < 3; s++) {
          x += (R() - 0.5) * 0.3;
          z += (R() - 0.5) * 0.3;
          g.lineTo(Math.min(t.i + 0.95, Math.max(t.i + 0.05, x)), Math.min(t.j + 0.95, Math.max(t.j + 0.05, z)));
        }
      }
      g.stroke();
      g.restore();
    } else if (t.surface === 'sand') {
      g.fillStyle = color.sand;
      g.fillRect(t.i, t.j, 1, 1);
      g.fillStyle = color.sandDot;
      for (let k = 0; k < 22; k++) {
        g.beginPath();
        g.arc(t.i + 0.05 + R() * 0.9, t.j + 0.05 + R() * 0.9, 0.012 + R() * 0.012, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // seams between neighbouring special tiles
  g.strokeStyle = 'rgba(30,38,25,0.12)';
  g.lineWidth = 0.02;
  g.beginPath();
  for (const t of floor.tiles) {
    if (t.surface === 'grass' && !t.belt) continue;
    g.rect(t.i, t.j, 1, 1);
  }
  g.stroke();
}

function drawRampArrows(g: CanvasRenderingContext2D, floor: Floor) {
  g.save();
  g.strokeStyle = color.grassMark;
  g.lineWidth = 0.075;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const t of floor.tiles) {
    if (t.ramp === -1) continue;
    // Arrows point downhill: the way the ball will roll.
    const down = [Math.PI, -Math.PI / 2, 0, Math.PI / 2][t.ramp]; // canvas angle (x right, z down)
    const dx = Math.cos(down);
    const dz = Math.sin(down);
    const px = -dz;
    const pz = dx;
    for (const k of [-0.16, 0.14]) {
      const cx = t.i + 0.5 + dx * k;
      const cz = t.j + 0.5 + dz * k;
      const arm = 0.17;
      g.beginPath();
      g.moveTo(cx - dx * arm + px * arm, cz - dz * arm + pz * arm);
      g.lineTo(cx, cz);
      g.lineTo(cx - dx * arm - px * arm, cz - dz * arm - pz * arm);
      g.stroke();
    }
  }
  g.restore();
}

function drawTufts(g: CanvasRenderingContext2D, floor: Floor, R: () => number) {
  const [tx, tz] = floor.def.target;
  g.save();
  g.strokeStyle = color.ink;
  g.globalAlpha = 0.6;
  g.lineWidth = 0.014;
  g.lineCap = 'round';
  for (const t of floor.tiles) {
    if (t.ramp !== -1 || t.surface !== 'grass' || t.belt || t.bridge) continue;
    const n = R() < 0.42 ? (R() < 0.3 ? 2 : 1) : 0;
    for (let k = 0; k < n; k++) {
      const x = t.i + 0.18 + R() * 0.64;
      const z = t.j + 0.18 + R() * 0.64;
      if (Math.hypot(x - tx, z - tz) < floor.def.radius + 0.12) continue;
      const s = 0.035 + R() * 0.015;
      // A little "m" of grass blades, turned to stand upright on screen
      // (screen-up is world -x/-z) and stretched against the camera tilt.
      g.save();
      g.translate(x, z);
      g.rotate(-Math.PI / 4);
      g.scale(1, 1.25);
      g.beginPath();
      g.moveTo(-s * 1.4, s);
      g.quadraticCurveTo(-s * 1.2, -s * 1.1, -s * 0.5, -s * 0.2);
      g.moveTo(-s * 0.5, s);
      g.quadraticCurveTo(0, -s * 1.4, s * 0.5, -s * 0.1);
      g.moveTo(s * 0.5, s);
      g.quadraticCurveTo(s * 0.9, -s * 0.8, s * 1.4, s * 0.1);
      g.restore();
      g.stroke();
    }
  }
  g.restore();
}
