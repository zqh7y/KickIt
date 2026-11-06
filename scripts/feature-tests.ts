// Mechanics bench: one tiny floor per mechanic, solved through the game's own
// physics. Run: node scripts/feature-tests.ts
import { floorFromDef, parseFloor, type FloorDef } from '../src/levels.ts';
import { BallSim, PHYS_DT } from '../src/physics.ts';
import { solveFloor } from './lib/solver.ts';

const base = { kicks: 4, time: 60, radius: 0.4, seed: 3 };
const benches: FloorDef[] = [
  {
    ...base, name: 'fence bank', start: [3.5, 4.5], target: [0.5, 0.5],
    map: ['0 0 0 0', '0 0 0 0', '0 0 0 0', '0 0 0 0', '0 0 0 0'],
    objects: [{ type: 'fence', from: [0, 2.5], to: [2.8, 2.5] }],
  },
  {
    ...base, name: 'trampoline gap', start: [0.5, 7.5], target: [0.5, 0.6],
    map: ['0', '0', '0', '.', '.', '0', '0', '0'],
    objects: [{ type: 'trampoline', at: [0.5, 5.5] }],
  },
  {
    ...base, name: 'bridge', start: [0.5, 5.5], target: [0.5, 0.5],
    map: ['0', '0', '0|', '0|', '0', '0'],
  },
  {
    ...base, name: 'magnet pull', start: [1.5, 5.5], target: [1.5, 0.5],
    map: ['0 0 0', '0 0 0', '0 0 0', '0 0 0', '0 0 0', '0 0 0'],
    objects: [{ type: 'magnet', at: [0.4, 2.5] }],
  },
  {
    ...base, name: 'ice and sand', start: [0.5, 6.5], target: [0.5, 0.5],
    map: ['0s', '0s', '0i', '0i', '0i', '0', '0'],
  },
  {
    ...base, name: 'boost corner', start: [3.5, 3.5], target: [0.5, 0.5],
    map: ['0 . . .', '0 . . .', '0 . . .', '0 0 0 0'],
    objects: [{ type: 'boost', at: [0.5, 3.5], dir: 270 }],
  },
  {
    ...base, name: 'bumpers', start: [1.5, 5.5], target: [1.5, 0.5],
    map: ['0 0 0', '0 0 0', '0 0 0', '0 0 0', '0 0 0', '0 0 0'],
    objects: [{ type: 'bumper', at: [1.5, 3] }, { type: 'bumper', at: [0.6, 2] }, { type: 'bumper', at: [2.4, 2] }],
  },
  {
    ...base, name: 'portal hop', start: [3.5, 4.5], target: [0.5, 0.5],
    map: ['0 0 . .', '0 0 . .', '. . . .', '. . 0 0', '. . 0 0'],
    objects: [{ type: 'portal', a: [2.5, 3.5], b: [1.5, 1.5] }],
  },
  {
    ...base, name: 'conveyor', start: [1.5, 5.5], target: [1.5, 0.5],
    map: ['. 0 .', '. 0 .', '. 0W .', '0 0W 0', '. 0 .', '. 0 .'],
  },
];

let ok = true;
for (const def of benches) {
  const f = floorFromDef(def, 10);
  const t0 = Date.now();
  const s = solveFloor(f, { maxKicks: def.kicks, angles: 72, powers: 30, beam: 10 });
  const ms = Date.now() - t0;
  if (!s) {
    ok = false;
    console.log(`✗ ${def.name}: NOT solved within ${def.kicks} kicks (${ms} ms)`);
  } else {
    console.log(`✓ ${def.name}: ${s.kicks} kick(s), ${s.wins}/${s.tried} winning samples, robust ${s.robust}/25, falls ${(s.fallRate * 100).toFixed(0)}%, stuck ${s.stuck} (${ms} ms)`);
    if (s.stuck) ok = false;
  }
}

// Direct checks of individual behaviours.
{
  const f = floorFromDef(benches[1], 10);
  const sim = new BallSim(f);
  sim.place(0.5, 7.5);
  sim.kick(0, -1, 0.5);
  let maxY = 0;
  let launched = false;
  for (let n = 0; n < 240 * 10 && sim.state !== 'rest' && sim.state !== 'fallen'; n++) {
    sim.step(PHYS_DT);
    for (const e of sim.events) if (e.type === 'tramp') launched = true;
    sim.events.length = 0;
    maxY = Math.max(maxY, sim.y);
  }
  console.log(`  trampoline: launched=${launched} peak=${maxY.toFixed(2)} end=${sim.state} at z=${sim.z.toFixed(2)}`);
}
for (const i of [0, 1]) {
  const f = parseFloor(i);
  const s = solveFloor(f, { maxKicks: f.def.kicks, angles: 96, powers: 40, beam: 12 });
  console.log(`floor ${i + 1}: ${s ? `${s.kicks} kicks (limit ${f.def.kicks}), robust ${s.robust}, falls ${(s.fallRate * 100).toFixed(0)}%, stuck ${s.stuck}` : 'NOT SOLVED'}`);
  if (!s) ok = false;
}
process.exit(ok ? 0 : 1);
