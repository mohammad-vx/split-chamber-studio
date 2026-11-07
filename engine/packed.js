// Packed engine (ARCHITECTURE §4.3–4.4, review findings phys B2/B3/M1/M2): equal-radius balls that collide
// and stack, optional gravity, scripted rotating arms (capsules) sweeping past static wedges (convex polygons)
// inside a circular arena with a breakable rim.
// - Small-step position-based dynamics: S substeps × 1 iteration, alternating sweep direction (symmetry).
// - Ball–arm contacts remember which side of the arm the ball was on (no tunnelling through thin arms).
// - Pinch = contact with a closing arm + an opposing contact (static surface or another arm), with residual
//   overlap, sustained for ≥ 2 substeps. Pinched balls split (pacing controller) or squirt out.
// - Newborn balls separate softly (correction clamp) so splits never explode the pile.
// Determinism: IEEE basic ops + dsin/dcos only; counter RNG; fixed iteration order.
import { FPS, H } from '../core/constants.js';
import { dsin, dcos } from './dmath.js';
import { rand } from './rng.js';
import { splitChance } from './pacing.js';
import { FLAG_CAP, FLAG_OUTRO } from '../sim/sim.js';

export const FLAG_SWEEP = 16;   // arm 0 passed the top (beat accent)
export const FLAG_BREAK = 32;   // rim broke (ending)
export const GOLD_INDEX = 10;
const P_SPLIT = 11, P_OFFSET = 12, P_EJECT = 13;

/** Arm angle at time t (shared by sim and renderer). */
export function armAngle(arms, k, t) {
  return arms.phase + k * (6.283185307179586 / arms.count) + arms.dir * arms.omega * t;
}

