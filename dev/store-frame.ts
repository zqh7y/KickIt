// Google Play phone screenshots: a real game capture (store/raw/) in a tilted,
// ink-outlined card on the game's striped pitch, under a headline in the game's
// own font and an ink ribbon, with a few stars and glints. One slide per ?i=N.
// Rendered by Playwright at 360x640 CSS px with device scale 3, so 1080x1920 (9:16).
import { color } from '../src/theme.ts';

type Deco = ['star' | 'glint' | 'glint gold', number, number, number, number]; // kind, x, y, size, rotation

interface Slide {
  shot: string;
  title: string[]; // lines; <b> marks the gold words
  ribbon: string;
  tilt: number; // degrees
  deco: Deco[];
}

export const SLIDES: Slide[] = [
  {
    shot: 'aim',
    title: ['Drag, aim', 'and <b>kick!</b>'],
    ribbon: 'Stop the ball inside the circle',
    tilt: -2.5,
    deco: [['glint', 22, 168, 22, 0], ['glint gold', 318, 196, 16, 0], ['glint', 324, 560, 20, 0]],
  },
  {
    shot: 'stars',
    title: ['Earn <b>3 stars</b>', 'on every floor'],
    ribbon: 'Beat the clock, save kicks',
    tilt: 2.5,
    deco: [['star', 8, 30, 30, -14], ['star', 318, 22, 34, 12], ['star', 316, 548, 26, 18], ['glint', 24, 520, 18, 0]],
  },
  {
    shot: 'shop',
    title: ['Unlock', '<b>16 balls</b>'],
    ribbon: 'Each with its own kick effect',
    tilt: -2.5,
    deco: [['glint gold', 40, 40, 22, 0], ['glint', 300, 58, 18, 0], ['glint gold', 322, 540, 22, 0], ['glint', 18, 590, 16, 0]],
  },
  {
    shot: 'magnet',
    title: ['A new twist', 'every <b>5 floors</b>'],
    ribbon: 'Magnets, portals & more',
    tilt: 2.5,
    deco: [['glint', 24, 176, 20, 0], ['glint gold', 322, 520, 18, 0]],
  },
  {
    shot: 'portal',
    title: ['<b>50</b> floating', 'floors'],
    ribbon: 'High above a giant stadium',
    tilt: -2.5,
    deco: [['glint gold', 30, 50, 20, 0], ['glint', 316, 170, 18, 0], ['glint', 20, 560, 18, 0]],
  },
  {
    shot: 'mayhem',
    title: ['Can you beat', '<b>all 50?</b>'],
    ribbon: 'The last floors mix every twist',
    tilt: 2.5,
    deco: [['star', 20, 46, 26, -12], ['glint', 318, 60, 18, 0], ['glint gold', 316, 556, 20, 0]],
  },
  {
    shot: 'lobby',
    title: ['Play', '<b>anywhere</b>'],
    ribbon: 'Offline · No ads · No tracking',
    tilt: -2.5,
    deco: [['glint gold', 42, 46, 22, 0], ['glint', 300, 40, 18, 0], ['glint', 322, 548, 20, 0]],
  },
];

const STAR = 'M12 2.6l2.59 6.44 6.92.47-5.33 4.45 1.7 6.73L12 16.99l-5.88 3.7 1.7-6.73-5.33-4.45 6.92-.47z';
const GLINT = 'M5 .6Q5.7 4.3 9.4 5 5.7 5.7 5 9.4 4.3 5.7.6 5 4.3 4.3 5 .6Z';

function outline(w: number): string {
  const d = +(w * 0.75).toFixed(2);
  const at: [number, number][] = [[w, 0], [-w, 0], [0, w], [0, -w], [d, d], [-d, d], [d, -d], [-d, -d]];
  return at.map(([x, y]) => `${x}px ${y}px 0 ${color.ink}`).join(',');
}

const root = document.documentElement.style;
root.setProperty('--ink', color.ink);
root.setProperty('--paper', color.paper);
root.setProperty('--gold', color.gold);
root.setProperty('--grass-a', color.grassA);
root.setProperty('--grass-b', color.grassSeam);
root.setProperty('--stripe', `color-mix(in srgb, ${color.paint} 10%, transparent)`);
root.setProperty('--glow', `color-mix(in srgb, ${color.paint} 45%, transparent)`);
root.setProperty('--paint-soft', `color-mix(in srgb, ${color.paint} 38%, transparent)`);
root.setProperty('--shade', `color-mix(in srgb, ${color.ink} 35%, transparent)`);
root.setProperty('--outline', outline(3));

const i = Math.max(0, Math.min(SLIDES.length - 1, Number(new URLSearchParams(location.search).get('i') ?? 0)));
const s = SLIDES[i];
document.getElementById('title')!.innerHTML = s.title.map((l) => `<span>${l}</span>`).join('');
document.getElementById('ribbon')!.textContent = s.ribbon;
document.getElementById('card')!.style.setProperty('--tilt', `${s.tilt}deg`);
for (const [kind, x, y, size, rot] of s.deco) {
  const star = kind === 'star';
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('class', `sf-deco ${kind}`);
  el.setAttribute('viewBox', star ? '0 0 24 24' : '0 0 10 10');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = `rotate(${rot}deg)`;
  el.innerHTML = `<path d="${star ? STAR : GLINT}" />`;
  document.body.appendChild(el);
}
const img = document.getElementById('shot') as HTMLImageElement;
img.src = `/store/raw/${s.shot}.png`;
Promise.all([img.decode(), document.fonts.ready]).then(() => ((window as unknown as { __ready: boolean }).__ready = true));
