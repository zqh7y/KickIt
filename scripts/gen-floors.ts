// Generates floors 3-50 and writes src/floors.generated.ts.
// Each floor is a path climbing up the screen (toward -x/-z) with ramps,
// ledges and wider spots; every tier of five floors adds a new mechanic and
// mixes earlier ones back in. Every candidate is solved with the game's own
// physics and kept only if its fewest-kicks solution fits the difficulty curve.
// Run: node scripts/gen-floors.ts [firstSlot lastSlot]
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { floorFromDef, type FloorDef, type FloorObject, type Vec2 } from '../src/levels.ts';
import { HANDMADE } from '../src/floors.ts';
import { rng } from '../src/util.ts';
import { solveFloor } from './lib/solver.ts';

const TOTAL = 50;
type Dir = 'X' | 'Z';
type Feature = 'bridge' | 'tramp' | 'magnet' | 'ice' | 'boost' | 'bumper' | 'portal' | 'belt';
/** The mechanic each tier introduces (tier 0 = basics + fences, tier 9 = everything). */
const TIER_FEATURE: (Feature | null)[] = [null, 'bridge', 'tramp', 'magnet', 'ice', 'boost', 'bumper', 'portal', 'belt', null];
const TIER_NAME = ['Kick-off', 'Plank', 'Bounce', 'Pull', 'Slide', 'Rush', 'Pinball', 'Warp', 'Drift', 'Mayhem'];
const STEP: Record<Dir, Vec2> = { X: [-1, 0], Z: [0, -1] };

