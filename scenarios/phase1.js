// Phase 1 (owner feedback 2026-11-06): every listed pattern on ONE engine (src/engine/machines.js) with ONE rule:
// solid parts always collide, a ball pinched between a moving part and another surface always splits, and the only
// part balls pass through is a glowing laser (which splits what it touches).
//   orbit-crusher@2   two blade pairs turning in opposite directions around a pull toward the centre: scissor cuts
//   split-chamber@3   four solid presses, top/bottom and left/right pairs closing in turn, mild pull to the centre
//   rotary-sweeper@3  the rotary sweeper rebuilt on the machine engine (arms + fixed wedges), so every control applies
//   laser-cross@1     rotating laser beams sweep through a pile; fixed wedges catch the balls (owner reference 43)
import { MachineSim } from '../engine/machines.js';
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';
import { baseMachine, finalize, wrap } from './machines.js';
import { wedge } from './rotary-sweeper.js';
import { wallsV2, kaleidoscopeV2 } from './contact-v2.js';

const TAU = 6.283185307179586;
const ARENA = { cx: 540, cy: 1000, r: 460 };
const VERSIONS = { engine: 3, renderer: 2, audio: 2, frame: 1, rule: 2 };
const r01 = (seed, salt, k) => rand(seed, salt, k, 0);
const range = (seed, salt, lo, hi, k) => lo + r01(seed, salt, k) * (hi - lo);
const pick = (seed, salt, arr, k) => arr[Math.floor(r01(seed, salt, k) * arr.length)];
/** Whole beats per revolution nearest to a target angular speed. */
const beatsOmega = (bpm, target) => { const beat = 60 / bpm, n = Math.max(2, Math.round(TAU / (target * beat))); return TAU / (n * beat); };

// shared contact-rule settings for every phase-1 machine
const RULE = { pinchRule: 'contact', safetyCap: 40, checkSolid: true };
function v2(cfg) {
  cfg.duration = { minS: 30, maxS: 50 };
  cfg.checks = { ...(cfg.checks || {}), climaxFillMin: 0.5, solidMax: 0.035 };
  cfg.versions = { ...VERSIONS };
  return cfg;
}
const module = (key, label, gen, defaults) => ({
  id: key.split('@')[0], version: Number(key.split('@')[1]), key, mode: 'packed', label, listed: true, defaults,
  generate: (seed, opts = {}) => gen(seed >>> 0, opts),
  createSim(config) { return new MachineSim(config); },
  checks(config) { return { duration: config.duration }; },
});

export const orbitCrusherV2 = module('orbit-crusher@2', 'Orbit Crusher', (seed, o) => {
  const S = 0x6a1, bpm = Math.round(range(seed, S, 92, 120, 1));
  const omega = beatsOmega(bpm, (o.tune && o.tune.omega) || 0.5);
  const base = r01(seed, S, 2) * TAU, pairs = 1;
  const parts = [];
  for (let k = 0; k < pairs * 2; k++) {
    const dir = k % 2 ? -1 : 1, a = base + Math.floor(k / 2) * (TAU / (pairs * 2)) + (k % 2) * 0.9;
    for (const end of [0, Math.PI]) parts.push({ type: 'capsule', pivot: [ARENA.cx, ARENA.cy], angle: a + end, u0: 50, u1: ARENA.r - 16, thick: 9, motion: { rotate: { dir, omega } } });
  }
  const sa = base + 0.45;                    // between two blades that are about to cross
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, hubR: 46, ballR: (o.tune && o.tune.ballR) || 7, gravityChance: 1, gravityMode: 'center',
    start: [ARENA.cx + dcos(sa) * 170, ARENA.cy + dsin(sa) * 170], ...(o.tune || {}) }));
  m.gravity = m.gravity * 0.8; m.bladeCount = pairs * 4;
  const cfg = v2(wrap('orbit-crusher@2', 'Orbit Crusher', m, seed, { bpm, beatsPerBar: 4 }));
  cfg.checks.solidMax = 0.06;   // two blades crossing overlap each other for an instant: only balls at that point
  return cfg;
}, { gravity: 'center' });

export const splitChamberV3 = module('split-chamber@3', 'Split Chamber', (seed, o) => {
  const S = 0x7b2, bpm = Math.round(range(seed, S, 90, 118, 1));
  const period = pick(seed, S, [2, 2, 4], 2) * 60 / bpm * ((o.tune && o.tune.slow) || 1);
  const mid = 200, amp = 200 - (13 + 2.5), half = 230, parts = [];   // closed: the pair's faces are ~1 ball apart
  const bars = [[0, -1, 0], [0, 1, 0], [-1, 0, Math.PI], [1, 0, Math.PI]];   // [dx, dy, phase]: pairs close in turn
  for (const [dx, dy, ph] of bars) {
    const horizontal = dx === 0;
    parts.push({ type: 'capsule', pivot: [ARENA.cx + dx * mid, ARENA.cy + dy * mid], angle: horizontal ? 0 : Math.PI / 2, u0: -half, u1: half, thick: 13,
      motion: { slide: { axis: [-dx, -dy], amp, period, phase: ph - Math.PI / 2, square: true } } });
  }
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, ballR: (o.tune && o.tune.ballR) || 9, gravityChance: 1, gravityMode: 'center',
    start: [ARENA.cx + 4, ARENA.cy - 6], ...(o.tune || {}) }));
  m.gravity = 480 + r01(seed, S, 5) * 200;
  return v2(wrap('split-chamber@3', 'Split Chamber', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'center' });

