// Engine modules (v2.3): the part tree (parts mounted on parts), closed-form mechanisms and morphing shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partPose, partGeometry, partShape, validateTree, mechanism, MECHANISMS, MachineSim } from '../../src/engine/machines.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('part tree: a child pivot rides on its parent (elbow arm)', () => {
  const upper = { type: 'capsule', pivot: [500, 900], angle: 0, u0: 0, u1: 200, thick: 20, motion: { rotate: { dir: 1, omega: Math.PI / 2 } } };
  const fore = { type: 'capsule', parent: 0, pivot: [200, 0], angle: 0, u0: 0, u1: 150, thick: 16, motion: {} };
  const parts = [upper, fore];
  // at t = 1 the upper arm points straight down (+90°): the elbow is 200 px below the shoulder
  const e = partPose(fore, 1, parts);
  assert.ok(close(e.x, 500, 1e-6) && close(e.y, 1100, 1e-6), `elbow at ${e.x},${e.y}`);
  assert.ok(close(e.a, Math.PI / 2, 1e-6));
  // the forearm's tip follows: 150 px further down
  const g = partGeometry(fore, e);
  assert.ok(close(g.b[0], 500, 1e-6) && close(g.b[1], 1250, 1e-6));
});

test('part tree: a crane trolley slides on its rail and the claw swings below it', () => {
  const rail = { type: 'poly', static: true, pivot: [540, 400], pts: [[-300, -8], [300, -8], [300, 8], [-300, 8]], motion: {} };
  const trolley = { type: 'poly', parent: 0, pivot: [0, 20], pts: [[-30, -12], [30, -12], [30, 12], [-30, 12]], motion: { slide: { axis: [1, 0], amp: 200, period: 4 } } };
  const cable = { type: 'capsule', parent: 1, pivot: [0, 12], angle: Math.PI / 2, u0: 0, u1: 300, thick: 3, motion: { oscillate: { amp: 0.3, period: 2 } } };
  const parts = [rail, trolley, cable];
  const t1 = partPose(trolley, 1, parts);                          // quarter period: slide at +amp
  assert.ok(close(t1.x, 740, 1e-6) && close(t1.y, 420, 1e-6));
  const c = partPose(cable, 1, parts);
  assert.ok(close(c.x, 740, 1e-6) && close(c.y, 432, 1e-6), 'the cable hangs from the trolley');
});

test('part tree: parents must come first (no cycles), and a child without the list is an error', () => {
  assert.throws(() => validateTree([{ parent: 1 }, {}]), /earlier part/);
  assert.throws(() => validateTree([{ parent: 0 }]), /earlier part/);
  assert.ok(validateTree([{}, { parent: 0 }, { parent: 1 }]));
  assert.throws(() => partPose({ parent: 0, pivot: [0, 0] }, 0), /parts list/);
});

test('mechanisms: quick return closes slowly and opens fast; slam drops faster than it lifts', () => {
  const q = { kind: 'quickReturn', period: 1, slow: 0.75, to: [0, 0, 1] };
  assert.ok(close(mechanism(q, 0).a, 0) && close(mechanism(q, 0.75).a, 1));
  const riseRate = mechanism(q, 0.4).a - mechanism(q, 0.35).a, fallRate = mechanism(q, 0.85).a - mechanism(q, 0.9).a;
  assert.ok(fallRate > riseRate * 2, `fall ${fallRate} vs rise ${riseRate}`);
  const s = { kind: 'slam', period: 2, rise: 0.5, fall: 0.1, to: [0, -100, 0] };
  assert.ok(close(mechanism(s, 1).y, -100) && close(mechanism(s, 1.2).y, 0) && close(mechanism(s, 1.6).y, 0));
  for (const kind of MECHANISMS) assert.ok(typeof kind === 'string');
  assert.throws(() => mechanism({ kind: 'nope', period: 1 }, 0), /unknown mechanism/);
});

test('mechanisms: ratchet advances in whole steps; planet traces an epicycle', () => {
  const r = { kind: 'ratchet', period: 1, dwell: 0.5, to: [0, 0, 0.5] };
  assert.ok(close(mechanism(r, 0.3).a, 0) && close(mechanism(r, 1.3).a, 0.5) && close(mechanism(r, 2.3).a, 1));
  const p = mechanism({ kind: 'planet', R1: 100, w1: 1, R2: 20, w2: 5 }, 0);
  assert.ok(close(p.x, 120, 1e-6) && close(p.y, 0, 1e-6));
});

test('morph: a claw blends into a cage and back', () => {
  const p = { type: 'poly', pivot: [0, 0], pts: [[0, 0], [10, 0], [10, 10]], morph: { period: 2, to: [[0, 0], [20, 0], [20, 20]] }, motion: {} };
  const s0 = partShape(p, 0); assert.ok(close(s0[1][0], 10, 1e-6) && close(s0[2][1], 10, 1e-6));
  const mid = partShape(p, 1);
  assert.ok(close(mid[1][0], 20, 1e-6) && close(mid[2][1], 20, 1e-6));
});

