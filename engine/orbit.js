// Orbit Crusher engine (new Swarm path). Balls orbit a central gravity well; rotating blades sweep through
// the orbits and every ball they cut can fission into three. No ball–ball collisions.
// Determinism: only IEEE basic ops + dsin/dcos (src/engine/dmath.js); counter-based RNG; fixed iteration
// order. Time convention (ARCHITECTURE §4.6): the state of frame f is the state at t = (f+1)/FPS.
import { FPS } from '../core/constants.js';
import { dsin, dcos } from './dmath.js';
import { splitChance } from './pacing.js';
export { splitChance };
import { rand } from './rng.js';
import { FLAG_CAP, FLAG_OUTRO } from '../sim/sim.js';

export const FLAG_BEAT = 16;      // a blade passed the top (used for music/impact accents)
export const GOLD_INDEX = 10;     // matches the v1 palette layout (10 colours + gold)
const P_SPLIT = 1, P_ANGLE = 2, P_SPEED = 3, P_RADIAL = 4, P_BOUNCE = 5;

/** Blade angle (radians) at time t: shared by sim and renderer. */
export function bladeAngle(blades, k, t) {
  return blades.phase + k * (6.283185307179586 / blades.count) + blades.dir * blades.omega * t;
}

export class OrbitSim {
  constructor(config) {
    const c = config.orbit;
    this.cfg = c;
    this.seed = config.seed >>> 0;
    const n = c.maxBalls;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    this.gen = new Uint16Array(n); this.age = new Uint16Array(n);
    this.immune = new Uint16Array(n); this.col = new Uint8Array(n);
    this.id = new Uint32Array(n);
    this.prevCross = new Float64Array(n * c.blades.count);
    this.count = 0; this.nextId = 0;
    this.frame = 0; this.capFrame = -1; this.outroFrame = -1; this.endFrame = -1;
    this.splits = []; this.flags = 0; this.crushed = 0;
    this.substeps = c.substeps;
    // first ball on a circular orbit
    const a0 = c.startAngle != null ? c.startAngle : rand(this.seed, 0, 0, P_ANGLE) * 6.283185307179586;
    const r0 = c.startRadius;
    const vc = Math.sqrt(this.accel(r0) * r0);
    this.spawn(c.arena.cx + dcos(a0) * r0, c.arena.cy + dsin(a0) * r0, -dsin(a0) * vc * c.dir, dcos(a0) * vc * c.dir, 0, 0);
    this.age[0] = 255;
    this.initCross(0, 0);
  }

  get done() { return this.endFrame >= 0 && this.frame > this.endFrame; }

  accel(d) { const s = this.cfg.softening; return this.cfg.gm / (d * d + s * s); }

  spawn(x, y, vx, vy, gen, immune) {
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.gen[i] = gen; this.age[i] = 0; this.immune[i] = immune;
    this.col[i] = gen % 10; this.id[i] = this.nextId++;
    return i;
  }

  initCross(i, t) {
    const b = this.cfg.blades, { cx, cy } = this.cfg.arena;
    for (let k = 0; k < b.count; k++) {
      const a = bladeAngle(b, k, t);
      this.prevCross[i * b.count + k] = dcos(a) * (this.y[i] - cy) - dsin(a) * (this.x[i] - cx);
    }
  }