export const rotarySweeperV3 = module('rotary-sweeper@3', 'Rotary Sweeper', (seed, o) => {
  const S = 0x8c3, bpm = Math.round(range(seed, S, 90, 120, 1));
  const omega = beatsOmega(bpm, (o.tune && o.tune.omega) || 1.8) * (r01(seed, S, 2) < 0.5 ? 1 : -1);
  const arms = pick(seed, S, [2, 2, 3], 3), phase = r01(seed, S, 4) * TAU;
  const parts = [];
  for (let k = 0; k < arms; k++) parts.push({ type: 'capsule', pivot: [ARENA.cx, ARENA.cy], angle: phase + k * TAU / arms, u0: 58, u1: ARENA.r - 8, thick: 9, motion: { rotate: { dir: Math.sign(omega), omega: Math.abs(omega) } } });
  const wedgeCount = pick(seed, S, [3, 4, 5, 6], 5), wPhase = r01(seed, S, 6) * TAU, rin = range(seed, S, 190, 280, 7);
  for (let k = 0; k < wedgeCount; k++) {
    const pts = wedge(ARENA, wPhase + k * TAU / wedgeCount, rin, 0.07, 0.2).map(([x, y]) => [x - ARENA.cx, y - ARENA.cy]);
    parts.push({ type: 'poly', static: true, pivot: [ARENA.cx, ARENA.cy], angle: 0, pts, motion: {} });
  }
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, hubR: 58, ballR: 12, gravityChance: 1, freeFraction: 0.8,
    start: [ARENA.cx + dcos(phase + 0.5) * 230, ARENA.cy + dsin(phase + 0.5) * 230], ...(o.tune || {}) }));
  return v2(wrap('rotary-sweeper@3', 'Rotary Sweeper', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

export const laserCrossV1 = module('laser-cross@1', 'Laser Cross', (seed, o) => {
  const S = 0x9d4, bpm = Math.round(range(seed, S, 92, 120, 1));
  const omega = beatsOmega(bpm, (o.tune && o.tune.omega) || 0.7) * (r01(seed, S, 2) < 0.5 ? 1 : -1);
  const beams = pick(seed, S, [2, 2, 3], 3), phase = r01(seed, S, 4) * TAU;
  const parts = [];
  for (let k = 0; k < beams; k++) parts.push({ type: 'beam', pivot: [ARENA.cx, ARENA.cy], angle: phase + k * TAU / beams, u0: 36, u1: ARENA.r - 4, thick: 3, motion: { rotate: { dir: Math.sign(omega), omega: Math.abs(omega) } } });
  const wa = r01(seed, S, 5) * TAU, wn = pick(seed, S, [1, 2], 6);
  for (let k = 0; k < wn; k++) {
    const pts = wedge(ARENA, wa + k * Math.PI, 300, 0.09, 0.22).map(([x, y]) => [x - ARENA.cx, y - ARENA.cy]);
    parts.push({ type: 'poly', static: true, pivot: [ARENA.cx, ARENA.cy], angle: 0, pts, motion: {} });
  }
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, hubR: 32, ballR: 8.5, gravityChance: 1, splitInto: 2,
    beamImmune: Math.round(((o.tune && o.tune.immune) || 2.0) * 60), start: [ARENA.cx + dcos(phase + 0.22 * Math.sign(omega)) * 200, ARENA.cy + dsin(phase + 0.22 * Math.sign(omega)) * 200], ...(o.tune || {}) }));
  m.bladeCount = beams;
  return v2(wrap('laser-cross@1', 'Laser Cross', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

// walls@3 / kaleidoscope@3: the @2 machines closed until their parts overlapped, so balls between them ended up
// inside the metal (measured: 100 % / 5–11 % of balls at the worst moment). v3 stops each closing about one ball apart.
function derive(src, key, fix) {
  return { ...src, key, version: Number(key.split('@')[1]), listed: true,
    generate(seed, opts = {}) { const cfg = src.generate(seed, opts); cfg.scenario = key; fix(cfg.machine); cfg.machine.checkSolid = true;
      cfg.checks = { ...cfg.checks, solidMax: 0.035 }; cfg.versions = { ...cfg.versions, rule: 3 }; return cfg; } };
}
export const wallsV3 = derive(wallsV2, 'walls@3', (m) => { for (const p of m.parts) { p.motion.slide.amp = 171 - (12 + 3); p.motion.slide.period *= 0.8; } });
export const kaleidoscopeV3 = derive(   // unlisted for now: no gap is both safe and productive (phase 2 redesign)
 kaleidoscopeV2, 'kaleidoscope@3', (m) => {
  for (const p of m.parts) { p.motion.radial.amp *= 0.97; p.pts = p.pts.map(([x, y], i) => (i ? [x, y * 0.93] : [x, y])); }
});
