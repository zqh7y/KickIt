// The shop's sixteen balls (the classic football, tennis, basket, volley, base,
// beach, pool, cricket, bowling, golf and disco balls, a watermelon, the Earth,
// the Moon, a galaxy and a lava ball): what each looks like and the goal that
// unlocks it.
// Goals read the player's own records (floors reached, floors cleared, one-kick
// clears, Speedrun times), all kept on the device.
import { storage } from './util.ts';

export type Goal =
  | { kind: 'free' }
  | { kind: 'floor'; n: number } // reach floor n
  | { kind: 'clears'; n: number } // clear n floors in all
  | { kind: 'ones'; n: number } // clear n floors with the first kick
  | { kind: 'speedrun'; under?: number }; // finish a Speedrun (under this many seconds)

/** What a ball is: a stitched football, or one of the round balls painted by src/ball.ts. */
export type BallKind = 'soccer' | 'tennis' | 'basket' | 'volley' | 'base' | 'beach' | 'pool' | 'cricket' | 'bowling' | 'golf' | 'disco' | 'melon' | 'earth' | 'moon' | 'galaxy' | 'lava';

/**
 * A ball's own effect: the burst when it is kicked and the trail it leaves as
 * it rolls. `look`: glowing sparks, or solid little bits (fuzz, dust, seeds);
 * `move`: they drop like drops, float like dust, or rise like embers.
 */
export interface BallFx {
  colors: string[];
  look: 'spark' | 'bits';
  move: 'fall' | 'float' | 'rise';
}

export interface Skin {
  id: string;
  name: string;
  kind: BallKind;
  fx: BallFx;
  /** soccer: [hexagons, pentagons]; the round balls: up to four colours their pattern uses, in its order */
  colors: string[];
  goal: Goal;
}

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Classic', kind: 'soccer', colors: ['#fbfbf6', '#1e2619'], fx: { colors: ['#ffffff', '#ffd84a'], look: 'spark', move: 'fall' }, goal: { kind: 'free' } },
  { id: 'tennis', name: 'Tennis', kind: 'tennis', colors: ['#d9ec4c', '#f6f8ee'], fx: { colors: ['#d9ec4c', '#eef7a8', '#c3d93a'], look: 'bits', move: 'float' }, goal: { kind: 'floor', n: 5 } },
  { id: 'basket', name: 'Basketball', kind: 'basket', colors: ['#e8772e', '#2a1c14'], fx: { colors: ['#ff8a3d', '#ffd08a', '#e8772e'], look: 'spark', move: 'fall' }, goal: { kind: 'floor', n: 10 } },
  { id: 'volley', name: 'Volleyball', kind: 'volley', colors: ['#ffd23f', '#2b5fd9', '#f7f7f2', '#3b4a63'], fx: { colors: ['#ffd23f', '#2b5fd9', '#ffffff'], look: 'spark', move: 'fall' }, goal: { kind: 'floor', n: 20 } },
  { id: 'base', name: 'Baseball', kind: 'base', colors: ['#f5f0e3', '#d0312d'], fx: { colors: ['#f5f0e3', '#d0312d', '#e9e2cf'], look: 'bits', move: 'float' }, goal: { kind: 'floor', n: 30 } },
  { id: 'beach', name: 'Beach ball', kind: 'beach', colors: ['#ff5c47', '#3fa7f5', '#ffd84a', '#fbfbf6'], fx: { colors: ['#7fd3ff', '#ffffff', '#3fa7f5'], look: 'spark', move: 'fall' }, goal: { kind: 'floor', n: 40 } },
  { id: 'moon', name: 'Moon', kind: 'moon', colors: ['#d9dbe1', '#7f838f', '#ffffff'], fx: { colors: ['#c9ccd4', '#9a9ea8', '#e4e6ec'], look: 'bits', move: 'float' }, goal: { kind: 'floor', n: 50 } },
  { id: 'pool', name: '8-Ball', kind: 'pool', colors: ['#17181c', '#fbfbf6'], fx: { colors: ['#ffffff', '#e9eef5', '#ffd84a'], look: 'spark', move: 'fall' }, goal: { kind: 'clears', n: 25 } },
  { id: 'cricket', name: 'Cricket', kind: 'cricket', colors: ['#b3262b', '#f3ead2'], fx: { colors: ['#ff5a4f', '#f3ead2', '#b3262b'], look: 'spark', move: 'fall' }, goal: { kind: 'clears', n: 50 } },
  { id: 'bowling', name: 'Bowling', kind: 'bowling', colors: ['#2b2f8f', '#8a5ae0', '#0d0d18'], fx: { colors: ['#8a5ae0', '#c9b3ff', '#2b2f8f'], look: 'spark', move: 'fall' }, goal: { kind: 'clears', n: 100 } },
  { id: 'golf', name: 'Golf', kind: 'golf', colors: ['#f7f8f3', '#d9ddd3'], fx: { colors: ['#ffffff', '#cfe8c0', '#9fd16a'], look: 'spark', move: 'fall' }, goal: { kind: 'ones', n: 5 } },
  { id: 'disco', name: 'Disco', kind: 'disco', colors: ['#e9eef5', '#7fe8ff', '#ff8ad8', '#3d4250'], fx: { colors: ['#7fe8ff', '#ff8ad8', '#ffe27a', '#ffffff'], look: 'spark', move: 'float' }, goal: { kind: 'ones', n: 25 } },
  { id: 'melon', name: 'Watermelon', kind: 'melon', colors: ['#97d66e', '#2f7a35'], fx: { colors: ['#e8414f', '#1d1d1d', '#ff7a85'], look: 'bits', move: 'fall' }, goal: { kind: 'speedrun' } },
  { id: 'galaxy', name: 'Galaxy', kind: 'galaxy', colors: ['#121a4a', '#4b2a8c', '#ff6fb5', '#fff6d8'], fx: { colors: ['#ff6fb5', '#b98cff', '#fff6d8'], look: 'spark', move: 'float' }, goal: { kind: 'speedrun', under: 20 * 60 } },
  { id: 'earth', name: 'Earth', kind: 'earth', colors: ['#2f80dc', '#63bd57', '#3f8f40', '#f4f8fb'], fx: { colors: ['#63bd57', '#2f80dc', '#ffffff'], look: 'spark', move: 'float' }, goal: { kind: 'speedrun', under: 14 * 60 } },
  { id: 'lava', name: 'Lava', kind: 'lava', colors: ['#2b211f', '#ff5a1f', '#ffd23a'], fx: { colors: ['#ff5a1f', '#ffd23a', '#ff8a3d'], look: 'spark', move: 'rise' }, goal: { kind: 'speedrun', under: 10 * 60 } },
];

