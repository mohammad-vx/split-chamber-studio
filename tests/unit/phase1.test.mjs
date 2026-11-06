// Phase 1: one engine, one rule (solid parts collide, pinches always split, only lasers are see-through),
// plus the batch controls (gravity, stop-at count, length, ending).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getScenario, listedScenarios } from '../../src/scenarios/index.js';
import { applyControls } from '../../src/scenarios/controls.js';
import { runHeadless } from '../../src/sim/run.js';
import { checkRun } from '../../src/pipeline/checks.js';
import { W, H } from '../../src/core/constants.js';

test('every listed pattern runs on the machine engine with the contact rule and the solid-part check', () => {
  for (const s of listedScenarios()) {
    const cfg = applyControls(s.generate(1), {});
    assert.ok(cfg.machine, `${s.key} is not on the machine engine`);
    assert.equal(cfg.machine.pinchRule, 'contact', s.key);
    assert.ok(cfg.checks.solidMax > 0, s.key);
    assert.ok(cfg.controls && cfg.controls.gravity, s.key);
  }
});

test('controls: gravity, stop-at count, length and ending are written into the config', () => {
  const sc = getScenario('walls@3');
  const off = applyControls(sc.generate(3), { gravity: 'off' });
  assert.equal(off.machine.gravity, 0);
  const cen = applyControls(sc.generate(3), { gravity: 'center' });
  assert.equal(cen.machine.gravityMode, 'center'); assert.ok(cen.machine.gravity > 0);
  const t = applyControls(sc.generate(3), { target: 500 });
  assert.equal(t.machine.maxBalls, 500); assert.equal(t.render.maxBalls, 500);
  const m = applyControls(sc.generate(3), { length: 'medium' });
  assert.deepEqual(m.duration, { minS: 45, maxS: 65 }); assert.ok(m.machine.safetyCap > 40);
  const f = applyControls(sc.generate(3), { ending: 'flood' });
  assert.equal(f.machine.ending.type, 'flood'); assert.equal(f.render.ending.type, 'flood');
  const g = applyControls(sc.generate(3), { ending: 'gold' });
  assert.equal(g.machine.ending.type, 'cap-gold'); assert.equal(g.machine.finaleHold, 5.5);
});

test('stop-at count: the finale starts exactly at the chosen number', () => {
  const cfg = applyControls(getScenario('jaws@2').generate(2), { target: 300 });
  const s = runHeadless(cfg);
  assert.equal(s.capN, 300);
});

test('laser: balls pass through the beam, and every touch splits', () => {
  const cfg = applyControls(getScenario('laser-cross@1').generate(2), {});
  const s = runHeadless(cfg);
  assert.ok(s.hookFrame >= 0 && s.hookFrame / 60 <= 3, 'first laser touch splits');
  assert.equal(s.passMax, 0, 'the only parts are a laser (see-through) and fixed wedges');
  assert.ok(s.capN > 100);
});

test('flood ending: the glass goes and the balls spill over the whole frame, staying inside it', () => {
  const sc = getScenario('rams@2'), cfg = applyControls(sc.generate(1), { ending: 'flood', target: 600 });
  const sim = sc.createSim(cfg);
  while (!sim.done) sim.step();
  const { cx, cy, r } = cfg.machine.arena;
  let outside = 0, inFrame = true;
  for (let i = 0; i < sim.count; i++) {
    if (Math.hypot(sim.x[i] - cx, sim.y[i] - cy) > r + 20) outside++;
    if (sim.x[i] < 0 || sim.x[i] > W || sim.y[i] < 0 || sim.y[i] > H) inFrame = false;
  }
  assert.ok(outside > sim.count * 0.3, `only ${outside} of ${sim.count} balls left the arena`);
  assert.ok(inFrame);
});

test('walls@3 never close into each other: no ball ends up inside the metal (walls@2 did)', () => {
  const a = runHeadless(applyControls(getScenario('walls@3').generate(1), {}));
  assert.ok(a.passMax <= 0.035, `walls@3 ${a.passMax}`);
  const old = getScenario('walls@2').generate(1); old.machine.checkSolid = true;
  assert.ok(runHeadless(old).passMax > 0.5, 'the measurement must catch the @2 overlap');
});

test('phase-1 patterns are deterministic', () => {
  for (const key of ['orbit-crusher@2', 'split-chamber@3', 'rotary-sweeper@3', 'laser-cross@1']) {
    const cfg = applyControls(getScenario(key).generate(4), {});
    assert.deepEqual([...runHeadless(cfg).hashes.slice(0, 600)], [...runHeadless(cfg).hashes.slice(0, 600)], key);
  }
});
