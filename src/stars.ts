// The three stars of every floor, in Play mode: one for clearing it, one for
// clearing it within its time (counted from the first touch), one for clearing
// it within its kicks. The targets come from scripts/stars.ts, which replays
// each floor's fewest-kick solution; the best stars of each floor stay on the
// device.
import { STAR_TARGETS } from './stars.generated.ts';
import { storage } from './util.ts';

const KEY = 'skypitch.stars';

export interface StarTarget {
  kicks: number;
  time: number; // seconds
}

export function starTarget(index: number): StarTarget {
  return STAR_TARGETS[index] ?? { kicks: 99, time: 999 };
}

/** The best stars of every floor, 0 to 3 each. */
export function bestStars(): number[] {
  const s = storage.get(KEY) ?? '';
  return STAR_TARGETS.map((_, i) => Math.min(3, Math.max(0, Number(s[i]) || 0)));
}

/** Keep `n` stars for floor `index` if that beats its best; true if it did. */
export function saveStars(index: number, n: number): boolean {
  const all = bestStars();
  if (index < 0 || index >= all.length || n <= all[index]) return false;
  all[index] = n;
  storage.set(KEY, all.join(''));
  return true;
}

export function totalStars(): number {
  return bestStars().reduce((a, b) => a + b, 0);
}

/** How many stars a floor can give: three each. */
export const MAX_STARS = STAR_TARGETS.length * 3;
