// The "Balls" control (3.6): the count you ask for is the count the arena is full at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getScenario } from '../../src/scenarios/index.js';
import { applyControls, wantedBalls, radiusForBalls, splitIntoFor, BALL_R_MIN, BALL_R_MAX } from '../../src/scenarios/controls.js';
import { invent2, FAMILIES, FREE } from '../../src/scenarios/inventor2.js';

test('balls: the count is clamped to 100…20,000 and empty means auto', () => {
  assert.equal(wantedBalls(''), 0); assert.equal(wantedBalls('auto'), 0); assert.equal(wantedBalls(0), 0);
  assert.equal(wantedBalls(5), 100); assert.equal(wantedBalls('10000'), 10000); assert.equal(wantedBalls(1e9), 20000);
});

test('balls: more balls are smaller, inside the size limits; small balls split into more pieces', () => {
  assert.ok(radiusForBalls(10000) < radiusForBalls(1000));
  assert.equal(radiusForBalls(1e7), BALL_R_MIN); assert.equal(radiusForBalls(10), BALL_R_MAX);
  assert.equal(splitIntoFor(10), 3); assert.ok(splitIntoFor(3) > 3); assert.ok(splitIntoFor(0.5) <= 8);
});

test('balls: without a count nothing changes (old videos and default batches)', () => {
  for (const key of ['jaws@2', 'invent@2']) {
    const sc = getScenario(key), o = key === 'invent@2' ? { precheck: false } : {};
    assert.deepEqual(applyControls(sc.generate(7, o), { balls: 'auto' }), applyControls(sc.generate(7, o), {}));
  }
});

test('balls: every inventor family is built for the count, and its table of open space is right', () => {
  for (const family of Object.keys(FAMILIES)) {
    const big = invent2(11, family, 0, 10000), std = invent2(11, family, 0);
    assert.ok(big.ballR < 4 && big.ballR >= BALL_R_MIN, `${family}: ball ${big.ballR}`);
    assert.equal(big.freeFraction, FREE[family], `${family}: FREE table`);
    assert.ok(std.ballR >= 9, `${family}: default ball unchanged`);
  }
});

test('balls: an invented machine and a hand-written one are full at exactly the count asked', () => {
  for (const n of [500, 3000, 10000]) {
    const inv = applyControls(getScenario('invent@2').generate(5, { balls: n, precheck: false }), { balls: n });
    assert.equal(inv.machine.maxBalls, n); assert.equal(inv.render.maxBalls, n); assert.equal(inv.controls.balls, n);
    assert.equal(inv.render.ballR, inv.machine.ballR);
    const jaws = applyControls(getScenario('jaws@2').generate(5), { balls: n });
    assert.equal(jaws.machine.maxBalls, n); assert.equal(jaws.render.ballR, jaws.machine.ballR);
  }
  assert.ok(applyControls(getScenario('invent@2').generate(5, { balls: 10000, precheck: false }), { balls: 10000 }).machine.splitInto > 3);
});

test('balls: patterns tuned to one ball size keep it; the count only stops them earlier', () => {
  const sc = getScenario('rams@2'), plain = sc.generate(3), cfg = applyControls(sc.generate(3), { balls: 300 });
  assert.equal(cfg.machine.ballR, plain.machine.ballR); assert.equal(cfg.machine.maxBalls, 300);
  assert.equal(applyControls(sc.generate(3), { balls: 20000 }).machine.maxBalls, plain.machine.maxBalls);
});
