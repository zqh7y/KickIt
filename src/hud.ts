// DOM side of the game: HUD, floor arrows, hint, power label, callouts, title
// and the run-complete card. No game logic lives here.
import { TESTER_TOOLS } from './config.ts';
import { skies, space, ui } from './theme.ts';
import { clamp, formatClock } from './util.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Writes text as fixed-width cells so ticking digits never jitter. */
function setDigits(el: HTMLElement, text: string) {
  if (el.dataset.v === text) return;
  el.dataset.v = text;
  el.innerHTML = [...text].map((c) => `<span class="${/\d/.test(c) ? 'd' : 's'}">${c}</span>`).join('');
}

/** Restart a one-shot CSS animation that hangs off `cls`. */
function restart(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Show an element whose CSS animates it in. */
function reveal(el: HTMLElement) {
  el.classList.remove('leaving');
  el.hidden = false;
}

/** Play the element's leave animation, then hide it. */
function dismiss(el: HTMLElement, ms: number = ui.base) {
  if (el.hidden) return;
  el.classList.add('leaving');
  window.setTimeout(() => {
    if (el.classList.contains('leaving')) {
      el.hidden = true;
      el.classList.remove('leaving');
    }
  }, ms);
}

/** The one wording for the kick count, wherever it is announced. */
const kicksLeftLabel = (left: number) => `${left} ${left === 1 ? 'kick' : 'kicks'} left`;

export type Mode = 'regular' | 'speedrun';

/** Floor arrows: shown or not, and whether each one can be pressed. */
export interface NavState {
  visible: boolean;
  prev: boolean;
  next: boolean;
  /** A floor change is under way: both arrows dim and ignore presses but keep focus. */
  busy?: boolean;
}

export interface HudHandlers {
  play: (m: Mode) => void;
  again: () => void;
  menu: () => void;
  tap: () => void;
  /** "<" floor arrow (Play mode). */
  prev: () => void;
  /** ">" floor arrow (Play mode). */
  next: () => void;
  /** Zoom button: in on the shot (the ball and the circle), or back out. */
  zoom: () => void;
  /** Tester button: tester mode on or off. */
  tester: () => void;
  /** The HUD's restart button. */
  restart: () => void;
  /** Lobby Shop button, and its Done button. */
  shop: () => void;
  shopDone: () => void;
  /** A ball in the shop was tapped. */
  pickBall: (id: string) => void;
}

/** One ball in the shop grid. */
export interface ShopCell {
  id: string;
  name: string;
  goal: string; // what unlocks it
  unlocked: boolean;
  selected: boolean;
}

/** The zoom button: whether the view is zoomed in (it then zooms out) and whether it can be used now. */
export interface ZoomState {
  zoomed: boolean;
  enabled: boolean;
}

export class Hud {
  private overlay = $('ui');
  private hud = $('hud');
  private floorNum = $('floor-num');
  private floorTotal = $('floor-total');
  private timer = $('timer');
  private timerText = $('timer-text');
  private kicks = $('kicks');
  private kickBall = $('kick-ball');
  private kickNum = $('kick-num');
  private runClock = $('run-clock');
  private runTime = $('run-time');
  private navPrev = $<HTMLButtonElement>('nav-prev');
  private navNext = $<HTMLButtonElement>('nav-next');
  private zoomBtn = $<HTMLButtonElement>('zoom-btn');
  private testerBtn = $<HTMLButtonElement>('tester-btn');
  private restartBtn = $<HTMLButtonElement>('restart-btn');
  private restartLabel = 'Restart floor';
  private floorStars = $('floor-stars');
  private starGoals = $('star-goals');
  private goalTime = $('goal-time');
  private goalTimeText = $('goal-time-text');
  private goalKicks = $('goal-kicks');
  private goalKicksText = $('goal-kicks-text');
  private goalKey = '';
  private starsResult = $('stars-result');
  private playStars = $('play-stars');
  private playStarsNum = $('play-stars-num');
  private testerBadge = $('tester-badge');
  private shop = $('shop');
  private shopGrid = $('shop-grid');
  private shopDone = $('shop-done');
  private power = $('power');
  private hint = $('hint');
  private hintZoom = $('hint-zoom');
  private callout = $('callout');
  private calloutText = $('callout-text');
  private calloutRibbon = $('callout-ribbon');
  private calloutSub = $('callout-sub');
  private title = $('title');
  private titleTop = this.title.querySelector<HTMLElement>('.title-top')!;
  private titleBottom = this.title.querySelector<HTMLElement>('.title-bottom')!;
  private playBtn = $<HTMLButtonElement>('btn-play');
  private speedrunBest = $('speedrun-best');
  private complete = $('complete');
  private completeMode = $('complete-mode');
  private completeTime = $('complete-time');
  private completeBest = $('complete-best');
  private againBtn = $<HTMLButtonElement>('btn-again');
  private flashEl = $('flash');
  private calloutTimer = 0;
  private handlers!: HudHandlers;
  private lastWhole = -1;
  /** Safe-area insets in CSS px (the theme's --safe-* tokens). */
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(handlers: HudHandlers) {
    $('btn-play').addEventListener('click', () => {
      handlers.tap();
      handlers.play('regular');
    });
    $('btn-speedrun').addEventListener('click', () => {
      handlers.tap();
      handlers.play('speedrun');
    });
    $('btn-again').addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.tap();
      handlers.again();
    });
    $('btn-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.tap();
      handlers.menu();
    });
    // the dimmed backdrop also means "run again"
    this.complete.addEventListener('click', (e) => {
      if (e.target === this.complete) {
        handlers.tap();
        handlers.again();
      }
    });
    this.handlers = handlers;
    $('btn-shop').addEventListener('click', () => {
      handlers.tap();
      handlers.shop();
    });
    $('shop-done').addEventListener('click', () => {
      handlers.tap();
      handlers.shopDone();
    });
    if (!TESTER_TOOLS) {
      this.testerBtn.remove();
      this.testerBadge.remove();
    }
    for (const [btn, go] of [
      [this.navPrev, handlers.prev],
      [this.navNext, handlers.next],
      [this.zoomBtn, handlers.zoom],
      [this.testerBtn, handlers.tester],
      [this.restartBtn, handlers.restart],
    ] as const) {
      // these sit above the canvas: pressing one never starts an aim drag or a pinch
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.getAttribute('aria-disabled') === 'true') return; // busy: no tap, no jump
        handlers.tap();
        go();
      });
    }
    this.readInsets();
    window.addEventListener('resize', () => this.readInsets());
    if (import.meta.env.DEV) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta?.getAttribute('content') !== skies[0]) {
        console.warn(`index.html theme-color should be skies[0] from src/theme.ts (${skies[0]})`);
      }
    }
  }

  private readInsets() {
    const css = getComputedStyle(document.documentElement);
    const px = (side: string) => parseFloat(css.getPropertyValue(`--safe-${side}`)) || 0;
    this.insets = { top: px('top'), right: px('right'), bottom: px('bottom'), left: px('left') };
  }

  showHud(mode: Mode) {
    reveal(this.hud);
    this.runClock.hidden = mode !== 'speedrun';
    // the floor arrows belong to Play mode only
    if (mode !== 'regular') this.setNav({ visible: false, prev: false, next: false });
  }

  /** Hides the whole HUD: bar, run clock, floor arrows, power, hints, stars and any callout. */
  hideHud() {
    this.hud.hidden = true;
    this.starsResult.hidden = true;
    this.runClock.hidden = true;
    this.navPrev.hidden = true;
    this.navNext.hidden = true;
    this.power.hidden = true;
    this.hideHint();
    this.clearCallout();
  }

  /**
   * Floor arrows on the screen edges (Play mode). An arrow whose flag is false
   * shows dimmed and disabled. hideHud() hides both, so call this after showHud().
   */
  setNav(state: NavState) {
    const focused = document.activeElement;
    const apply = (btn: HTMLButtonElement, enabled: boolean) => {
      btn.hidden = !state.visible;
      // at a floor bound the arrow is truly unavailable; while busy it only waits
      btn.disabled = !enabled;
      if (state.busy && enabled) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
    };
    apply(this.navPrev, state.prev);
    apply(this.navNext, state.next);
    // a focused arrow that just became unavailable hands focus to the other one
    if (focused === this.navPrev && this.navPrev.disabled && !this.navNext.disabled) this.navNext.focus({ preventScroll: true });
    if (focused === this.navNext && this.navNext.disabled && !this.navPrev.disabled) this.navPrev.focus({ preventScroll: true });
  }

  /** The zoom button's look and label follow the view; while it cannot be used it dims and ignores presses. */
  setZoom(state: ZoomState) {
    const b = this.zoomBtn;
    b.classList.toggle('zoomed', state.zoomed);
    b.setAttribute('aria-label', state.zoomed ? 'Zoom out' : 'Zoom in on the shot');
    if (state.enabled) b.removeAttribute('aria-disabled');
    else b.setAttribute('aria-disabled', 'true');
  }

  // ------------------------------------------------------------- stars

  /** A floor's best stars by its label; null hides them (Speedrun). */
  setFloorStars(n: number | null) {
    this.floorStars.hidden = n == null;
    if (n == null) return;
    this.floorStars.querySelectorAll('.star').forEach((s, k) => s.classList.toggle('off', k >= n));
    this.floorStars.setAttribute('aria-label', `Best on this floor: ${n} of 3 stars`);
  }

  /**
   * The star targets under the timer, as what is left of each: seconds and
   * kicks (below zero, that star is gone). Null hides them (Speedrun).
   */
  setStarGoals(g: { time: number; kicks: number } | null) {
    this.starGoals.hidden = !g;
    if (!g) {
      this.goalKey = '';
      return;
    }
    const sec = Math.max(0, Math.ceil(g.time));
    const kicks = Math.max(0, g.kicks);
    const timeLost = g.time < 0;
    const kicksLost = g.kicks < 0;
    const warn = !timeLost && g.time <= 3;
    const key = `${sec}|${kicks}|${timeLost}|${kicksLost}|${warn}`;
    if (key === this.goalKey) return;
    const was = this.goalKey ? this.goalKey.split('|') : null;
    this.goalKey = key;
    const word = kicks === 1 ? 'kick' : 'kicks';
    this.goalTimeText.textContent = `${sec}s`;
    this.goalKicksText.textContent = `${kicks} ${word}`;
    this.goalTime.classList.toggle('warn', warn);
    this.markGoal(this.goalTime, timeLost, was?.[2] === 'false');
    this.markGoal(this.goalKicks, kicksLost, was?.[3] === 'false');
    this.starGoals.setAttribute(
      'aria-label',
      `Star targets: ${timeLost ? 'time missed' : `clear within ${sec} seconds`}, ${kicksLost ? 'kicks missed' : `within ${kicks} ${word}`}`,
    );
  }

  private markGoal(el: HTMLElement, lost: boolean, justLost: boolean) {
    el.classList.toggle('lost', lost);
    if (lost && justLost) restart(el, 'break');
  }

  /** A clear's stars land one by one, earned ones first, each with what it was for. */
  showStars(slots: { on: boolean; label: string }[]) {
    const els = this.starsResult.querySelectorAll<HTMLElement>('.star-slot');
    slots.forEach((s, k) => {
      const el = els[k];
      if (!el) return;
      el.classList.toggle('on', s.on);
      el.classList.toggle('off', !s.on);
      el.querySelector('.star-label')!.textContent = s.label;
    });
    this.starsResult.setAttribute('aria-label', `${slots.filter((s) => s.on).length} of 3 stars`);
    this.starsResult.hidden = true; // so the landing plays again
    reveal(this.starsResult);
  }

  hideStars() {
    if (!this.starsResult.hidden) dismiss(this.starsResult);
  }

  /** The lobby's star total, as a badge on Play (none yet: no badge). */
  setTotalStars(n: number) {
    this.playStarsNum.textContent = String(n);
    this.playStars.hidden = n <= 0;
  }

  // ----------------------------------------------------------- restart

  /** Restart restarts the floor (Play) or the run (Speedrun). */
  setRestartMode(mode: Mode) {
    this.restartLabel = mode === 'speedrun' ? 'Restart run' : 'Restart floor';
    this.armRestart(false);
  }

  /** While busy (between floors) the restart button dims and ignores presses. */
  setRestartEnabled(on: boolean) {
    if (on) this.restartBtn.removeAttribute('aria-disabled');
    else this.restartBtn.setAttribute('aria-disabled', 'true');
  }

  /** Speedrun asks for a second tap: gold and shaking until then. */
  armRestart(on: boolean) {
    this.restartBtn.classList.toggle('armed', on);
    if (on) restart(this.restartBtn, 'armed');
    this.restartBtn.setAttribute('aria-label', on ? 'Tap again to restart the run' : this.restartLabel);
  }

  /** The arrow spins back once: the floor starts over. */
  spinRestart() {
    restart(this.restartBtn, 'spin');
  }

  /** Tester mode's button and badge. */
  setTester(on: boolean) {
    this.testerBtn.classList.toggle('on', on);
    this.testerBtn.setAttribute('aria-pressed', String(on));
    this.testerBadge.hidden = !on;
  }

  /** Open the shop: its balls float at the top (the game draws each 3D ball into its box). */
  showShop(cells: ShopCell[]) {
    if (!this.shopGrid.childElementCount) {
      cells.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'shop-cell';
        b.dataset.id = c.id;
        b.innerHTML =
          `<span class="shop-ball"></span><span class="shop-label"></span>`;
        b.addEventListener('click', () => {
          this.handlers.tap();
          this.handlers.pickBall(c.id);
        });
        this.shopGrid.appendChild(b);
      });
    }
    this.updateShop(cells);
    reveal(this.shop);
  }

  /** Refresh which balls are unlocked (a locked one shows how to get it) and which one is picked. */
  updateShop(cells: ShopCell[]) {
    for (const c of cells) {
      const b = this.shopGrid.querySelector<HTMLElement>(`[data-id="${c.id}"]`);
      if (!b) continue;
      b.classList.toggle('locked', !c.unlocked);
      b.classList.toggle('selected', c.selected);
      b.querySelector('.shop-label')!.textContent = c.unlocked ? c.name : c.goal;
      b.setAttribute('aria-label', `${c.name}, ${c.selected ? 'selected' : c.unlocked ? 'unlocked' : `locked: ${c.goal}`}`);
      b.setAttribute('aria-pressed', String(c.selected));
    }
  }

  /** A shop ball reacts: `picked` pops it, otherwise it shakes (still locked). */
  shopFeedback(id: string, picked: boolean) {
    const b = this.shopGrid.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (b) restart(b, picked ? 'picked' : 'nope');
  }

  hideShop() {
    dismiss(this.shop);
  }

  get shopVisible() {
    return !this.shop.hidden && !this.shop.classList.contains('leaving');
  }

  /** Where the shop's balls end, CSS px from the top (from layout, so their entrance does not move it). */
  shopBottom(): number {
    return this.shop.offsetTop + this.shopGrid.offsetTop + this.shopGrid.offsetHeight;
  }

  /** Each shop ball's box on the screen right now, in the grid's order. */
  shopBallRects(): DOMRect[] {
    return Array.from(this.shopGrid.querySelectorAll('.shop-ball'), (e) => e.getBoundingClientRect());
  }

  /** A shop ball box's size at rest, CSS px. */
  shopBallBox(): number {
    return (this.shopGrid.querySelector('.shop-ball') as HTMLElement | null)?.offsetWidth ?? 0;
  }

  /** Where the shop's Done button starts, CSS px from the top. */
  shopDoneTop(): number {
    return this.shop.offsetTop + this.shopDone.offsetTop;
  }

  /** How many floors the game has (the HUD's floor total). */
  setTotal(total: number) {
    this.floorTotal.textContent = String(total);
  }

  /**
   * Room the HUD takes during play, in CSS px: from the top (the HUD, the run
   * clock included in Speedrun) and from each side (the floor arrows in Play), measured
   * from layout so it follows the theme.
   */
  playArea(mode: Mode): { top: number; side: number } {
    const bottomOf = (el: HTMLElement) => (el.hidden ? 0 : el.offsetTop + el.offsetHeight);
    const hudBottom = bottomOf(this.hud) || this.insets.top + space[3] + ui.kickBall;
    const top = hudBottom + space[3]; // the run clock is the HUD's second row
    // the arrows may not be shown yet when the camera frames: use their theme size
    const side = mode === 'regular' ? Math.max(this.insets.left, this.insets.right, ui.gutter) + ui.nav : 0;
    return { top, side };
  }

  setFloor(n: number, total: number, animate: boolean) {
    this.floorTotal.textContent = String(total);
    this.flipTo(this.floorNum, String(n), animate);
  }

  /** Change a number; `animate` flips it, swapping it while it is out of sight. */
  private flipTo(el: HTMLElement, text: string, animate = true) {
    if (el.textContent === text && !el.dataset.next) return;
    if (!animate) {
      delete el.dataset.next;
      el.textContent = text;
      return;
    }
    el.dataset.next = text;
    restart(el, 'go');
    window.setTimeout(() => {
      if (el.dataset.next !== text) return; // a later change took over
      delete el.dataset.next;
      el.textContent = text;
    }, ui.base / 2);
  }

  /** Kick count beside the 3D ball (game.ts animates the ball itself). */
  setKicks(left: number, _max: number, refill = false) {
    this.flipTo(this.kickNum, String(left), refill);
    this.markKicks(left);
  }

  /** One kick spent: the count flips, a puff leaves the ball, the last one shakes. */
  spendKick(left: number, _max: number) {
    this.flipTo(this.kickNum, String(left));
    restart(this.kicks, 'spend');
    if (left === 1) restart(this.kicks, 'warn');
    this.markKicks(left);
  }

  private markKicks(left: number) {
    this.kicks.classList.toggle('last', left === 1);
    this.kicks.classList.toggle('out', left === 0);
    this.kicks.setAttribute('aria-label', kicksLeftLabel(left));
  }

  /** The kick ball's sparkles twinkle once. */
  sparkleKicks() {
    restart(this.kicks, 'shine');
  }

  /** Where the 3D kick ball is drawn, in CSS px from the viewport; null while the HUD is hidden. */
  kickSlot(): DOMRect | null {
    return this.hud.hidden ? null : this.kickBall.getBoundingClientRect();
  }

  /**
   * Countdown display. Returns true when a new whole second was entered
   * inside the last five (for the tick sound).
   */
  setTimer(left: number, total: number, state: 'run' | 'idle' | 'cleared') {
    const frac = clamp(left / total);
    const urgent = state === 'run' && left <= 5 && left > 0;
    const c = this.timer.classList;
    c.toggle('urgent', urgent);
    c.toggle('mid', state === 'run' && !urgent && frac <= 0.5);
    c.toggle('cleared', state === 'cleared');
    c.toggle('idle', state === 'idle');
    const text = left < 10 ? Math.max(0, left).toFixed(1) : String(Math.ceil(left));
    setDigits(this.timerText, text);
    const whole = Math.ceil(left);
    const newSecond = state === 'run' && whole !== this.lastWhole;
    if (newSecond) restart(this.timer, 'tick');
    this.lastWhole = whole;
    return urgent && newSecond;
  }

  setRunClock(sec: number) {
    setDigits(this.runTime, formatClock(sec));
  }

  /** Power readout just above the aim tip (`x`, `y` in CSS px), kept whole inside the safe area. */
  showPower(x: number, y: number, pct: number) {
    const el = this.power;
    el.hidden = false;
    el.textContent = `${pct}%`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const s = this.insets;
    const minX = Math.max(ui.gutter, s.left);
    const maxX = this.overlay.clientWidth - Math.max(ui.gutter, s.right) - w;
    const minY = s.top + ui.outlineText;
    const maxY = this.overlay.clientHeight - s.bottom - ui.liftText - h;
    el.style.left = `${clamp(x - w / 2, minX, Math.max(minX, maxX))}px`;
    el.style.top = `${clamp(y - h - space[2], minY, Math.max(minY, maxY))}px`;
  }

  hidePower() {
    this.power.hidden = true;
  }

  showHint() {
    reveal(this.hint);
  }

  /** "Pinch to zoom", in the middle of the screen. */
  showZoomHint() {
    reveal(this.hintZoom);
  }

  hideZoomHint() {
    this.hintZoom.hidden = true;
  }

  /** Hides both first-touch hints. */
  hideHint() {
    this.hint.hidden = true;
    this.hideZoomHint();
  }

  /** Fail label (a status, never a dialog); it empties itself once it has faded. */
  say(text: string, sub = '', bad = true) {
    this.calloutText.textContent = text;
    this.calloutSub.textContent = sub;
    this.calloutRibbon.hidden = !sub;
    this.callout.classList.toggle('bad', bad);
    this.callout.classList.remove('show');
    void this.callout.offsetWidth;
    this.callout.classList.add('show');
    window.clearTimeout(this.calloutTimer);
    this.calloutTimer = window.setTimeout(() => this.clearCallout(), ui.callout);
  }

  /** Stop the callout and empty it, so it leaves the accessibility tree. */
  private clearCallout() {
    window.clearTimeout(this.calloutTimer);
    this.callout.classList.remove('show');
    this.calloutText.textContent = '';
    this.calloutSub.textContent = '';
    this.calloutRibbon.hidden = true;
  }

  /** Title with the two modes. `focus`: move focus to Play (coming back via Change mode or Back). */
  showTitle(bestSpeedrun: number | null, focus = false) {
    // a badge on the Speedrun button's top right corner
    this.speedrunBest.textContent = bestSpeedrun != null ? `Best ${formatClock(bestSpeedrun)}` : '';
    this.speedrunBest.hidden = bestSpeedrun == null;
    reveal(this.title);
    if (focus) this.playBtn.focus({ preventScroll: true });
  }

  hideTitle() {
    dismiss(this.title);
  }

  get titleVisible() {
    return !this.title.hidden && !this.title.classList.contains('leaving');
  }

  /**
   * The free band between the title's top block (logo, tagline) and its mode
   * buttons: `top` in CSS px from the top of the viewport, `bottom` in CSS px
   * from the bottom. Null while the title is hidden or leaving. Read from
   * layout offsets, so the entrance animations do not move it.
   */
  titleBand(): { top: number; bottom: number } | null {
    if (!this.titleVisible) return null;
    const t = this.title;
    return {
      top: t.offsetTop + this.titleTop.offsetTop + this.titleTop.offsetHeight,
      bottom: this.overlay.clientHeight - (t.offsetTop + this.titleBottom.offsetTop),
    };
  }

  showComplete(mode: Mode, time: number, best: number | null, isNewBest: boolean) {
    this.completeMode.textContent = mode === 'speedrun' ? 'Speedrun' : 'Play';
    setDigits(this.completeTime, formatClock(time));
    this.completeBest.classList.toggle('new', isNewBest);
    this.completeBest.textContent = isNewBest
      ? 'New best time'
      : best != null
        ? `Best ${formatClock(best)}`
        : mode === 'regular'
          ? 'Play from floor 1 without skipping to set a best time'
          : '';
    reveal(this.complete);
    // once the card has landed
    window.setTimeout(() => this.againBtn.focus({ preventScroll: true }), ui.slow);
  }

  hideComplete() {
    this.complete.hidden = true;
  }

  get completeVisible() {
    return !this.complete.hidden;
  }

  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  setSky(hex: string) {
    document.documentElement.style.setProperty('--sky', hex);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex);
  }
}