export class PackedSim {
  constructor(config) {
    const c = config.packed;
    this.cfg = c;
    this.seed = config.seed >>> 0;
    const n = c.maxBalls + 64;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n);
    this.gen = new Uint16Array(n); this.age = new Uint16Array(n);
    this.immune = new Uint16Array(n); this.col = new Uint8Array(n);
    this.id = new Uint32Array(n); this.pinch = new Uint8Array(n);
    this.side = new Int8Array(n * c.arms.count);
    this.count = 0; this.nextId = 0;
    this.frame = 0; this.capFrame = -1; this.breakFrame = -1; this.outroFrame = -1; this.endFrame = -1;
    this.splits = []; this.flags = 0; this.crushed = 0; this.peak = 0;
    // grid over the arena bounding box (+ margin); out-of-box balls clamp to border cells
    const cs = 2 * c.ballR;
    this.cs = cs;
    this.gx0 = c.arena.cx - c.arena.r - cs; this.gy0 = c.arena.cy - c.arena.r - cs;
    this.gw = Math.ceil((2 * c.arena.r + 2 * cs) / cs); this.gh = this.gw;
    this.cellStart = new Int32Array(this.gw * this.gh + 1);
    this.cellItems = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.cosGap = dcos(c.ending.gapHalf);
    // wedge edge normals (outward) precomputed
    this.wedges = c.wedges.map((poly) => {
      const m = poly.length, edges = [];
      for (let k = 0; k < m; k++) {
        const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % m];
        let nx = by - ay, ny = -(bx - ax); const l = Math.sqrt(nx * nx + ny * ny); nx /= l; ny /= l;
        edges.push({ ax, ay, bx, by, nx, ny, d: nx * ax + ny * ay });
      }
      return edges;
    });
    // ensure outward normals (polygon may be either winding): flip if centroid is on the positive side
    this.wedges.forEach((edges, wi) => {
      const poly = c.wedges[wi]; let mx = 0, my = 0; for (const [x, y] of poly) { mx += x; my += y; } mx /= poly.length; my /= poly.length;
      for (const e of edges) if (e.nx * mx + e.ny * my - e.d > 0) { e.nx = -e.nx; e.ny = -e.ny; e.d = -e.d; }
    });
    // first ball: just ahead of arm 0, half-way out, at rest (falls/drifts into the first sweep → hook)
    const a0 = armAngle(c.arms, 0, 0) + c.arms.dir * 0.35, r0 = c.startRadius;
    this.spawn(c.arena.cx + dcos(a0) * r0, c.arena.cy + dsin(a0) * r0, 0, 0, 0);
    this.age[0] = 255;
    this.initSides(0, 0);
  }

  get done() { return this.endFrame >= 0 && this.frame > this.endFrame; }

  spawn(x, y, vx, vy, gen) {
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.gen[i] = gen; this.age[i] = 0; this.immune[i] = 0; this.col[i] = gen % 10;
    this.id[i] = this.nextId++; this.pinch[i] = 0;
    if (this.count > this.peak) this.peak = this.count;
    return i;
  }

  initSides(i, t) {
    const a = this.cfg.arms, { cx, cy } = this.cfg.arena;
    for (let k = 0; k < a.count; k++) {
      const ang = armAngle(a, k, t);
      const cr = dcos(ang) * (this.y[i] - cy) - dsin(ang) * (this.x[i] - cx);
      this.side[i * a.count + k] = cr >= 0 ? 1 : -1;
    }
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
    const fill = this.cellFill || (this.cellFill = new Int32Array(gw * gh));
    fill.fill(0);
    for (let i = 0; i < n; i++) { const c = this.cellOf[i]; this.cellItems[cnt[c] + fill[c]++] = i; }
  }

  step() {
    const f = this.frame, c = this.cfg, A = c.arms;
    const { cx, cy, r: R } = c.arena;
    const S = c.substeps, h = 1 / (FPS * S);
    const r = c.ballR, d2 = 2 * r, lim = R - r, rc = A.thick, armR = rc + r;
    const broken = this.breakFrame >= 0;
    // gravity switches on after the first split, so the first ball stays in the arm's path (fast hook)
    const g = broken ? c.ending.gravity : this.count > 1 ? c.gravity : 0;
    this.splits = []; this.flags = 0; this.crushed = 0;
    const ac = new Float64Array(A.count), as = new Float64Array(A.count);
    // per-substep contact bookkeeping
    const n0max = this.x.length;
    const armN = this.armNx || (this.armNx = new Float64Array(n0max * 2));
    const statN = this.statNx || (this.statNx = new Float64Array(n0max * 2));
    const flagsC = this.cflags || (this.cflags = new Uint8Array(n0max));   // bit0 arm closing, bit1 static contact
    const nb = this.nbIdx || (this.nbIdx = new Int32Array(n0max));           // deepest ball neighbour (pressure transmission)
    const nbD = this.nbDepth || (this.nbDepth = new Float64Array(n0max));

    for (let s = 0; s < S; s++) {
      const step = f * S + s, t = (step + 1) * h;
      for (let k = 0; k < A.count; k++) { const a = armAngle(A, k, t); ac[k] = dcos(a); as[k] = dsin(a); }
      const a0p = armAngle(A, 0, t - h), a0 = armAngle(A, 0, t);
      if (Math.floor((a0p + 1.5707963267948966) / 6.283185307179586) !== Math.floor((a0 + 1.5707963267948966) / 6.283185307179586)) this.flags |= FLAG_SWEEP;
      const n = this.count;
      // integrate
      for (let i = 0; i < n; i++) {
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
        this.vy[i] += g * h;
        this.x[i] += this.vx[i] * h; this.y[i] += this.vy[i] * h;
        flagsC[i] = 0; nb[i] = -1; nbD[i] = 0;
      }
      this.buildGrid();
      const gw = this.gw, gh = this.gh, cst = this.cellStart, items = this.cellItems;
      const forward = (step & 1) === 0;
      for (let q = 0; q < n; q++) {
        const i = forward ? q : n - 1 - q;
        // --- ball–ball (neighbours in 3x3 cells, each pair once: j > i in forward, j < i in backward)
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
              if (this.age[i] < 10 || this.age[j] < 10) corr = corr > c.softCorr ? c.softCorr : corr;   // newborns separate softly
              dx /= d; dy /= d;
              if (d2 - d > nbD[i]) { nbD[i] = d2 - d; nb[i] = j; }
              if (d2 - d > nbD[j]) { nbD[j] = d2 - d; nb[j] = i; }
              this.x[i] -= dx * corr; this.y[i] -= dy * corr; this.x[j] += dx * corr; this.y[j] += dy * corr;
            }
          }
        }
      }
      // --- static surfaces, arms, arena (after ball–ball so boundaries win)
      for (let i = 0; i < n; i++) {
        let x = this.x[i], y = this.y[i];
        // wedges
        for (const edges of this.wedges) {
          let sd = -Infinity, en = null;
          for (const e of edges) { const v = e.nx * x + e.ny * y - e.d; if (v > sd) { sd = v; en = e; } }
          if (sd >= r) continue;
          let nx, ny, pen;
          if (sd < 0) { nx = en.nx; ny = en.ny; pen = r - sd; }
          else {
            let best = Infinity, qx = 0, qy = 0;
            for (const e of edges) {
              const ex = e.bx - e.ax, ey = e.by - e.ay; let u = ((x - e.ax) * ex + (y - e.ay) * ey) / (ex * ex + ey * ey);
              u = u < 0 ? 0 : u > 1 ? 1 : u;
              const px = e.ax + ex * u, py = e.ay + ey * u, dd = (x - px) * (x - px) + (y - py) * (y - py);
              if (dd < best) { best = dd; qx = px; qy = py; }
            }
            const d = Math.sqrt(best); if (d >= r) continue;
            nx = (x - qx) / (d || 1); ny = (y - qy) / (d || 1); pen = r - d;
          }
          x += nx * pen; y += ny * pen;
          statN[2 * i] = nx; statN[2 * i + 1] = ny; flagsC[i] |= 2;
        }
        // hub
        { const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) || 1e-9, hl = A.hubR + r;
          if (d < hl) { const nx = dx / d, ny = dy / d; x = cx + nx * hl; y = cy + ny * hl; statN[2 * i] = nx; statN[2 * i + 1] = ny; flagsC[i] |= 2; } }
        // arms (capsules from hubR to length), with side memory
        for (let k = 0; k < A.count; k++) {
          const ux = ac[k], uy = as[k];
          const rx = x - cx, ry = y - cy;
          let u = rx * ux + ry * uy;                       // along the arm
          const cr = ux * ry - uy * rx;                   // signed distance across the arm
          const si = i * A.count + k;
          if (u < A.hubR - armR || u > A.length + armR) { this.side[si] = cr >= 0 ? 1 : -1; continue; }
          const uc = u < A.hubR ? A.hubR : u > A.length ? A.length : u;
          const qx = cx + ux * uc, qy = cy + uy * uc;
          let dx = x - qx, dy = y - qy, d = Math.sqrt(dx * dx + dy * dy);
          const remembered = this.side[si];
          const nowSide = cr >= 0 ? 1 : -1;
          if (d >= armR && nowSide === remembered) continue;
          // normal toward the remembered side (perpendicular when along the shaft)
          let nx, ny;
          if (u > A.hubR && u < A.length) { nx = -uy * remembered; ny = ux * remembered; }
          else if (d > 1e-9 && nowSide === remembered) { nx = dx / d; ny = dy / d; }
          else { nx = -uy * remembered; ny = ux * remembered; }
          const along = (x - qx) * nx + (y - qy) * ny;
          if (along < armR) { x += nx * (armR - along); y += ny * (armR - along); }
          // arm surface velocity at the contact (rigid rotation about the centre)
          const vpx = -A.dir * A.omega * (qy - cy), vpy = A.dir * A.omega * (qx - cx);
          if (vpx * nx + vpy * ny > c.vPinch) { flagsC[i] |= 1; armN[2 * i] = nx; armN[2 * i + 1] = ny; }
          else { statN[2 * i] = nx; statN[2 * i + 1] = ny; flagsC[i] |= 2; }   // a non-closing arm acts like a wall
        }
        // arena rim (open gap after the break)
        { const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
          if (dd > lim * lim) {
            const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
            const inGap = broken && ny > this.cosGap;
            // intact rim always holds; after the break only balls still near the rim (not in the gap) bounce
            if (!broken || (!inGap && d < R + 2 * r)) { x = cx + nx * lim; y = cy + ny * lim; statN[2 * i] = -nx; statN[2 * i + 1] = -ny; flagsC[i] |= 2; }
          } }
        this.x[i] = x; this.y[i] = y;
        // refresh remembered sides from the resolved position
        for (let k = 0; k < A.count; k++) { const cr = ac[k] * (y - cy) - as[k] * (x - cx); const si = i * A.count + k; if (Math.abs(cr) > armR * 0.5) this.side[si] = cr >= 0 ? 1 : -1; }
      }
      // velocities from positions; clamp
      const vmax = c.vmax;
      for (let i = 0; i < n; i++) {
        let vx = (this.x[i] - this.px[i]) / h, vy = (this.y[i] - this.py[i]) / h;
        vx *= c.damping; vy *= c.damping;
        const sp = Math.sqrt(vx * vx + vy * vy); if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
        this.vx[i] = vx; this.vy[i] = vy;
      }
      // pinch: closing arm + opposing static contact, sustained
      const capped = this.capFrame >= 0;
      const contactRule = c.pinchRule === 'contact';
      for (let i = 0; i < n; i++) {
        const fl = flagsC[i];
        let squeezed = false, wall = 0;
        if ((fl & 1) && this.immune[i] === 0) {
          const ax = armN[2 * i], ay = armN[2 * i + 1];
          if ((fl & 2) && ax * statN[2 * i] + ay * statN[2 * i + 1] < -0.5) { squeezed = true; wall = 1; } // arm vs wall
          else if (contactRule) { if (nbD[i] > c.pileSqueeze * r) squeezed = true; }                     // v2: piles only eject
          else if (nbD[i] > c.pileSqueeze * r) squeezed = true;                                       // arm ploughing a compressed pile
          else {
            const j = nb[i];                                                                          // arm vs pinned neighbour
            if (j >= 0 && (flagsC[j] & 2) && nbD[i] > 0.05 * r) {
              const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i], dd = Math.sqrt(dx * dx + dy * dy) || 1;
              if ((ax * dx + ay * dy) / dd > 0.5 && ax * statN[2 * j] + ay * statN[2 * j + 1] < -0.5) squeezed = true;
            }
          }
        }
        if (squeezed) this.pinch[i]++; else this.pinch[i] = 0;
        if (contactRule ? (wall || this.pinch[i] >= 2) : this.pinch[i] >= 2) {
          this.pinch[i] = 0;
          if (contactRule) {                                        // v2: a real pinch always splits, a pile push never does
            if (wall && !capped && this.count < c.maxBalls) { this.split(i, step); } else this.eject(i, step);
            continue;
          }
          const p = this.count === 1 ? 1 : splitChance(this.count, t, c.pacing, c.maxBalls);
          if (!capped && this.count < c.maxBalls && rand(this.seed, this.id[i], step, P_SPLIT) < p) this.split(i, step);
          else this.eject(i, step);
        }
      }
    }

    // frame-level bookkeeping
    for (let i = 0; i < this.count; i++) { if (this.age[i] < 255) this.age[i]++; if (this.immune[i] > 0) this.immune[i]--; }
    // despawn balls that left the frame (rim-break ending): deterministic swap-remove from the end
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.y[i] > H + 80) {
        const last = --this.count;
        if (i !== last) this.move(last, i);
      }
    }
    if (this.capFrame < 0 && (this.count >= c.maxBalls || f >= c.safetyCap * FPS)) {
      this.capFrame = f; this.flags |= FLAG_CAP;
      this.breakFrame = f + Math.round(c.finaleHold * FPS);
      this.outroFrame = this.breakFrame + Math.round(c.ending.duration * FPS);
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
    const k = this.cfg.arms.count;
    for (let q = 0; q < k; q++) this.side[to * k + q] = this.side[from * k + q];
  }

  split(i, step) {
    const c = this.cfg, room = c.maxBalls - this.count;
    const children = Math.min(c.splitInto - 1, room);
    const g = this.gen[i] + 1, r = c.ballR;
    // children appear beside the parent along the free direction (perpendicular to the squeeze)
    const fx = -this.statNx[2 * i + 1], fy = this.statNx[2 * i];
    this.gen[i] = g; this.col[i] = g % 10; this.age[i] = 0; this.immune[i] = c.immuneFrames;
    for (let m = 0; m < children; m++) {
      const sgn = m === 0 ? 1 : -1;
      const off = r * (0.5 + 0.3 * rand(this.seed, this.id[i], step, P_OFFSET + m));
      const j = this.spawn(this.x[i] + fx * off * sgn, this.y[i] + fy * off * sgn, this.vx[i], this.vy[i], g);
      this.immune[j] = c.immuneFrames;
      this.px[j] = this.x[j]; this.py[j] = this.y[j];
      for (let q = 0; q < c.arms.count; q++) this.side[j * c.arms.count + q] = this.side[i * c.arms.count + q];
    }
    this.splits.push(this.x[i], this.y[i], g % 10);
    this.crushed++;
  }

  eject(i, step) {
    // squirt out along the free direction
    const c = this.cfg, fx = -this.statNx[2 * i + 1], fy = this.statNx[2 * i];
    const sgn = rand(this.seed, this.id[i], step, P_EJECT) < 0.5 ? -1 : 1;
    this.vx[i] += fx * sgn * c.ejectSpeed; this.vy[i] += fy * sgn * c.ejectSpeed;
    this.immune[i] = c.immuneFrames;
  }
}
