// Pooled effects: particles (sparkles, confetti, grass dust), ground
// shockwave rings and teleport light beams. Nothing allocates per frame.
import * as THREE from 'three';
import { color } from './theme.ts';
import { clamp, easeOutCubic } from './util.ts';

type Kind = 0 | 1 | 2; // sparkle, confetti, dust

interface Particle {
  kind: Kind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grav: number;
  drag: number;
  col: THREE.Color;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private list: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private readonly cap: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  add(p: Particle) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push(p);
  }

  clear() {
    this.list.length = 0;
    this.mesh.count = 0;
  }

  update(dt: number) {
    let k = 0;
    const keep: Particle[] = [];
    for (const p of this.list) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const a = p.life / p.max;
      const sc = p.kind === 1 ? p.size * (a < 0.85 ? 1 : 1 - (a - 0.85) / 0.15) : p.size * (1 - a * a);
      this.q.setFromEuler(p.rot);
      this.s.setScalar(Math.max(sc, 1e-4));
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
      this.mesh.setColorAt(k, p.col);
      k++;
      keep.push(p);
    }
    this.list = keep;
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  max: number;
  r0: number;
  r1: number;
  alpha: number;
}

interface Beam {
  mesh: THREE.Mesh;
  u: { uAlpha: { value: number }; uTime: { value: number }; uColor: { value: THREE.Color } };
  life: number;
  max: number;
  radius: number;
  height: number;
}

const CONFETTI = [color.accent, color.gold, color.paper, '#6cc4f0', '#8fd16a', '#ff9bd0'];

export class Fx {
  readonly group = new THREE.Group();
  private sparkles: Pool;
  private confetti: Pool;
  private dust: Pool;
  private rings: Ring[] = [];
  private beams: Beam[] = [];
  private up = new THREE.Vector3(0, 0, 1);
  private time = 0;

