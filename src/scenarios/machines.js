// Step-5 mechanism families on the generic machine engine (src/engine/machines.js):
//   jaws@1         Scissor Jaws — V-shaped jaws on a hub open/close and slowly rotate (ref 12)
//   rams@1         Melodic Rams — pendulum rams with hammer heads; every swing is faster (rams image, ref 05)
//   kaleidoscope@1 Kaleidoscope Press — N triangles contract radially into a mandala and release (ref 11)
//   walls@1        Press Walls — two full-height walls slide in from the sides (ref 13)
import { MachineSim } from '../engine/machines.js';
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';

const VERSIONS = { engine: 2, renderer: 1, audio: 2, frame: 1 };
const TAU = 6.283185307179586;
const r01 = (seed, salt, k) => rand(seed, salt, k, 0);
const range = (seed, salt, lo, hi, k) => lo + r01(seed, salt, k) * (hi - lo);
const pick = (seed, salt, arr, k) => arr[Math.floor(r01(seed, salt, k) * arr.length)];
const ARENA = { cx: 540, cy: 1000, r: 460 };

export function baseMachine(seed, salt, over) {
  const ballR = over.ballR || 8.5;
  const free = Math.PI * ARENA.r * ARENA.r * (over.freeFraction || 0.9);
  const maxBalls = Math.floor(0.6 * free / (Math.PI * ballR * ballR) / 50) * 50;
  return {
    arena: ARENA, ballR, maxBalls, splitInto: 3, hubR: 0,
    gravity: r01(seed, salt, 90) < (over.gravityChance ?? 0.6) ? range(seed, salt, 500, 800, 91) : 0,
    substeps: 12, damping: 0.9995, vmax: 1600, softCorr: 0.6, vPinch: 30, pileSqueeze: 0.18, immuneFrames: 12, ejectSpeed: 260,
    pacing: { p0: 0.5, pmin: 0.005, capTime: Math.round(range(seed, salt, 25.5, 30.5, 92) * 10) / 10 },
    finaleHold: 3.0, outro: 2.5, safetyCap: 45, goldWaveSpeed: 1150,
    ending: r01(seed, salt, 93) < (over.breakChance ?? 0.6) ? { type: 'rim-break', gapHalf: 0.55, gravity: 1400, duration: 3.0 } : { type: 'cap-gold', gapHalf: 0.5 },
    beatPart: 0,
    ...over,
  };
}

/** The gold ending has no 3 s rim-break segment: hold the gold finale longer instead. */
export function finalize(m) { if (m.ending.type !== 'rim-break') m.finaleHold = 5.5; return m; }

export function wrap(key, label, machine, seed, tempo, extra = {}) {
  return {
    scenario: key, seed, mode: 'packed',
    duration: { minS: 30, maxS: 45 },
    checks: { coverageMin: 0.006 },   // ~2,200-ball cap: half-time coverage on the pacing curve is ~0.8–3 %; stalls are ~0.1 %
    tempo,
    machine,
    render: { kind: 'machine', partTimeOffsetFrames: 1, arena: machine.arena, parts: machine.parts, ballR: machine.ballR, hubR: machine.hubR, ending: machine.ending, maxBalls: machine.maxBalls, finaleHold: machine.finaleHold },
    versions: { ...VERSIONS },
    ...extra,
  };
}

const module = (key, label, gen) => ({
  id: key.split('@')[0], version: 1, key, mode: 'packed', label, listed: true,
  generate: (seed, opts = {}) => gen(seed >>> 0, opts),
  createSim(config) { return new MachineSim(config); },
  checks(config) { return { duration: config.duration }; },
});

export const jawsV1 = module('jaws@1', 'Scissor Jaws', (seed) => {
  const S = 0x1a3, bpm = Math.round(range(seed, S, 92, 120, 1));
  const beat = 60 / bpm, period = pick(seed, S, [4, 8], 2) * beat;          // one open/close per 4 or 8 beats
  const pairs = pick(seed, S, [1, 1, 2], 3);
  const rot = { dir: r01(seed, S, 4) < 0.5 ? 1 : -1, omega: TAU / (pick(seed, S, [16, 32], 5) * beat) };
  const base = r01(seed, S, 6) * TAU, open = 0.5, amp = 0.44;
  const parts = [];
  for (let p = 0; p < pairs; p++) {
    const b = base + p * Math.PI;
    for (const sgn of [1, -1]) {
      parts.push({ type: 'capsule', pivot: [ARENA.cx, ARENA.cy], angle: b + sgn * open, u0: 52, u1: ARENA.r - 18, thick: 11,
        motion: { rotate: rot, oscillate: { amp: -sgn * amp, period, phase: 0 } } });
    }
  }
  const machine = finalize(baseMachine(seed, S, { parts, hubR: 52, start: [ARENA.cx + dcos(base) * 220, ARENA.cy + dsin(base) * 220] }));
  return wrap('jaws@1', 'Scissor Jaws', machine, seed, { bpm, beatsPerBar: 4 });
});

