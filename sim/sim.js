// Deterministic fission-chamber simulation. Pure JS, no DOM: runs in a worker or in Node.
// Same seed + same SIM_VERSION => identical frames.
import {
  FPS, SUBSTEPS, ARENA, BALL_R, MAX_BALLS, BASE_SPEED, CHILD_SPEED, SPEED_RELAX,
  IMMUNE_FRAMES, CHILD_SPREAD, PISTON, PALETTE, GOLD, GOLD_WAVE_SPEED, FINALE_HOLD,
  OUTRO, SAFETY_CAP_SECONDS, CRUSH, DRIFT, plateFace,
} from './config.js';
import { splitChance } from '../engine/pacing.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FLAG_HIT_H = 1;
export const FLAG_HIT_V = 2;
export const FLAG_CAP = 4;      // first frame at 10,000
export const FLAG_OUTRO = 8;    // first frame of end card

export class Simulation {
  /**
   * @param seed   uint32
   * @param params optional overrides for later split-chamber versions; defaults are the frozen v1 values
   *               { crush: {floor, boost, knee, squeeze, squeezeN}, finaleHold, outro, safetyCap }
   */
  constructor(seed, params = null) {
    this.p = { crush: CRUSH, finaleHold: FINALE_HOLD, outro: OUTRO, safetyCap: SAFETY_CAP_SECONDS, startSpeed: BASE_SPEED, ...(params || {}) };
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
    const n = MAX_BALLS;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    this.gen = new Uint16Array(n); this.age = new Uint16Array(n);
    this.immune = new Uint16Array(n); this.col = new Uint8Array(n);
    this.count = 0;
    this.frame = 0;          // index of the next frame to produce
    this.capFrame = -1;
    this.outroFrame = -1;
    this.endFrame = -1;
    this.splits = [];        // [x, y, colour] of crushes in the current frame
    this.flags = 0;
    this.crushed = 0;
    const r = this.rand;
    const a = (r() < 0.5 ? 0.5 : 1.5) * Math.PI + (r() - 0.5) * 0.4; // up/down the top-bottom lane
    this.spawn(ARENA.cx + (r() - 0.5) * 40, ARENA.cy + (r() - 0.5) * 80,
      Math.cos(a) * this.p.startSpeed, Math.sin(a) * this.p.startSpeed, 0, 0);
    this.age[0] = 255;
    this.prevFace = [plateFace(0, 0), plateFace(1, 0)];
  }

  spawn(x, y, vx, vy, gen, immune) {
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.gen[i] = gen; this.age[i] = 0; this.immune[i] = immune;
    this.col[i] = gen % PALETTE.length;
    return i;
  }

  get done() { return this.endFrame >= 0 && this.frame > this.endFrame; }