interface Cell {
  i: number;
  j: number;
  level: number;
  ramp: string;
  surface: '' | 'i' | 's';
  bridge: '' | '=' | '|';
  belt: '' | 'E' | 'W' | 'S' | 'N';
  path: number; // index in the path, -1 for widened cells
  dir: Dir | null; // direction moved to enter this cell
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const difficulty = (slot: number) => Math.max(0, slot / (TOTAL - 1) - (slot % 5 === 0 ? 0.05 : 0));

/** Range of fewest-kick counts a floor of difficulty D may need. */
function kickRange(D: number): [number, number] {
  if (D < 0.12) return [1, 2];
  if (D < 0.35) return [2, 3];
  if (D < 0.65) return [2, 4];
  return [3, 5];
}
const slack = (D: number) => (D < 0.25 ? 2 : D < 0.88 ? 1 : 0);
const secondsPerKick = (D: number) => lerp(9.5, 6.5, D);

export function buildCandidate(slot: number, seed: number): FloorDef | null {
  const R = rng(seed * 7919 + slot * 104729 + 17);
  const pick = <T>(xs: T[]): T => xs[Math.floor(R() * xs.length) % xs.length];
  const D = difficulty(slot);
  const tier = Math.floor(slot / 5);
  const intro = slot % 5 === 0;
  const cells = new Map<string, Cell>();
  const key = (i: number, j: number) => `${i},${j}`;
  const get = (i: number, j: number) => cells.get(key(i, j));
  const path: Cell[] = [];
  const put = (c: Cell) => {
    cells.set(key(c.i, c.j), c);
    return c;
  };
  const blank = (i: number, j: number, level: number, pathIndex: number, dir: Dir | null): Cell => ({
    i, j, level, ramp: '', surface: '', bridge: '', belt: '', path: pathIndex, dir,
  });

  // ------------------------------------------------------------ mechanics
  const featureList: Feature[] = [];
  const own = TIER_FEATURE[tier];
  if (own) featureList.push(own);
  const earlier = TIER_FEATURE.slice(1, tier).filter((f): f is Feature => !!f);
  if (tier === 9) earlier.push(...TIER_FEATURE.filter((f): f is Feature => !!f));
  const extra = tier === 9 ? 2 + Math.floor(R() * 2) : intro ? 0 : R() < lerp(0.1, 0.7, D) ? 1 : 0;
  for (let q = 0; q < extra && earlier.length; q++) featureList.push(pick(earlier));
  // straight stretch the mechanics need (cells before, on and after them)
  const NEED: Record<Feature, number> = { bridge: 4, tramp: 6, portal: 6, belt: 4, magnet: 0, ice: 0, boost: 0, bumper: 0 };
  const needRun = Math.max(0, ...featureList.map((f) => NEED[f]));

  // ---------------------------------------------------------------- path
  let i = 0;
  let j = 0;
  let level = 3;
  path.push(put(blank(0, 0, level, 0, null)));
  let dir: Dir = R() < 0.5 ? 'X' : 'Z';
  const runs = intro ? 3 : Math.round(lerp(3, 6.4, D) + R() * 1.4);
  const pRamp = lerp(0.12, 0.2, D);
  const pDrop = lerp(0.05, 0.12, D);
  let lastEvent = 0;
  const longRun = needRun ? 1 + Math.floor(R() * Math.max(1, runs - 1)) : -1;
  for (let r = 0; r < runs; r++) {
    let len = 1 + Math.floor(R() * (D < 0.3 ? 3 : 4));
    if (r === 0) len = Math.max(len, 2);
    const dd = dir === 'X' ? -1 : 1;
    if (r === longRun) {
      // the long straight: start it from the far side of the band so it fits
      len = needRun;
    } else {
      while (len > 1 && Math.abs(i - j + dd * len) > 3) len--;
    }
    for (let k = 0; k < len; k++) {
      i += STEP[dir][0];
      j += STEP[dir][1];
      if (get(i, j)) return null; // path crossed itself
      const c = blank(i, j, level, path.length, dir);
      const roll = R();
      const ok = path.length - lastEvent > 1 && path.length > 1 && r !== longRun;
      if (ok && roll < pRamp && level < 8) {
        c.ramp = dir === 'X' ? '<' : '^';
        lastEvent = path.length;
        path.push(put(c));
        level += 1;
        continue;
      }
      if (ok && roll < pRamp + pDrop && level > 0) {
        level -= 1;
        c.level = level;
        lastEvent = path.length;
      }
      path.push(put(c));
    }
    dir = dir === 'X' ? 'Z' : 'X';
  }
  if (path.length < 4) return null;
  const last = path.length - 1;

  // ------------------------------------------------------------- widening
  const pWide = intro ? 0.55 : lerp(0.62, 0.18, D);
  for (const c of [...path]) {
    if (c.ramp || c.path === last) continue;
    if (R() > pWide) continue;
    const d: Dir = c.dir ?? 'X';
    const side: Vec2[] = d === 'X' ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const order = R() < 0.5 ? side : [side[1], side[0]];
    const both = R() < pWide * 0.35;
    for (const [di, dj] of both ? order : order.slice(0, 1)) {
      const ni = c.i + di;
      const nj = c.j + dj;
      if (!get(ni, nj)) put(blank(ni, nj, c.level, -1, d));
    }
  }

  // helpers over the path
  const straight = (k: number, n: number) => {
    for (let q = k; q < k + n; q++) {
      const c = path[q];
      if (!c || c.ramp || c.bridge || q === 0 || q === last) return false;
      if (q > k && (c.dir !== path[k].dir || c.level !== path[k].level)) return false;
    }
    return path[k].dir !== null;
  };
  const sideCells = (c: Cell): Cell[] =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([di, dj]) => get(c.i + di, c.j + dj))
      .filter((n): n is Cell => !!n && n.path === -1);
  const removeCell = (c: Cell) => cells.delete(key(c.i, c.j));
  const centre = (c: Cell): Vec2 => [c.i + 0.5, c.j + 0.5];
  const objects: FloorObject[] = [];
  const used = new Set<number>(); // path cells already carrying something

