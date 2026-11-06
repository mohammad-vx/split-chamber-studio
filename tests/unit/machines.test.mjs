import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../../src/scenarios/index.js';
import { runHeadless } from '../../src/sim/run.js';
import { checkRun } from '../../src/pipeline/checks.js';
import { partPose, partGeometry } from '../../src/engine/machines.js';

for (const key of ['jaws@1', 'rams@1', 'kaleidoscope@1', 'walls@1']) {
  test(`${key}: deterministic, passes the run checks, stays contained`, () => {
    const sc = getScenario(key), cfg = sc.generate(1);
    const a = runHeadless(cfg), b = runHeadless(cfg);
    assert.deepEqual([...a.hashes], [...b.hashes]);
    assert.deepEqual(checkRun(cfg, a), []);
    assert.ok(a.hookFrame >= 0 && a.hookFrame / 60 <= 3);
  });
}

test('rams escalate: each swing is shorter than the previous one', () => {
  const p = getScenario('rams@1').generate(1).machine.parts[0];
  const zero = [];
  let prev = partPose(p, 0).a - Math.PI / 2;
  for (let t = 1 / 240; t < 30; t += 1 / 240) { const a = partPose(p, t).a - Math.PI / 2; if ((prev < 0) !== (a < 0)) zero.push(t); prev = a; }
  const halves = zero.slice(1).map((z, i) => z - zero[i]);
  assert.ok(halves.length > 6 && halves[halves.length - 1] < halves[0] * 0.8, 'swings do not speed up');
});

test('two closing parts with opposing normals squeeze (walls)', () => {
  const cfg = getScenario('walls@1').generate(2);
  const s = runHeadless(cfg);
  assert.ok(s.hookFrame >= 0 && s.capFrame > 0);
});

test('part geometry follows the pose', () => {
  const p = { type: 'capsule', pivot: [100, 100], angle: 0, u0: 0, u1: 50, thick: 5, motion: { slide: { axis: [1, 0], amp: 10, period: 1 } } };
  const g = partGeometry(p, partPose(p, 0.25));
  assert.ok(Math.abs(g.a[0] - 110) < 1e-6 && Math.abs(g.b[0] - 160) < 1e-6);
});

// v2 contact rule (user feedback 2026-11-06): a ball pinched between a moving part and a fixed surface always
// splits. Proof: with the split probability forced to zero, v2 still grows (pinches decide), v1 cannot.
for (const key of ['jaws@2', 'rams@2', 'kaleidoscope@2', 'walls@2', 'rotary-sweeper@2']) {
  test(`${key}: every real pinch splits (no probability), passes the run checks`, () => {
    const sc = getScenario(key), cfg = sc.generate(1);
    const w = cfg.machine || cfg.packed;
    assert.equal(w.pinchRule, 'contact');
    const a = runHeadless(cfg);
    assert.deepEqual(checkRun(cfg, a), []);
    const zero = sc.generate(1); (zero.machine || zero.packed).pacing = { p0: 0, pmin: 0, capTime: 30 };
    const z = runHeadless(zero);
    assert.deepEqual([...z.hashes], [...a.hashes], 'pacing must have no influence under the contact rule');
    const v1 = getScenario(key.replace('@2', '@1')), c1 = v1.generate(1);
    (c1.machine || c1.packed).pacing = { p0: 0, pmin: 0, capTime: 30 }; (c1.machine || c1.packed).safetyCap = 12;
    const o = runHeadless({ ...c1, duration: { minS: 0, maxS: 60 } });
    assert.ok(Math.max(...o.timeline.n.slice(0, 600)) <= 3, 'v1 should not grow without the probability');
  });
}
