import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, crushChance, FLAG_CAP, FLAG_OUTRO } from '../../src/sim/sim.js';
import { encodeFrame, decodeFrame, serializeSession, parseSession, hashFrames, makeMeta, POS_SCALE } from '../../src/sim/session.js';
import { MAX_BALLS, FPS, ARENA, BALL_R, pistonExtension, PISTON } from '../../src/sim/config.js';

function runAll(seed) {
  const sim = new Simulation(seed);
  const frames = [];
  while (!sim.done) { sim.step(); frames.push(encodeFrame(sim)); }
  return { sim, frames };
}

const A = runAll(4242);

test('same seed produces bit-identical frames', () => {
  const B = runAll(4242);
  assert.equal(B.frames.length, A.frames.length);
  assert.equal(hashFrames(B.frames), hashFrames(A.frames));
});

test('different seeds diverge', () => {
  assert.notEqual(hashFrames(runAll(4243).frames), hashFrames(A.frames));
});

test('count never exceeds the cap, reaches exactly 10,000 and finale flags fire once', () => {
  let caps = 0, outros = 0, max = 0;
  for (const f of A.frames) { const d = decodeFrame(f); max = Math.max(max, d.n); if (d.flags & FLAG_CAP) caps++; if (d.flags & FLAG_OUTRO) outros++; }
  assert.equal(max, MAX_BALLS);
  assert.equal(caps, 1); assert.equal(outros, 1);
  assert.equal(A.sim.endFrame, A.frames.length - 1);
});

test('count is non-decreasing and grows by even steps (each fission adds two)', () => {
  let prev = 1;
  for (const f of A.frames) {
    const n = decodeFrame(f).n;
    assert.ok(n >= prev);
    assert.ok((n - prev) % 2 === 0 || n === MAX_BALLS);
    prev = n;
  }
});

test('every ball stays inside the arena', () => {
  for (let k = 0; k < A.frames.length; k += 17) {
    const d = decodeFrame(A.frames[k]);
    for (let i = 0; i < d.n; i++) {
      const x = d.xy[2 * i] / POS_SCALE - ARENA.cx, y = d.xy[2 * i + 1] / POS_SCALE - ARENA.cy;
      assert.ok(Math.hypot(x, y) <= ARENA.r - BALL_R + 0.1, `ball outside at frame ${k}`);
    }
  }
});

test('session file round-trips losslessly', () => {
  const buf = serializeSession(makeMeta(A.sim, A.frames.length), A.frames);
  const s = parseSession(buf);
  assert.equal(s.meta.seed, 4242);
  assert.equal(s.meta.frameCount, A.frames.length);
  assert.equal(hashFrames(s.frames), hashFrames(A.frames));
});

test('corrupt session files are rejected', () => {
  const buf = serializeSession(makeMeta(A.sim, A.frames.length), A.frames.slice(0, 10));
  const bad = buf.slice(0, buf.byteLength - 100);
  assert.throws(() => parseSession(new ArrayBuffer(64)));
  assert.throws(() => parseSession(bad));
});

test('pistons: pairs alternate and never close at the same time', () => {
  for (let t = 0; t < 30; t += 1 / 240) {
    assert.ok(!(pistonExtension(0, t) > 0.05 && pistonExtension(1, t) > 0.05), `overlap at ${t}`);
  }
  assert.equal(pistonExtension(1, PISTON.offsetV + PISTON.tExtend + 0.01), 1);
});

test('fission probability is a probability', () => {
  for (const n of [1, 10, 100, 1000, 9999]) { const p = crushChance(n); assert.ok(p > 0 && p <= 1); }
});

test('finale timing matches the reference pacing (10k between 13 s and 21 s)', () => {
  const t = A.sim.capFrame / FPS;
  assert.ok(t > 13 && t < 21, `cap at ${t}s`);
});
