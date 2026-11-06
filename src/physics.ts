// Ball physics on a tile heightfield with map objects. Pure and deterministic:
// the game and the floor tools in scripts/ run exactly this code.
import { BRIDGE_W, CORNER_R, cornerCentre, type Floor, type Tile, supportTile, surfaceAt } from './levels.ts';

export const BALL_R = 0.13;
export const GRAVITY = 15;
const ROLL_K = 5 / 7; // rolling sphere: a = 5/7 g sinθ
export const FRICTION = 2.2; // rolling resistance on grass, tiles/s²
const GRIP = { grass: 1, ice: 0.22, sand: 2.8 } as const;
const WALL_E = 0.5;
const WALL_SLIDE = 0.9;
const FENCE_E = 0.72; // fences are springy: made for bank shots
const FENCE_SLIDE = 0.94;
export const FENCE_T = 0.035; // half thickness
export const BUMPER_R = 0.17;
const BUMPER_H = 0.26;
const BUMPER_KICK = 3.4; // a bumper always fires the ball out at least this fast
export const MAGNET_R = 0.14;
const MAGNET_H = 0.34;
export const TRAMP_R = 0.28;
export const BOOST_R = 0.3;
export const PORTAL_R = 0.28;
const BELT_ACCEL = 3.2;
const LAND_E = 0.3;
const LAND_BOUNCE_MIN = 1.4;
const STEP_TOL = 0.04;
const DROP_TOL = 0.03;
const STOP_SPEED = 0.05;
const CRAWL_STEPS = 72; // crawling this long counts as stopped (valleys, pinned against a magnet)
const MAX_STEPS = 240 * 40; // safety net: no roll lasts longer than 40 s
export const PHYS_DT = 1 / 240;

/** Flat-ground distance covered at full power. */
export const MAX_RANGE = 9;
/** Kick speed for power p in [0,1]: flat-ground distance grows linearly with p. */
export const kickSpeed = (p: number) => Math.sqrt(2 * FRICTION * MAX_RANGE * Math.max(0, p));

export type BallState = 'rest' | 'ground' | 'air' | 'fallen';

export type BallEvent =
  | { type: 'wall' | 'fence' | 'bumper' | 'land'; speed: number; x: number; y: number; z: number; index: number }
  | { type: 'tramp' | 'boost'; index: number }
  | { type: 'portal'; index: number; to: 'a' | 'b' }
  | { type: 'stop' }
  | { type: 'fall' };

/** A tile's top plane, extended past its edges. */
function planeAt(t: Tile, x: number, z: number): number {
  return t.c[0] + t.gx * (x - t.i) + t.gz * (z - t.j);
}

export class BallSim {
  x = 0;
  y = 0; // height of the ball's lowest point
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  state: BallState = 'rest';
  events: BallEvent[] = [];
  floor: Floor;
  /** True when the last rest came from the safety net (a roll that would never end). */
  forced = false;
  private vyGround = 0;
  private acc = 0;
  private crawl = 0;
  private steps = 0;
  private inTramp = -1;
  private inBoost = -1;
  private portalLock = -1; // portal end the ball sits in: 2k = a, 2k+1 = b
  private qx = 0;
  private qz = 0;
  private mx = 0;
  private mz = 0;

  constructor(floor: Floor) {
    this.floor = floor;
  }

  place(x: number, z: number) {
    this.x = x;
    this.z = z;
    const t = supportTile(this.floor, x, z);
    this.y = t ? surfaceAt(t, x, z) : 0;
    this.vx = this.vy = this.vz = 0;
    this.vyGround = 0;
    this.state = 'rest';
    this.events.length = 0;
    this.acc = 0;
    this.crawl = 0;
    this.steps = 0;
    this.forced = false;
    this.inTramp = this.inBoost = -1;
    this.portalLock = this.portalEnd(false);
  }

