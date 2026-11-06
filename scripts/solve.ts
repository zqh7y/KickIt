// Floor checker: solves every floor (or the ones named) through the game's
// own physics and fails if any cannot be cleared within its kick limit or can
// trap the ball. Optionally writes the winning kick sequences as JSON.
// Run: node scripts/solve.ts [floorNumber ...] [--paths out.json]
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { FLOORS, parseFloor } from '../src/levels.ts';
import { solveFloor, type Solution } from './lib/solver.ts';

type Report = { index: number; sol: Solution | null };

if (isMainThread) {
  const args = process.argv.slice(2);
  const pathsAt = args.indexOf('--paths');
  const out = pathsAt >= 0 ? args[pathsAt + 1] : null;
  const named = args.filter((a, k) => /^\d+$/.test(a) && (pathsAt < 0 || k !== pathsAt + 1)).map((a) => Number(a) - 1);
  const list = named.length ? named : FLOORS.map((_, i) => i);
  const reports = new Map<number, Report>();
  let next = 0;
  let running = 0;
  await new Promise<void>((done) => {
    const spawn = () => {
      if (next >= list.length) {
        if (!running) done();
        return;
      }
      const index = list[next++];
      running++;
      const w = new Worker(new URL(import.meta.url), { workerData: { index } });
      w.on('message', (r: Report) => reports.set(r.index, r));
      w.on('error', (e: Error) => console.log(`floor ${index + 1}: worker error ${e.message}`));
      w.on('exit', () => {
        running--;
        spawn();
      });
    };
    for (let k = 0; k < Math.min(cpus().length, list.length); k++) spawn();
  });
  let ok = true;
  const paths: Record<number, { angle: number; power: number }[]> = {};
  for (const i of list) {
    const r = reports.get(i);
    const def = FLOORS[i];
    if (!r || !r.sol) {
      ok = false;
      console.log(`✗ floor ${i + 1} "${def.name}": not solved within ${def.kicks} kicks`);
      continue;
    }
    const s = r.sol;
    if (s.stuck) ok = false;
    paths[i] = s.path;
    console.log(
      `${s.stuck ? '✗' : '✓'} floor ${String(i + 1).padStart(2)} "${def.name}": fewest ${s.kicks} / limit ${def.kicks} · ${def.time}s · robust ${s.robust}/25 · first-kick falls ${(s.fallRate * 100).toFixed(0)}%${s.stuck ? ` · ${s.stuck} STUCK` : ''}`,
    );
  }
  if (out) writeFileSync(out, JSON.stringify(paths));
  process.exit(ok ? 0 : 1);
} else {
  const { index } = workerData as { index: number };
  const f = parseFloor(index);
  const sol = solveFloor(f, { maxKicks: f.def.kicks, angles: 72, powers: 32, beam: 12 });
  parentPort!.postMessage({ index, sol } satisfies Report);
}