  /** Advance one video frame. Returns frame index just produced. */
  step() {
    const f = this.frame;
    this.splits = [];
    this.flags = 0;
    this.crushed = 0;
    const h = 1 / (FPS * SUBSTEPS);
    const { cx, cy, r: R } = ARENA;
    const r = BALL_R;
    const lim = R - r;
    const L = PISTON.halfLen, TH = PISTON.thick;
    const capped = this.capFrame >= 0;
    const sq = this.p.crush.squeeze * Math.min(1, this.count / this.p.crush.squeezeN);

    for (let s = 0; s < SUBSTEPS; s++) {
      const t = (f * SUBSTEPS + s + 1) * h;
      const dH = plateFace(0, t), dV = plateFace(1, t);
      const vH = (dH - this.prevFace[0]) / h; // + = retracting
      const vV = (dV - this.prevFace[1]) / h;
      if (this.prevFace[0] >= r && dH < r) this.flags |= FLAG_HIT_H;
      if (this.prevFace[1] >= r && dV < r) this.flags |= FLAG_HIT_V;
      this.prevFace[0] = dH; this.prevFace[1] = dV;
      const n = this.count;
      const crush = [];
      for (let i = 0; i < n; i++) {
        let x = this.x[i] + this.vx[i] * h;
        let y = this.y[i] + this.vy[i] * h;
        let vx = this.vx[i], vy = this.vy[i];
        // rim
        let dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > lim * lim) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          x = cx + nx * lim; y = cy + ny * lim;
          const vn = vx * nx + vy * ny;
          if (vn > 0) { vx -= 2 * vn * nx; vy -= 2 * vn * ny; }
          dx = x - cx; dy = y - cy;
        }
        if (this.immune[i] === 0) {
          // left/right plates (move along x); lane is |dy| < L
          if (Math.abs(dy) < L + r * 0.6) {
            pushPair(dx, vx, dH, -vH, r, TH);
            dx = _p; vx = _v; x = cx + dx;
            if (_hit && vH < 0 && sq > 0) vy = squeeze(vy, dy, -vH * sq, this.rand);
            if (dH < r && Math.abs(dx) < r + dH && !capped) crush.push(i, 0);
            else if (dH < r && Math.abs(dx) < r + dH) { this.eject(i, 0); vx = this.vx[i]; vy = this.vy[i]; }
          }
          // top/bottom plates (move along y); lane is |dx| < L
          if (Math.abs(dx) < L + r * 0.6) {
            pushPair(dy, vy, dV, -vV, r, TH);
            dy = _p; vy = _v; y = cy + dy;
            if (_hit && vV < 0 && sq > 0) vx = squeeze(vx, dx, -vV * sq, this.rand);
            if (dV < r && Math.abs(dy) < r + dV && !capped) crush.push(i, 1);
            else if (dV < r && Math.abs(dy) < r + dV) { this.eject(i, 1); vx = this.vx[i]; vy = this.vy[i]; }
          }
        }
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      }
      // process crushes (dedupe: a ball might be listed by both pairs)
      for (let k = 0; k < crush.length; k += 2) {
        const i = crush[k];
        if (this.immune[i] !== 0) continue;
        if (this.capFrame >= 0 || this.rand() > this.chance(f)) { this.eject(i, crush[k + 1]); continue; }
        this.split(i, crush[k + 1], f);
      }
    }

    // velocity relaxation, ageing
    const relax = SPEED_RELAX / FPS;
    const rnd = this.rand;
    for (let i = 0; i < this.count; i++) {
      const vx = this.vx[i], vy = this.vy[i];
      const sp = Math.sqrt(vx * vx + vy * vy) || 1;
      const k = 1 + (BASE_SPEED / sp - 1) * relax;
      // small random heading drift keeps the swarm chaotic (no coherent bands)
      const th = (rnd() - 0.5) * 2 * DRIFT;
      const c = Math.cos(th) * k, sn = Math.sin(th) * k;
      this.vx[i] = vx * c - vy * sn; this.vy[i] = vx * sn + vy * c;
      if (this.age[i] < 255) this.age[i]++;
      if (this.immune[i] > 0) this.immune[i]--;
    }

    // finale
    if (this.capFrame < 0 && (this.count >= MAX_BALLS || f >= this.p.safetyCap * FPS)) {
      this.capFrame = f;
      this.flags |= FLAG_CAP;
      this.outroFrame = f + Math.round(this.p.finaleHold * FPS);
      this.endFrame = this.outroFrame + Math.round(this.p.outro * FPS) - 1;
    }
    if (this.capFrame >= 0) {
      const wave = (f - this.capFrame) / FPS * GOLD_WAVE_SPEED;
      const w2 = wave * wave;
      for (let i = 0; i < this.count; i++) {
        if (this.col[i] === GOLD) continue;
        const dx = this.x[i] - cx, dy = this.y[i] - cy;
        if (dx * dx + dy * dy <= w2) this.col[i] = GOLD;
      }
    }
    if (f === this.outroFrame) this.flags |= FLAG_OUTRO;
    this.frame++;
    return f;
  }

  /** Split probability: v1 count schedule, or the pacing controller when params.pacing is set (@2+). */
  chance(f) {
    return this.p.pacing ? splitChance(this.count, (f + 1) / FPS, this.p.pacing, MAX_BALLS) : crushChance(this.count, this.p.crush);
  }

  split(i, pair, f) {
    const room = MAX_BALLS - this.count;
    const children = Math.min(2, room); // parent becomes one of the 3
    const g = this.gen[i] + 1;
    const rnd = this.rand;
    const { cx, cy } = ARENA;
    // collapse onto the contact line
    if (pair === 0) this.x[i] = cx + (rnd() - 0.5) * 4; else this.y[i] = cy + (rnd() - 0.5) * 4;
    const px = this.x[i], py = this.y[i];
    const base = pair === 0 ? Math.PI / 2 : 0; // escape along the plate's long axis
    const dirs = [1, -1, rnd() < 0.5 ? 1 : -1];
    const set = (j, k) => {
      const a = base + (dirs[k] < 0 ? Math.PI : 0) + (rnd() - 0.5) * 2 * CHILD_SPREAD;
      const sp = CHILD_SPEED * (0.85 + rnd() * 0.3);
      this.vx[j] = Math.cos(a) * sp; this.vy[j] = Math.sin(a) * sp;
      this.gen[j] = g; this.col[j] = g % PALETTE.length;
      this.age[j] = 0; this.immune[j] = IMMUNE_FRAMES;
    };
    set(i, 0);
    for (let k = 0; k < children; k++) {
      const j = this.spawn(px, py, 0, 0, g, IMMUNE_FRAMES);
      set(j, k + 1);
    }
    this.splits.push(px, py, g % PALETTE.length);
    this.crushed++;
  }

  eject(i, pair) {
    // squeezed out without splitting: fly off along the plate's long axis with a wide spread so the
    // swarm fills the arena instead of ping-ponging inside the presses' cross
    const rnd = this.rand;
    const base = (pair === 0 ? Math.PI / 2 : 0) + (rnd() < 0.5 ? 0 : Math.PI);
    const a = base + (rnd() - 0.5) * 2 * CHILD_SPREAD;
    const sp = CHILD_SPEED * (0.8 + rnd() * 0.4);
    this.vx[i] = Math.cos(a) * sp; this.vy[i] = Math.sin(a) * sp;
    this.immune[i] = IMMUNE_FRAMES;
  }
}