  kick(dirX: number, dirZ: number, power: number) {
    const len = Math.hypot(dirX, dirZ) || 1;
    const v = kickSpeed(power);
    this.vx = (dirX / len) * v;
    this.vz = (dirZ / len) * v;
    this.vy = 0;
    this.state = 'ground';
    this.crawl = 0;
    this.steps = 0;
    this.forced = false;
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get moving() {
    return this.state === 'ground' || this.state === 'air';
  }

  /** Advance by dt using fixed sub-steps. */
  update(dt: number) {
    this.acc += dt;
    while (this.acc >= PHYS_DT) {
      this.acc -= PHYS_DT;
      this.step(PHYS_DT);
    }
  }

  step(dt: number) {
    if (this.state === 'ground') this.stepGround(dt);
    else if (this.state === 'air') this.stepAir(dt);
    else if (this.state === 'fallen') {
      // keep falling for the visuals, no more collisions
      this.vy -= GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
    }
  }

  // ------------------------------------------------------------------ ground

  private stepGround(dt: number) {
    const s0 = supportTile(this.floor, this.x, this.z);
    if (!s0) {
      this.leaveGround();
      return;
    }
    const inv = 1 / (1 + s0.gx * s0.gx + s0.gz * s0.gz);
    // applied forces: slope, conveyor belt, magnets
    let fx = -GRAVITY * ROLL_K * s0.gx * inv;
    let fz = -GRAVITY * ROLL_K * s0.gz * inv;
    if (s0.belt) {
      fx += s0.belt[0] * BELT_ACCEL;
      fz += s0.belt[1] * BELT_ACCEL;
    }
    this.magnetForce();
    fx += this.mx;
    fz += this.mz;
    const mu = FRICTION * GRIP[s0.surface] * inv;
    const fm = Math.hypot(fx, fz);
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 1e-6) {
      const ovx = this.vx;
      const ovz = this.vz;
      this.vx += (fx - (mu * ovx) / sp) * dt;
      this.vz += (fz - (mu * ovz) / sp) * dt;
      // friction stops a ball, it never pushes it backwards
      if (this.vx * ovx + this.vz * ovz <= 0 && fm <= mu) this.vx = this.vz = 0;
    } else if (fm > mu) {
      // static friction overcome
      this.vx += (fx - (mu * fx) / fm) * dt;
      this.vz += (fz - (mu * fz) / fm) * dt;
    } else {
      this.vx = this.vz = 0;
    }
    const prevY = this.y;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.collide(true, s0);
    if (this.triggers(true)) return;

    const t2 = supportTile(this.floor, this.x, this.z);
    if (!t2) {
      this.leaveGround();
      return;
    }
    const s = surfaceAt(t2, this.x, this.z);
    if (s < this.y - DROP_TOL) {
      this.leaveGround();
      return;
    }
    this.y = s;
    this.vyGround = (this.y - prevY) / dt;

    const speed = Math.hypot(this.vx, this.vz);
    this.steps++;
    this.crawl = speed < STOP_SPEED ? this.crawl + 1 : 0;
    const settled = speed < STOP_SPEED && fm <= mu;
    if (settled || this.crawl > CRAWL_STEPS || this.steps > MAX_STEPS) {
      this.forced = !settled && this.crawl <= CRAWL_STEPS;
      this.vx = this.vz = this.vy = 0;
      this.state = 'rest';
      this.events.push({ type: 'stop' });
    }
  }

  private leaveGround() {
    this.state = 'air';
    this.vy = this.vyGround;
  }

  // --------------------------------------------------------------------- air

  private stepAir(dt: number) {
    this.vy -= GRAVITY * dt;
    this.magnetForce();
    this.vx += this.mx * dt;
    this.vz += this.mz * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.vy * dt;
    this.collide(false, undefined);
    if (this.triggers(false)) return;
    const t = supportTile(this.floor, this.x, this.z);
    if (t) {
      const s = surfaceAt(t, this.x, this.z);
      if (this.y <= s && this.vy <= 0) {
        const impact = -this.vy;
        this.y = s;
        const k = this.trampUnder();
        if (k >= 0) {
          // landing on a trampoline: launched again
          this.vy = this.floor.tramps[k].power;
          this.inTramp = k;
          this.events.push({ type: 'tramp', index: k });
          return;
        }
        this.events.push({ type: 'land', speed: impact, x: this.x, y: s, z: this.z, index: -1 });
        if (impact > LAND_BOUNCE_MIN) {
          this.vy = impact * LAND_E;
          this.vx *= 0.9;
          this.vz *= 0.9;
        } else {
          this.vy = 0;
          this.vyGround = 0;
          this.state = 'ground';
          this.vx *= 0.94;
          this.vz *= 0.94;
        }
        return;
      }
    }
    // Below every top on the floor: nothing left to land on.
    if (this.y < this.floor.minTop - 0.25) {
      this.state = 'fallen';
      this.events.push({ type: 'fall' });
    }
  }

  // ------------------------------------------------------------- collisions