test('a machine with mounted parts runs deterministically and splits balls', () => {
  const R = 400, cx = 540, cy = 960;
  const machine = {
    arena: { cx, cy, r: R }, start: [cx, cy - 100], ballR: 14, maxBalls: 400, gravity: 900, substeps: 4,
    damping: 0.999, vmax: 2400, softCorr: 2, vPinch: 40, pileSqueeze: 0.9, immuneFrames: 18, splitInto: 2, ejectSpeed: 260,
    pinchRule: 'contact', safetyCap: 25, finaleHold: 1, outro: 1, goldWaveSpeed: 900, ending: { type: 'cap-gold' },
    parts: [
      { type: 'capsule', pivot: [cx, cy - R], angle: Math.PI / 2, u0: 0, u1: 300, thick: 22, motion: { oscillate: { amp: 0.7, period: 2.4 } } },
      { type: 'capsule', parent: 0, pivot: [300, 0], angle: 0, u0: 0, u1: 220, thick: 20, motion: { mech: { kind: 'quickReturn', period: 1.6, to: [0, 0, 1.4] } } },
      { type: 'poly', static: true, pivot: [cx, cy + 250], pts: [[-140, -40], [140, -40], [180, 40], [-180, 40]], motion: {} },
    ],
  };
  const run = () => { const sim = new MachineSim({ seed: 5, machine }); let h = 0; while (!sim.done) { sim.step(); h = (h * 31 + sim.count) >>> 0; } return [h, sim.peak]; };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.ok(a[1] > 1, `peak ${a[1]}`);
});

test('phase-2 machines: listed, on the contact rule, deterministic, and they split', async () => {
  const { getScenario, listedScenarios } = await import('../../src/scenarios/index.js');
  const { applyControls } = await import('../../src/scenarios/controls.js');
  const keys = listedScenarios().map((s) => s.key);
  for (const k of ['croc-jaws@1', 'fist-arm@1', 'hammer-bowl@1', 'shears-fan@1', 'fan-blades@1', 'laser-spin@1']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('claw-machine@1'), 'the claw is registered but not offered yet');
  for (const k of ['croc-jaws@1', 'hammer-bowl@1', 'fan-blades@1']) {
    const sc = getScenario(k), cfg = applyControls(sc.generate(3), { target: 200 });
    const run = () => { const sim = sc.createSim(cfg); let h = 0; for (let f = 0; f < 900 && !sim.done; f++) { sim.step(); h = (h * 31 + sim.count + Math.round(sim.x[0])) >>> 0; } return [h, sim.peak]; };
    const a = run(); assert.deepEqual(a, run(), k); assert.ok(a[1] > 10, `${k} peak ${a[1]}`);
  }
});

test('inventor: every seed is a different, named, reproducible machine, never picked at random', async () => {
  const { getScenario, listedScenarios, randomScenarios } = await import('../../src/scenarios/index.js');
  const sc = getScenario('invent@1');
  assert.ok(listedScenarios().includes(sc) && !randomScenarios().includes(sc));
  const names = new Set(), families = new Set();
  for (let s = 1; s <= 12; s++) {
    const a = sc.generate(s), b = sc.generate(s);
    assert.deepEqual(a, b, `seed ${s} reproduces`);
    assert.ok(a.invented.name.length > 10 && a.machine.pinchRule === 'contact');
    names.add(a.invented.name); families.add(a.invented.family);
  }
  assert.ok(names.size >= 10, `only ${names.size} different machines`);
  assert.equal(families.size, 3);
});

test('saved machines: a variation keeps every shape, only rhythm moves; a deleted pattern still replays', async () => {
  const { getScenario, registerSaved, listedScenarios } = await import('../../src/scenarios/index.js');
  const { baseFrom, deriveMachine } = await import('../../src/scenarios/saved.js');
  const inv = getScenario('invent@1').generate(6, { precheck: false });
  const base = baseFrom(inv, 'abc123');
  registerSaved([{ key: 'mine-test@1', label: 'Test machine', base }]);
  const sc = getScenario('mine-test@1');
  assert.ok(listedScenarios().includes(sc));
  const a = sc.generate(11), b = sc.generate(12);
  assert.deepEqual(a, sc.generate(11));
  assert.deepEqual(a.machine.parts.map((p) => p.pts || p.u1 || p.r), inv.machine.parts.map((p) => p.pts || p.u1 || p.r), 'shapes unchanged');
  assert.notDeepEqual(a.machine.parts[0].motion, b.machine.parts[0].motion, 'rhythm varies with the seed');
  const v = deriveMachine(inv, 99, 'invent@1');
  assert.equal(v.scenario, 'invent@1'); assert.equal(v.seed, 99);
  registerSaved([]);
  assert.ok(!listedScenarios().some((s) => s.key === 'mine-test@1'));
  assert.equal(typeof getScenario('mine-test@1').createSim, 'function');
});
