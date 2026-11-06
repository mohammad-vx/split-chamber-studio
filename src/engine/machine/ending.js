// Endings: when the finale starts (stop-at count or safety time), the gold wave, the rim break / flood, and the
// per-ball forces that change once the rim is gone.
import { FPS } from '../../core/constants.js';
import { FLAG_CAP } from '../../sim/sim.js';

export const FLAG_BREAK = 32;
export const GOLD_INDEX = 10;

/** Body force for this frame: { g, centre, flood } (gravity strength, pull-to-centre, flood push). */
export function forceMode(sim) {
  const c = sim.cfg, broken = sim.breakFrame >= 0;
  const flood = broken && c.ending.type === 'flood';
  const g = flood ? 0 : broken ? (c.ending.gravity || 1400) : sim.count > 1 ? c.gravity : 0;
  const centre = c.gravityMode === 'center' && !broken;   // pull toward the arena centre instead of down
  return { broken, flood, g, centre };
}

/** Apply the body force to ball i over a substep h. */
export function applyForce(sim, i, mode, h) {
  const c = sim.cfg, { cx, cy } = c.arena, g = mode.g;
  if (mode.centre) {
    const dx = cx - sim.x[i], dy = cy - sim.y[i], d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) { sim.vx[i] += g * h * dx / d; sim.vy[i] += g * h * dy / d; }
  } else if (mode.flood) {
    const dx = sim.x[i] - cx, dy = sim.y[i] - cy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) { const a = (c.ending.push || 900) * h; sim.vx[i] += a * dx / d; sim.vy[i] += a * dy / d; }
  } else sim.vy[i] += g * h;
}

/** End-of-frame finale bookkeeping: start the finale at the cap, spread the gold wave, flag the break. */
export function updateEnding(sim, f) {
  const c = sim.cfg, { cx, cy } = c.arena;
  if (sim.capFrame < 0 && (sim.count >= c.maxBalls || f >= c.safetyCap * FPS)) {
    sim.capFrame = f; sim.flags |= FLAG_CAP;
    const brk = c.ending.type === 'rim-break' || c.ending.type === 'flood';
    sim.breakFrame = brk ? f + Math.round(c.finaleHold * FPS) : -1;
    sim.outroFrame = f + Math.round(c.finaleHold * FPS) + (brk ? Math.round(c.ending.duration * FPS) : 0);
    sim.endFrame = sim.outroFrame + Math.round(c.outro * FPS) - 1;
  }
  if (sim.capFrame >= 0) {
    const wave = (f - sim.capFrame) / FPS * c.goldWaveSpeed, w2 = wave * wave;
    for (let i = 0; i < sim.count; i++) {
      if (sim.col[i] === GOLD_INDEX) continue;
      const dx = sim.x[i] - cx, dy = sim.y[i] - cy;
      if (dx * dx + dy * dy <= w2) sim.col[i] = GOLD_INDEX;
    }
  }
  if (f === sim.breakFrame) sim.flags |= FLAG_BREAK;
}
