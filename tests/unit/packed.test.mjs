import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PackedSim, armAngle } from '../../src/engine/packed.js';
import { rotarySweeperV1 as sc } from '../../src/scenarios/rotary-sweeper.js';
import { encodeFrame, hashFrames } from '../../src/sim/session.js';

function runTo(seed, frames = Infinity) {
  const sim = sc.createSim(sc.generate(seed));
  const out = [];
  while (!sim.done && sim.frame < frames) { sim.step(); out.push(encodeFrame(sim)); }
  return { sim, out };
}

test('packed: deterministic and finite', () => {
  const a = runTo(9, 900), b = runTo(9, 900);
  assert.equal(hashFrames(a.out), hashFrames(b.out));
  for (let i = 0; i < a.sim.count; i++) assert.ok(Number.isFinite(a.sim.x[i]) && Number.isFinite(a.sim.y[i]));
});

test('packed: balls stay inside the arena until the rim breaks, little residual overlap', () => {
  const { sim } = runTo(4, 1200);
  const c = sim.cfg, { cx, cy, r } = c.arena;
  let worst = 0, overlaps = 0;
  for (let i = 0; i < sim.count; i++) {
    worst = Math.max(worst, Math.hypot(sim.x[i] - cx, sim.y[i] - cy) - (r - c.ballR));
    for (let j = i + 1; j < sim.count; j++) {
      const d = Math.hypot(sim.x[j] - sim.x[i], sim.y[j] - sim.y[i]);
      if (d < 2 * c.ballR * 0.6) overlaps++;                       // > 40 % overlap counts as a solver failure
    }
  }
  assert.ok(worst < 1.5, `ball outside the rim by ${worst.toFixed(2)} px`);
  assert.ok(overlaps <= sim.count * 0.03, `${overlaps} deep overlaps among ${sim.count} balls`);
});

test('packed: full run reaches the cap, breaks the rim and empties the arena', () => {
  const { sim, out } = runTo(4);
  assert.ok(sim.capFrame > 0 && sim.breakFrame > sim.capFrame);
  assert.equal(sim.peak, sim.cfg.maxBalls);
  assert.ok(sim.count < sim.cfg.maxBalls * 0.2, `still ${sim.count} balls after the rim broke`);
  assert.ok(out.length / 60 >= 30 && out.length / 60 <= 45);
});

function oneBallWorld(over) {
  const cfg = sc.generate(1);
  cfg.packed = { ...cfg.packed, gravity: 0, wedges: [], ...over };
  return new PackedSim(cfg);
}

test('pinch: a resting ball beside a parked (non-rotating) arm is never split', () => {
  const sim = oneBallWorld({ arms: { ...sc.generate(1).packed.arms, count: 1, omega: 0 } });
  const a = armAngle(sim.cfg.arms, 0, 0), ux = Math.cos(a), uy = Math.sin(a);
  // place the ball touching the arm, pressed against nothing
  sim.x[0] = 540 + ux * 250 - uy * (sim.cfg.arms.thick + sim.cfg.ballR); sim.y[0] = 1000 + uy * 250 + ux * (sim.cfg.arms.thick + sim.cfg.ballR);
  sim.vx[0] = 0; sim.vy[0] = 0; sim.initSides(0, 0);
  for (let f = 0; f < 120; f++) sim.step();
  assert.equal(sim.count, 1);
});

test('pinch: an arm sweeping a ball into a wedge splits it (first cut always splits)', () => {
  const { sim } = runTo(3, 240);
  assert.ok(sim.count > 1, 'no split in the first 4 s');
});

test('arms do not tunnel: no ball crosses an arm while inside its span', () => {
  const sim = sc.createSim(sc.generate(12));
  const A = sim.cfg.arms;
  let crossings = 0;
  for (let f = 0; f < 900; f++) {
    const before = [];
    const t0 = f / 60;
    for (let i = 0; i < sim.count; i++) {
      const a = armAngle(A, 0, t0), cr = Math.cos(a) * (sim.y[i] - 1000) - Math.sin(a) * (sim.x[i] - 540);
      const u = Math.cos(a) * (sim.x[i] - 540) + Math.sin(a) * (sim.y[i] - 1000);
      before.push(u > A.hubR + 20 && u < A.length - 20 && Math.abs(cr) < 40 ? Math.sign(cr) : 0);
    }
    const n0 = sim.count;
    sim.step();
    const t1 = (f + 1) / 60;
    for (let i = 0; i < Math.min(n0, sim.count); i++) {
      if (!before[i]) continue;
      const a = armAngle(A, 0, t1), cr = Math.cos(a) * (sim.y[i] - 1000) - Math.sin(a) * (sim.x[i] - 540);
      if (Math.sign(cr) !== before[i] && Math.abs(cr) > A.thick) crossings++;
    }
  }
  assert.ok(crossings <= 2, `${crossings} balls tunnelled through the arm`);
});
