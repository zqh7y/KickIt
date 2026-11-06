import './style.css';
import { Game, type Snapshot } from './game.ts';
import { platform } from './platform.ts';

interface HotHook {
  snapshot?: (fn: () => unknown) => void;
  ready?: (start: (data: unknown) => void) => void;
  data?: unknown;
}

const hot = (window as unknown as { claude?: { hot?: HotHook } }).claude?.hot;

/** Shown when the device cannot run the game (no WebGL). */
function unsupported() {
  const p = document.createElement('p');
  p.className = 'unsupported';
  p.textContent = 'Kick-It! needs 3D graphics (WebGL), which this device or browser has turned off.';
  document.getElementById('ui')?.appendChild(p);
}

async function boot(data: unknown) {
  // The shirt number is painted with the UI font: wait for it (briefly).
  try {
    await Promise.race([
      Promise.all([document.fonts.load("700 92px 'Fredoka'"), document.fonts.load("600 16px 'Fredoka'")]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
  try {
    const canvas = document.getElementById('scene') as HTMLCanvasElement;
    const game = new Game(canvas);
    const restore = (data && typeof data === 'object' && 'mode' in data ? data : null) as Snapshot | null;
    game.start(restore);
    hot?.snapshot?.(() => game.snapshot());
    (window as unknown as { __game?: Game }).__game = game;
  } catch (e) {
    console.error(e);
    unsupported();
  } finally {
    // never leave the native splash up, whatever happened
    requestAnimationFrame(() => requestAnimationFrame(() => platform.hideSplash()));
  }
}

if (hot?.ready) hot.ready(boot);
else void boot(hot?.data ?? {});