export const ramsV1 = module('rams@1', 'Melodic Rams', (seed) => {
  const S = 0x2b4, bpm = Math.round(range(seed, S, 88, 116, 1));
  const period = pick(seed, S, [4, 6], 2) * 60 / bpm;
  const count = 2;   // a counter-swinging pair meets at the bottom (single rams stalled growth)
  const amp = range(seed, S, 0.95, 1.2, 4);
  const parts = [];
  for (let k = 0; k < count; k++) {
    const motion = { swing: { amp, period, phase: k * Math.PI, speedUp: 0.022 } };       // every swing a little faster
    parts.push({ type: 'capsule', pivot: [ARENA.cx, ARENA.cy], angle: Math.PI / 2, u0: 0, u1: 330, thick: 9, motion });
    parts.push({ type: 'circle', pivot: [ARENA.cx, ARENA.cy], angle: Math.PI / 2, at: [398, 0], r: 46, motion });   // head edge 444: squeezes balls against the rim
  }
  const sa = Math.PI / 2 + 0.45 * amp;   // beside the rest position: the head reaches it at full swing speed
  const machine = finalize(baseMachine(seed, S, { parts, hubR: 38, gravityChance: 1, breakChance: 0.5, start: [ARENA.cx + dcos(sa) * 398, ARENA.cy + dsin(sa) * 398] }));
  return wrap('rams@1', 'Melodic Rams', machine, seed, { bpm, beatsPerBar: 4 }, { caption: { escalation: true } });
});

export const kaleidoscopeV1 = module('kaleidoscope@1', 'Kaleidoscope Press', (seed) => {
  const S = 0x3c5, bpm = Math.round(range(seed, S, 96, 124, 1));
  const N = pick(seed, S, [5, 6, 6, 7, 8], 2);
  const period = pick(seed, S, [2, 4], 3) * 60 / bpm * 2;
  const rot = r01(seed, S, 4) * TAU;
  const half = Math.PI / N * 0.95, ri = 175, ro = 380, amp = 140;   // narrow gaps: closing triangles squeeze what is between them
  const parts = [];
  for (let k = 0; k < N; k++) {
    const a = rot + k * TAU / N;
    // triangle in local coords (x outward): apex inward, wide base outward
    const pts = [[ri, 0], [ro, -Math.tan(half) * ro], [ro, Math.tan(half) * ro]];
    parts.push({ type: 'poly', pivot: [ARENA.cx, ARENA.cy], angle: a, pts,
      motion: { radial: { amp, period, phase: 0, dir: [-dcos(a), -dsin(a)] } } });
  }
  const machine = finalize(baseMachine(seed, S, { parts, gravityChance: 0.6, freeFraction: 0.7, start: [ARENA.cx + dcos(rot) * 110, ARENA.cy + dsin(rot) * 110] }));   // on triangle 0's apex path
  return wrap('kaleidoscope@1', 'Kaleidoscope Press', machine, seed, { bpm, beatsPerBar: 4 });
});

export const wallsV1 = module('walls@1', 'Press Walls', (seed) => {
  const S = 0x4d6, bpm = Math.round(range(seed, S, 90, 120, 1));
  const period = pick(seed, S, [4, 8], 2) * 60 / bpm;
  const tilt = (r01(seed, S, 3) - 0.5) * 0.5;                              // walls may be slightly tilted
  const half = 159, open = 171;
  const parts = [];
  for (const sgn of [1, -1]) {
    const ax = sgn > 0 ? 1 : -1;
    parts.push({ type: 'capsule', pivot: [ARENA.cx - sgn * open, ARENA.cy], angle: Math.PI / 2 + tilt, u0: -520, u1: 520, thick: 12,
      motion: { slide: { axis: [ax, 0], amp: half, period, phase: -Math.PI / 2, square: true } } });
  }
  const machine = finalize(baseMachine(seed, S, { parts, start: [ARENA.cx + 6, ARENA.cy - 40] }));
  return wrap('walls@1', 'Press Walls', machine, seed, { bpm, beatsPerBar: 4 });
});
