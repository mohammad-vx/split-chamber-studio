// Machines engine (Packed v2, generic kinematic parts). Same physics as src/engine/packed.js (left untouched so
// rotary-sweeper@1 stays bit-exact), generalised to any number of scripted parts:
//   capsule: segment [u0,u1] along a direction from a pivot, thickness `thick`
//   poly:    convex polygon in local coordinates
//   circle:  disc of radius `r` at a local point (pendulum heads)
// Each part has a pose(t) = translation + rotation about its pivot, built from motion primitives that are pure
// functions of time (shared with the renderer): rotate, oscillate (angle), slide (translation), swing
// (pendulum with escalating speed). Determinism: basic IEEE ops + dsin/dcos, counter RNG, fixed order.
import { FPS, H } from '../core/constants.js';
import { dsin, dcos } from './dmath.js';
import { rand } from './rng.js';
import { splitChance } from './pacing.js';
import { FLAG_CAP, FLAG_OUTRO } from '../sim/sim.js';

export const FLAG_BEAT = 16, FLAG_BREAK = 32, FLAG_SMASH = 64;
export const GOLD_INDEX = 10;
const TAU = 6.283185307179586;
const P_SPLIT = 21, P_OFFSET = 22, P_EJECT = 23;

/** Phase (radians) of a periodic motion whose frequency rises linearly: f(t) = f0 (1 + k t). */
function phaseOf(m, t) { return TAU * (t / m.period + (m.speedUp || 0) * t * t / (2 * m.period)) + (m.phase || 0); }

/** Pose of a part at time t: { x, y, a } (pivot position + rotation). Pure; shared with the renderer. */
export function partPose(p, t) {
  let x = p.pivot[0], y = p.pivot[1], a = p.angle || 0;
  const m = p.motion || {};
  if (m.rotate) a += m.rotate.dir * m.rotate.omega * t + (m.rotate.accel || 0) * t * t / 2;
  if (m.oscillate) { const o = m.oscillate; a += o.amp * dsin(phaseOf(o, t)); }
  if (m.swing) { const o = m.swing; a += o.amp * dsin(phaseOf(o, t)); }
  if (m.slide) {
    const o = m.slide; const s = o.amp * (o.square ? squareish(phaseOf(o, t)) : dsin(phaseOf(o, t)));
    x += o.axis[0] * s; y += o.axis[1] * s;
  }
  if (m.radial) {                                  // move along the part's own outward direction (contraction)
    const o = m.radial, s = o.amp * (0.5 - 0.5 * dcos(phaseOf(o, t)));   // 0 → amp → 0
    x += o.dir[0] * s; y += o.dir[1] * s;
  }
  return { x, y, a };
}
// smooth "press" profile: dwell open, close fast, dwell, open (keeps velocities bounded)
function squareish(ph) { const s = dsin(ph); return s * (1.5 - 0.5 * s * s); }

/** World geometry of a part at pose. */
export function partGeometry(p, pose) {
  const c = dcos(pose.a), s = dsin(pose.a);
  const W = (lx, ly) => [pose.x + lx * c - ly * s, pose.y + lx * s + ly * c];
  if (p.type === 'capsule') return { a: W(p.u0, 0), b: W(p.u1, 0), thick: p.thick };
  if (p.type === 'circle') return { c: W(p.at[0], p.at[1]), r: p.r };
  return { pts: p.pts.map(([lx, ly]) => W(lx, ly)) };
}

export class MachineSim {
  constructor(config) {
    const c = config.machine;
    this.cfg = c;
    this.seed = config.seed >>> 0;
    const n = c.maxBalls + 64;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    this.gen = new Uint16Array(n); this.age = new Uint16Array(n);
    this.immune = new Uint16Array(n); this.col = new Uint8Array(n);
    this.id = new Uint32Array(n); this.pinch = new Uint8Array(n);
    this.side = new Int8Array(n * Math.max(1, c.parts.length));
    this.count = 0; this.nextId = 0;
    this.frame = 0; this.capFrame = -1; this.breakFrame = -1; this.outroFrame = -1; this.endFrame = -1;
    this.splits = []; this.flags = 0; this.crushed = 0; this.peak = 0;
    const cs = 2 * c.ballR; this.cs = cs;
    this.gx0 = c.arena.cx - c.arena.r - cs; this.gy0 = c.arena.cy - c.arena.r - cs;
    this.gw = Math.ceil((2 * c.arena.r + 2 * cs) / cs); this.gh = this.gw;
    this.cellStart = new Int32Array(this.gw * this.gh + 1);
    this.cellFill = new Int32Array(this.gw * this.gh);
    this.cellItems = new Int32Array(n); this.cellOf = new Int32Array(n);
    this.cosGap = dcos(c.ending.gapHalf || 0.5);
    this.closeN = new Float64Array(n * 2); this.otherN = new Float64Array(n * 2);
    this.cflags = new Uint8Array(n); this.closeV = new Float64Array(n);
    this.nb = new Int32Array(n); this.nbD = new Float64Array(n);
    this.geo = c.parts.map(() => null); this.prevGeo = c.parts.map(() => null);
    this.updateParts(0);
    this.prevGeo = this.geo.slice();
    const [sx, sy] = c.start;
    this.spawn(sx, sy, 0, 0, 0);
    this.age[0] = 255;
    this.initSides(0);
  }