  /** Closest point of tile t's top outline to (x, z), into qx/qz. */
  private closest(t: Tile, x: number, z: number) {
    let x0 = t.i;
    let x1 = t.i + 1;
    let z0 = t.j;
    let z1 = t.j + 1;
    if (t.bridge === 1) {
      z0 = t.j + 0.5 - BRIDGE_W / 2;
      z1 = t.j + 0.5 + BRIDGE_W / 2;
    } else if (t.bridge === 2) {
      x0 = t.i + 0.5 - BRIDGE_W / 2;
      x1 = t.i + 0.5 + BRIDGE_W / 2;
    }
    this.qx = Math.min(x1, Math.max(x0, x));
    this.qz = Math.min(z1, Math.max(z0, z));
    if (t.bridge) return;
    for (let k = 0; k < 4; k++) {
      if (!t.round[k]) continue;
      const cx = t.i + (k === 1 || k === 2 ? 1 : 0);
      const cz = t.j + (k >= 2 ? 1 : 0);
      if (Math.abs(this.qx - cx) < CORNER_R && Math.abs(this.qz - cz) < CORNER_R) {
        const [ax, az] = cornerCentre(t, k);
        const dx = x - ax;
        const dz = z - az;
        const d = Math.hypot(dx, dz);
        if (d > CORNER_R) {
          this.qx = ax + (dx / d) * CORNER_R;
          this.qz = az + (dz / d) * CORNER_R;
        } else {
          this.qx = x;
          this.qz = z;
        }
        return;
      }
    }
  }

