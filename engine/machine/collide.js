// Ball ↔ part and ball ↔ arena contacts (position-based). Each function moves ball i out of the solid and records
// the contact (normal + closing speed of the part's surface) for the pinch rule. Beams (lasers) never push: they
// only mark a touch. The arithmetic is the original engine's, in the same order (old patterns stay bit-exact).
import { W, H } from '../../core/constants.js';

/** Resolve ball i at (x, y) against every part. Returns the corrected position in sim.ox / sim.oy. */
export function collideParts(sim, i, x, y, h) {
  const parts = sim.cfg.parts, P = parts.length, r = sim.cfg.ballR;
  for (let k = 0; k < P; k++) {
    const part = parts[k], G = sim.geo[k];
    if (part.type === 'beam') {                      // laser: balls pass through it; a touch splits (pinch.js)
      const ax = G.a[0], ay = G.a[1], ex = G.b[0] - ax, ey = G.b[1] - ay, L2 = ex * ex + ey * ey;
      let u = ((x - ax) * ex + (y - ay) * ey) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + ex * u, qy = ay + ey * u, dx = x - qx, dy = y - qy;
      if (dx * dx + dy * dy < (G.thick + r) * (G.thick + r)) {
        const L = Math.sqrt(L2); sim.beamHit[i] = 1; sim.closeN[2 * i] = -ey / L; sim.closeN[2 * i + 1] = ex / L;
      }
      continue;
    }
    if (part.type === 'capsule') {
      const ax = G.a[0], ay = G.a[1], ex = G.b[0] - ax, ey = G.b[1] - ay, L2 = ex * ex + ey * ey, L = Math.sqrt(L2);
      const ux = ex / L, uy = ey / L, rr = G.thick + r;
      const u = (x - ax) * ux + (y - ay) * uy, cr = ux * (y - ay) - uy * (x - ax);
      const si = i * P + k;
      if (u < -rr || u > L + rr) { sim.side[si] = cr >= 0 ? 1 : -1; continue; }
      const uc = u < 0 ? 0 : u > L ? L : u;
      const qx = ax + ux * uc, qy = ay + uy * uc;
      const dx = x - qx, dy = y - qy, d = Math.sqrt(dx * dx + dy * dy);
      const remembered = sim.side[si] || (cr >= 0 ? 1 : -1), nowSide = cr >= 0 ? 1 : -1;
      if (d >= rr && nowSide === remembered) continue;
      let nx, ny;
      if (u > 0 && u < L) { nx = -uy * remembered; ny = ux * remembered; }
      else if (d > 1e-9 && nowSide === remembered) { nx = dx / d; ny = dy / d; }
      else { nx = -uy * remembered; ny = ux * remembered; }
      const along = (x - qx) * nx + (y - qy) * ny;
      if (along < rr) { x += nx * (rr - along); y += ny * (rr - along); }
      const [vpx, vpy] = sim.pointVel(k, qx, qy, h);
      sim.contact(i, nx, ny, vpx * nx + vpy * ny);
    } else if (part.type === 'circle') {
      const dx = x - G.c[0], dy = y - G.c[1], d = Math.sqrt(dx * dx + dy * dy), rr = G.r + r;
      if (d >= rr || d < 1e-9) continue;
      const nx = dx / d, ny = dy / d;
      x = G.c[0] + nx * rr; y = G.c[1] + ny * rr;
      const [vpx, vpy] = sim.pointVel(k, G.c[0] + nx * G.r, G.c[1] + ny * G.r, h);
      sim.contact(i, nx, ny, vpx * nx + vpy * ny);
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
      const [vpx, vpy] = part.static ? [0, 0] : sim.pointVel(k, x - nx * r, y - ny * r, h);
      sim.contact(i, nx, ny, vpx * nx + vpy * ny);
    }
  }
  sim.ox = x; sim.oy = y;
}

/** Optional central hub and the arena rim (circle, or the whole frame once a flood ending has started). */
export function collideArena(sim, i, x, y, broken, flood) {
  const c = sim.cfg, { cx, cy, r: R } = c.arena, r = c.ballR, lim = R - r;
  if (c.hubR) { const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) || 1e-9, hl = c.hubR + r;
    if (d < hl) { const nx = dx / d, ny = dy / d; x = cx + nx * hl; y = cy + ny * hl; sim.contact(i, nx, ny, 0); } }
  const dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy;
  if (flood) {
    if (x < r) x = r; else if (x > W - r) x = W - r;
    if (y < r) y = r; else if (y > H - r) y = H - r;
  } else if (dd > lim * lim) {
    const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
    const inGap = broken && ny > sim.cosGap;
    if (!broken || (!inGap && d < R + 2 * r)) { x = cx + nx * lim; y = cy + ny * lim; sim.contact(i, -nx, -ny, 0); }
  }
  sim.ox = x; sim.oy = y;
}

/** Remember which side of each capsule the ball is on (so a fast blade never tunnels through it). */
export function updateSides(sim, i, x, y) {
  const parts = sim.cfg.parts, P = parts.length, r = sim.cfg.ballR;
  for (let k = 0; k < P; k++) {
    if (parts[k].type !== 'capsule') continue;
    const G = sim.geo[k], ex = G.b[0] - G.a[0], ey = G.b[1] - G.a[1], L = Math.sqrt(ex * ex + ey * ey);
    const cr = (ex * (y - G.a[1]) - ey * (x - G.a[0])) / L;
    if (Math.abs(cr) > (G.thick + r) * 0.5) sim.side[i * P + k] = cr >= 0 ? 1 : -1;
  }
}
