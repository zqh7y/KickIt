// Star targets for every floor. Replays each floor's fewest-kick solution
// (written by `node scripts/solve.ts --paths <file>`) through the game's own
// physics, times how long the ball rolls, and writes src/stars.generated.ts:
//   kicks: the fewest kicks the solver found (beat or match it for a star)
//   time:  seconds to clear the floor in for a star: the rolling time plus a
//          calm aim for every kick, rounded up to 5 s, and always at least
//          5 s inside the floor's own countdown
// Run: node scripts/solve.ts --paths paths.json && node scripts/stars.ts paths.json
import { readFileSync, writeFileSync } from 'node:fs';
import { FLOORS, parseFloor } from '../src/levels.ts';
import { BallSim, inTarget, PHYS_DT } from '../src/physics.ts';

const AIM = 3; // s to grab the ball, aim and let go, per kick
const SPARE = 3; // s of slack on top of it all

const paths: Record<string, { angle: number; power: number }[]> = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows: { kicks: number; time: number }[] = [];
let ok = true;
FLOORS.forEach((def, i) => {
  const path = paths[String(i)];
  if (!path?.length) {
    console.log(`✗ floor ${i + 1}: no solution in the file`);
    ok = false;
    return;
  }
  const floor = parseFloor(i);
  const sim = new BallSim(floor);
  let [x, z] = def.start;
  let roll = 0;
  for (const k of path) {
    sim.place(x, z);
    sim.kick(Math.cos(k.angle), Math.sin(k.angle), k.power);
    let n = 0;
    while (sim.state !== 'rest' && sim.state !== 'fallen' && n < 240 * 45) {
      sim.step(PHYS_DT);
      n++;
    }
    roll += n * PHYS_DT;
    if (sim.state !== 'rest') break;
    x = sim.x;
    z = sim.z;
  }
  if (sim.state !== 'rest' || !inTarget(floor, x, z)) {
    console.log(`✗ floor ${i + 1}: the solution no longer wins (re-run solve.ts for fresh paths)`);
    ok = false;
    return;
  }
  const kicks = path.length;
  const time = Math.min(def.time - 5, Math.ceil((roll + kicks * AIM + SPARE) / 5) * 5);
  rows.push({ kicks, time });
  console.log(`✓ floor ${String(i + 1).padStart(2)}: ${kicks}/${def.kicks} kicks · ${time}/${def.time}s (rolls ${roll.toFixed(1)}s)`);
});
if (!ok) process.exit(1);
const body = rows.map((r) => `  { kicks: ${r.kicks}, time: ${r.time} },`).join('\n');
writeFileSync(
  new URL('../src/stars.generated.ts', import.meta.url),
  `// Written by scripts/stars.ts. Do not edit by hand.\n\n/** Per floor: the kicks and the seconds (from the first touch) to beat for its stars. */\nexport const STAR_TARGETS: { kicks: number; time: number }[] = [\n${body}\n];\n`,
);
console.log('wrote src/stars.generated.ts');