  // ------------------------------------------------------------- features
  const apply: Record<Feature, () => boolean> = {
    bridge: () => {
      const ks = path.map((_, k) => k).filter((k) => straight(k - 1, 4) && !used.has(k));
      if (!ks.length) return false;
      const k = pick(ks);
      const c = path[k];
      c.bridge = c.dir === 'X' ? '=' : '|';
      for (const n of sideCells(c)) removeCell(n);
      used.add(k);
      if (D > 0.3 && straight(k, 3) && !used.has(k + 1)) {
        const c2 = path[k + 1];
        c2.bridge = c.bridge;
        for (const n of sideCells(c2)) removeCell(n);
        used.add(k + 1);
      }
      return true;
    },
    tramp: () => {
      const ks = path.map((_, k) => k).filter((k) => straight(k - 1, 5) && !used.has(k - 1) && !used.has(k));
      if (!ks.length) return false;
      const k = pick(ks);
      const gap = D > 0.45 && straight(k - 1, 6) ? 2 : 1;
      objects.push({ type: 'trampoline', at: centre(path[k - 1]) });
      for (const n of sideCells(path[k - 1])) removeCell(n);
      for (let g = 0; g < gap; g++) {
        for (const n of sideCells(path[k + g])) removeCell(n);
        removeCell(path[k + g]);
        used.add(k + g);
      }
      used.add(k - 1);
      return true;
    },
    magnet: () => {
      const ks = path.map((_, k) => k).filter((k) => k > 0 && k < last && !path[k].ramp && !path[k].bridge && !used.has(k));
      if (!ks.length) return false;
      const c = path[pick(ks)];
      const sides = sideCells(c);
      const at: Vec2 = sides.length ? centre(pick(sides)) : [c.i + 0.5 + (c.dir === 'Z' ? 0.3 : 0), c.j + 0.5 + (c.dir === 'X' ? 0.3 : 0)];
      const repel = D > 0.6 && R() < 0.3;
      objects.push({ type: 'magnet', at, range: lerp(1.9, 2.6, R()), pull: (repel ? -1 : 1) * lerp(3.5, 7, D) });
      used.add(c.path);
      return true;
    },
    ice: () => {
      const n = 2 + Math.floor(R() * 3);
      const ks = path.map((_, k) => k).filter((k) => k > 0 && k + n <= last);
      if (!ks.length) return false;
      const k = pick(ks);
      for (let q = k; q < k + n; q++) {
        if (path[q].bridge) continue;
        path[q].surface = 'i';
        for (const s of sideCells(path[q])) s.surface = 'i';
      }
      if (R() < 0.5) {
        // a patch of sand somewhere else slows the ball down
        const sk = pick(path.map((_, q) => q).filter((q) => q > 0 && q < last && !path[q].surface && !path[q].bridge));
        if (sk !== undefined) path[sk].surface = 's';
      }
      return true;
    },
    boost: () => {
      const ks = path.map((_, k) => k).filter((k) => k > 0 && k < last && path[k + 1] && path[k + 1].dir !== path[k].dir && !path[k].ramp && !path[k].bridge && !used.has(k));
      if (!ks.length) return false;
      const k = pick(ks);
      const to = path[k + 1].dir === 'X' ? 180 : 270;
      objects.push({ type: 'boost', at: centre(path[k]), dir: to, speed: lerp(4.2, 5.6, R()) });
      used.add(k);
      return true;
    },
    bumper: () => {
      const ks = path.map((_, k) => k).filter((k) => k > 1 && k < last && !path[k].ramp && !path[k].bridge && !used.has(k) && sideCells(path[k]).length > 0);
      if (!ks.length) return false;
      const n = Math.min(ks.length, 1 + Math.floor(R() * (D > 0.6 ? 3 : 2)));
      for (let q = 0; q < n; q++) {
        const k = pick(ks);
        if (used.has(k)) continue;
        objects.push({ type: 'bumper', at: centre(path[k]) });
        used.add(k);
      }
      return true;
    },
    portal: () => {
      const ks = path.map((_, k) => k).filter((k) => straight(k - 1, 5) && !used.has(k - 1) && !used.has(k));
      if (!ks.length) return false;
      const k = pick(ks);
      const gap = straight(k - 1, 6) ? 2 : 1;
      for (let g = 0; g < gap; g++) {
        for (const n of sideCells(path[k + g])) removeCell(n);
        removeCell(path[k + g]);
        used.add(k + g);
      }
      // the entry sits in a side pocket when there is room, so it must be aimed for
      const before = path[k - 1];
      const pockets = sideCells(before);
      const entry = pockets.length && D > 0.4 ? centre(pick(pockets)) : centre(before);
      objects.push({ type: 'portal', a: entry, b: centre(path[k + gap]) });
      used.add(k - 1);
      used.add(k + gap);
      return true;
    },
    belt: () => {
      const n = 1 + Math.floor(R() * (D > 0.5 ? 3 : 2));
      const ks = path.map((_, k) => k).filter((k) => straight(k, n) && !used.has(k));
      if (!ks.length) return false;
      const k = pick(ks);
      const d = path[k].dir!;
      const across: ('E' | 'W' | 'S' | 'N')[] = d === 'X' ? ['S', 'N'] : ['E', 'W'];
      const back = d === 'X' ? 'E' : 'S';
      const b = R() < 0.65 ? pick(across) : back;
      for (let q = k; q < k + n; q++) {
        path[q].belt = b;
        used.add(q);
      }
      return true;
    },
  };