  get done() { return this.endFrame >= 0 && this.frame > this.endFrame; }

  updateParts(t) {
    this.cfg.parts.forEach((p, k) => {
      const pose = partPose(p, t);
      const g = partGeometry(p, pose);
      g.pose = pose;
      if (g.pts) {                                    // outward edge normals
        const m = g.pts.length; let mx = 0, my = 0; for (const [x, y] of g.pts) { mx += x; my += y; } mx /= m; my /= m;
        g.edges = [];
        for (let e = 0; e < m; e++) {
          const [ax, ay] = g.pts[e], [bx, by] = g.pts[(e + 1) % m];
          let nx = by - ay, ny = -(bx - ax); const l = Math.sqrt(nx * nx + ny * ny); nx /= l; ny /= l;
          let d = nx * ax + ny * ay; if (nx * mx + ny * my - d > 0) { nx = -nx; ny = -ny; d = -d; }
          g.edges.push({ ax, ay, bx, by, nx, ny, d });
        }
      }
      this.geo[k] = g;
    });
  }

  /** Velocity of the material point of part k at (x, y) over the last substep. */
  pointVel(k, x, y, h) {
    const g = this.geo[k], pg = this.prevGeo[k];
    if (!pg) return [0, 0];
    const da = g.pose.a - pg.pose.a;
    // rigid motion: translation of the pivot + rotation about it
    const vx = (g.pose.x - pg.pose.x) / h - da / h * (y - g.pose.y);
    const vy = (g.pose.y - pg.pose.y) / h + da / h * (x - g.pose.x);
    return [vx, vy];
  }

  initSides(i) {
    this.cfg.parts.forEach((p, k) => {
      if (p.type !== 'capsule') return;
      const g = this.geo[k], ex = g.b[0] - g.a[0], ey = g.b[1] - g.a[1];
      this.side[i * this.cfg.parts.length + k] = ex * (this.y[i] - g.a[1]) - ey * (this.x[i] - g.a[0]) >= 0 ? 1 : -1;
    });
  }

  spawn(x, y, vx, vy, gen) {
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.gen[i] = gen; this.age[i] = 0; this.immune[i] = 0; this.col[i] = gen % 10;
    this.id[i] = this.nextId++; this.pinch[i] = 0;
    if (this.count > this.peak) this.peak = this.count;
    return i;
  }

  buildGrid() {
    const n = this.count, gw = this.gw, gh = this.gh, cs = this.cs, cnt = this.cellStart;
    cnt.fill(0);
    for (let i = 0; i < n; i++) {
      let gx = Math.floor((this.x[i] - this.gx0) / cs), gy = Math.floor((this.y[i] - this.gy0) / cs);
      gx = gx < 0 ? 0 : gx >= gw ? gw - 1 : gx; gy = gy < 0 ? 0 : gy >= gh ? gh - 1 : gy;
      const c = gy * gw + gx; this.cellOf[i] = c; cnt[c + 1]++;
    }
    for (let c = 0; c < gw * gh; c++) cnt[c + 1] += cnt[c];
    this.cellFill.fill(0);
    for (let i = 0; i < n; i++) { const c = this.cellOf[i]; this.cellItems[cnt[c] + this.cellFill[c]++] = i; }
  }

