import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dsin, dcos, dexp, dlog } from '../../src/engine/dmath.js';
import { rand, hash32 } from '../../src/engine/rng.js';
import { splitChance } from '../../src/engine/orbit.js';
import { getScenario, listedScenarios, configOf, SCENARIOS } from '../../src/scenarios/index.js';
import { encodeFrame, decodeFrame, hashFrames, POS_SCALE } from '../../src/sim/session.js';
import { FPS } from '../../src/core/constants.js';

test('deterministic math is accurate', () => {
  for (let x = -20; x < 20; x += 0.0137) {
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) < 1e-8);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) < 1e-8);
    assert.ok(Math.abs(dexp(x / 2) / Math.exp(x / 2) - 1) < 1e-13);
  }
  for (let x = 0.001; x < 20000; x *= 1.37) assert.ok(Math.abs(dlog(x) - Math.log(x)) < 1e-12);
});

test('counter RNG is a pure function in [0,1)', () => {
  assert.equal(rand(5, 1, 2, 3), rand(5, 1, 2, 3));
  assert.notEqual(hash32(5, 1, 2, 3), hash32(5, 1, 2, 4));
  let lo = 1, hi = 0, sum = 0;
  for (let i = 0; i < 20000; i++) { const v = rand(9, i, 0, 1); lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; }
  assert.ok(lo >= 0 && hi < 1 && Math.abs(sum / 20000 - 0.5) < 0.01);
});

test('pacing controller pushes toward the target curve', () => {
  const pacing = { capTime: 25, p0: 0.5, pmin: 0.02 };
  assert.ok(splitChance(1, 20, pacing, 10000) === 1);            // far behind -> always split
  assert.ok(splitChance(9000, 5, pacing, 10000) === pacing.pmin); // far ahead -> minimum
  const p = splitChance(100, 0.5 * 25, pacing, 10000);           // on target (sqrt(10000)=100)
  assert.ok(Math.abs(p - 0.5) < 1e-9);
});

function run(key, seed) {
  const sc = getScenario(key);
  const sim = sc.createSim(sc.generate(seed));
  const frames = [];
  while (!sim.done) { sim.step(); frames.push(encodeFrame(sim)); }
  return { sim, frames };
}

test('orbit-crusher: deterministic, capped, contained, duration within bounds', () => {
  const a = run('orbit-crusher@1', 31), b = run('orbit-crusher@1', 31);
  assert.equal(hashFrames(a.frames), hashFrames(b.frames));
  const cfg = getScenario('orbit-crusher@1').generate(31);
  const dur = a.frames.length / FPS;
  assert.ok(dur >= cfg.duration.minS && dur <= cfg.duration.maxS, `duration ${dur}`);
  let max = 0;
  for (let k = 0; k < a.frames.length; k += 23) {
    const d = decodeFrame(a.frames[k]);
    max = Math.max(max, d.n);
    for (let i = 0; i < d.n; i++) {
      const x = d.xy[2 * i] / POS_SCALE - 540, y = d.xy[2 * i + 1] / POS_SCALE - 1000;
      assert.ok(Math.hypot(x, y) <= 460 - 6.5 + 0.1);
    }
  }
  assert.equal(max, cfg.orbit.maxBalls);
});

test('split-chamber@2 runs 30-40 s and differs from @1', () => {
  const r = run('split-chamber@2', 5);
  const dur = r.frames.length / FPS;
  assert.ok(dur >= 30 && dur <= 40, `duration ${dur}`);
  assert.equal(getScenario('split-chamber@2').generate(5).render.partTimeOffsetFrames, 1);
  assert.equal(getScenario('split-chamber@1').generate(5).render.partTimeOffsetFrames, 0);
});

test('registry: keys, listing, legacy sessions default to @1', () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), ['orbit-crusher@1', 'split-chamber@1', 'split-chamber@2']);
  assert.ok(!listedScenarios().some((s) => s.key === 'split-chamber@1'));
  assert.equal(configOf({ seed: 3 }).scenario, 'split-chamber@1');
  for (const s of listedScenarios()) {
    const c = s.generate(77);
    assert.equal(c.scenario, s.key);
    assert.deepEqual(c, s.generate(77));        // generate is pure
    assert.ok(c.duration.minS >= 30 && c.duration.maxS <= 60);
  }
});
