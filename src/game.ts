// Game flow: lobby → aim → kick → roll → (clear | fail) → next floor, for the
// two modes. Owns the scene, the timers and every scripted transition.
//
// Play (regular): any mistake retries the floor; each floor's countdown waits
// for the first touch; < and > move between floors already reached.
// Speedrun: one run through all floors; any mistake goes back to floor 1; the
// run clock waits only for the first touch of floor 1.
//
// Input: grab the ball and drag it back, let go to kick; touch anywhere else to
// look around (pinch or wheel to zoom, drag to pan, double-tap to zoom in or
// back out). Looking never starts a countdown.
import * as THREE from 'three';
import { AimView } from './aim.ts';
import { Sfx } from './audio.ts';
import { BallView } from './ball.ts';
import { IsoCamera, type Insets } from './camera.ts';
import { FloorView, makeLineUniforms } from './floor.ts';
import { tileAnimOffset } from './floorShaders.ts';
import { Fx } from './fx.ts';
import { Hud, type Mode, type ShopCell } from './hud.ts';
import { KickBall } from './kickBall.ts';
import { TESTER_TOOLS } from './config.ts';
import { ShopBalls } from './shopBalls.ts';
import { bestStars, saveStars, starTarget, totalStars } from './stars.ts';
import { KEY_BALL, KEY_CLEARS, KEY_ONES, SKINS, chosenSkin, countUp, goalMet, goalText, readRecords } from './skins.ts';
import { FLOORS, heightAt, parseFloor, supportTile, surfaceAt, tileAt, type Floor, type Tile } from './levels.ts';
import { BALL_R, BallSim, inTarget } from './physics.ts';
import { platform } from './platform.ts';
import { Footballer } from './player.ts';
import { PropsView } from './propsView.ts';
import { SkyView } from './sky.ts';
import { TargetView } from './target.ts';
import { color, outlinePx, skies, space, ui } from './theme.ts';
import { makeOutlineUniforms, makeSkyFade, sceneLights } from './toon.ts';
import { clamp, damp, easeInCubic, easeInOutCubic, easeOutBack, easeOutCubic, easeOutElastic, hump, lerp, storage } from './util.ts';

type State = 'boot' | 'title' | 'aim' | 'kick' | 'roll' | 'clear' | 'fail' | 'switch' | 'complete';
type FailReason = 'fall' | 'kicks' | 'time';
type BallMode = 'hidden' | 'sim' | 'drop' | 'ride' | 'beam';
type PlayerMode = 'gone' | 'in' | 'here' | 'out';

const DRAG_DEAD = 14; // px before a drag counts as aiming (or panning)
const TAP_MS = 260; // a press this short that barely moved is a tap
const DOUBLE_MS = 320; // two taps this close make a double-tap
const ZOOM_STEP = 2.2; // a double-tap zooms in this much
const ZOOM_SHOT = 1.15; // the zoom button frames the ball and the circle, at least this close
const PULL_ROOM = 1.8; // world units kept clear behind the ball in that framing, to drag it back
const GRAB_PX = 56; // CSS px round the ball that grab it (a thumb is about 44)
const GRAB_UP = new THREE.Vector3(0, 0, 1); // the ring's own facing
const ZOOMED = 1.05; // past this the view counts as zoomed in
const MIN_POWER = 0.02;
const LOBBY_ZOOM = 0.9; // the lobby shows the turning floor from farther away
const SHOP_ZOOM = 2; // the shop: twice the lobby's zoom, on the ball
const RESTART_ARM = 2; // s a Speedrun restart waits for its second tap
const STARS_AT = 0.3; // s into a clear when its stars start landing
const TRAIL_STEP = 0.07; // tiles a rolling ball goes between two pieces of its trail
const LOBBY_SPIN = (Math.PI * 2) / 36; // rad/s: one turn every 36 s
const UNSPIN_TIME = 1.0; // s, back to the game's angle when a mode starts
const KEY_BEST = (m: Mode) => `skypitch.best.${m}`;
const KEY_UNLOCKED = 'skypitch.unlocked';
const KEY_FLOOR = 'skypitch.floor';
const KEY_TESTER = 'skypitch.tester';
const LAST = FLOORS.length - 1;

interface Riser {
  view: FloorView;
  landAt: Map<Tile, number>;
  landed: Set<Tile>;
  done: number;
}

export interface Snapshot {
  mode: Mode;
  floor: number;
  runTime: number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new IsoCamera();
  private lineU = makeLineUniforms();
  private sky = new THREE.Color(skies[0]);
  private skyFrom = new THREE.Color();
  private skyTo = new THREE.Color();
  private skyT = 1;
  /** What things dissolve into below the floor: the mist over the stadium far below (src/sky.ts). */
  private haze = new THREE.Color(color.groundMist);
  private fade = makeSkyFade(this.haze);
  private outlineU = makeOutlineUniforms();
  private fx = new Fx();
  private clouds: SkyView;
  private target = new TargetView({ fade: this.fade, outline: this.outlineU });
  private targetScale = 0;
  private targetGoal = 0;
  private aimView = new AimView();
  private ball: BallView;
  private player: Footballer;
  private hud: Hud;
  private sfx = new Sfx();
  private maxTex: number;
  private aniso: number;

  private floor!: Floor;
  private sim!: BallSim;
  private view: FloorView | null = null;
  private props = new Map<FloorView, PropsView>();
  private riser: Riser | null = null;
  private falling: { view: FloorView; t: number }[] = [];
  private targetView: FloorView | null = null;

  private mode: Mode = 'regular';
  private state: State = 'boot';
  private floorIndex = 0;
  private heading = 0; // floor a transition is heading to (for snapshots)
  private kicksLeft = 0;
  private timeLeft = 0;
  private runTime = 0;
  private timerOn = false;
  private waitFirstTouch = false;
  private playQueued: Mode | null = null;
  private introDone = false;
  private restored = false; // a restored run never sets a best time
  private cleanRun = false; // Play: started at floor 1 and never jumped, so its time can be a best
  private unlocked = 0;
  private navKey = '';
  private zoomKey = '';
  private backArmed = -1; // clock time of the first Back press during a run
  /** Tester mode (src/config.ts): every floor reachable, every shop ball unlocked. */
  private tester = TESTER_TOOLS && storage.get(KEY_TESTER) === '1';
  private tested = false; // this run used tester skips, so its time is no record
  private queuedFloor: number | null = null; // tester skips made while a floor was changing
  private shopOpen = false;
  private shopQueued = false; // Shop pressed while the lobby was still coming in
  private lobbyScale = 40; // the lobby view's scale, which the shop doubles
  private restartArmed = -1; // clock time of a Speedrun restart's first tap
  private shopBalls: ShopBalls | null = null; // the shop's 3D balls, made on first open
  private skin = chosenSkin();

  private ballMode: BallMode = 'hidden';
  private ballPos = new THREE.Vector3();
  private ballScale = 1;
  private drop = { vy: 0, ground: 0, cb: null as null | (() => void) };
  private ride = { view: null as FloorView | null, tile: null as Tile | null, base: 0 };
  private beamT = 0;
  private hopT = 9;
  private trailDist = 0; // distance rolled since the trail's last piece
  private trailN = 0;
  private lastGround = new THREE.Vector3();

  private playerMode: PlayerMode = 'gone';
  private playerT = 0;
  private stance = new THREE.Vector3();
  private stanceGoal = new THREE.Vector3();
  private lunge = 0;
  private aimDir = new THREE.Vector2(0, -1);