  /** Record a contact on ball i: closing kinematic contact or other (wall/static/non-closing). */
  contact(i, nx, ny, closing) {
    if (closing > this.cfg.vPinch) {
      if (this.cflags[i] & 1) {
        // a second closing surface: if it opposes the first, the ball is squeezed between two moving parts
        const ox = this.closeN[2 * i], oy = this.closeN[2 * i + 1];
        if (ox * nx + oy * ny < -0.5) {
          if (closing > this.closeV[i]) { this.otherN[2 * i] = ox; this.otherN[2 * i + 1] = oy; this.closeV[i] = closing; this.closeN[2 * i] = nx; this.closeN[2 * i + 1] = ny; }
          else { this.otherN[2 * i] = nx; this.otherN[2 * i + 1] = ny; }
          this.cflags[i] |= 2;
          return;
        }
      }
      if (closing > this.closeV[i]) { this.closeV[i] = closing; this.closeN[2 * i] = nx; this.closeN[2 * i + 1] = ny; }
      this.cflags[i] |= 1;
    } else { this.otherN[2 * i] = nx; this.otherN[2 * i + 1] = ny; this.cflags[i] |= 2; }
  }

  step() {
    const f = this.frame, c = this.cfg, parts = c.parts, P = parts.length;
    const { cx, cy, r: R } = c.arena;
    const S = c.substeps, h = 1 / (FPS * S);
    const r = c.ballR, d2 = 2 * r, lim = R - r;
    const broken = this.breakFrame >= 0;
    const g = broken ? (c.ending.gravity || 1400) : this.count > 1 ? c.gravity : 0;
    this.splits = []; this.flags = 0; this.crushed = 0;

    for (let s = 0; s < S; s++) {
      const step = f * S + s, t = (step + 1) * h;
      this.prevGeo = this.geo.slice();
      this.updateParts(t);
      if (c.beatPart != null) {                      // accent when the beat part crosses its reference phase
        const p = parts[c.beatPart], m = p.motion.swing || p.motion.oscillate || p.motion.slide || p.motion.radial;
        if (m && Math.floor(phaseOf(m, t - h) / Math.PI) !== Math.floor(phaseOf(m, t) / Math.PI)) this.flags |= FLAG_BEAT;
      }
      const n = this.count;
      for (let i = 0; i < n; i++) {
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
        this.vy[i] += g * h;
        this.x[i] += this.vx[i] * h; this.y[i] += this.vy[i] * h;
        this.cflags[i] = 0; this.closeV[i] = 0; this.nb[i] = -1; this.nbD[i] = 0;
      }
      this.buildGrid();
      const gw = this.gw, gh = this.gh, cst = this.cellStart, items = this.cellItems;
      const forward = (step & 1) === 0;
      for (let q = 0; q < n; q++) {
        const i = forward ? q : n - 1 - q;
        const ci = this.cellOf[i], gxi = ci % gw, gyi = (ci - gxi) / gw;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = gyi + oy; if (yy < 0 || yy >= gh) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = gxi + ox; if (xx < 0 || xx >= gw) continue;
            const cc = yy * gw + xx;
            for (let p = cst[cc]; p < cst[cc + 1]; p++) {
              const j = items[p];
              if (forward ? j <= i : j >= i) continue;
              let dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i];
              const dd = dx * dx + dy * dy;
              if (dd >= d2 * d2 || dd === 0) continue;
              const d = Math.sqrt(dd);
              let corr = (d2 - d) * 0.5;
              if (this.age[i] < 10 || this.age[j] < 10) corr = corr > c.softCorr ? c.softCorr : corr;
              dx /= d; dy /= d;
              if (d2 - d > this.nbD[i]) { this.nbD[i] = d2 - d; this.nb[i] = j; }
              if (d2 - d > this.nbD[j]) { this.nbD[j] = d2 - d; this.nb[j] = i; }
              this.x[i] -= dx * corr; this.y[i] -= dy * corr; this.x[j] += dx * corr; this.y[j] += dy * corr;
            }
          }
        }
      }
      for (let i = 0; i < n; i++) {
        let x = this.x[i], y = this.y[i];
        for (let k = 0; k < P; k++) {
          const part = parts[k], G = this.geo[k];
          if (part.type === 'capsule') {
            const ax = G.a[0], ay = G.a[1], ex = G.b[0] - ax, ey = G.b[1] - ay, L2 = ex * ex + ey * ey, L = Math.sqrt(L2);
            const ux = ex / L, uy = ey / L, rr = G.thick + r;
            const u = (x - ax) * ux + (y - ay) * uy, cr = ux * (y - ay) - uy * (x - ax);
            const si = i * P + k;
            if (u < -rr || u > L + rr) { this.side[si] = cr >= 0 ? 1 : -1; continue; }
            const uc = u < 0 ? 0 : u > L ? L : u;
            const qx = ax + ux * uc, qy = ay + uy * uc;
            const dx = x - qx, dy = y - qy, d = Math.sqrt(dx * dx + dy * dy);
            const remembered = this.side[si] || (cr >= 0 ? 1 : -1), nowSide = cr >= 0 ? 1 : -1;
            if (d >= rr && nowSide === remembered) continue;
            let nx, ny;
            if (u > 0 && u < L) { nx = -uy * remembered; ny = ux * remembered; }
            else if (d > 1e-9 && nowSide === remembered) { nx = dx / d; ny = dy / d; }
            else { nx = -uy * remembered; ny = ux * remembered; }
            const along = (x - qx) * nx + (y - qy) * ny;
            if (along < rr) { x += nx * (rr - along); y += ny * (rr - along); }
            const [vpx, vpy] = this.pointVel(k, qx, qy, h);
            this.contact(i, nx, ny, vpx * nx + vpy * ny);
          } else if (part.type === 'circle') {
            const dx = x - G.c[0], dy = y - G.c[1], d = Math.sqrt(dx * dx + dy * dy), rr = G.r + r;
            if (d >= rr || d < 1e-9) continue;
            const nx = dx / d, ny = dy / d;
            x = G.c[0] + nx * rr; y = G.c[1] + ny * rr;
            const [vpx, vpy] = this.pointVel(k, G.c[0] + nx * G.r, G.c[1] + ny * G.r, h);
            this.contact(i, nx, ny, vpx * nx + vpy * ny);
          } else {
            let sd = -Infinity, en = null;
            for (const e of G.edges) { const v = e.nx * x + e.ny * y - e.d; if (v > sd) { sd = v; en = e; } }
            if (sd >= r) continue;
            let nx, ny, pen;
            if (sd < 0) { nx = en.nx; ny = en.ny; pen = r - sd; }
            else {
              let best = Infinity, qx = 0, qy = 0;
              for (const e of G.edges) {
                const ex = e.bx - e.ax, ey = e.by - e.ay; let u = ((x - e.ax) * ex + (y - e.ay) * ey) / (ex * ex + ey * ey);
                u = u < 0 ? 0 : u > 1 ? 1 : u;
                const qqx = e.ax + ex * u, qqy = e.ay + ey * u, dd = (x - qqx) * (x - qqx) + (y - qqy) * (y - qqy);
                if (dd < best) { best = dd; qx = qqx; qy = qqy; }
              }
              const d = Math.sqrt(best); if (d >= r) continue;
              nx = (x - qx) / (d || 1); ny = (y - qy) / (d || 1); pen = r - d;
            }
            x += nx * pen; y += ny * pen;
            const [vpx, vpy] = part.static ? [0, 0] : this.pointVel(k, x - nx * r, y - ny * r, h);
            this.contact(i, nx, ny, vpx * nx + vpy * ny);
          }
        }
        { // hub (optional) and arena rim
          if (c.hubR) { const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) || 1e-9, hl = c.hubR + r;
            if (d < hl) { const nx = dx / d, ny = dy / d; x = cx + nx * hl; y = cy + ny * hl; this.contact(i, nx, ny, 0); } }
          const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
          if (dd > lim * lim) {
            const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
            const inGap = broken && ny > this.cosGap;
            if (!broken || (!inGap && d < R + 2 * r)) { x = cx + nx * lim; y = cy + ny * lim; this.contact(i, -nx, -ny, 0); }
          }
        }
        this.x[i] = x; this.y[i] = y;
        for (let k = 0; k < P; k++) {
          if (parts[k].type !== 'capsule') continue;
          const G = this.geo[k], ex = G.b[0] - G.a[0], ey = G.b[1] - G.a[1], L = Math.sqrt(ex * ex + ey * ey);
          const cr = (ex * (y - G.a[1]) - ey * (x - G.a[0])) / L;
          if (Math.abs(cr) > (G.thick + r) * 0.5) this.side[i * P + k] = cr >= 0 ? 1 : -1;
        }
      }
      const vmax = c.vmax;
      for (let i = 0; i < n; i++) {
        let vx = (this.x[i] - this.px[i]) / h * c.damping, vy = (this.y[i] - this.py[i]) / h * c.damping;
        const sp = Math.sqrt(vx * vx + vy * vy); if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
        this.vx[i] = vx; this.vy[i] = vy;
      }
      const capped = this.capFrame >= 0;
      const contactRule = c.pinchRule === 'contact';
      for (let i = 0; i < n; i++) {
        const fl = this.cflags[i];
        let squeezed = false, wall = 0;
        if ((fl & 1) && this.immune[i] === 0) {
          const ax = this.closeN[2 * i], ay = this.closeN[2 * i + 1];
          if ((fl & 2) && ax * this.otherN[2 * i] + ay * this.otherN[2 * i + 1] < -0.5) { squeezed = true; wall = 1; }
          else if (contactRule) { if (this.nbD[i] > c.pileSqueeze * r) squeezed = true; }   // v2: piles only eject
          else if (this.nbD[i] > c.pileSqueeze * r) squeezed = true;
          else {
            const j = this.nb[i];
            if (j >= 0 && (this.cflags[j] & 2) && this.nbD[i] > 0.05 * r) {
              const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i], dd = Math.sqrt(dx * dx + dy * dy) || 1;
              if ((ax * dx + ay * dy) / dd > 0.5 && ax * this.otherN[2 * j] + ay * this.otherN[2 * j + 1] < -0.5) squeezed = true;
            }
          }
        }
        if (squeezed) this.pinch[i]++; else this.pinch[i] = 0;
        // hook rule: the very first ball splits as soon as a moving part strikes it
        if (this.count === 1 && (fl & 1) && this.immune[i] === 0) this.pinch[i] = 2;
        if (contactRule && wall && this.immune[i] === 0) this.pinch[i] = 2;
        if (this.pinch[i] >= 2) {
          this.pinch[i] = 0;
          if (contactRule) {                                        // v2: a real pinch always splits, a pile push never does
            if ((wall || this.count === 1) && !capped && this.count < c.maxBalls) { this.split(i, step); this.flags |= FLAG_SMASH; }
            else this.eject(i, step);
            continue;
          }
          const p = this.count === 1 ? 1 : splitChance(this.count, t, c.pacing, c.maxBalls);
          if (!capped && this.count < c.maxBalls && rand(this.seed, this.id[i], step, P_SPLIT) < p) { this.split(i, step); this.flags |= FLAG_SMASH; }
          else this.eject(i, step);
        }
      }
    }

    for (let i = 0; i < this.count; i++) { if (this.age[i] < 255) this.age[i]++; if (this.immune[i] > 0) this.immune[i]--; }
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.y[i] > H + 80) { const last = --this.count; if (i !== last) this.move(last, i); }
    }
    if (this.capFrame < 0 && (this.count >= c.maxBalls || f >= c.safetyCap * FPS)) {
      this.capFrame = f; this.flags |= FLAG_CAP;
      const brk = c.ending.type === 'rim-break';
      this.breakFrame = brk ? f + Math.round(c.finaleHold * FPS) : -1;
      this.outroFrame = f + Math.round(c.finaleHold * FPS) + (brk ? Math.round(c.ending.duration * FPS) : 0);
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
    if (f === this.breakFrame) this.flags |= FLAG_BREAK;
    if (f === this.outroFrame) this.flags |= FLAG_OUTRO;
    this.frame++;
    return f;
  }

  move(from, to) {
    for (const a of [this.x, this.y, this.px, this.py, this.vx, this.vy, this.gen, this.age, this.immune, this.col, this.id, this.pinch]) a[to] = a[from];
    const P = this.cfg.parts.length;
    for (let q = 0; q < P; q++) this.side[to * P + q] = this.side[from * P + q];
  }

  split(i, step) {
    const c = this.cfg, children = Math.min(c.splitInto - 1, c.maxBalls - this.count);
    const g = this.gen[i] + 1, r = c.ballR;
    const fx = -this.closeN[2 * i + 1], fy = this.closeN[2 * i];       // free direction ⟂ squeeze
    this.gen[i] = g; this.col[i] = g % 10; this.age[i] = 0; this.immune[i] = c.immuneFrames;
    const P = c.parts.length;
    for (let m = 0; m < children; m++) {
      const sgn = m === 0 ? 1 : -1, off = r * (0.5 + 0.3 * rand(this.seed, this.id[i], step, P_OFFSET + m));
      const j = this.spawn(this.x[i] + fx * off * sgn, this.y[i] + fy * off * sgn, this.vx[i], this.vy[i], g);
      this.immune[j] = c.immuneFrames;
      for (let q = 0; q < P; q++) this.side[j * P + q] = this.side[i * P + q];
    }
    this.splits.push(this.x[i], this.y[i], g % 10);
    this.crushed++;
  }

  eject(i, step) {
    const c = this.cfg, fx = -this.closeN[2 * i + 1], fy = this.closeN[2 * i];
    const sgn = rand(this.seed, this.id[i], step, P_EJECT) < 0.5 ? -1 : 1;
    this.vx[i] += fx * sgn * c.ejectSpeed; this.vy[i] += fy * sgn * c.ejectSpeed;
    this.immune[i] = c.immuneFrames;
  }
}
