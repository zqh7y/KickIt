// Floor solver core: simulates kicks through the game's own physics and runs
// a beam search for the fewest-kick solution. Used by solve.ts, find-path.ts
// and the floor generator.
import { type Floor, type Tile, supportTile } from '../../src/levels.ts';
import { BallSim, inTarget, PHYS_DT } from '../../src/physics.ts';

export type Outcome = { kind: 'rest'; x: number; z: number; win: boolean } | { kind: 'fall' } | { kind: 'stuck' };
export interface Kick {
  angle: number;
  power: number;
}

export function simulate(sim: BallSim, x: number, z: number, k: Kick): Outcome {
  sim.place(x, z);
  sim.kick(Math.cos(k.angle), Math.sin(k.angle), k.power);
  for (let n = 0; n < 240 * 45; n++) {
    sim.step(PHYS_DT);
    if (sim.state === 'rest') {
      if (sim.forced) return { kind: 'stuck' };
      return { kind: 'rest', x: sim.x, z: sim.z, win: inTarget(sim.floor, sim.x, sim.z) };
    }
    if (sim.state === 'fallen') return { kind: 'fall' };
  }
  return { kind: 'stuck' };
}

/** Tile-graph distance to the target tile (a ranking heuristic only). */
export function distanceField(f: Floor): Map<Tile, number> {
  const [tx, tz] = f.def.target;
  const goal = supportTile(f, tx, tz);
  const dist = new Map<Tile, number>();
  if (!goal) return dist;
  const links = new Map<Tile, Tile[]>();
  const link = (a: Tile, b: Tile) => {
    if (!links.has(a)) links.set(a, []);
    links.get(a)!.push(b);
  };
  for (const t of f.tiles) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = f.at(t.i + di, t.j + dj);
      if (n && Math.abs(n.level - t.level) <= 1) link(t, n);
    }
  }
  for (const tr of f.tramps) for (const t of f.tiles) if (Math.hypot(t.i + 0.5 - tr.x, t.j + 0.5 - tr.z) < 3.6) link(tr.tile, t);
  for (const b of f.boosts) for (const t of f.tiles) if (Math.hypot(t.i + 0.5 - b.x, t.j + 0.5 - b.z) < 3) link(b.tile, t);
  for (const p of f.portals) {
    link(p.a.tile, p.b.tile);
    link(p.b.tile, p.a.tile);
  }
  // BFS backwards from the goal over reversed links
  const rev = new Map<Tile, Tile[]>();
  for (const [a, bs] of links) for (const b of bs) {
    if (!rev.has(b)) rev.set(b, []);
    rev.get(b)!.push(a);
  }
  dist.set(goal, 0);
  const q = [goal];
  while (q.length) {
    const t = q.shift()!;
    for (const p of rev.get(t) ?? []) {
      if (!dist.has(p)) {
        dist.set(p, dist.get(t)! + 1);
        q.push(p);
      }
    }
  }
  return dist;
}

export interface SolveOptions {
  maxKicks: number;
  angles: number;
  powers: number;
  beam: number;
}

export interface Solution {
  /** Fewest kicks found. */
  kicks: number;
  /** A winning sequence (the most robust final kick found). */
  path: Kick[];
  /** Winning samples at that depth, and how many were tried. */
  wins: number;
  tried: number;
  /** Robustness of the chosen final kick: winning neighbours in a 5x5 window (max 25). */
  robust: number;
  /** Share of first kicks that fall off. */
  fallRate: number;
  /** Kicks that never settle (should be 0). */
  stuck: number;
}

export function solveFloor(f: Floor, o: SolveOptions): Solution | null {
  const sim = new BallSim(f);
  const field = distanceField(f);
  type Node = { x: number; z: number; path: Kick[] };
  let frontier: Node[] = [{ x: f.def.start[0], z: f.def.start[1], path: [] }];
  const seen = new Set<string>();
  const key = (x: number, z: number) => `${Math.round(x / 0.3)},${Math.round(z / 0.3)}`;
  seen.add(key(frontier[0].x, frontier[0].z));
  let stuck = 0;
  let falls = 0;
  let first = 0;
  for (let depth = 1; depth <= o.maxKicks; depth++) {
    let best: { path: Kick[]; robust: number } | null = null;
    let wins = 0;
    let tried = 0;
    const next: { node: Node; score: number }[] = [];
    for (const node of frontier) {
      const grid: (Outcome | null)[][] = [];
      for (let a = 0; a < o.angles; a++) {
        grid[a] = [];
        for (let p = 1; p <= o.powers; p++) {
          const k = { angle: (a / o.angles) * Math.PI * 2, power: p / o.powers };
          const out = simulate(sim, node.x, node.z, k);
          grid[a][p] = out;
          tried++;
          if (depth === 1) {
            first++;
            if (out.kind === 'fall') falls++;
          }
          if (out.kind === 'stuck') stuck++;
          if (out.kind !== 'rest') continue;
          if (out.win) {
            wins++;
            continue;
          }
          const kk = key(out.x, out.z);
          if (seen.has(kk)) continue;
          seen.add(kk);
          const t = supportTile(f, out.x, out.z);
          const g = t ? (field.get(t) ?? 99) : 99;
          const [tx, tz] = f.def.target;
          next.push({ node: { x: out.x, z: out.z, path: [...node.path, k] }, score: g + Math.hypot(out.x - tx, out.z - tz) * 0.35 });
        }
      }
      for (let a = 0; a < o.angles; a++) {
        for (let p = 1; p <= o.powers; p++) {
          const out = grid[a][p];
          if (!out || out.kind !== 'rest' || !out.win) continue;
          let robust = 0;
          for (let da = -2; da <= 2; da++)
            for (let dp = -2; dp <= 2; dp++) {
              const q = grid[(a + da + o.angles) % o.angles][p + dp];
              if (q && q.kind === 'rest' && q.win) robust++;
            }
          if (!best || robust > best.robust) best = { path: [...node.path, { angle: (a / o.angles) * Math.PI * 2, power: p / o.powers }], robust };
        }
      }
    }
    if (best) {
      return { kicks: depth, path: best.path, wins, tried, robust: best.robust, fallRate: first ? falls / first : 0, stuck };
    }
    next.sort((a, b) => a.score - b.score);
    frontier = next.slice(0, o.beam).map((n) => n.node);
    if (!frontier.length) return null;
  }
  return null;
}