  /**
   * Walls (neighbouring columns higher than the ball's surface), fences,
   * bumpers and magnet bodies. A rolling ball measures walls against the
   * tile it stood on at the start of the step, so the edge it is rolling off
   * never counts as a wall.
   */
  private collide(grounded: boolean, support: Tile | undefined) {
    const f = this.floor;
    const ci = Math.floor(this.x);
    const cj = Math.floor(this.z);
    const tol = grounded ? STEP_TOL : BALL_R * 0.6;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const t = f.at(ci + di, cj + dj);
        if (!t || t === support) continue;
        this.closest(t, this.x, this.z);
        const dx = this.x - this.qx;
        const dz = this.z - this.qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= BALL_R * BALL_R || d2 < 1e-12) continue;
        const ref = support ? planeAt(support, this.qx, this.qz) : this.y;
        if (surfaceAt(t, this.qx, this.qz) <= ref + tol) continue;
        const d = Math.sqrt(d2);
        this.contact(dx / d, dz / d, BALL_R - d, WALL_E, WALL_SLIDE, 'wall', -1);
      }
    }
    for (let k = 0; k < f.fences.length; k++) {
      const fe = f.fences[k];
      if (this.y >= fe.top - 0.01 || this.y + 2 * BALL_R < fe.base) continue;
      const ex = fe.bx - fe.ax;
      const ez = fe.bz - fe.az;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((this.x - fe.ax) * ex + (this.z - fe.az) * ez) / len2)) : 0;
      const dx = this.x - (fe.ax + ex * t);
      const dz = this.z - (fe.az + ez * t);
      const d = Math.hypot(dx, dz);
      const reach = BALL_R + FENCE_T;
      if (d >= reach || d < 1e-9) continue;
      this.contact(dx / d, dz / d, reach - d, FENCE_E, FENCE_SLIDE, 'fence', k);
    }
    for (let k = 0; k < f.bumpers.length; k++) {
      const b = f.bumpers[k];
      if (this.y >= b.base + BUMPER_H || this.y + 2 * BALL_R < b.base) continue;
      const dx = this.x - b.x;
      const dz = this.z - b.z;
      const d = Math.hypot(dx, dz);
      const reach = BALL_R + BUMPER_R;
      if (d >= reach || d < 1e-9) continue;
      const nx = dx / d;
      const nz = dz / d;
      this.x = b.x + nx * reach;
      this.z = b.z + nz * reach;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        this.vx -= 2 * vn * nx;
        this.vz -= 2 * vn * nz;
      }
      this.vx += nx * 1.2;
      this.vz += nz * 1.2;
      const sp = Math.hypot(this.vx, this.vz);
      if (sp < BUMPER_KICK) {
        this.vx *= BUMPER_KICK / sp;
        this.vz *= BUMPER_KICK / sp;
      }
      this.crawl = 0;
      this.events.push({ type: 'bumper', speed: Math.max(sp, BUMPER_KICK), x: this.x, y: this.y, z: this.z, index: k });
    }
    for (let k = 0; k < f.magnets.length; k++) {
      const m = f.magnets[k];
      if (this.y >= m.base + MAGNET_H || this.y + 2 * BALL_R < m.base) continue;
      const dx = this.x - m.x;
      const dz = this.z - m.z;
      const d = Math.hypot(dx, dz);
      const reach = BALL_R + MAGNET_R;
      if (d >= reach || d < 1e-9) continue;
      this.contact(dx / d, dz / d, reach - d, 0.4, 0.9, 'wall', -1);
    }
  }

  private contact(nx: number, nz: number, pen: number, e: number, slide: number, kind: 'wall' | 'fence', index: number) {
    const vn = this.vx * nx + this.vz * nz;
    // Always undo this step's own travel into the surface; ease out any
    // overlap that already existed, instead of teleporting the ball.
    const push = vn < 0 ? Math.min(pen, Math.max(0.012, -vn * PHYS_DT)) : Math.min(pen, 0.012);
    this.x += nx * push;
    this.z += nz * push;
    if (vn < 0) {
      const tx = this.vx - vn * nx;
      const tz = this.vz - vn * nz;
      this.vx = tx * slide - vn * e * nx;
      this.vz = tz * slide - vn * e * nz;
      if (-vn > 0.25) this.events.push({ type: kind, speed: -vn, x: this.x, y: this.y, z: this.z, index });
    }
  }

  // --------------------------------------------------------------- triggers

  private magnetForce() {
    this.mx = 0;
    this.mz = 0;
    for (const m of this.floor.magnets) {
      const dx = m.x - this.x;
      const dz = m.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d >= m.range || d < 1e-3) continue;
      const a = m.pull * (1 - d / m.range);
      this.mx += (dx / d) * a;
      this.mz += (dz / d) * a;
    }
  }

  private trampUnder(): number {
    const tr = this.floor.tramps;
    for (let k = 0; k < tr.length; k++) {
      if (Math.hypot(this.x - tr[k].x, this.z - tr[k].z) < TRAMP_R * 0.85 && Math.abs(this.y - tr[k].base) < 0.06) return k;
    }
    return -1;
  }

  private nearPortal(p: { x: number; z: number; base: number }, airborne: boolean): boolean {
    const h = this.y - p.base;
    return h > -0.06 && h < (airborne ? 0.15 : 0.06) && Math.hypot(this.x - p.x, this.z - p.z) < PORTAL_R;
  }

  private portalEnd(airborne: boolean): number {
    const ps = this.floor.portals;
    for (let k = 0; k < ps.length; k++) {
      if (this.nearPortal(ps[k].a, airborne)) return 2 * k;
      if (this.nearPortal(ps[k].b, airborne)) return 2 * k + 1;
    }
    return -1;
  }

  /** Trampolines, boost pads and portals. Returns true when the step ends here. */
  private triggers(grounded: boolean): boolean {
    const f = this.floor;
    const tr = this.trampUnder();
    if (tr !== this.inTramp) {
      this.inTramp = tr;
      if (tr >= 0 && grounded) {
        this.vy = f.tramps[tr].power;
        this.state = 'air';
        this.events.push({ type: 'tramp', index: tr });
        return true;
      }
    }
    if (grounded) {
      let bi = -1;
      for (let k = 0; k < f.boosts.length; k++) {
        const b = f.boosts[k];
        if (Math.hypot(this.x - b.x, this.z - b.z) < BOOST_R && Math.abs(this.y - b.base) < 0.06) bi = k;
      }
      if (bi !== this.inBoost) {
        this.inBoost = bi;
        if (bi >= 0) {
          const b = f.boosts[bi];
          const along = this.vx * b.dx + this.vz * b.dz;
          const px = this.vx - along * b.dx;
          const pz = this.vz - along * b.dz;
          const v = Math.max(along, b.speed);
          this.vx = b.dx * v + px * 0.35;
          this.vz = b.dz * v + pz * 0.35;
          this.crawl = 0;
          this.events.push({ type: 'boost', index: bi });
        }
      }
    }
    const end = this.portalEnd(!grounded);
    if (end !== this.portalLock) {
      this.portalLock = end;
      if (end >= 0) {
        const p = f.portals[end >> 1];
        const from = end & 1 ? p.b : p.a;
        const to = end & 1 ? p.a : p.b;
        const lift = this.y - from.base;
        this.x = to.x;
        this.z = to.z;
        this.y = to.base + (grounded ? 0 : lift);
        this.portalLock = end ^ 1; // now sitting in the exit end
        this.events.push({ type: 'portal', index: end >> 1, to: end & 1 ? 'a' : 'b' });
        return true;
      }
    }
    return false;
  }
}

/** True when a resting ball's centre is inside the target circle. */
export function inTarget(f: Floor, x: number, z: number): boolean {
  const [tx, tz] = f.def.target;
  return Math.hypot(x - tx, z - tz) <= f.def.radius;
}