/**
 * Collide a ball (1-D coordinate p relative to centre, velocity v) with a symmetric plate pair whose
 * faces sit at +-d and move with face velocity fv (+ = toward centre for the positive plate).
 */
/** Probability that a ball caught between closed plates fissions (otherwise it squirts out sideways). */
export function crushChance(n, crush = CRUSH) { return Math.min(1, crush.floor + crush.boost / (1 + n / crush.knee)); }

let _p = 0, _v = 0, _hit = false; // outputs of pushPair (avoids per-call allocation)

/** A ball pressed by a closing plate squirts sideways toward the nearer plate edge. */
function squeeze(vl, lat, close, rand) {
  const dir = lat > 2 ? 1 : lat < -2 ? -1 : (rand() < 0.5 ? -1 : 1);
  const want = close * (0.6 + 0.8 * Math.min(1, Math.abs(lat) / PISTON.halfLen));
  return dir * vl >= want ? vl : dir * Math.min(want, VMAX);
}
const REST = 0.35;   // restitution relative to the moving plate
const VMAX = 3000;   // keeps per-substep travel well below plate thickness
function bounce(v, pv) { v = pv - (v - pv) * REST; return v > VMAX ? VMAX : v < -VMAX ? -VMAX : v; }
function pushPair(p, v, d, close, r, th) {
  _hit = false;
  // close > 0 when the plates move toward the centre; the +side plate then has velocity -close.
  // Only the front face collides: on the way back a plate slides over balls behind it (they are hidden
  // under the piston) instead of pinning them against the rim.
  if (p >= 0) {
    const face = d, pv = -close;
    if (p - r < face + th && p + r > face) { p = face - r; _hit = true; if (v > pv) v = bounce(v, pv); }
  } else {
    const face = -d, pv = close;
    if (p + r > face - th && p - r < face) { p = face + r; _hit = true; if (v < pv) v = bounce(v, pv); }
  }
  _p = p; _v = v;
}