  constructor() {
    this.sparkles = new Pool(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), 260);
    this.confetti = new Pool(
      new THREE.BoxGeometry(1, 0.1, 0.6),
      new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide }),
      220,
    );
    this.dust = new Pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), 120);
    this.group.add(this.sparkles.mesh, this.confetti.mesh, this.dust.mesh);

    const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
    for (let k = 0; k < 10; k++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -8,
        polygonOffsetUnits: -8,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, life: 1, max: 1, r0: 0, r1: 1, alpha: 1 });
    }

    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (let k = 0; k < 4; k++) {
      const u = { uAlpha: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color.paper) } };
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          uniform float uTime;
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() {
            float fade = pow(1.0 - vUv.y, 1.6);
            float bands = 0.7 + 0.3 * sin(vUv.y * 38.0 - uTime * 24.0);
            float edge = 0.55 + 0.45 * abs(sin(vUv.x * 3.14159));
            float a = uAlpha * fade * bands * edge;
            gl_FragColor = vec4(linearToOutputTexel(vec4(uColor, 1.0)).rgb * a, a);
          }`,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.beams.push({ mesh, u, life: 1, max: 1, radius: 0.2, height: 3 });
    }
  }

  private particle(kind: Kind, pos: THREE.Vector3, vel: THREE.Vector3, opts: Partial<Particle> & { hex?: string }) {
    const p: Particle = {
      kind,
      pos: pos.clone(),
      vel: vel.clone(),
      rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      life: 0,
      max: opts.max ?? 0.8,
      size: opts.size ?? 0.04,
      grav: opts.grav ?? 0,
      drag: opts.drag ?? 1.5,
      col: new THREE.Color(opts.hex ?? color.paper),
    };
    (kind === 0 ? this.sparkles : kind === 1 ? this.confetti : this.dust).add(p);
  }

  /** Burst of glints. */
  sparkle(at: THREE.Vector3, n: number, opts: { speed?: number; up?: number; size?: number; colors?: string[]; max?: number } = {}) {
    const cols = opts.colors ?? [color.paper, color.gold];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (opts.speed ?? 1.6) * (0.4 + Math.random() * 0.8);
      const v = new THREE.Vector3(Math.cos(a) * s, (opts.up ?? 1.2) * (0.5 + Math.random()), Math.sin(a) * s);
      this.particle(0, at, v, {
        size: (opts.size ?? 0.035) * (0.6 + Math.random() * 0.8),
        max: (opts.max ?? 0.55) * (0.7 + Math.random() * 0.6),
        grav: 2.5,
        drag: 2.2,
        hex: cols[k % cols.length],
      });
    }
  }

  /** Celebration confetti shooting up from a point. */
  confettiBurst(at: THREE.Vector3, n = 70, power = 1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 1.8) * power;
      const v = new THREE.Vector3(Math.cos(a) * s, (2.4 + Math.random() * 3) * power, Math.sin(a) * s);
      this.particle(1, at, v, {
        size: 0.05 + Math.random() * 0.035,
        max: 1.4 + Math.random() * 1.1,
        grav: 4.2,
        drag: 1.7,
        hex: CONFETTI[k % CONFETTI.length],
      });
    }
  }

  /** Grass bits kicked up from the ground. */
  kickDust(at: THREE.Vector3, dirX: number, dirZ: number, power: number) {
    const n = Math.round(6 + power * 10);
    for (let k = 0; k < n; k++) {
      const spread = (Math.random() - 0.5) * 1.6;
      const s = 0.4 + Math.random() * 1.2 * (0.4 + power);
      const vx = (-dirX + spread * -dirZ) * s * 0.6 + (Math.random() - 0.5) * 0.4;
      const vz = (-dirZ + spread * dirX) * s * 0.6 + (Math.random() - 0.5) * 0.4;
      this.particle(2, at, new THREE.Vector3(vx, 0.8 + Math.random() * 1.6 * (0.5 + power), vz), {
        size: 0.018 + Math.random() * 0.02,
        max: 0.45 + Math.random() * 0.35,
        grav: 9,
        drag: 1,
        hex: k % 3 === 0 ? color.grassSeam : k % 3 === 1 ? color.grassA : color.paint,
      });
    }
  }

  /** Single soft glint, for trails. */
  trail(at: THREE.Vector3, size: number) {
    this.particle(0, at, new THREE.Vector3(0, 0.15, 0), { size, max: 0.35, drag: 0, hex: color.paper });
  }

  /** Flat shockwave on a surface with normal n. */
  ring(at: THREE.Vector3, r0: number, r1: number, max: number, hex: string, alpha = 0.9, n?: THREE.Vector3) {
    const r = this.rings.find((x) => x.life >= x.max) ?? this.rings[0];
    r.life = 0;
    r.max = max;
    r.r0 = r0;
    r.r1 = r1;
    r.alpha = alpha;
    r.mat.color.set(hex);
    r.mesh.position.copy(at);
    r.mesh.position.y += 0.012;
    r.mesh.quaternion.setFromUnitVectors(this.up, n ?? new THREE.Vector3(0, 1, 0));
    r.mesh.visible = true;
  }

  /** Vertical column of light. */
  beam(at: THREE.Vector3, radius: number, height: number, max: number, hex: string = color.paper) {
    const b = this.beams.find((x) => x.life >= x.max) ?? this.beams[0];
    b.life = 0;
    b.max = max;
    b.radius = radius;
    b.height = height;
    b.u.uColor.value.set(hex);
    b.mesh.position.copy(at);
    b.mesh.visible = true;
  }

  clear() {
    this.sparkles.clear();
    this.confetti.clear();
    this.dust.clear();
    for (const r of this.rings) {
      r.life = r.max;
      r.mesh.visible = false;
    }
    for (const b of this.beams) {
      b.life = b.max;
      b.mesh.visible = false;
    }
  }

  update(dt: number) {
    this.time += dt;
    this.sparkles.update(dt);
    this.confetti.update(dt);
    this.dust.update(dt);
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life += dt;
      const a = clamp(r.life / r.max);
      if (a >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.r0 + (r.r1 - r.r0) * easeOutCubic(a);
      r.mesh.scale.setScalar(Math.max(s, 1e-3));
      r.mat.opacity = r.alpha * (1 - a) * (1 - a);
    }
    for (const b of this.beams) {
      if (!b.mesh.visible) continue;
      b.life += dt;
      const a = clamp(b.life / b.max);
      if (a >= 1) {
        b.mesh.visible = false;
        continue;
      }
      // quick flare in, slow fade out, narrowing as it goes
      const flare = a < 0.15 ? a / 0.15 : 1 - (a - 0.15) / 0.85;
      b.u.uAlpha.value = flare * 0.95;
      b.u.uTime.value = this.time;
      const rad = b.radius * (a < 0.15 ? 0.4 + (a / 0.15) * 0.6 : 1 - (a - 0.15) * 0.7);
      b.mesh.scale.set(rad, b.height, rad);
    }
  }
}
