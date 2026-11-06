// Places a floor's props (fences, trampolines, magnets, boost pads, bumpers,
// portals, conveyor belts, plank bridges) on their tiles, keeps them riding
// the tile rise/crumble animation, and lets physics events poke them.
import * as THREE from 'three';
import type { FloorView } from './floor.ts';
import { tileAnimOffset } from './floorShaders.ts';
import type { Tile } from './levels.ts';
import {
  makeBoost,
  makeBridge,
  makeBumper,
  makeConveyor,
  makeFence,
  makeMagnet,
  makePortal,
  makeTrampoline,
  type Prop,
  type PropContext,
} from './props.ts';
import { color } from './theme.ts';

/** Yaw that turns a prop's local +x onto the world direction (dx, dz). */
const yawFor = (dx: number, dz: number) => Math.atan2(-dz, dx);
const PORTAL_COLOURS = [color.portalA, color.portalB];

interface Placed {
  prop: Prop;
  tile: Tile;
  base: number;
}

export class PropsView {
  readonly group = new THREE.Group();
  readonly fences: Prop[] = [];
  readonly tramps: Prop[] = [];
  readonly boosts: Prop[] = [];
  readonly bumpers: Prop[] = [];
  readonly portals: [Prop, Prop][] = [];
  private placed: Placed[] = [];
  private view: FloorView;

  constructor(view: FloorView, ctx: PropContext) {
    this.view = view;
    const f = view.floor;
    const add = (prop: Prop, tile: Tile, x: number, y: number, z: number, yaw = 0) => {
      prop.root.position.set(x, y, z);
      prop.root.rotation.y = yaw;
      this.group.add(prop.root);
      this.placed.push({ prop, tile, base: y });
      return prop;
    };
    for (const t of f.tiles) {
      if (t.bridge) add(makeBridge(ctx), t, t.i + 0.5, t.c[0], t.j + 0.5, t.bridge === 1 ? 0 : -Math.PI / 2);
      if (t.belt) add(makeConveyor(ctx), t, t.i + 0.5, t.c[0], t.j + 0.5, yawFor(t.belt[0], t.belt[1]));
    }
    for (const fe of f.fences) {
      const len = Math.hypot(fe.bx - fe.ax, fe.bz - fe.az);
      this.fences.push(add(makeFence(ctx, len), fe.tile, fe.ax, fe.base, fe.az, yawFor(fe.bx - fe.ax, fe.bz - fe.az)));
    }
    for (const tr of f.tramps) this.tramps.push(add(makeTrampoline(ctx), tr.tile, tr.x, tr.base, tr.z));
    for (const m of f.magnets) add(makeMagnet(ctx, m.range, m.pull < 0), m.tile, m.x, m.base, m.z);
    for (const b of f.boosts) this.boosts.push(add(makeBoost(ctx), b.tile, b.x, b.base, b.z, yawFor(b.dx, b.dz)));
    for (const b of f.bumpers) this.bumpers.push(add(makeBumper(ctx), b.tile, b.x, b.base, b.z));
    f.portals.forEach((p, k) => {
      const hue = PORTAL_COLOURS[k % PORTAL_COLOURS.length];
      this.portals.push([add(makePortal(ctx, hue), p.a.tile, p.a.x, p.a.base, p.a.z), add(makePortal(ctx, hue), p.b.tile, p.b.x, p.b.base, p.b.z)]);
    });
  }

  update(dt: number, time: number) {
    const u = this.view.uniforms;
    for (const p of this.placed) {
      p.prop.root.position.y = p.base + tileAnimOffset(u, p.tile.i + 0.5, p.tile.j + 0.5, this.view.tileRand.get(p.tile) ?? 0);
      p.prop.update(dt, time);
    }
  }

  dispose() {
    for (const p of this.placed) p.prop.dispose();
    this.placed.length = 0;
    this.group.removeFromParent();
  }
}