/** The player's records the goals look at. */
export interface Records {
  floor: number; // highest floor reached (1-based)
  clears: number;
  ones: number;
  speedrun: number | null; // best Speedrun, seconds
}

export const KEY_BALL = 'skypitch.ball';
export const KEY_CLEARS = 'skypitch.stats.clears';
export const KEY_ONES = 'skypitch.stats.ones';

const num = (key: string) => Math.max(0, Math.floor(Number(storage.get(key) ?? 0)) || 0);

export function readRecords(): Records {
  const best = parseFloat(storage.get('skypitch.best.speedrun') ?? '');
  return {
    floor: num('skypitch.unlocked') + 1,
    clears: num(KEY_CLEARS),
    ones: num(KEY_ONES),
    speedrun: Number.isFinite(best) ? best : null,
  };
}

/** Add one to a record counter. */
export function countUp(key: string) {
  storage.set(key, String(num(key) + 1));
}

export function goalMet(g: Goal, r: Records): boolean {
  switch (g.kind) {
    case 'free':
      return true;
    case 'floor':
      return r.floor >= g.n;
    case 'clears':
      return r.clears >= g.n;
    case 'ones':
      return r.ones >= g.n;
    case 'speedrun':
      return r.speedrun != null && (g.under == null || r.speedrun < g.under);
  }
}

export function goalText(g: Goal): string {
  switch (g.kind) {
    case 'free':
      return 'Free';
    case 'floor':
      return `Reach floor ${g.n}`;
    case 'clears':
      return `Clear ${g.n} floors`;
    case 'ones':
      return `${g.n} one-kick clears`;
    case 'speedrun':
      return g.under == null ? 'Finish a Speedrun' : `Speedrun under ${Math.round(g.under / 60)} min`;
  }
}

/** The ball the player picked (the classic one if none, or if it is gone). */
export function chosenSkin(): Skin {
  return SKINS.find((s) => s.id === storage.get(KEY_BALL)) ?? SKINS[0];
}
