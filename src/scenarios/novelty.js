// Machine novelty (inventor v2): a picture of what a machine covers, so two inventions that are the same machine
// shifted a little, turned to another angle, mirrored or resized slightly are recognised as one machine.
//   signature(parts)  'v2:' + where the machine goes: the arena as a polar grid (RINGS × SECTORS), the share of the
//                     cycle each cell is covered (360 digits) + what it looks like: SNAPS moments, each reduced to the
//                     strength of the first HARM angular harmonics per ring (two digits each), which does not change
//                     when the machine is turned or mirrored. Rotors cover the whole disc, so the look tells them apart.
//   similarity(a, b)  mean of: coverage (weighted Jaccard, best over every rotation and mirror) and look (each moment
//                     of a matched with the closest moment of b, so a machine started at another phase still matches)
// Pure and deterministic (no RNG, no clock): the same parts always give the same signature.
import { partPose, partGeometry } from '../engine/machines.js';
import { ARENA } from './phase2.js';

export const RINGS = 10, SECTORS = 36;
const SAMPLES = 60, SPAN_S = 24, SNAPS = 8, HARM = 9;
export const SIMILAR = 0.66;   // at or above: the same machine (tuned on sampled inventions, see tools/novelty-tune.mjs)

// 3 × 3 sample points per cell (one point per cell missed small parts); equal-area rings
function cells() {
  const out = [];
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SECTORS; j++) {
    const pts = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const rr = ARENA.r * Math.sqrt((i + (a + 0.5) / 3) / RINGS), th = 2 * Math.PI * (j + (b + 0.5) / 3) / SECTORS;
      pts.push([ARENA.cx + rr * Math.cos(th), ARENA.cy + rr * Math.sin(th)]);
    }
    out.push(pts);
  }
  return out;
}
const CELLS = cells();

function inside(g, x, y) {
  if (g.c) { const dx = x - g.c[0], dy = y - g.c[1]; return dx * dx + dy * dy <= g.r * g.r; }
  if (g.a) {
    const [ax, ay] = g.a, [bx, by] = g.b, vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L)), dx = x - ax - u * vx, dy = y - ay - u * vy;
    const h = Math.max(g.thick / 2, 14);   // thin parts (lasers) still mark their path
    return dx * dx + dy * dy <= h * h;
  }
  const p = g.pts; let s = 0;
  for (let k = 0; k < p.length; k++) {
    const [ax, ay] = p[k], [bx, by] = p[(k + 1) % p.length], c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c !== 0) { const sg = c > 0 ? 1 : -1; if (s && sg !== s) return false; s = sg; }
  }
  return true;
}

/** Signature of a parts list (see the header). */
export function signature(parts) {
  const acc = new Float64Array(CELLS.length), snaps = [];
  for (let n = 0; n < SAMPLES; n++) {
    const t = SPAN_S * n / SAMPLES, geos = parts.map((p) => partGeometry(p, partPose(p, t, parts), t));
    for (let c = 0; c < CELLS.length; c++) {
      let hit = 0;
      for (const [x, y] of CELLS[c]) for (const g of geos) if (inside(g, x, y)) { hit++; break; }
      acc[c] += hit / 9; if (n % (SAMPLES / SNAPS) === 0) { if (c === 0) snaps.push(new Float64Array(CELLS.length)); snaps[snaps.length - 1][c] = hit / 9; }
    }
  }
  let s = 'v2:';   // square root: a fast part that crosses a cell briefly still marks it
  for (let c = 0; c < CELLS.length; c++) s += Math.min(9, Math.round(9 * Math.sqrt(acc[c] / SAMPLES)));
  for (const sn of snaps) for (let i = 0; i < RINGS; i++) for (let h = 0; h < HARM; h++) {
    let re = 0, im = 0;
    for (let j = 0; j < SECTORS; j++) { const v = sn[i * SECTORS + j], a = 2 * Math.PI * h * j / SECTORS; re += v * Math.cos(a); im += v * Math.sin(a); }
    s += String(Math.min(99, Math.round(99 * Math.sqrt(re * re + im * im) / SECTORS))).padStart(2, '0');
  }
  return s;
}

/** Similarity 0…1 of two signatures, invariant to rotation and mirroring. */
export function similarity(a, b) {
  if (!a || !b || a.length !== b.length || !a.startsWith('v2:')) return 0;
  const n = RINGS * SECTORS;
  return (half(a.slice(3, 3 + n), b.slice(3, 3 + n)) + look(a.slice(3 + n), b.slice(3 + n))) / 2;
}
const LOOK_LEN = RINGS * HARM;
// parsed signatures, so comparing one invention with hundreds of kept machines does not re-parse them every time
const CACHE = new Map();
function memo(key, make) { let v = CACHE.get(key); if (!v) { if (CACHE.size > 4000) CACHE.clear(); v = make(); CACHE.set(key, v); } return v; }
function moments(str) { const out = []; for (let k = 0; k < SNAPS; k++) { const m = []; for (let q = 0; q < LOOK_LEN; q++) m.push(Number(str.substr((k * LOOK_LEN + q) * 2, 2))); out.push(m); } return out; }
function jac(x, y) { let lo = 0, hi = 0; for (let q = 0; q < x.length; q++) { lo += Math.min(x[q], y[q]); hi += Math.max(x[q], y[q]); } return hi ? lo / hi : 1; }
function look(a, b) {
  const A = memo('m' + a, () => moments(a)), B = memo('m' + b, () => moments(b));
  const side = (P, Q) => P.reduce((sum, p) => sum + Math.max(...Q.map((q) => jac(p, q))), 0) / P.length;
  return Math.min(side(A, B), side(B, A));
}
// soften each ring along its sectors (1-2-1) and across rings, so a part half a cell away still overlaps itself
function soft(str) {
  const v = Array.from(str, Number), o = new Array(v.length).fill(0);
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SECTORS; j++) {
    const at = (ii, jj) => v[ii * SECTORS + ((jj + SECTORS) % SECTORS)];
    let x = 2 * at(i, j) + at(i, j - 1) + at(i, j + 1), w = 4;
    if (i > 0) { x += at(i - 1, j); w += 1; }
    if (i < RINGS - 1) { x += at(i + 1, j); w += 1; }
    o[i * SECTORS + j] = x / w;
  }
  return o;
}
function half(a, b) {
  const A = memo('s' + a, () => soft(a)), B = memo('s' + b, () => soft(b));
  let best = 0;
  for (let mirror = 0; mirror < 2; mirror++) for (let sh = 0; sh < SECTORS; sh++) {
    let lo = 0, hi = 0;
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SECTORS; j++) {
      const jb = mirror ? (SECTORS - 1 - j + sh) % SECTORS : (j + sh) % SECTORS;
      const x = A[i * SECTORS + j], y = B[i * SECTORS + jb];
      lo += Math.min(x, y); hi += Math.max(x, y);
    }
    const v = hi ? lo / hi : 1;
    if (v > best) best = v;
  }
  return best;
}

/** The closest signature in a list: { sim, index } (sim 0 when the list is empty). */
export function closest(sig, list) {
  let sim = 0, index = -1;
  (list || []).forEach((s, i) => { const v = similarity(sig, s); if (v > sim) { sim = v; index = i; } });
  return { sim, index };
}
