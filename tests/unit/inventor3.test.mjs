// Inventor v3: machines put together freely (layout × limbs × drive × elbow × tool × spin × phase).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario, listedScenarios, randomScenarios } from '../../src/scenarios/index.js';
import { invent3, LAYOUT_NAMES } from '../../src/scenarios/inventor3.js';
import { validateTree, partPose, partGeometry } from '../../src/engine/machines.js';
import { closest, similarFor, SIMILAR, SIMILAR_FREE } from '../../src/scenarios/novelty.js';
import { explainNovelty } from '../../src/pipeline/checks.js';

const ARENA = { cx: 540, cy: 1000, r: 460 };
const drawn = [];
for (let s = 0; s < 60; s++) { const layout = LAYOUT_NAMES[s % LAYOUT_NAMES.length], inv = invent3(500 + s * 131, layout, 0); if (inv) drawn.push({ layout, inv }); }

test('invent@3 is the inventor offered (not at random); invent@2 and invent@1 still replay', () => {
  const sc = getScenario('invent@3');
  assert.ok(listedScenarios().includes(sc) && !randomScenarios().includes(sc));
  assert.ok(!listedScenarios().includes(getScenario('invent@2')) && !listedScenarios().includes(getScenario('invent@1')));
  assert.deepEqual(sc.families, ['hub', 'ring', 'rim', 'twin', 'classic']);
});

test('invent@3: most draws fit, every layout appears, and a machine reproduces from its seed', () => {
  assert.ok(drawn.length >= 42, `${drawn.length} of 60 draws fit`);
  for (const l of LAYOUT_NAMES) assert.ok(drawn.some((d) => d.layout === l), `${l} appears`);
  const sc = getScenario('invent@3');
  for (const family of LAYOUT_NAMES) {
    const a = sc.generate(9, { family, precheck: false });
    assert.deepEqual(a, sc.generate(9, { family, precheck: false }), `${family} reproduces`);
    assert.ok(a.invented.name.length > 8 && a.invented.sig.startsWith('v2:') && a.machine.pinchRule === 'contact');
    assert.equal(a.scenario, 'invent@3');
  }
});

test('invent@3: the part tree is valid and no part is too many for the engine', () => {
  for (const { inv, layout } of drawn) {
    assert.ok(validateTree(inv.parts), layout);
    assert.ok(inv.parts.length <= 36 + 17, `${inv.name}: ${inv.parts.length} parts`);   // 36 machine parts + rim teeth and a laser
    for (const p of inv.parts) {
      if (p.type === 'poly') assert.ok(p.pts.length >= 3 && p.pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), inv.name);
      if (p.type === 'capsule') assert.ok(p.u1 > p.u0 && p.thick > 0, inv.name);
      if (p.type === 'circle') assert.ok(p.r > 0, inv.name);
    }
  }
});

test('invent@3: the machine stays inside the arena and passes its anvil one ball apart', () => {
  for (const { inv, layout } of drawn) {
    if (layout === 'classic') continue;   // invent@2's families place themselves
    const g = 1.1 * inv.ballR; let far = 0, near = Infinity;
    for (let t = 0; t < 24; t += 0.05) for (const p of inv.parts) {
      if (p.type === 'beam' || p.static) continue;
      const geo = partGeometry(p, partPose(p, t, inv.parts), t);
      const pts = geo.c ? [[geo.c[0], geo.c[1], geo.r]] : geo.a ? [[geo.a[0], geo.a[1], geo.thick], [geo.b[0], geo.b[1], geo.thick]] : geo.pts.map(([x, y]) => [x, y, 0]);
      for (const [x, y, rr] of pts) { const d = Math.hypot(x - ARENA.cx, y - ARENA.cy); far = Math.max(far, d + rr); near = Math.min(near, d - rr); }
    }
    if (layout === 'rim') assert.ok(near >= inv.hubR + 0.4 * g, `${inv.name}: comes ${near.toFixed(1)} from the centre, anvil ${inv.hubR}`);
    else assert.ok(far <= ARENA.r - g + 2 && far >= ARENA.r - g - 45, `${inv.name}: reaches ${far.toFixed(1)}`);
    assert.ok(inv.freeFraction >= 0.5 && inv.freeFraction <= 0.9);
    const [sx, sy] = inv.start; assert.ok(Math.hypot(sx - ARENA.cx, sy - ARENA.cy) <= ARENA.r - inv.ballR, `${inv.name}: first ball inside`);
  }
});

test('invent@3: its own threshold; a machine you have is never drawn again', () => {
  assert.equal(similarFor('invent@3'), SIMILAR_FREE); assert.equal(similarFor('invent@2'), SIMILAR); assert.ok(SIMILAR_FREE > SIMILAR);
  const sc = getScenario('invent@3'), a = sc.generate(21, { precheck: false });
  const b = sc.generate(21, { precheck: false, avoid: [a.invented.sig] });
  assert.notEqual(b.invented.sig, a.invented.sig);
  assert.ok(closest(b.invented.sig, [a.invented.sig]).sim < SIMILAR_FREE);
  const kept = [{ id: 'x1', invented: a.invented }];
  assert.equal(explainNovelty(a, kept).ok, false);
  assert.equal(explainNovelty(b, kept).ok, true);
});

test('novelty: the fast search gives the same answer as the full one at or above the floor', () => {
  const sigs = drawn.map((d) => d.inv.sig);
  for (let i = 1; i < Math.min(sigs.length, 16); i++) {
    const full = closest(sigs[i], sigs.slice(0, i)), fast = closest(sigs[i], sigs.slice(0, i), SIMILAR_FREE);
    if (full.sim >= SIMILAR_FREE) assert.deepEqual(fast, full); else assert.ok(fast.sim < SIMILAR_FREE);
  }
});

test('invent@3: many different machines (at least 30 of 60 draws differ from each other)', () => {
  const kept = [];
  for (const { inv } of drawn) if (closest(inv.sig, kept, SIMILAR_FREE).sim < SIMILAR_FREE) kept.push(inv.sig);
  assert.ok(kept.length >= 30, `${kept.length} different`);
});

test('invent@3: the beat accent comes on the beat, never every frame (no buzz)', async () => {
  const { MachineSim, FLAG_BEAT } = await import('../../src/engine/machines.js');
  for (const family of LAYOUT_NAMES) for (const seed of [3, 4]) {
    const cfg = getScenario('invent@3').generate(seed, { family, precheck: false });
    const sim = new MachineSim(cfg); let beats = 0;
    for (let f = 0; f < 600; f++) { sim.step(); if (sim.flags & FLAG_BEAT) beats++; }
    assert.ok(beats <= 60, `${family} seed ${seed}: ${beats} accents in 10 s`);
  }
});
