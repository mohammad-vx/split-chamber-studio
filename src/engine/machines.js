// Machines engine (Packed v2, generic kinematic parts). Same physics as src/engine/packed.js (left untouched so
// rotary-sweeper@1 stays bit-exact), generalised to any number of scripted parts:
//   capsule: segment [u0,u1] along a direction from a pivot, thickness `thick`
//   poly:    convex polygon in local coordinates (optionally morphing between two point sets)
//   circle:  disc of radius `r` at a local point (pendulum heads)
//   beam:    a see-through laser — every touch splits
// The engine is split into modules under ./machine/:
//   kinematics.js  part poses (motion primitives + the part tree: parts mounted on parts)
//   mechanisms.js  closed-form mechanisms (quick return, slam, cam, ratchet, Lissajous, rose, planet)
//   collide.js     ball ↔ part and ball ↔ arena contacts
//   pinch.js       the pinch / split rule
//   ending.js      body forces, finale, gold wave, rim break / flood
//   measure.js     read-only measurements (balls inside solid parts)
// Determinism: basic IEEE ops + dsin/dcos, counter RNG, fixed order — identical arithmetic to v2.2.
import { FPS, W, H } from '../core/constants.js';
import { dcos } from './dmath.js';
import { rand } from './rng.js';
import { FLAG_OUTRO } from '../sim/sim.js';
import { phaseOf, partPose, partGeometry, polyEdges, validateTree } from './machine/kinematics.js';
import { collideParts, collideArena, updateSides } from './machine/collide.js';
import { resolvePinches, FLAG_SMASH } from './machine/pinch.js';
import { forceMode, applyForce, updateEnding, FLAG_BREAK, GOLD_INDEX } from './machine/ending.js';
import { measureSolid } from './machine/measure.js';

export { partPose, partGeometry, localPose, compose, partShape, validateTree, phaseOf } from './machine/kinematics.js';
export { mechanism, MECHANISMS } from './machine/mechanisms.js';
export { FLAG_SMASH, FLAG_BREAK, GOLD_INDEX };
export const FLAG_BEAT = 16;
const P_OFFSET = 22, P_EJECT = 23;

export class MachineSim {
  constructor(config) {
    const c = config.machine;
    validateTree(c.parts);
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
    this.ox = 0; this.oy = 0;                       // scratch output of the collide functions
    const cs = 2 * c.ballR; this.cs = cs;
    this.gx0 = c.arena.cx - c.arena.r - cs; this.gy0 = c.arena.cy - c.arena.r - cs;
    this.gw = Math.ceil((2 * c.arena.r + 2 * cs) / cs); this.gh = this.gw;
    if (c.ending.type === 'flood') {                // balls leave the arena and fill the frame: grid over the frame
      this.gx0 = -cs; this.gy0 = -cs; this.gw = Math.ceil((W + 2 * cs) / cs); this.gh = Math.ceil((H + 2 * cs) / cs);
    }
    this.cellStart = new Int32Array(this.gw * this.gh + 1);
    this.cellFill = new Int32Array(this.gw * this.gh);
    this.cellItems = new Int32Array(n); this.cellOf = new Int32Array(n);
    this.cosGap = dcos(c.ending.gapHalf || 0.5);
    this.closeN = new Float64Array(n * 2); this.otherN = new Float64Array(n * 2);
    this.cflags = new Uint8Array(n); this.closeV = new Float64Array(n);
    this.nb = new Int32Array(n); this.nbD = new Float64Array(n);
    this.beamHit = new Uint8Array(n); this.passMax = 0;   // laser touches; worst share of balls inside a solid part
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
    const parts = this.cfg.parts;
    parts.forEach((p, k) => {
      const pose = partPose(p, t, parts);
      const g = partGeometry(p, pose, t);
      g.pose = pose;
      if (g.pts) g.edges = polyEdges(g.pts);
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

  /** Ball ↔ ball separation (PBD), alternating sweep direction per substep. */
  separate(n, step) {
    const c = this.cfg, d2 = 2 * c.ballR;
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
  }

  step() {
    const f = this.frame, c = this.cfg, parts = c.parts;
    const S = c.substeps, h = 1 / (FPS * S);
    const mode = forceMode(this);
    this.splits = []; this.flags = 0; this.crushed = 0;

    for (let s = 0; s < S; s++) {
      const step = f * S + s, t = (step + 1) * h;
      this.prevGeo = this.geo.slice();
      this.updateParts(t);
      if (c.beatPart != null) {                      // accent when the beat part crosses its reference phase
        const p = parts[c.beatPart], m = p.motion.swing || p.motion.oscillate || p.motion.slide || p.motion.radial || p.motion.mech;
        if (m && Math.floor(phaseOf(m, t - h) / Math.PI) !== Math.floor(phaseOf(m, t) / Math.PI)) this.flags |= FLAG_BEAT;
      }
      const n = this.count;
      for (let i = 0; i < n; i++) {
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
        applyForce(this, i, mode, h);
        this.x[i] += this.vx[i] * h; this.y[i] += this.vy[i] * h;
        this.beamHit[i] = 0;
        this.cflags[i] = 0; this.closeV[i] = 0; this.nb[i] = -1; this.nbD[i] = 0;
      }
      this.buildGrid();
      this.separate(n, step);
      for (let i = 0; i < n; i++) {
        collideParts(this, i, this.x[i], this.y[i], h);
        collideArena(this, i, this.ox, this.oy, mode.broken, mode.flood);
        const x = this.ox, y = this.oy;
        this.x[i] = x; this.y[i] = y;
        updateSides(this, i, x, y);
      }
      const vmax = c.vmax;
      for (let i = 0; i < n; i++) {
        let vx = (this.x[i] - this.px[i]) / h * c.damping, vy = (this.y[i] - this.py[i]) / h * c.damping;
        const sp = Math.sqrt(vx * vx + vy * vy); if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
        this.vx[i] = vx; this.vy[i] = vy;
      }
      resolvePinches(this, step, t);
    }

    for (let i = 0; i < this.count; i++) { if (this.age[i] < 255) this.age[i]++; if (this.immune[i] > 0) this.immune[i]--; }
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.y[i] > H + 80) { const last = --this.count; if (i !== last) this.move(last, i); }
    }
    updateEnding(this, f);
    if (c.checkSolid && (f % 6) === 0 && this.breakFrame < 0) measureSolid(this);
    if (f === this.outroFrame) this.flags |= FLAG_OUTRO;
    this.frame++;
    return f;
  }

  /** Share of balls sitting deep inside a solid part (kept as a method for callers of v2.2). */
  measureSolid() { measureSolid(this); }

  move(from, to) {
    for (const a of [this.x, this.y, this.px, this.py, this.vx, this.vy, this.gen, this.age, this.immune, this.col, this.id, this.pinch, this.beamHit]) a[to] = a[from];
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