  for (const f of featureList) if (!apply[f]() && f === own) return null; // the tier's mechanic must appear

  // --------------------------------------------------------------- fences
  const voidSide = (c: Cell, di: number, dj: number) => !get(c.i + di, c.j + dj);
  const rails = Math.floor(R() * (intro ? 2 : 3)) + (tier === 0 ? 1 : 0);
  for (let q = 0; q < rails; q++) {
    const c = pick(path.slice(1, last));
    if (!c || c.ramp || c.bridge || !get(c.i, c.j)) continue;
    const edges: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const open = edges.filter(([di, dj]) => voidSide(c, di, dj));
    if (!open.length) continue;
    const [di, dj] = pick(open);
    const inset = 0.12;
    const len = lerp(0.55, 0.85, R());
    const off = (1 - len) / 2;
    let from: Vec2;
    let to: Vec2;
    if (di !== 0) {
      const x = di > 0 ? c.i + 1 - inset : c.i + inset;
      from = [x, c.j + off];
      to = [x, c.j + 1 - off];
    } else {
      const z = dj > 0 ? c.j + 1 - inset : c.j + inset;
      from = [c.i + off, z];
      to = [c.i + 1 - off, z];
    }
    objects.push({ type: 'fence', from, to });
  }
  // diagonal deflectors at turns: bank the ball around the corner
  if (D > 0.18) {
    const turns = path.map((_, k) => k).filter((k) => k > 0 && k < last && path[k + 1].dir !== path[k].dir && !path[k].ramp && !path[k].bridge && !used.has(k));
    const n = Math.min(turns.length, R() < lerp(0.4, 0.9, D) ? 1 + (D > 0.6 && R() < 0.5 ? 1 : 0) : 0);
    for (let q = 0; q < n; q++) {
      const k = pick(turns);
      if (used.has(k)) continue;
      const c = path[k];
      // incoming along c.dir, leaving along the other axis: fence across the far corner
      if (c.dir === 'X') {
        // moving -x, turning to -z: corner at low x / high z
        objects.push({ type: 'fence', from: [c.i + 0.08, c.j + 0.42], to: [c.i + 0.58, c.j + 0.92] });
      } else {
        // moving -z, turning to -x: corner at high x / low z
        objects.push({ type: 'fence', from: [c.i + 0.42, c.j + 0.08], to: [c.i + 0.92, c.j + 0.58] });
      }
      used.add(k);
    }
  }

  // ------------------------------------------------------ start and target
  const s = path[0];
  const g = path[last];
  if (!get(g.i, g.j) || g.ramp || g.bridge || g.belt) return null;
  if (D > 0.85 && R() < 0.3 && tier >= 4) g.surface = 'i';
  else if (g.surface === 'i' && D < 0.6) g.surface = '';
  const radius = +lerp(0.44, 0.3, D).toFixed(2);
  const lean = D > 0.55 ? 0.1 : 0;
  const gd = STEP[g.dir ?? 'X'];
  const target: Vec2 = [g.i + 0.5 + gd[0] * lean, g.j + 0.5 + gd[1] * lean];
  const start: Vec2 = [s.i + 0.5, s.j + 0.5];

  // ------------------------------------------------------- normalise + emit
  const all = [...cells.values()];
  const minI = Math.min(...all.map((c) => c.i));
  const minJ = Math.min(...all.map((c) => c.j));
  const maxI = Math.max(...all.map((c) => c.i));
  const maxJ = Math.max(...all.map((c) => c.j));
  const minL = Math.min(...all.map((c) => c.level));
  const maxL = Math.max(...all.map((c) => c.level + (c.ramp ? 1 : 0)));
  if (maxL - minL > 9) return null;
  const shift = (p: Vec2): Vec2 => [+(p[0] - minI).toFixed(3), +(p[1] - minJ).toFixed(3)];
  const map: string[] = [];
  for (let jj = minJ; jj <= maxJ; jj++) {
    const row: string[] = [];
    for (let ii = minI; ii <= maxI; ii++) {
      const c = get(ii, jj);
      row.push(c ? `${c.level - minL}${c.ramp}${c.surface}${c.bridge}${c.belt}` : '.');
    }
    map.push(row.map((t) => t.padEnd(3)).join(' ').trimEnd());
  }
  const objs: FloorObject[] = objects.map((o) => {
    switch (o.type) {
      case 'fence': return { ...o, from: shift(o.from), to: shift(o.to) };
      case 'portal': return { ...o, a: shift(o.a), b: shift(o.b) };
      default: return { ...o, at: shift(o.at) } as FloorObject;
    }
  });
  return {
    name: `${TIER_NAME[tier]} ${(slot % 5) + 1}`,
    kicks: 9,
    time: 99,
    map,
    start: shift(start),
    target: shift(target),
    radius,
    seed: 100 + slot * 13 + (seed % 97),
    objects: objs.length ? objs : undefined,
  };
}

