import { FLOORS } from './floors.ts';
import { skies } from './theme.ts';

export { FLOORS };

/** Height of one level step, in tiles. */
export const LEVEL_H = 0.5;
/** Radius of the rounded outer corners of the map. */
export const CORNER_R = 0.24;
/** Width of a plank bridge. */
export const BRIDGE_W = 0.42;
/** Floors per tier; every tier brings a new mechanic and a new sky. */
export const TIER_SIZE = 5;
/** Fence height above its surface. */
export const FENCE_H = 0.2;

/** Direction a ramp rises toward: 0 = +x, 1 = +z, 2 = -x, 3 = -z. -1 = flat tile. */
export type Ramp = -1 | 0 | 1 | 2 | 3;
export type Surface = 'grass' | 'ice' | 'sand';
export type Vec2 = [number, number];

export interface Tile {
  i: number;
  j: number;
  level: number;
  ramp: Ramp;
  /** Top corner heights: [x0z0, x1z0, x1z1, x0z1]. */
  c: [number, number, number, number];
  /** Surface gradient (dS/dx, dS/dz). */
  gx: number;
  gz: number;
  surface: Surface;
  /** 0 = solid block, 1 = plank bridge along x, 2 = plank bridge along z. */
  bridge: 0 | 1 | 2;
  /** Conveyor belt push direction, or null. */
  belt: Vec2 | null;
  /** Rounded corners, same order as `c`. */
  round: [boolean, boolean, boolean, boolean];
}

/** Things placed on a floor. Positions are world (x, z); 1 tile = 1. */
export type FloorObject =
  | { type: 'fence'; from: Vec2; to: Vec2 }
  | { type: 'trampoline'; at: Vec2; power?: number }
  | { type: 'magnet'; at: Vec2; range?: number; pull?: number }
  | { type: 'boost'; at: Vec2; dir: number; speed?: number }
  | { type: 'bumper'; at: Vec2 }
  | { type: 'portal'; a: Vec2; b: Vec2 };

export interface FloorDef {
  name: string;
  /** Kick limit. */
  kicks: number;
  /** Countdown, seconds. */
  time: number;
  /**
   * Rows run along +z, tokens along +x (space separated). A token is a level
   * digit followed by optional parts, in this order:
   *   ramp    `>` `<` `v` `^`  rises one level toward +x, -x, +z, -z
   *   surface `i` ice, `s` sand
   *   bridge  `=` plank along x, `|` plank along z
   *   belt    `E` `W` `S` `N`  conveyor pushing toward +x, -x, +z, -z
   * `.` is empty.
   */
  map: string[];
  /** Ball start, world (x, z). */
  start: Vec2;
  /** Target circle centre, world (x, z). */
  target: Vec2;
  /** Target circle radius (tiles); the ball's centre must stop inside it. */
  radius: number;
  /** Seed for the pitch markings. */
  seed: number;
  /** Skip the painted pitch lines (single-tile art). */
  plain?: boolean;
  objects?: FloorObject[];
}

export interface PointObject {
  x: number;
  z: number;
  base: number;
  tile: Tile;
}
export interface Fence {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  base: number;
  top: number;
  tile: Tile;
}
export interface Magnet extends PointObject {
  range: number;
  pull: number;
}
export interface Trampoline extends PointObject {
  power: number;
}
export interface Boost extends PointObject {
  dx: number;
  dz: number;
  speed: number;
}
export interface Portal {
  a: PointObject;
  b: PointObject;
}

export interface Floor {
  index: number;
  def: FloorDef;
  tiles: Tile[];
  /** Grid size in tiles. */
  w: number;
  d: number;
  minTop: number;
  maxTop: number;
  sky: string;
  tier: number;
  at(i: number, j: number): Tile | undefined;
  fences: Fence[];
  bumpers: PointObject[];
  magnets: Magnet[];
  tramps: Trampoline[];
  boosts: Boost[];
  portals: Portal[];
}

function cornerHeights(level: number, ramp: Ramp): [number, number, number, number] {
  const lo = level * LEVEL_H;
  const hi = lo + LEVEL_H;
  switch (ramp) {
    case 0: return [lo, hi, hi, lo];
    case 1: return [lo, lo, hi, hi];
    case 2: return [hi, lo, lo, hi];
    case 3: return [hi, hi, lo, lo];
    default: return [lo, lo, lo, lo];
  }
}

const RAMP_CHARS: Record<string, Ramp> = { '>': 0, v: 1, '<': 2, '^': 3 };
const BELT_DIRS: Record<string, Vec2> = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
const TOKEN = /^(\d)([><v^])?([is])?([=|])?([EWSN])?$/;

export function parseFloor(index: number): Floor {
  return floorFromDef(FLOORS[index], index);
}