  step() {
    const f = this.frame, c = this.cfg, b = c.blades;
    const { cx, cy, r: R } = c.arena;
    const S = this.substeps, h = 1 / (FPS * S);
    const lim = R - c.ballR, hubLim = c.hubR + c.ballR;
    const vmax = c.vmax;
    this.splits = []; this.flags = 0; this.crushed = 0;
    const capped = this.capFrame >= 0;
    const bc = new Float64Array(b.count), bs = new Float64Array(b.count);

    for (let s = 0; s < S; s++) {
      const step = f * S + s;
      const t = (step + 1) * h;
      for (let k = 0; k < b.count; k++) { const a = bladeAngle(b, k, t); bc[k] = dcos(a); bs[k] = dsin(a); }
      // beat accent: blade 0 passes the top (angle crosses -pi/2 mod 2pi)
      const a0p = bladeAngle(b, 0, t - h), a0 = bladeAngle(b, 0, t);
      if (Math.floor((a0p + 1.5707963267948966) / 6.283185307179586) !== Math.floor((a0 + 1.5707963267948966) / 6.283185307179586)) this.flags |= FLAG_BEAT;
      const n = this.count;
      const hits = [];
      for (let i = 0; i < n; i++) {
        let dx = this.x[i] - cx, dy = this.y[i] - cy;
        let d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const g = this.accel(d) / d;
        let vx = this.vx[i] - dx * g * h, vy = this.vy[i] - dy * g * h;   // semi-implicit Euler
        const sp = Math.sqrt(vx * vx + vy * vy);
        if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
        let x = this.x[i] + vx * h, y = this.y[i] + vy * h;
        dx = x - cx; dy = y - cy; d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        if (d > lim) {                                 // rim
          const nx = dx / d, ny = dy / d; x = cx + nx * lim; y = cy + ny * lim;
          const vn = vx * nx + vy * ny; if (vn > 0) { vx -= 2 * vn * nx; vy -= 2 * vn * ny; }
          dx = x - cx; dy = y - cy; d = lim;
        } else if (d < hubLim) {                       // hub
          const nx = dx / d, ny = dy / d; x = cx + nx * hubLim; y = cy + ny * hubLim;
          const vn = vx * nx + vy * ny; if (vn < 0) { vx -= 2 * vn * nx; vy -= 2 * vn * ny; }
          dx = x - cx; dy = y - cy; d = hubLim;
        }
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
        // blade crossings (sign change of the cross product, within the blade's radial span)
        for (let k = 0; k < b.count; k++) {
          const cr = bc[k] * dy - bs[k] * dx;
          const pi = i * b.count + k;
          const prev = this.prevCross[pi];
          this.prevCross[pi] = cr;
          if (this.immune[i] !== 0) continue;
          const radial = bc[k] * dx + bs[k] * dy;
          if (radial < c.hubR || radial > b.length) continue;
          if ((prev < 0 && cr >= 0) || (prev > 0 && cr <= 0)) hits.push(i, k, radial);
        }
      }
      for (let q = 0; q < hits.length; q += 3) {
        const i = hits[q], k = hits[q + 1], radial = hits[q + 2];
        if (this.immune[i] !== 0) continue;
        const p = this.count === 1 ? 1 : splitChance(this.count, t, c.pacing, c.maxBalls);   // the first cut always splits (hook)
        if (!capped && rand(this.seed, this.id[i], step, P_SPLIT) < p && this.count < c.maxBalls) this.split(i, k, step, radial);
        else this.bounce(i, k, radial, step);
      }
    }

    for (let i = 0; i < this.count; i++) {
      if (this.age[i] < 255) this.age[i]++;
      if (this.immune[i] > 0) this.immune[i]--;
    }
    if (this.capFrame < 0 && (this.count >= c.maxBalls || f >= c.safetyCap * FPS)) {
      this.capFrame = f; this.flags |= FLAG_CAP;
      this.outroFrame = f + Math.round(c.finaleHold * FPS);
      this.endFrame = this.outroFrame + Math.round(c.outro * FPS) - 1;
    }
    if (this.capFrame >= 0) {
      const wave = (f - this.capFrame) / FPS * c.goldWaveSpeed, w2 = wave * wave;
      for (let i = 0; i < this.count; i++) {
        if (this.col[i] === GOLD_INDEX) continue;
        const dx = this.x[i] - cx, dy = this.y[i] - cy;
        if (dx * dx + dy * dy <= w2) this.col[i] = GOLD_INDEX;
      }
    }
    if (f === this.outroFrame) this.flags |= FLAG_OUTRO;
    this.frame++;
    return f;
  }

  /** Blade surface velocity at a radial distance (perpendicular to the blade). */
  bladeVel(k, radial) {
    const b = this.cfg.blades;
    return b.dir * b.omega * radial;
  }

  split(i, k, step, radial) {
    const c = this.cfg, room = c.maxBalls - this.count;
    const children = Math.min(c.splitInto - 1, room);
    const g = this.gen[i] + 1;
    const px = this.x[i], py = this.y[i];
    const vx0 = this.vx[i], vy0 = this.vy[i];
    const set = (j, m) => {
      const ang = (rand(this.seed, this.id[j], step, P_ANGLE + m * 8) - 0.5) * 2 * c.childSpread;
      const scale = 0.85 + rand(this.seed, this.id[j], step, P_SPEED + m * 8) * 0.3;
      const ca = dcos(ang), sa = dsin(ang);
      let vx = (vx0 * ca - vy0 * sa) * scale, vy = (vx0 * sa + vy0 * ca) * scale;
      // radial kick spreads children into neighbouring orbits
      const dx = px - c.arena.cx, dy = py - c.arena.cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const kick = (rand(this.seed, this.id[j], step, P_RADIAL + m * 8) - 0.5) * 2 * c.radialKick;
      vx += dx / d * kick; vy += dy / d * kick;
      this.vx[j] = vx; this.vy[j] = vy;
      this.gen[j] = g; this.col[j] = g % 10; this.age[j] = 0; this.immune[j] = c.immuneFrames;
    };
    set(i, 0);
    for (let m = 0; m < children; m++) {
      const j = this.spawn(px, py, 0, 0, g, c.immuneFrames);
      set(j, m + 1);
      // children start with the parent's crossing state so they don't re-trigger
      for (let q = 0; q < c.blades.count; q++) this.prevCross[j * c.blades.count + q] = this.prevCross[i * c.blades.count + q];
    }
    this.splits.push(px, py, g % 10);
    this.crushed++;
  }

  bounce(i, k, radial, step) {
    // A cut that does not split deflects the ball radially and slows it slightly. The orbit direction is kept:
    // reflecting relative to the blade would turn balls into co-rotating riders that are almost never cut again.
    const c = this.cfg, { cx, cy } = c.arena;
    const dx = this.x[i] - cx, dy = this.y[i] - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
    // outward-biased kick and no speed loss: otherwise orbits decay and the swarm clumps around the hub
    const kick = (rand(this.seed, this.id[i], step, P_BOUNCE) - 0.3) * 2.5 * c.radialKick;
    this.vx[i] += dx / d * kick;
    this.vy[i] += dy / d * kick;
    this.immune[i] = Math.max(this.immune[i], 6);
  }

}