  private drag: { id: number; x0: number; y0: number; active: boolean; power: number } | null = null;
  /** A soft ring pulsing under the ball while it waits to be grabbed. */
  private grabRing: THREE.Mesh;
  private grabMat = new THREE.MeshBasicMaterial({ color: color.paper, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  private grabT = 0;
  private notch = -1;
  private kickBall: KickBall;
  /** Fingers in the look (top) half: pan with one, pinch with two. */
  private looks = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; moved: boolean }>();
  private pinchDist = 0;
  private pinched = false; // this touch sequence pinched, so its last release is no tap
  private lastTap = { t: -1e9, x: 0, y: 0 };
  private follow = false; // zoomed in: keep the ball in view (after a kick or an aim)
  private followMargin: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  private clock = 0;
  private hitStop = 0;
  private tasks: { at: number; fn: () => void }[] = [];
  private w = 1;
  private h = 1;
  private dpr = 1;
  private dprCap = 2;
  private frameAvg = 1 / 60;
  private perfClock = 0;
  private resizeDue = false;
  private safe = { top: 0, bottom: 0, left: 0, right: 0 };
  private paused = false;
  private last = 0;
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private tmp = new THREE.Vector3();
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxTex = Math.min(2048, this.renderer.capabilities.maxTextureSize);
    this.aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene.add(...sceneLights());
    this.clouds = new SkyView(this.sky, this.reduced);
    this.scene.add(this.clouds.group);
    this.scene.background = this.clouds.deep; // the hazy ground's tone, behind everything

    this.ball = new BallView(this.fade, this.outlineU);
    this.grabRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), this.grabMat);
    this.grabRing.renderOrder = 2;
    this.grabRing.visible = false;
    this.scene.add(this.grabRing);
    this.kickBall = new KickBall(this.reduced);
    this.player = new Footballer(this.fade, this.outlineU);
    this.ball.group.visible = false;
    this.player.root.visible = false;
    this.player.shadow.mesh.visible = false;
    this.scene.add(this.ball.group, this.ball.shadow.mesh, this.player.root, this.player.shadow.mesh);
    this.scene.add(this.target.group, this.aimView.group, this.fx.group);
    this.target.group.scale.setScalar(0);

    this.unlocked = clamp(Math.floor(Number(storage.get(KEY_UNLOCKED) ?? 0)) || 0, 0, LAST);

    this.hud = new Hud({
      play: (m) => this.play(m),
      again: () => this.runAgain(),
      menu: () => this.goTitle(),
      tap: () => {
        this.sfx.unlock();
        this.sfx.tap();
      },
      prev: () => this.goToFloor(this.navFloor() - 1),
      next: () => this.goToFloor(this.navFloor() + 1),
      zoom: () => this.toggleZoom(),
      tester: () => this.toggleTester(),
      restart: () => this.restartPressed(),
      shop: () => this.openShop(),
      shopDone: () => this.closeShop(),
      pickBall: (id) => this.pickBall(id),
    });
    this.hud.setTester(this.tester);
    this.ball.setSkin(this.skin);
    this.kickBall.setSkin(this.skin);
    this.hud.setTotal(FLOORS.length);

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onCancel(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.back();
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.resume()));
    platform.init(
      () => this.back(),
      () => this.pause(),
      () => this.resume(),
    );
    this.resize();
  }

  // ------------------------------------------------------------- lifecycle

  start(restore?: Snapshot | null) {
    if (restore && restore.floor >= 0 && restore.floor <= LAST) {
      // a republished preview: carry on from the same floor
      this.introDone = true;
      this.play(restore.mode, restore.floor, restore.runTime);
    } else {
      this.showTitle();
      this.state = 'title';
      this.floorIndex = this.savedFloor();
      this.buildFloor(this.floorIndex, null, 0.15);
      this.after(this.riseTime() - 0.15, () => this.dropBallIn(() => this.introPlayer()));
    }
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  snapshot(): Snapshot | null {
    if (this.state === 'title' || this.state === 'boot' || this.state === 'complete') return null;
    const floor = this.state === 'switch' || this.state === 'fail' ? this.heading : this.floorIndex;
    return { mode: this.mode, floor, runTime: this.mode === 'speedrun' && floor === 0 ? 0 : this.runTime };
  }

  private pause() {
    this.paused = true;
    this.cancelAim();
    this.looks.clear();
    this.pinched = false;
    this.sfx.suspend();
  }

  private resume() {
    if (!this.paused) return;
    this.paused = false;
    this.last = performance.now();
    this.sfx.resume();
  }

  /** Android back / Escape. Returns false when there is nothing to go back to. */
  back(): boolean {
    if (this.shopOpen) {
      this.closeShop();
      return true;
    }
    if (this.state === 'title' || this.state === 'boot') return false;
    if (this.state === 'complete') {
      this.goTitle();
      return true;
    }
    // A run is live: an edge swipe while aiming can fire Back by accident,
    // so leaving takes a second press.
    if (this.backArmed >= 0 && this.clock - this.backArmed < 2.2) {
      this.backArmed = -1;
      this.goTitle();
    } else {
      this.backArmed = this.clock;
      this.hud.say('Back again to quit', '', false);
    }
    return true;
  }

  private savedFloor(): number {
    const f = Math.floor(Number(storage.get(KEY_FLOOR) ?? 0)) || 0;
    return clamp(f, 0, this.unlocked);
  }

  // --------------------------------------------------------------- frame

  private frame(now: number) {
    if (this.paused) return;
    if (this.resizeDue) {
      // resizing clears the canvas, so it happens before this frame draws
      this.resizeDue = false;
      this.resize();
    }
    const real = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let dt = real;
    if (this.hitStop > 0) {
      this.hitStop -= real;
      dt = 0;
    }
    this.clock += dt;
    this.runTasks();
    this.update(dt, real);
    this.renderer.render(this.scene, this.cam.cam);
    // the HUD's kick ball, drawn into its slot over the frame
    const slot = this.hud.kickSlot();
    if (slot) this.kickBall.render(this.renderer, slot, this.w, this.h);
    // the shop's balls, each over its box
    if (this.shopBalls && this.hud.shopVisible) this.shopBalls.render(this.renderer, this.hud.shopBallRects(), this.hud.shopBallBox(), this.w, this.h);
    this.watchPerformance(real);
  }

  /** Slow phone? Render fewer pixels rather than fewer frames. */
  private watchPerformance(real: number) {
    this.perfClock += real;
    this.frameAvg += (real - this.frameAvg) * 0.05;
    if (this.perfClock > 3 && this.frameAvg > 1 / 38 && this.dpr > 1) {
      this.dprCap = Math.max(1, this.dpr - 0.25);
      this.perfClock = 0;
      this.frameAvg = 1 / 60;
      this.resizeDue = true;
    }
  }

  private after(sec: number, fn: () => void) {
    this.tasks.push({ at: this.clock + sec, fn });
  }

  private runTasks() {
    if (!this.tasks.length) return;
    const due = this.tasks.filter((t) => t.at <= this.clock).sort((a, b) => a.at - b.at);
    if (!due.length) return;
    this.tasks = this.tasks.filter((t) => t.at > this.clock);
    for (const t of due) t.fn();
  }

  private update(dt: number, real: number) {
    this.updateTimers(dt);
    this.updateFloors(dt);
    this.updateSky(dt);
    this.updateBall(dt);
    this.updatePlayer(dt);
    this.updateTarget(dt);
    this.fx.update(dt);
    if (this.state === 'title' && !this.reduced) this.cam.spinBy(LOBBY_SPIN * real);
    if (this.state === 'title' && (this.playerMode === 'here' || this.playerMode === 'in')) {
      // the footballer keeps facing you while the floor turns
      const v = this.cam.viewDir;
      this.player.faceDir(v.x, v.z, true);
    }
    this.clouds.update(real, this.cam);
    if (this.kickBall.update(real)) this.hud.sparkleKicks();
    this.ball.tick(this.clock);
    if (this.shopBalls && this.hud.shopVisible) this.shopBalls.update(real);
    if (this.follow && this.cam.zoom > 1 && this.ballMode === 'sim' && !this.looks.size) this.cam.keepInView(this.ballPos, this.followMargin);
    this.cam.update(real);
    const css = clamp(outlinePx * (this.cam.scale / 60), 1.05, 2.6);
    this.lineU.uLineWidth.value = css * this.dpr;
    this.outlineU.uOutline.value = (css * 0.95) / this.cam.scale;
    this.updateAimLabel();
    this.updateNav();
    this.updateZoomButton();
  }

  // -------------------------------------------------------------- floors

  private riseTime(view = this.view) {
    if (!view) return 1;
    let maxD = 0;
    const o = view.uniforms.uAnimOrigin.value;
    for (const t of view.floor.tiles) maxD = Math.max(maxD, Math.hypot(t.i + 0.5 - o.x, t.j + 0.5 - o.y));
    return maxD * view.uniforms.uAnimSpread.value + 0.09 + 0.5;
  }

  /** Create floor `index` and raise it, tile by tile, sweeping out from `origin`. */
  private buildFloor(index: number, origin: [number, number] | null, delay = 0) {
    const floor = parseFloor(index);
    const view = new FloorView(floor, this.haze, this.lineU, this.maxTex, this.aniso);
    const props = new PropsView(view, { fade: this.fade, outline: this.outlineU });
    this.scene.add(view.group, props.group);
    this.props.set(view, props);
    const u = view.uniforms;
    const o = origin ?? [floor.w / 2, floor.d / 2];
    u.uAnimMode.value = 1;
    u.uAnimT.value = -delay;
    u.uAnimOrigin.value.set(o[0], o[1]);
    u.uAnimSpread.value = 0.075;
    const landAt = new Map<Tile, number>();
    for (const t of floor.tiles) {
      landAt.set(t, Math.hypot(t.i + 0.5 - o[0], t.j + 0.5 - o[1]) * 0.075 + view.tileRand.get(t)! * 0.09 + 0.42);
    }
    this.view = view;
    this.ballMode = 'hidden'; // every new floor gets its ball dropped in
    this.riser = { view, landAt, landed: new Set(), done: this.riseTime(view) };
    this.floor = floor;
    this.floorIndex = index;
    this.sim = new BallSim(floor);
    this.fade.uFadeTop.value = floor.minTop - 0.35;
    this.fade.uFadeBottom.value = floor.minTop - 3.9;
    this.clouds.setLevel(floor.minTop, this.state === 'boot');
    this.target.setRadius(floor.def.radius);
    this.target.setHot(0);
    this.hopT = 9;
    this.targetView = view;
    this.targetGoal = 0;
    this.after(this.riseTime(view) * 0.85 + delay, () => {
      if (this.targetView === view) this.targetGoal = 1;
    });
    this.skyFrom.copy(this.sky);
    this.skyTo.set(floor.sky);
    this.skyT = 0;
    this.hud.setSky(floor.sky);
    // every floor starts in full view
    this.cam.resetZoom();
    this.follow = false;
    this.frameCamera(this.state === 'boot', this.state === 'boot' ? 0 : 0.9);
  }

  /** Drop the current floor away, starting from (x, z). */
  private crumble(x: number, z: number) {
    const v = this.view;
    if (!v) return;
    const u = v.uniforms;
    if (this.riser?.view === v && u.uAnimT.value < this.riser.done) {
      // still rising: every tile falls from where it is right now
      u.uFreeze.value = u.uAnimT.value;
      u.uAnimMode.value = 3;
    } else {
      u.uAnimMode.value = 2;
      u.uAnimOrigin.value.set(x, z);
      u.uAnimSpread.value = 0.055;
    }
    u.uAnimT.value = 0;
    this.falling.push({ view: v, t: 0 });
    if (this.riser?.view === v) this.riser = null;
    this.view = null;
    this.targetGoal = 0;
    this.cam.addShake(this.reduced ? 0 : 0.12);
  }

  private updateFloors(dt: number) {
    const r = this.riser;
    if (r) {
      const u = r.view.uniforms;
      u.uAnimT.value += dt;
      for (const [tile, at] of r.landAt) {
        if (!r.landed.has(tile) && u.uAnimT.value >= at) {
          r.landed.add(tile);
          this.sfx.pop();
        }
      }
      if (u.uAnimT.value > r.done + 0.05) {
        u.uAnimMode.value = 0;
        this.riser = null;
      }
    }
    for (const f of this.falling) {
      f.t += dt;
      f.view.uniforms.uAnimT.value = f.t;
    }
    for (const props of this.props.values()) props.update(dt, this.clock);
    const gone = this.falling.filter((f) => f.t > 2.4);
    if (gone.length) {
      for (const f of gone) {
        this.props.get(f.view)?.dispose();
        this.props.delete(f.view);
        f.view.dispose();
      }
      this.falling = this.falling.filter((f) => f.t <= 2.4);
    }
  }

  private updateSky(dt: number) {
    if (this.skyT >= 1) return;
    this.skyT = Math.min(1, this.skyT + dt / 0.9);
    this.sky.lerpColors(this.skyFrom, this.skyTo, easeInOutCubic(this.skyT));
  }

  /** Frame the floor: between the lobby's title and buttons from afar, or under the HUD. */
  private frameCamera(instant: boolean, glide = 0) {
    if (!this.floor) return;
    if (this.shopOpen) {
      // the shop: the ball at twice the lobby's zoom, between the balls on top
      // and Done below, the turntable now turning round the ball
      const b = this.ballPos;
      const pts: THREE.Vector3[] = [];
      for (const dx of [-BALL_R, BALL_R]) for (const dy of [-BALL_R, BALL_R]) for (const dz of [-BALL_R, BALL_R]) pts.push(new THREE.Vector3(b.x + dx, b.y + dy, b.z + dz));
      const insets = {
        top: this.hud.shopBottom() + space[3],
        bottom: this.h - this.hud.shopDoneTop() + space[3],
        left: this.safe.left + space[3],
        right: this.safe.right + space[3],
      };
      this.cam.frame(pts, this.w, this.h, insets, instant, this.lobbyScale * SHOP_ZOOM, 1, glide, b.clone());
      return;
    }
    const f = this.floor;
    const corners: [number, number, number][] = [];
    for (const t of f.tiles) {
      corners.push([t.i, t.c[0], t.j], [t.i + 1, t.c[1], t.j], [t.i + 1, t.c[2], t.j + 1], [t.i, t.c[3], t.j + 1]);
    }
    const [tx, tz] = f.def.target;
    const lo = f.minTop - 0.7;
    const hi = Math.max(...corners.map((c) => c[1] + 0.85), heightAt(f, tx, tz) + 1.2); // the floating goal marker
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[2]);
    // the floor's middle: what the lobby turns around
    const pivot = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, (lo + hi) / 2, (Math.min(...zs) + Math.max(...zs)) / 2);
    const band = this.hud.titleVisible ? this.hud.titleBand() : null;
    const pts: THREE.Vector3[] = [];
    let insets: Insets;
    let zoom = 1;
    if (band) {
      // a cylinder around the floor, so the framing holds at every angle of the turn
      const r = Math.max(...corners.map(([x, , z]) => Math.hypot(x - pivot.x, z - pivot.z)));
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = pivot.x + Math.cos(a) * r;
        const z = pivot.z + Math.sin(a) * r;
        pts.push(new THREE.Vector3(x, lo, z), new THREE.Vector3(x, hi, z));
      }
      insets = { top: band.top, bottom: band.bottom, left: this.safe.left + space[3], right: this.safe.right + space[3] };
      zoom = LOBBY_ZOOM;
    } else {
      for (const [x, y, z] of corners) pts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 0.85, z), new THREE.Vector3(x, lo, z));
      pts.push(new THREE.Vector3(tx, hi, tz));
      // the HUD's own measured footprint: top bar (+ run clock), side arrows in Play
      const area = this.hud.playArea(this.mode);
      const left = Math.max(this.safe.left + space[3], area.side + space[1]);
      const right = Math.max(this.safe.right + space[3], area.side + space[1]);
      insets = { top: area.top, bottom: this.safe.bottom + space[5], left, right };
    }
    this.cam.frame(pts, this.w, this.h, insets, instant, 150, zoom, glide, pivot);
    if (band) this.lobbyScale = this.cam.fitScale;
  }

  private resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    this.lineU.uResolution.value.set(this.w * this.dpr, this.h * this.dpr);
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    this.safe = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    probe.remove();
    this.frameCamera(true);
    this.cam.update(0);
  }

  // ---------------------------------------------------------------- flow

  /** Lobby intro: the footballer beams in facing you. */
  private introPlayer() {
    const b = this.ballPos;
    this.placePlayer(b.x, b.z, 1, 1, false);
    this.player.faceDir(1, 1, true);
    this.playerIn();
    this.after(0.45, () => {
      this.introDone = true;
      if (this.playQueued) {
        const m = this.playQueued;
        this.playQueued = null;
        this.play(m);
      } else if (this.shopQueued) {
        this.shopQueued = false;
        this.openShop();
      }
    });
  }

  /** Start a mode from the lobby (or resume a restored run). */
  play(mode: Mode, restoreFloor?: number, restoreTime = 0) {
    this.sfx.unlock();
    this.cam.unspin(UNSPIN_TIME); // the lobby turntable eases back to the game's angle
    this.mode = mode;
    this.shopQueued = false;
    this.hud.hideTitle();
    this.hud.hideComplete();
    if (!this.introDone && restoreFloor === undefined) {
      this.playQueued = mode;
      this.state = 'switch';
      return;
    }
    const target = restoreFloor ?? (mode === 'speedrun' ? 0 : this.savedFloor());
    this.restored = restoreFloor !== undefined;
    this.cleanRun = target === 0 && !this.restored;
    this.tested = false;
    this.queuedFloor = null;
    this.runTime = this.restored ? restoreTime : 0;
    this.hud.setRunClock(this.runTime);
    this.hud.showHud(mode);
    this.hud.setFloor(target + 1, FLOORS.length, false);
    // the HUD drops in showing the floor it is heading to
    this.timeLeft = FLOORS[target].time;
    this.hud.setKicks(FLOORS[target].kicks, FLOORS[target].kicks, false);
    this.hud.setTimer(this.timeLeft, this.timeLeft, 'idle');
    this.hud.setRestartMode(mode);
    // the star targets show from the start (the camera leaves room for them)
    if (mode === 'regular') {
      const t = starTarget(target);
      this.hud.setFloorStars(bestStars()[target]);
      this.hud.setStarGoals({ time: t.time, kicks: t.kicks });
    } else {
      this.hud.setFloorStars(null);
      this.hud.setStarGoals(null);
    }
    this.heading = target;
    if (this.view && this.floorIndex === target && this.ballMode === 'sim' && !this.sim.moving && this.playerMode !== 'gone') {
      // the lobby floor is the one to play: zoom in and go
      this.state = 'switch';
      this.resetCounters(true);
      this.frameCamera(false, UNSPIN_TIME);
      this.after(0.35, () => this.enterAim());
      return;
    }
    this.switchTo(target);
  }

  /** Beam the ball and footballer out, crumble this floor, raise `index`. */
  private switchTo(index: number) {
    this.state = 'switch';
    this.heading = index;
    this.timerOn = false;
    this.waitFirstTouch = false;
    this.cancelAim();
    this.hud.hideHint();
    this.target.setHot(0);
    this.playerOut();
    this.ballBeamOut();
    if (!this.view) {
      this.restartAt(index);
      return;
    }
    this.after(0.2, () => {
      this.crumble(this.ballPos.x, this.ballPos.z);
      this.after(0.3, () => this.restartAt(index));
    });
  }

  /** Whether this floor's clock waits for the first touch. */
  private waitsForTouch(index: number) {
    return this.mode === 'regular' || index === 0;
  }

  private enterAim() {
    if (this.queuedFloor != null) {
      // tester skips arrived while this floor was rising: go on to that one
      const q = this.queuedFloor;
      this.queuedFloor = null;
      if (q !== this.floorIndex) {
        this.switchTo(q);
        return;
      }
    }
    this.state = 'aim';
    this.player.setPose('idle');
    const [tx, tz] = this.floor.def.target;
    const b = this.ballPos;
    this.placePlayer(b.x, b.z, tx - b.x, tz - b.z, this.playerMode === 'here');
    if (this.waitsForTouch(this.floorIndex)) {
      this.waitFirstTouch = true;
      this.timerOn = false;
      if (this.floorIndex === 0) {
        this.hud.showHint();
        if (this.cam.maxZoom > 1.05) this.hud.showZoomHint();
      }
    } else {
      this.timerOn = true;
      this.sfx.whistle('pip');
    }
    if (this.mode === 'regular') storage.set(KEY_FLOOR, String(this.floorIndex));
  }

  private resetCounters(animate: boolean) {
    const def = this.floor.def;
    this.kicksLeft = def.kicks;
    this.timeLeft = def.time;
    this.hud.setKicks(def.kicks, def.kicks, animate);
    this.kickBall.refill(def.kicks);
    this.hud.setTimer(def.time, def.time, 'idle');
    this.updateStars();
  }

  /** Play mode's stars in the HUD: this floor's best by its label, its targets under the timer. */
  private updateStars() {
    if (this.mode !== 'regular' || !this.floor) {
      this.hud.setFloorStars(null);
      this.hud.setStarGoals(null);
      return;
    }
    const t = starTarget(this.floorIndex);
    const def = this.floor.def;
    this.hud.setFloorStars(bestStars()[this.floorIndex]);
    this.hud.setStarGoals({ time: t.time - (def.time - this.timeLeft), kicks: t.kicks - (def.kicks - this.kicksLeft) });
  }

  /** The lobby, with the star total on Play and the best Speedrun on its button. */
  private showTitle(focus = false) {
    this.hud.setTotalStars(totalStars());
    this.hud.showTitle(this.best('speedrun'), focus);
  }

  /** The HUD's restart: Play builds this floor afresh; Speedrun starts the run over, on a second tap. */
  private restartPressed() {
    if (this.state !== 'aim' && this.state !== 'roll') return;
    if (this.mode === 'speedrun' && this.floorIndex > 0 && this.clock - this.restartArmed > RESTART_ARM) {
      const at = this.clock;
      this.restartArmed = at;
      this.hud.armRestart(true);
      this.after(RESTART_ARM, () => {
        if (this.restartArmed !== at) return;
        this.restartArmed = -1;
        this.hud.armRestart(false);
      });
      return;
    }
    this.restartArmed = -1;
    this.hud.armRestart(false);
    this.hud.spinRestart();
    this.sfx.whistle('pip');
    platform.haptic.tick();
    this.switchTo(this.mode === 'speedrun' ? 0 : this.floorIndex);
  }

  private runAgain() {
    this.hud.hideComplete();
    this.restored = false;
    this.cleanRun = true;
    this.tested = false;
    this.queuedFloor = null;
    this.runTime = 0;
    // show fresh values before the HUD drops back in
    this.hud.setRunClock(0);
    this.hud.setFloor(1, FLOORS.length, false);
    const first = FLOORS[0];
    this.hud.setKicks(first.kicks, first.kicks, false);
    this.kickBall.refill(first.kicks);
    this.hud.setTimer(first.time, first.time, 'idle');
    this.hud.showHud(this.mode);
    this.switchTo(0);
  }

  goTitle() {
    this.tasks.length = 0;
    this.cancelAim();
    this.timerOn = false;
    this.waitFirstTouch = false;
    this.playQueued = null;
    this.shopQueued = false;
    this.hud.hideHud();
    this.hud.setNav({ visible: false, prev: false, next: false });
    this.navKey = '';
    this.hud.hideComplete();
    this.hud.hideStars();
    this.showTitle(true);
    this.state = 'title';
    this.introDone = false;
    this.playerOut();
    this.ballBeamOut();
    const lobby = this.savedFloor();
    this.heading = lobby;
    this.after(0.2, () => {
      this.crumble(this.ballPos.x, this.ballPos.z);
      this.after(0.3, () => {
        this.buildFloor(lobby, null);
        this.after(this.riseTime() - 0.15, () => this.dropBallIn(() => this.introPlayer()));
      });
    });
  }

  /** Build floor `index` fresh and start it (after a fail, a clear, a jump, a new run or a restore). */
  private restartAt(index: number) {
    if (this.queuedFloor != null) {
      // a tester skip made while the floor changed wins
      index = this.queuedFloor;
      this.queuedFloor = null;
    }
    if (this.mode === 'speedrun' && index === 0) {
      this.runTime = 0;
      this.hud.setRunClock(0);
    }
    this.buildFloor(index, FLOORS[index].start, 0);
    this.resetCounters(true);
    this.hud.setFloor(index + 1, FLOORS.length, true);
    this.timerOn = false;
    this.state = 'switch';
    this.heading = index;
    this.after(this.riseTime() - 0.25, () =>
      this.dropBallIn(() => {
        this.playerAtBall();
        this.after(0.3, () => this.enterAim());
      }),
    );
  }

  /**
   * Play mode: jump to a floor already reached. Tester mode: any floor, in
   * either mode, and presses while a floor changes skip on from there.
   */
  private goToFloor(index: number) {
    if (this.mode !== 'regular' && !this.tester) return;
    if (index < 0 || index > (this.tester ? LAST : this.unlocked)) return;
    if (this.state === 'aim' || this.state === 'roll') {
      if (index === this.floorIndex) return;
      if (this.mode === 'regular') storage.set(KEY_FLOOR, String(index)); // (the Hud already played the tap)
      this.cleanRun = false; // a jump means this run's time is no record
      if (this.tester) this.tested = true;
      this.switchTo(index);
    } else if (this.tester && (this.state === 'switch' || this.state === 'clear' || this.state === 'fail' || this.state === 'kick')) {
      // the floor built next will be this one
      this.queuedFloor = index;
      this.cleanRun = false;
      this.tested = true;
      this.hud.setFloor(index + 1, FLOORS.length, true);
    }
  }

  /** The floor the arrows count from: a queued tester skip, the floor being headed to, or this one. */
  private navFloor() {
    return this.queuedFloor ?? (this.state === 'aim' || this.state === 'roll' ? this.floorIndex : this.heading);
  }

  private toggleTester() {
    this.tester = !this.tester;
    storage.set(KEY_TESTER, this.tester ? '1' : '0');
    this.hud.setTester(this.tester);
    this.navKey = '';
  }

  private updateNav() {
    const show = (this.mode === 'regular' || this.tester) && !this.hud.titleVisible && this.state !== 'complete' && this.state !== 'title' && this.state !== 'boot';
    // Only the floor bounds disable an arrow (presses during a switch are
    // ignored by goToFloor, except in tester mode), so a focused arrow keeps its focus.
    const at = this.navFloor();
    const prev = show && at > 0;
    const next = show && at < (this.tester ? LAST : this.unlocked);
    const busy = !this.tester && this.state !== 'aim' && this.state !== 'roll';
    const restartable = this.state === 'aim' || this.state === 'roll';
    const key = `${show}${prev}${next}${busy}${restartable}`;
    if (key === this.navKey) return;
    this.navKey = key;
    this.hud.setNav({ visible: show, prev, next, busy });
    this.hud.setRestartEnabled(restartable);
  }

  // ------------------------------------------------------------- timers

  private updateTimers(dt: number) {
    if (this.timerOn) {
      this.timeLeft -= dt;
      this.runTime += dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.timerOn = false;
        if (this.state === 'aim') this.fail('time');
        // mid-roll: the roll finishes, onStop decides
      }
    }
    if (this.floor && this.state !== 'title' && this.state !== 'boot') {
      const st = this.state === 'clear' ? 'cleared' : this.timerOn ? 'run' : 'idle';
      if (this.hud.setTimer(this.timeLeft, this.floor.def.time, st)) this.sfx.tick(this.timeLeft <= 3);
      if (this.mode === 'speedrun') this.hud.setRunClock(this.runTime);
      else if (this.state === 'aim' || this.state === 'kick' || this.state === 'roll') this.updateStars();
    }
  }

  // -------------------------------------------------------------- input

  private onDown(e: PointerEvent) {
    this.sfx.unlock();
    if (this.drag) return; // an aim owns the screen until it ends
    // grab the ball to aim; anywhere else looks around (a second finger joins a pinch)
    if (!this.looks.size && this.canAim() && this.onBall(e.clientX, e.clientY)) {
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, power: 0 };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
      this.startFollow(); // aiming needs the ball in view
      if (this.waitFirstTouch) {
        this.waitFirstTouch = false;
        this.timerOn = true;
        this.hud.hideHint();
        this.sfx.whistle('pip');
      }
      return;
    }
    this.lookDown(e);
  }

  /** The ball is waiting at rest and the footballer is with it. */
  private canAim() {
    return this.state === 'aim' && this.ballMode === 'sim' && !this.sim.moving && this.playerMode !== 'gone' && this.playerMode !== 'out';
  }

  /** Whether screen point (x, y), CSS px, is on the ball (generously, for a thumb). */
  private onBall(x: number, y: number) {
    const v = this.tmp.copy(this.ballPos).project(this.cam.cam);
    const bx = ((v.x + 1) / 2) * this.w;
    const by = ((1 - v.y) / 2) * this.h;
    return Math.hypot(x - bx, y - by) <= Math.max(GRAB_PX, BALL_R * this.cam.scale * 3);
  }

  private onMove(e: PointerEvent) {
    const look = this.looks.get(e.pointerId);
    if (look) {
      this.lookMove(e, look);
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id || this.state !== 'aim') return;
    const sx = d.x0 - e.clientX;
    const sy = d.y0 - e.clientY;
    const len = Math.hypot(sx, sy);
    if (len < DRAG_DEAD) {
      if (d.active) this.softCancel();
      return;
    }
    const maxDrag = clamp(Math.min(this.w, this.h) * 0.48, 150, 320);
    d.active = true;
    d.power = clamp((len - DRAG_DEAD) / maxDrag);
    // Pull back: the kick goes the opposite way of the finger. (sx, sy) is
    // that kick direction in screen pixels, y pointing down.
    const { r, u, foreshorten } = this.cam.groundAxes();
    const wx = r.x * sx - (u.x * sy) / foreshorten;
    const wz = r.y * sx - (u.y * sy) / foreshorten;
    const wl = Math.hypot(wx, wz) || 1;
    this.aimDir.set(wx / wl, wz / wl);
    const b = this.ballPos;
    this.player.setPose('aim');
    this.player.setWindup(d.power);
    this.placePlayer(b.x, b.z, this.aimDir.x, this.aimDir.y, true);
    this.aimView.show(this.floor, b.x, b.y - BALL_R, b.z, this.aimDir.x, this.aimDir.y, d.power);
    const n = Math.floor(d.power * 10);
    if (n !== this.notch) {
      this.notch = n;
      platform.haptic.tick();
      this.sfx.notch(d.power);
    }
  }

  private onUp(e: PointerEvent) {
    this.sfx.unlock();
    const look = this.looks.get(e.pointerId);
    if (look) {
      this.looks.delete(e.pointerId);
      const tap = !look.moved && !this.pinched && performance.now() - look.t0 < TAP_MS;
      if (this.looks.size < 2) this.pinchDist = 0;
      if (!this.looks.size) this.pinched = false;
      if (tap) this.lookTap(e.clientX, e.clientY);
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (this.state === 'aim' && d.active && d.power >= MIN_POWER) this.kick(d.power);
    else this.softCancel();
  }

  private onCancel(e: PointerEvent) {
    if (this.looks.delete(e.pointerId)) {
      if (this.looks.size < 2) this.pinchDist = 0;
      if (!this.looks.size) this.pinched = false;
      return;
    }
    if (this.drag && this.drag.id === e.pointerId) this.cancelAim();
  }

  /** Zooming and panning work while a floor is being played. */
  private canLook() {
    return (this.state === 'aim' || this.state === 'kick' || this.state === 'roll') && !!this.view && !this.hud.titleVisible;
  }

  private lookDown(e: PointerEvent) {
    if (!this.canLook() || this.looks.size >= 2) return;
    this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
    if (this.looks.size === 2) {
      this.pinched = true;
      this.pinchDist = this.lookSpread();
    }
  }

  private lookMove(e: PointerEvent, look: { x: number; y: number; x0: number; y0: number; moved: boolean }) {
    const dx = e.clientX - look.x;
    const dy = e.clientY - look.y;
    look.x = e.clientX;
    look.y = e.clientY;
    if (!look.moved && Math.hypot(look.x - look.x0, look.y - look.y0) > DRAG_DEAD) look.moved = true;
    if (!this.canLook()) return;
    if (this.looks.size >= 2) {
      // one finger moved: the midpoint moved half as far; pan with it, then zoom about it
      const [a, b] = [...this.looks.values()];
      this.cam.panBy(dx / 2, dy / 2);
      const dist = this.lookSpread();
      if (this.pinchDist > 0) this.cam.zoomAt(dist / this.pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinchDist = dist;
      this.stopFollow();
    } else if (look.moved && this.cam.zoom > 1) {
      this.cam.panBy(dx, dy);
      this.stopFollow();
    }
  }

  private lookSpread() {
    const [a, b] = [...this.looks.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Double-tap in the top half: zoom in there, or back out to the whole floor. */
  private lookTap(x: number, y: number) {
    const now = performance.now();
    const last = this.lastTap;
    if (now - last.t < DOUBLE_MS && Math.hypot(x - last.x, y - last.y) < ui.hit) {
      this.lastTap = { t: -1e9, x: 0, y: 0 };
      if (!this.canLook()) return;
      if (this.cam.zoom > 1.01) this.cam.resetZoom();
      else this.cam.zoomAt(ZOOM_STEP, x, y, false);
      this.stopFollow();
    } else {
      this.lastTap = { t: now, x, y };
    }
  }

  private onWheel(e: WheelEvent) {
    if (!this.canLook()) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines → px
    this.cam.zoomAt(Math.exp(-dy * 0.0018), e.clientX, e.clientY);
    this.stopFollow();
  }

  /** The zoom button: frame the shot (the ball and the circle, centred between them), or back out to the whole floor. */
  private toggleZoom() {
    if (!this.canLook()) return;
    if (this.cam.zoom > ZOOMED) {
      this.cam.resetZoom();
      this.follow = false;
    } else {
      const f = this.floor;
      const [tx, tz] = f.def.target;
      const r = f.def.radius;
      const ty = heightAt(f, tx, tz);
      const shot = [
        this.ballPos,
        new THREE.Vector3(tx - r, ty, tz),
        new THREE.Vector3(tx + r, ty, tz),
        new THREE.Vector3(tx, ty, tz - r),
        new THREE.Vector3(tx, ty, tz + r),
        new THREE.Vector3(tx, ty + 1.2, tz), // the marker floating over the circle
      ];
      // room behind the ball (away from the circle) to pull it back, the footballer included
      const away = new THREE.Vector2(this.ballPos.x - tx, this.ballPos.z - tz);
      if (away.lengthSq() > 1e-6) away.normalize();
      shot.push(new THREE.Vector3(this.ballPos.x + away.x * PULL_ROOM, this.ballPos.y, this.ballPos.z + away.y * PULL_ROOM));
      const area = this.hud.playArea(this.mode);
      const side = Math.max(area.side, space[3]) + space[4];
      this.cam.zoomToFit(shot, { top: area.top + space[5], bottom: this.safe.bottom + space[7], left: this.safe.left + side, right: this.safe.right + side }, ZOOM_SHOT);
      this.startFollow();
    }
    this.hud.hideZoomHint();
  }

  private updateZoomButton() {
    const zoomed = this.cam.zoom > ZOOMED;
    const enabled = this.canLook() && this.cam.maxZoom > ZOOMED + 0.1;
    const key = `${zoomed}${enabled}`;
    if (key === this.zoomKey) return;
    this.zoomKey = key;
    this.hud.setZoom({ zoomed, enabled });
  }

  // ---------------------------------------------------------------- shop

  /** The lobby's Shop: the lobby fades, the camera closes in on the ball, the sixteen balls show on top. */
  private openShop() {
    if (this.state !== 'title' || this.shopOpen) return;
    if (!this.introDone || this.ballMode !== 'sim') {
      this.shopQueued = true; // opens as soon as the ball and the footballer are in
      return;
    }
    this.shopOpen = true;
    this.shopBalls ??= new ShopBalls(this.reduced);
    const cells = this.shopCells();
    this.shopBalls.setState(cells);
    this.hud.hideTitle();
    this.hud.showShop(cells);
    this.frameCamera(false, 0.9);
  }

  private closeShop() {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.hud.hideShop();
    this.showTitle(true);
    this.frameCamera(false, 0.9);
  }

  private shopCells(): ShopCell[] {
    const r = readRecords();
    return SKINS.map((s) => ({
      id: s.id,
      name: s.name,
      goal: goalText(s.goal),
      unlocked: this.tester || goalMet(s.goal, r),
      selected: s.id === this.skin.id,
    }));
  }

  /** A shop ball tapped: wear it if it is unlocked (the real ball changes on the spot). */
  private pickBall(id: string) {
    const skin = SKINS.find((s) => s.id === id);
    const cell = this.shopCells().find((c) => c.id === id);
    if (!skin || !cell) return;
    if (!cell.unlocked) {
      this.hud.shopFeedback(id, false);
      platform.haptic.error();
      return;
    }
    this.skin = skin;
    storage.set(KEY_BALL, id);
    this.ball.setSkin(skin);
    this.kickBall.setSkin(skin);
    const cells = this.shopCells();
    this.hud.updateShop(cells);
    this.shopBalls?.setState(cells);
    this.shopBalls?.hop(SKINS.indexOf(skin));
    this.hud.shopFeedback(id, true);
    this.hopT = 0;
    // a taste of its kick: the ball's own burst
    this.fx.ballKick(this.ballPos.clone(), 1, 1, 0.7, skin.fx);
    this.sfx.appear();
    platform.haptic.tick();
  }

  /** Zoomed in: bring the ball into view and keep it there. */
  private startFollow() {
    if (this.cam.zoom <= 1) return;
    const area = this.hud.playArea(this.mode);
    const side = Math.max(area.side, space[3]) + space[5];
    this.followMargin = { top: area.top + space[5], bottom: this.safe.bottom + space[7], left: this.safe.left + side, right: this.safe.right + side };
    this.follow = true;
  }

  /** The player looks somewhere themselves. */
  private stopFollow() {
    this.follow = false;
    this.hud.hideZoomHint();
  }

  private softCancel() {
    if (this.drag) this.drag.active = false;
    this.aimView.hide();
    this.hud.hidePower();
    this.player.setWindup(0);
    if (this.player.currentPose === 'aim') this.player.setPose('idle');
    this.notch = -1;
  }

  private cancelAim() {
    this.drag = null;
    this.softCancel();
  }

  private updateAimLabel() {
    if (!this.drag?.active || this.state !== 'aim') {
      this.hud.hidePower();
      return;
    }
    const v = this.tmp.copy(this.aimView.tip).project(this.cam.cam);
    this.hud.showPower(((v.x + 1) / 2) * this.w, ((1 - v.y) / 2) * this.h, Math.round(this.drag.power * 100));
  }

  // --------------------------------------------------------------- kick

  private kick(power: number) {
    this.state = 'kick';
    this.aimView.hide();
    this.hud.hidePower();
    this.notch = -1;
    this.player.setPose('kick');
    this.lunge = 0;
    const dir = this.aimDir.clone();
    this.after(0.075, () => this.contact(dir, power));
  }

  private contact(dir: THREE.Vector2, power: number) {
    if (this.state !== 'kick') return;
    this.kicksLeft--;
    this.hud.spendKick(this.kicksLeft, this.floor.def.kicks);
    this.kickBall.spend(this.kicksLeft);
    this.startFollow();
    this.sim.kick(dir.x, dir.y, power);
    this.state = 'roll';
    this.hitStop = this.reduced ? 0 : 0.035 + power * 0.04;
    const b = this.ballPos;
    const foot = new THREE.Vector3(b.x, b.y - BALL_R + 0.01, b.z);
    this.fx.kickDust(foot, dir.x, dir.y, power);
    this.fx.ring(foot, 0.08, 0.32 + power * 0.35, 0.4, color.paper, 0.85);
    // the ball's own burst (fire, stardust, juice...)
    this.fx.ballKick(new THREE.Vector3(b.x - dir.x * 0.08, b.y, b.z - dir.y * 0.08), dir.x, dir.y, power, this.skin.fx);
    this.fx.ring(foot, 0.1, 0.45 + power * 0.4, 0.5, this.skin.fx.colors[0], 0.9);
    this.sfx.kick(power);
    platform.haptic.kick(power);
    if (!this.reduced) this.cam.addShake(0.12 + power * 0.32);
    // vanish only if the ball is still on its way (a tiny tap may already have stopped)
    this.after(0.17, () => {
      if (this.state === 'roll') this.playerOut();
    });
  }

  // --------------------------------------------------------------- ball

  private dropBallIn(cb: () => void) {
    const [sx, sz] = this.floor.def.start;
    this.sim.place(sx, sz);
    const ground = heightAt(this.floor, sx, sz);
    this.ballPos.set(sx, ground + BALL_R + 2.4, sz);
    this.drop = { vy: 0, ground, cb };
    this.ballMode = 'drop';
    this.ballScale = 1;
    this.ball.group.visible = true;
    this.ball.spin.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  }

  private ballBeamOut() {
    if (this.ballMode === 'hidden' || this.ballMode === 'beam') return;
    this.ballMode = 'beam';
    this.beamT = 0;
    const b = this.ballPos;
    this.fx.beam(new THREE.Vector3(b.x, b.y - BALL_R, b.z), 0.16, 2.6, 0.5, color.gold);
    this.fx.sparkle(b, 10, { speed: 1, up: 1.6, size: 0.03, max: 0.5 });
  }

  private updateBall(dt: number) {
    const b = this.ballPos;
    const ball = this.ball;
    let shadowOn = false;
    switch (this.ballMode) {
      case 'hidden':
        ball.group.visible = false;
        break;
      case 'drop': {
        this.drop.vy -= 22 * dt;
        b.y += this.drop.vy * dt;
        const floorY = this.drop.ground + BALL_R + this.tileOffsetAt(b.x, b.z);
        if (b.y <= floorY && this.drop.vy < 0) {
          b.y = floorY;
          const impact = -this.drop.vy;
          this.sfx.land(impact);
          this.fx.ring(new THREE.Vector3(b.x, floorY - BALL_R, b.z), 0.05, 0.3, 0.35, color.paper, 0.6 * Math.min(1, impact / 5));
          if (impact > 1.4) {
            this.drop.vy = impact * 0.42;
            if (impact > 4) platform.haptic.bump();
          } else {
            this.ballMode = 'sim';
            const cb = this.drop.cb;
            this.drop.cb = null;
            cb?.();
          }
        }
        ball.roll(0.4, 0.3, dt);
        shadowOn = true;
        break;
      }
      case 'sim': {
        const s = this.sim;
        if (s.moving || s.state === 'fallen') {
          s.update(dt);
          this.handleBallEvents();
        }
        b.set(s.x, s.y + BALL_R, s.z);
        if (s.state !== 'fallen') ball.roll(s.vx, s.vz, dt);
        if (s.state === 'ground' || s.state === 'rest') this.lastGround.set(s.x, s.y, s.z);
        this.sfx.roll(s.state === 'ground' ? s.speed : 0);
        // hop on a clear
        this.hopT += dt;
        if (this.hopT < 0.45) b.y += hump(this.hopT / 0.45) * 0.32;
        // the ball's own trail as it rolls: a piece every little way it goes
        if (s.moving && s.speed > 0.6 && s.state !== 'fallen') {
          this.trailDist += s.speed * dt;
          const step = this.reduced ? TRAIL_STEP * 3 : TRAIL_STEP;
          if (this.trailDist >= step) {
            this.trailDist = 0;
            const back = 1 / Math.max(0.001, s.speed);
            this.tmp.set(b.x - s.vx * back * BALL_R * 0.8, b.y - BALL_R * 0.55, b.z - s.vz * back * BALL_R * 0.8);
            this.fx.ballTrail(this.tmp, this.skin.fx, this.trailN++);
          }
        }
        // the circle warms up as the ball settles in it
        const inside = inTarget(this.floor, s.x, s.z);
        this.target.setHot(inside && s.state !== 'fallen' && this.state !== 'switch' ? clamp(1.3 - s.speed / 1.4) : 0);
        shadowOn = s.state !== 'fallen';
        break;
      }
      case 'ride': {
        const r = this.ride;
        if (r.view && r.tile) {
          b.y = r.base + tileAnimOffset(r.view.uniforms, r.tile.i + 0.5, r.tile.j + 0.5, r.view.tileRand.get(r.tile) ?? 0);
        }
        this.sfx.roll(0);
        break;
      }
      case 'beam': {
        this.beamT += dt;
        const k = clamp(this.beamT / 0.32);
        this.ballScale = 1 - easeInCubic(k);
        b.y += dt * (1 + k * 6);
        if (k >= 1) {
          this.ballMode = 'hidden';
          this.ballScale = 1;
        }
        this.sfx.roll(0);
        break;
      }
    }
    if (this.ballMode !== 'hidden') {
      ball.group.visible = true;
      ball.group.position.copy(b);
      ball.group.scale.setScalar(Math.max(0.001, this.ballScale));
      ball.outlineScale.value = this.ballScale;
    }
    if (shadowOn) {
      const t = supportTile(this.floor, b.x, b.z);
      if (t) {
        let pad = 0;
        for (const tr of this.floor.tramps) if (Math.hypot(b.x - tr.x, b.z - tr.z) < 0.3) pad = 0.034;
        for (const bo of this.floor.boosts) if (Math.abs(b.x - bo.x) < 0.31 && Math.abs(b.z - bo.z) < 0.31) pad = Math.max(pad, 0.018);
        const gy = surfaceAt(t, b.x, b.z) + pad + this.tileOffsetAt(b.x, b.z);
        ball.shadow.set(b.x, gy, b.z, b.y - BALL_R - gy, t.gx, t.gz);
        this.placeGrabRing(dt, b.x, gy, b.z, t.gx, t.gz);
      } else ball.shadow.mesh.visible = false;
    } else ball.shadow.mesh.visible = false;
    if (!shadowOn) this.placeGrabRing(dt, 0, 0, 0, 0, 0, true);
  }

  /** The grab ring: a soft pulse round the ball while it waits to be dragged. */
  private placeGrabRing(dt: number, x: number, y: number, z: number, gx: number, gz: number, off = false) {
    const show = !off && this.canAim() && !this.drag?.active && this.playerMode === 'here';
    this.grabT += ((show ? 1 : 0) - this.grabT) * damp(show ? 6 : 14, dt);
    const ring = this.grabRing;
    ring.visible = this.grabT > 0.01;
    if (!ring.visible) return;
    const pulse = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 3.2);
    ring.position.set(x, y + 0.004, z);
    ring.quaternion.setFromUnitVectors(GRAB_UP, this.tmp.set(-gx, 1, -gz).normalize());
    ring.scale.setScalar(BALL_R * (2.1 + 0.6 * pulse));
    this.grabMat.opacity = this.grabT * (0.75 - 0.4 * pulse);
  }

  /** Vertical offset of the current floor's tile under (x, z) while it animates. */
  private tileOffsetAt(x: number, z: number): number {
    const v = this.view;
    if (!v) return 0;
    const t = tileAt(v.floor, x, z);
    if (!t) return 0;
    return tileAnimOffset(v.uniforms, t.i + 0.5, t.j + 0.5, v.tileRand.get(t) ?? 0);
  }

  private handleBallEvents() {
    const s = this.sim;
    const props = this.view ? this.props.get(this.view) : undefined;
    const f = this.floor;
    for (const ev of s.events) {
      switch (ev.type) {
        case 'wall':
          this.sfx.wall(ev.speed);
          this.fx.sparkle(new THREE.Vector3(ev.x, ev.y + BALL_R, ev.z), 4, { speed: 0.8, up: 0.6, size: 0.022, max: 0.3 });
          if (ev.speed > 1.5) platform.haptic.bump();
          if (!this.reduced) this.cam.addShake(Math.min(0.2, ev.speed * 0.04));
          break;
        case 'fence':
          this.sfx.fence(ev.speed);
          props?.fences[ev.index]?.hit(Math.min(1, ev.speed / 4));
          this.fx.sparkle(new THREE.Vector3(ev.x, ev.y + BALL_R, ev.z), 5, { speed: 0.9, up: 0.7, size: 0.022, max: 0.3, colors: [color.paper] });
          if (ev.speed > 1.5) platform.haptic.bump();
          if (!this.reduced) this.cam.addShake(Math.min(0.15, ev.speed * 0.03));
          break;
        case 'bumper': {
          this.sfx.bumper();
          props?.bumpers[ev.index]?.hit(1);
          const bp = f.bumpers[ev.index];
          if (bp) this.fx.ring(new THREE.Vector3(bp.x, bp.base, bp.z), 0.15, 0.6, 0.35, color.accent, 0.8);
          this.fx.sparkle(new THREE.Vector3(ev.x, ev.y + BALL_R, ev.z), 8, { speed: 1.6, up: 1, size: 0.028, max: 0.35, colors: [color.accent, color.gold, color.paper] });
          platform.haptic.kick(0.5);
          if (!this.reduced) this.cam.addShake(0.12);
          break;
        }
        case 'tramp': {
          this.sfx.tramp();
          props?.tramps[ev.index]?.hit(1);
          const tr = f.tramps[ev.index];
          if (tr) {
            this.fx.ring(new THREE.Vector3(tr.x, tr.base, tr.z), 0.2, 0.7, 0.4, color.paper, 0.85);
            this.fx.sparkle(new THREE.Vector3(tr.x, tr.base + 0.1, tr.z), 10, { speed: 1.2, up: 2, size: 0.03, max: 0.45 });
          }
          platform.haptic.kick(0.6);
          break;
        }
        case 'boost': {
          this.sfx.boost();
          props?.boosts[ev.index]?.hit(1);
          const bo = f.boosts[ev.index];
          if (bo) this.fx.sparkle(new THREE.Vector3(bo.x, bo.base + 0.05, bo.z), 10, { speed: 1.8, up: 0.5, size: 0.026, max: 0.35, colors: [color.gold, color.paper] });
          platform.haptic.bump();
          break;
        }
        case 'portal': {
          this.sfx.portal();
          const pair = props?.portals[ev.index];
          pair?.[0].hit(1);
          pair?.[1].hit(1);
          const p = f.portals[ev.index];
          if (p) {
            for (const end of [p.a, p.b]) {
              this.fx.ring(new THREE.Vector3(end.x, end.base, end.z), 0.1, 0.55, 0.4, color.paper, 0.9);
              this.fx.sparkle(new THREE.Vector3(end.x, end.base + 0.15, end.z), 10, { speed: 1, up: 1.8, size: 0.028, max: 0.45 });
            }
          }
          platform.haptic.bump();
          break;
        }
        case 'land':
          this.sfx.land(ev.speed);
          if (ev.speed > 1) this.fx.ring(new THREE.Vector3(ev.x, ev.y, ev.z), 0.05, 0.28, 0.3, color.paper, 0.5);
          break;
        case 'fall':
          this.fail('fall');
          break;
        case 'stop':
          this.onStop();
          break;
      }
    }
    s.events.length = 0;
  }

  private onStop() {
    if (this.state !== 'roll') return;
    const s = this.sim;
    if (inTarget(this.floor, s.x, s.z)) this.clearFloor();
    else if (this.kicksLeft <= 0) this.fail('kicks');
    else if (this.timeLeft <= 0 && !this.waitFirstTouch) this.fail('time');
    else {
      this.playerAtBall();
      this.state = 'aim';
    }
  }

  // ------------------------------------------------------------- player

  /**
   * Stand behind the ball (for a kick toward dx, dz) and a little to its side,
   * so the ball stays in view over the footballer's shoulder.
   */
  private placePlayer(bx: number, bz: number, dx: number, dz: number, smooth: boolean) {
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const theta = Math.atan2(dx, dz);
    const lx = Math.cos(theta);
    const lz = -Math.sin(theta);
    const ground = heightAt(this.floor, bx, bz);
    const options: [number, number][] = [
      [0.3, 0.25],
      [0.3, -0.25],
      [0.24, 0],
      [0.2, 0.18],
      [0.2, -0.18],
    ];
    let pick = options[0];
    let gy = ground;
    for (const opt of options) {
      const x = bx - dx * opt[0] - lx * opt[1];
      const z = bz - dz * opt[0] - lz * opt[1];
      const h = heightAt(this.floor, x, z);
      if (Number.isFinite(h) && Math.abs(h - ground) < 0.12) {
        pick = opt;
        gy = h;
        break;
      }
    }
    let sx = bx - dx * pick[0] - lx * pick[1];
    let sz = bz - dz * pick[0] - lz * pick[1];
    if (!Number.isFinite(heightAt(this.floor, sx, sz)) || Math.abs(gy - ground) >= 0.12) {
      // no room behind the ball: shrink toward it until he stands on its tile
      for (let k = 0.85; k >= 0; k -= 0.15) {
        const x = bx + (sx - bx) * k;
        const z = bz + (sz - bz) * k;
        const h = heightAt(this.floor, x, z);
        if (Number.isFinite(h) && Math.abs(h - ground) < 0.12) {
          sx = x;
          sz = z;
          gy = h;
          break;
        }
      }
    }
    this.player.kickLeg = pick[1] >= 0 ? 1 : -1;
    this.stanceGoal.set(sx, Number.isFinite(gy) ? gy : 0, sz);
    if (!smooth) this.stance.copy(this.stanceGoal);
    this.player.faceDir(dx, dz, !smooth);
  }

  /** Teleport the footballer back to the resting ball, facing the circle. */
  private playerAtBall() {
    const b = this.ballPos;
    const [tx, tz] = this.floor.def.target;
    this.player.setPose('idle');
    this.player.setWindup(0);
    this.placePlayer(b.x, b.z, tx - b.x, tz - b.z, false);
    this.playerIn();
  }

  private playerIn() {
    this.playerMode = 'in';
    this.playerT = 0;
    this.player.root.visible = true;
    const p = this.stance;
    this.fx.beam(p, 0.24, 3.2, 0.55);
    this.fx.ring(p, 0.04, 0.5, 0.5, color.paper, 0.9);
    this.after(0.12, () => this.fx.sparkle(this.tmp.copy(p).setY(p.y + 0.2), 12, { speed: 1.4, up: 1.4, size: 0.03 }));
    this.sfx.appear();
  }

  private playerOut() {
    if (this.playerMode === 'gone' || this.playerMode === 'out') return;
    this.playerMode = 'out';
    this.playerT = 0;
    const p = this.stance;
    this.fx.beam(p, 0.2, 2.6, 0.38);
    this.fx.sparkle(new THREE.Vector3(p.x, p.y + 0.35, p.z), 14, { speed: 1.2, up: 2.2, size: 0.032, colors: [color.paper, color.gold, color.accent] });
    this.fx.ring(p, 0.3, 0.05, 0.3, color.paper, 0.6);
    this.sfx.vanish();
  }

  private updatePlayer(dt: number) {
    const pl = this.player;
    this.playerT += dt;
    this.stance.lerp(this.stanceGoal, damp(16, dt));
    let sx = 1;
    let sy = 1;
    let lift = 0;
    switch (this.playerMode) {
      case 'gone':
        pl.root.visible = false;
        pl.shadow.mesh.visible = false;
        return;
      case 'in': {
        const t = clamp(this.playerT / 0.42);
        sx = lerp(0.08, 1, easeOutBack(clamp(t * 1.5), 2.2));
        sy = lerp(2.4, 1, easeOutElastic(t));
        lift = (1 - easeOutCubic(clamp(t * 1.8))) * 0.7;
        if (t >= 1) this.playerMode = 'here';
        break;
      }
      case 'out': {
        const t = clamp(this.playerT / 0.26);
        if (t < 0.25) {
          const k = t / 0.25;
          sx = 1 + 0.32 * k;
          sy = 1 - 0.3 * k;
        } else {
          const k = easeInCubic((t - 0.25) / 0.75);
          sx = 1.32 * (1 - k);
          sy = 0.7 + 2.1 * k;
          lift = k * 0.9;
        }
        if (t >= 1) {
          this.playerMode = 'gone';
          pl.setPose('idle');
          pl.root.visible = false;
          pl.shadow.mesh.visible = false;
          return;
        }
        break;
      }
      case 'here':
        break;
    }
    // lunge into the ball on a kick
    let ox = 0;
    let oz = 0;
    if (pl.currentPose === 'kick') {
      this.lunge = Math.min(1, this.lunge + dt / 0.075);
      const k = easeOutCubic(this.lunge) * 0.14;
      ox = this.aimDir.x * k;
      oz = this.aimDir.y * k;
    }
    pl.stretch.set(sx, sy);
    pl.lift = lift;
    pl.root.visible = true;
    const off = this.tileOffsetAt(this.stance.x, this.stance.z);
    pl.root.position.set(this.stance.x + ox, this.stance.y + lift + off, this.stance.z + oz);
    pl.update(dt);
    const st = supportTile(this.floor, this.stance.x, this.stance.z);
    const gy = st ? surfaceAt(st, this.stance.x, this.stance.z) : NaN;
    pl.shadow.set(
      this.stance.x + ox,
      (Number.isFinite(gy) ? gy : this.stance.y) + off,
      this.stance.z + oz,
      lift + (pl.currentPose === 'celebrate' ? 0.15 : 0),
      st?.gx ?? 0,
      st?.gz ?? 0,
      st ? 1 : 0,
    );
  }

  // -------------------------------------------------------------- target

  private updateTarget(dt: number) {
    const v = this.targetView;
    this.targetScale += (this.targetGoal - this.targetScale) * damp(this.targetGoal > this.targetScale ? 9 : 14, dt);
    const show = v && this.targetScale > 0.01;
    this.target.group.visible = !!show;
    if (show && v) {
      const [tx, tz] = v.floor.def.target;
      const t = tileAt(v.floor, tx, tz);
      const y = t ? surfaceAt(t, tx, tz) + tileAnimOffset(v.uniforms, t.i + 0.5, t.j + 0.5, v.tileRand.get(t) ?? 0) : 0;
      this.target.group.position.set(tx, y + 0.004, tz);
      const pop = this.targetGoal > 0.5 ? easeOutBack(clamp(this.targetScale)) : this.targetScale;
      this.target.group.scale.setScalar(Math.max(0.001, pop));
    }
    this.target.update(dt);
  }

  // ---------------------------------------------------------- clear / fail

  private clearFloor() {
    this.state = 'clear';
    this.timerOn = false;
    const [tx, tz] = this.floor.def.target;
    const ty = heightAt(this.floor, tx, tz);
    const tp = new THREE.Vector3(tx, ty, tz);
    this.target.flash();
    this.fx.confettiBurst(tp, 80);
    this.fx.sparkle(tp.clone().setY(ty + 0.2), 22, { speed: 2.4, up: 2.2, size: 0.04, max: 0.8 });
    this.fx.beam(tp, this.floor.def.radius * 1.05, 3.6, 1.1, color.gold);
    this.fx.ring(tp, this.floor.def.radius, this.floor.def.radius * 3, 0.8, color.gold, 0.9);
    this.fx.ring(tp, 0.1, this.floor.def.radius * 2, 0.55, color.paper, 0.9);
    this.hopT = 0;
    this.sfx.win();
    platform.haptic.success();
    if (!this.reduced) this.cam.addShake(0.22);
    if (!this.tester) {
      // the shop's records
      countUp(KEY_CLEARS);
      if (this.floor.def.kicks - this.kicksLeft === 1) countUp(KEY_ONES);
    }
    if (this.mode === 'regular' && !this.tester && this.floorIndex < LAST && this.floorIndex + 1 > this.unlocked) {
      this.unlocked = this.floorIndex + 1;
      storage.set(KEY_UNLOCKED, String(this.unlocked));
    }
    const last = this.floorIndex >= LAST;
    let wait = last ? 1.35 : 1.15;
    if (this.mode === 'regular') wait = Math.max(wait, this.landStars());
    // the footballer pops up beside the ball to celebrate, facing you
    this.after(0.16, () => {
      const b = this.ballPos;
      this.placePlayer(b.x, b.z, 1, 1, false);
      this.player.faceDir(1, 1, true);
      this.player.setPose('celebrate');
      this.playerIn();
    });
    this.heading = last ? this.floorIndex : this.floorIndex + 1;
    this.after(wait, () => (last ? this.finishRun() : this.nextFloor()));
  }

  /**
   * Play mode: this clear's stars (cleared, in time, in kicks), kept if they
   * beat the floor's best, landing one by one with a chime each. Returns how
   * long to stay on the floor so they can be seen.
   */
  private landStars(): number {
    const t = starTarget(this.floorIndex);
    const def = this.floor.def;
    const word = t.kicks === 1 ? 'kick' : 'kicks';
    const slots = [
      { on: true, label: 'Cleared' },
      { on: def.time - this.timeLeft <= t.time, label: `In ${t.time}s` },
      { on: def.kicks - this.kicksLeft <= t.kicks, label: `In ${t.kicks} ${word}` },
    ].sort((a, b) => Number(b.on) - Number(a.on)); // earned first: they fill left to right
    const n = slots.filter((s) => s.on).length;
    saveStars(this.floorIndex, n);
    const gap = ui.starGap / 1000;
    this.after(STARS_AT, () => this.hud.showStars(slots));
    slots.forEach((s, k) =>
      this.after(STARS_AT + k * gap, () => {
        if (s.on) {
          this.sfx.star(k);
          platform.haptic.tick();
        } else this.sfx.starMiss();
      }),
    );
    this.after(STARS_AT + 2 * gap + 0.3, () => this.hud.setFloorStars(bestStars()[this.floorIndex]));
    return STARS_AT + 2 * gap + 1.1;
  }

  private nextFloor() {
    const next = this.floorIndex + 1;
    this.hud.hideStars();
    if (this.mode === 'regular') storage.set(KEY_FLOOR, String(next));
    this.state = 'switch';
    this.heading = next;
    this.playerOut();
    this.ballBeamOut();
    this.after(0.22, () => {
      const [tx, tz] = this.floor.def.target;
      this.crumble(tx, tz);
      this.after(0.3, () => this.restartAt(next));
    });
  }

  private finishRun() {
    this.state = 'complete';
    this.hud.hideStars();
    const time = this.runTime;
    // A best needs the whole run: Speedrun always is one; Play only from
    // floor 1 without jumps (the time of a resumed or jumped run means nothing).
    const counts = !this.restored && !this.tested && (this.mode === 'speedrun' || this.cleanRun);
    const prev = this.best(this.mode);
    const isNew = counts && (prev == null || time < prev);
    if (isNew) storage.set(KEY_BEST(this.mode), String(time));
    this.hud.hideHud();
    this.hud.setNav({ visible: false, prev: false, next: false });
    this.navKey = '';
    this.hud.showComplete(this.mode, time, counts ? prev : null, isNew);
    this.sfx.whistle('full');
    const b = this.ballPos;
    this.fx.confettiBurst(new THREE.Vector3(b.x, b.y, b.z), 90, 1.25);
    this.after(0.35, () => this.fx.confettiBurst(new THREE.Vector3(b.x - 1, b.y, b.z - 1), 60, 1.1));
  }

  private fail(reason: FailReason) {
    if (this.state === 'fail' || this.state === 'switch' || this.state === 'complete' || this.state === 'title') return;
    this.state = 'fail';
    this.timerOn = false;
    this.cancelAim();
    const restart = this.mode === 'speedrun' ? 0 : this.floorIndex;
    this.heading = restart;
    const text = reason === 'fall' ? 'Fell off' : reason === 'kicks' ? 'Out of kicks' : 'Time up';
    const sub = this.mode === 'regular' ? `Retry floor ${restart + 1}` : this.floorIndex === 0 ? 'Try again' : 'Back to floor 1';
    this.hud.say(text, sub);
    platform.haptic.error();
    if (!this.reduced) this.cam.addShake(0.3);
    if (reason === 'fall') this.sfx.fall();
    if (reason === 'time') this.sfx.whistle('long');
    this.after(reason === 'time' ? 0.55 : 0.1, () => this.sfx.fail());
    this.target.setHot(0);
    if (reason !== 'fall' && this.view) {
      // the ball rides its tile down when the floor crumbles
      const t = tileAt(this.floor, this.sim.x, this.sim.z);
      if (t) this.ride = { view: this.view, tile: t, base: this.ballPos.y };
      this.ballMode = 'ride';
    }
    this.after(reason === 'fall' ? 0.5 : 0.7, () => {
      this.playerOut();
      this.crumble(this.lastGround.x, this.lastGround.z);
      this.after(0.38, () => {
        if (this.ballMode === 'ride') this.ballMode = 'hidden';
        this.restartAt(restart);
      });
    });
  }

  private best(mode: Mode): number | null {
    const v = parseFloat(storage.get(KEY_BEST(mode)) ?? '');
    return Number.isFinite(v) ? v : null;
  }

  // ------------------------------------------------- test hooks (no UI)

  /** Kick at `angle` (radians, world x/z) with `power` 0..1, as a release would. */
  debugKick(angle: number, power: number): boolean {
    if (this.state !== 'aim' || this.ballMode !== 'sim' || this.sim.moving) return false;
    if (this.waitFirstTouch) {
      this.waitFirstTouch = false;
      this.timerOn = true;
      this.hud.hideHint();
    }
    this.aimDir.set(Math.cos(angle), Math.sin(angle));
    this.kick(power);
    return true;
  }

  /** Set the floor's countdown, in seconds, for testing. */
  debugTime(sec: number) {
    this.timeLeft = Math.max(0, sec);
  }

  /** Jump to a floor for testing (any mode, any floor). */
  debugFloor(index: number) {
    if (this.state !== 'aim' && this.state !== 'roll') return false;
    this.switchTo(clamp(index, 0, LAST));
    return true;
  }

  debugState() {
    return {
      state: this.state,
      mode: this.mode,
      floor: this.floorIndex,
      unlocked: this.unlocked,
      kicksLeft: this.kicksLeft,
      timeLeft: +this.timeLeft.toFixed(2),
      runTime: +this.runTime.toFixed(2),
      ball: { x: +this.sim?.x.toFixed(3), z: +this.sim?.z.toFixed(3), state: this.sim?.state },
      ballMode: this.ballMode,
      playerMode: this.playerMode,
      scale: +this.cam.scale.toFixed(1),
      zoom: +this.cam.zoom.toFixed(2),
      follow: this.follow,
      hints: { aim: !document.getElementById('hint')!.hidden, zoom: !document.getElementById('hint-zoom')!.hidden },
    };
  }
}