/** Build a floor from any definition (icons, tests and the generator use one-off floors). */
export function floorFromDef(def: FloorDef, index: number): Floor {
  const rows = def.map.map((r) => r.trim().split(/\s+/));
  const d = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const grid: (Tile | undefined)[] = new Array(w * d);
  const tiles: Tile[] = [];
  let minTop = Infinity;
  let maxTop = -Infinity;
  rows.forEach((row, j) => {
    row.forEach((tok, i) => {
      if (tok === '.') return;
      const m = TOKEN.exec(tok);
      if (!m) throw new Error(`Bad tile "${tok}" at ${i},${j} in floor "${def.name}"`);
      const level = Number(m[1]);
      const ramp: Ramp = m[2] ? RAMP_CHARS[m[2]] : -1;
      const bridge: 0 | 1 | 2 = m[4] === '=' ? 1 : m[4] === '|' ? 2 : 0;
      if (bridge && ramp !== -1) throw new Error(`Bridges must be flat ("${tok}" in "${def.name}")`);
      const c = cornerHeights(level, ramp);
      const t: Tile = {
        i,
        j,
        level,
        ramp,
        c,
        gx: ramp === 0 ? LEVEL_H : ramp === 2 ? -LEVEL_H : 0,
        gz: ramp === 1 ? LEVEL_H : ramp === 3 ? -LEVEL_H : 0,
        surface: m[3] === 'i' ? 'ice' : m[3] === 's' ? 'sand' : 'grass',
        bridge,
        belt: m[5] ? BELT_DIRS[m[5]] : null,
        round: [false, false, false, false],
      };
      grid[j * w + i] = t;
      tiles.push(t);
      minTop = Math.min(minTop, ...c);
      maxTop = Math.max(maxTop, ...c);
    });
  });
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= d ? undefined : grid[j * w + i]);
  // A block corner is rounded when both edges meeting there face open sky.
  // Planks don't count as neighbours: they only touch the middle of an edge.
  const solid = (i: number, j: number) => {
    const n = at(i, j);
    return !!n && n.bridge === 0;
  };
  for (const t of tiles) {
    if (t.bridge) continue;
    const W = solid(t.i - 1, t.j);
    const E = solid(t.i + 1, t.j);
    const N = solid(t.i, t.j - 1);
    const S = solid(t.i, t.j + 1);
    t.round = [!W && !N, !E && !N, !E && !S, !W && !S];
  }

  const tier = Math.floor(index / TIER_SIZE);
  const floor: Floor = {
    index,
    def,
    tiles,
    w,
    d,
    minTop,
    maxTop,
    tier,
    sky: skies[tier % skies.length],
    at,
    fences: [],
    bumpers: [],
    magnets: [],
    tramps: [],
    boosts: [],
    portals: [],
  };

  const point = (p: Vec2, what: string): PointObject => {
    const t = supportTile(floor, p[0], p[1]);
    if (!t) throw new Error(`${what} at ${p} is not on a tile in "${def.name}"`);
    return { x: p[0], z: p[1], base: surfaceAt(t, p[0], p[1]), tile: t };
  };
  for (const o of def.objects ?? []) {
    switch (o.type) {
      case 'fence': {
        const m = point([(o.from[0] + o.to[0]) / 2, (o.from[1] + o.to[1]) / 2], 'fence');
        floor.fences.push({ ax: o.from[0], az: o.from[1], bx: o.to[0], bz: o.to[1], base: m.base, top: m.base + FENCE_H, tile: m.tile });
        break;
      }
      case 'bumper':
        floor.bumpers.push(point(o.at, 'bumper'));
        break;
      case 'magnet':
        floor.magnets.push({ ...point(o.at, 'magnet'), range: o.range ?? 2.4, pull: o.pull ?? 5.5 });
        break;
      case 'trampoline':
        floor.tramps.push({ ...point(o.at, 'trampoline'), power: o.power ?? 5.6 });
        break;
      case 'boost': {
        const a = (o.dir * Math.PI) / 180;
        floor.boosts.push({ ...point(o.at, 'boost'), dx: Math.cos(a), dz: Math.sin(a), speed: o.speed ?? 5 });
        break;
      }
      case 'portal':
        floor.portals.push({ a: point(o.a, 'portal'), b: point(o.b, 'portal') });
        break;
    }
  }
  return floor;
}

/** Surface height of tile t at world (x, z) (planar tops). */
export function surfaceAt(t: Tile, x: number, z: number): number {
  const u = Math.min(1, Math.max(0, x - t.i));
  const v = Math.min(1, Math.max(0, z - t.j));
  const [a, b, c, d] = t.c;
  return (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + c * u) * v;
}

/** The grid cell's tile, ignoring rounded corners and plank widths. */
export function tileAt(f: Floor, x: number, z: number): Tile | undefined {
  return f.at(Math.floor(x), Math.floor(z));
}

/** Arc centre of rounded corner k of tile t (world x, z). */
export function cornerCentre(t: Tile, k: number): Vec2 {
  const cu = k === 1 || k === 2 ? 1 : 0;
  const cv = k >= 2 ? 1 : 0;
  return [t.i + (cu ? 1 - CORNER_R : CORNER_R), t.j + (cv ? 1 - CORNER_R : CORNER_R)];
}

/** The tile whose top really covers (x, z): rounded corners and plank widths respected. */
export function supportTile(f: Floor, x: number, z: number): Tile | undefined {
  const t = f.at(Math.floor(x), Math.floor(z));
  if (!t) return undefined;
  const u = x - t.i;
  const v = z - t.j;
  if (t.bridge === 1) return Math.abs(v - 0.5) <= BRIDGE_W / 2 ? t : undefined;
  if (t.bridge === 2) return Math.abs(u - 0.5) <= BRIDGE_W / 2 ? t : undefined;
  for (let k = 0; k < 4; k++) {
    if (!t.round[k]) continue;
    const cu = k === 1 || k === 2 ? 1 : 0;
    const cv = k >= 2 ? 1 : 0;
    if (Math.abs(u - cu) < CORNER_R && Math.abs(v - cv) < CORNER_R) {
      const [ax, az] = cornerCentre(t, k);
      if (Math.hypot(x - ax, z - az) > CORNER_R) return undefined;
    }
  }
  return t;
}

/** Surface height under world (x, z), or -Infinity over the void. */
export function heightAt(f: Floor, x: number, z: number): number {
  const t = supportTile(f, x, z);
  return t ? surfaceAt(t, x, z) : -Infinity;
}
