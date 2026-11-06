// The floors, in play order: floors 1-2 are hand-made (here); the rest come
// from scripts/gen-floors.ts, which writes src/floors.generated.ts.
import type { FloorDef } from './levels.ts';
import { GENERATED } from './floors.generated.ts';

export const HANDMADE: FloorDef[] = [
  {
    name: 'Kick-off',
    kicks: 3,
    time: 30,
    map: [
      '1  1  .  .  .  .',
      '1  1  1  .  .  .',
      '.  0^ 1  .  .  .',
      '.  0  0  0  .  .',
      '.  .  0  0  0  .',
      '.  .  .  0  0  0',
      '.  .  .  .  0  0',
    ],
    start: [4.5, 5.5],
    target: [0.62, 0.62],
    radius: 0.42,
    seed: 11,
  },
  {
    name: 'Two-step',
    kicks: 4,
    time: 40,
    map: [
      '2  2  .  .  .  .  .',
      '2  2  1< 1  .  .  .',
      '.  .  .  1  1  .  .',
      '.  .  .  0^ 1  .  .',
      '.  .  0  0  0  .  .',
      '.  .  .  0  0  0  .',
      '.  .  .  .  .  0  0',
      '.  .  .  .  .  0  0',
    ],
    start: [5.5, 7.4],
    target: [0.55, 0.5],
    radius: 0.36,
    seed: 23,
  },
];

export const FLOORS: FloorDef[] = [...HANDMADE, ...GENERATED];