interface Result {
  slot: number;
  def: FloorDef;
  stats: string;
}

function generateSlot(slot: number): Result | null {
  const D = difficulty(slot);
  const [lo, hi] = kickRange(D);
  for (let seed = 1; seed <= 400; seed++) {
    const def = buildCandidate(slot, seed);
    if (!def) continue;
    let floor;
    try {
      floor = floorFromDef(def, slot);
    } catch {
      continue;
    }
    const sol = solveFloor(floor, { maxKicks: hi, angles: 60, powers: 28, beam: 10 });
    if (!sol || sol.stuck > 0 || sol.kicks < lo) continue;
    if (D < 0.2 && sol.robust < 6) continue;
    def.kicks = sol.kicks + slack(D);
    // a second, differently sampled search must agree: no floor hangs on one lucky sample
    const check = solveFloor(floor, { maxKicks: def.kicks, angles: 72, powers: 32, beam: 12 });
    if (!check || check.stuck > 0) continue;
    def.time = Math.round((10 + def.kicks * secondsPerKick(D)) / 5) * 5;
    return {
      slot,
      def,
      stats: `fewest ${sol.kicks} / limit ${def.kicks} · ${def.time}s · robust ${sol.robust}/25 · first-kick falls ${(sol.fallRate * 100).toFixed(0)}% · seed ${seed}`,
    };
  }
  return null;
}

if (isMainThread) {
  const first = Number(process.argv[2] ?? HANDMADE.length);
  const lastSlot = Number(process.argv[3] ?? TOTAL - 1);
  const slots: number[] = [];
  for (let s = first; s <= lastSlot; s++) slots.push(s);
  const results = new Map<number, Result>();
  const n = Math.max(1, Math.min(cpus().length, slots.length));
  let next = 0;
  let running = 0;
  const t0 = Date.now();
  await new Promise<void>((done) => {
    const spawn = () => {
      if (next >= slots.length) {
        if (running === 0) done();
        return;
      }
      const slot = slots[next++];
      running++;
      const w = new Worker(new URL(import.meta.url), { workerData: { slot } });
      w.on('message', (r: Result | null) => {
        if (r) {
          results.set(slot, r);
          console.log(`floor ${slot + 1}: ${r.def.name} — ${r.stats}`);
        } else console.log(`floor ${slot + 1}: FAILED to generate`);
      });
      w.on('error', (e: Error) => console.log(`floor ${slot + 1}: worker error ${e.message}`));
      w.on('exit', () => {
        running--;
        spawn();
      });
    };
    for (let k = 0; k < n; k++) spawn();
  });
  // keep every result (also partial runs) for inspection and merging
  const cache = new URL('../.gen-cache.json', import.meta.url);
  let prev: Record<string, Result> = {};
  try {
    prev = JSON.parse((await import('node:fs')).readFileSync(cache, 'utf8'));
  } catch {
    prev = {};
  }
  for (const [s, r] of results) prev[s] = r;
  writeFileSync(cache, JSON.stringify(prev));
  for (const [s, r] of Object.entries(prev)) if (!results.has(Number(s))) results.set(Number(s), r);
  const generated: FloorDef[] = [];
  for (let s = HANDMADE.length; s < TOTAL; s++) {
    const r = results.get(s);
    if (!r) {
      console.log(`missing floor ${s + 1}; not writing`);
      process.exit(1);
    }
    generated.push(r.def);
  }
  const body = JSON.stringify(generated, null, 2).replace(/"(\w+)":/g, '$1:');
  writeFileSync(
    new URL('../src/floors.generated.ts', import.meta.url),
    `// Written by scripts/gen-floors.ts. Do not edit by hand.\nimport type { FloorDef } from './levels.ts';\n\nexport const GENERATED: FloorDef[] = ${body};\n`,
  );
  console.log(`wrote ${generated.length} floors in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} else {
  parentPort!.postMessage(generateSlot((workerData as { slot: number }).slot));
}
