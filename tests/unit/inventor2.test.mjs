// Inventor v2: more families, and never the same machine twice (turned, mirrored or shifted counts as the same).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario, listedScenarios, randomScenarios } from '../../src/scenarios/index.js';
import { invent2, FAMILY_NAMES } from '../../src/scenarios/inventor2.js';
import { signature, similarity, SIMILAR } from '../../src/scenarios/novelty.js';
import { explainNovelty } from '../../src/pipeline/checks.js';

const turned = (parts, a) => parts.map((p) => (p.parent == null && p.type === 'circle' ? { ...p, angle: (p.angle || 0) + a } : p));
const mirrored = (parts) => parts.map((p) => (p.parent == null && p.type === 'circle' ? { ...p, angle: -(p.angle || 0) } : p));

test('invent@2 still replays (invent@3 replaced it in the list), has eight families and reproduces', () => {
  const sc = getScenario('invent@2');
  assert.ok(!listedScenarios().includes(sc) && !randomScenarios().includes(sc));
  assert.equal(FAMILY_NAMES.length, 8);
  for (const fam of FAMILY_NAMES) {
    const a = sc.generate(3, { family: fam, precheck: false });
    assert.deepEqual(a, sc.generate(3, { family: fam, precheck: false }), `${fam} reproduces`);
    assert.equal(a.invented.family, fam);
    assert.ok(a.invented.sig.startsWith('v2:'));
    assert.ok(a.invented.name.length > 8 && a.machine.pinchRule === 'contact');
  }
});

test('novelty: the same machine turned, mirrored or slightly resized is the same machine', () => {
  for (const fam of ['wave', 'kaleido', 'geneva']) {
    const inv = invent2(11, fam, 0);
    assert.ok(similarity(inv.sig, signature(turned(inv.parts, 1.3))) >= 0.85, `${fam} turned`);
    assert.ok(similarity(inv.sig, signature(mirrored(inv.parts))) >= 0.75, `${fam} mirrored`);
    const bigger = inv.parts.map((p) => (p.type === 'circle' && p.parent != null ? { ...p, r: p.r * 1.06 } : p.pts ? { ...p, pts: p.pts.map(([x, y]) => [x * 1.04, y * 1.04]) } : p));
    assert.ok(similarity(inv.sig, signature(bigger)) >= SIMILAR, `${fam} resized`);
  }
  assert.ok(similarity(invent2(5, 'wave', 0).sig, invent2(5, 'orbit', 0).sig) < SIMILAR, 'different families differ');
});

test('novelty: a machine you have is never drawn again; a batch has no two alike', () => {
  const sc = getScenario('invent@2'), avoid = [];
  for (let i = 0; i < 12; i++) {
    const cfg = sc.generate(900 + i, { family: FAMILY_NAMES[i % 8], avoid, precheck: false });
    for (const s of avoid) assert.ok(similarity(cfg.invented.sig, s) < SIMILAR, `invention ${i} is new`);
    avoid.push(cfg.invented.sig);
  }
  const a = sc.generate(42, { family: 'kaleido', precheck: false });
  const b = sc.generate(42, { family: 'kaleido', avoid: [a.invented.sig], precheck: false });
  assert.ok(similarity(a.invented.sig, b.invented.sig) < SIMILAR, 'same seed with that machine avoided → another machine');
});

test('novelty check: rejects a machine like one you kept, not a new rhythm of it', () => {
  const a = getScenario('invent@2').generate(7, { precheck: false });
  const kept = [{ id: 'v1', invented: a.invented }];
  assert.equal(explainNovelty(a, kept).ok, false);
  assert.equal(explainNovelty({ ...a, invented: { ...a.invented, variationOf: '7:invent@2' } }, kept), null);
  const other = getScenario('invent@2').generate(8, { avoid: [a.invented.sig], precheck: false });
  assert.equal(explainNovelty(other, kept).ok, true);
});

test('invent@2: the chosen machine is calibrated to land its finale near 33 s', () => {
  const a = getScenario('invent@2').generate(7000, { family: 'wave' });
  assert.match(a.invented.precheck, /speed ×[\d.]+ · finale ≈ \d+ s/);
});

test('invent@2: the beat accent comes on the beat, never every frame (no buzz)', async () => {
  const { MachineSim, FLAG_BEAT } = await import('../../src/engine/machines.js');
  for (const fam of FAMILY_NAMES) for (const seed of [3, 4]) {
    const cfg = getScenario('invent@2').generate(seed, { family: fam, precheck: false });
    const sim = new MachineSim(cfg); let beats = 0;
    for (let f = 0; f < 600; f++) { sim.step(); if (sim.flags & FLAG_BEAT) beats++; }
    assert.ok(beats <= 60, `${fam} seed ${seed}: ${beats} accents in 10 s`);
  }
});
