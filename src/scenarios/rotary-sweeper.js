// rotary-sweeper@1 (Packed mode): rotating arms sweep the arena; balls squeezed between an arm and a fixed
// wedge (or the hub/rim) split into three. Balls collide and stack (optionally under gravity). Ending: the rim
// breaks at the bottom and the pile pours out.
import { PackedSim } from '../engine/packed.js';
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';

const VERSIONS = { engine: 1, renderer: 1, audio: 2, frame: 1 };
const r01 = (seed, k) => rand(seed, 0x5e3, k, 0);
const range = (seed, lo, hi, k) => lo + r01(seed, k) * (hi - lo);
const pick = (seed, arr, k) => arr[Math.floor(r01(seed, k) * arr.length)];

/** Trapezoid wedge from the rim inward, centred at angle a. */
function wedge(arena, a, rin, halfIn, halfOut) {
  const { cx, cy, r } = arena, ro = r + 200;   // far outside the rim: the outer edge must never be the nearest face
  const P = (rad, ang) => [cx + dcos(ang) * rad, cy + dsin(ang) * rad];
  return [P(rin, a - halfIn), P(ro, a - halfOut), P(ro, a + halfOut), P(rin, a + halfIn)];
}

export const rotarySweeperV1 = {
  id: 'rotary-sweeper', version: 1, key: 'rotary-sweeper@1', mode: 'packed', label: 'Rotary Sweeper', listed: true,
  generate(seed, opts = {}) {
    seed >>>= 0;
    const arena = { cx: 540, cy: 1000, r: 460 };
    const bpm = Math.round(range(seed, 90, 120, 1));
    const armCount = pick(seed, [1, 1, 2, 3], 2);
    const beatsPerRev = pick(seed, [4, 8, 8], 3);
    const omega = 6.283185307179586 / (beatsPerRev * 60 / bpm);
    const dir = r01(seed, 4) < 0.5 ? 1 : -1;
    const ballR = 8.5;
    const wedgeCount = pick(seed, [3, 4, 5, 6], 5);
    const wPhase = r01(seed, 6) * 6.283185307179586;
    const rin = range(seed, 170, 270, 7);
    const wedges = [];
    for (let k = 0; k < wedgeCount; k++) wedges.push(wedge(arena, wPhase + k * 6.283185307179586 / wedgeCount, rin, 0.07, 0.2));
    const gravity = r01(seed, 8) < 0.7 ? range(seed, 500, 800, 9) : 0;
    // ball cap from the free area (packing ~0.62 of the free space)
    const wedgeArea = wedgeCount * (0.2 + 0.07) * (arena.r * arena.r - rin * rin) / 2;
    const free = Math.PI * arena.r * arena.r - wedgeArea - Math.PI * 70 * 70;
    const maxBalls = opts.maxBalls || Math.floor(0.62 * free / (Math.PI * ballR * ballR) / 50) * 50;
    const packed = {
      arena, ballR, maxBalls, splitInto: 3, wedges,
      arms: { count: armCount, omega, dir, phase: r01(seed, 10) * 6.283185307179586, hubR: 60, length: arena.r - 6, thick: 9 },
      gravity, substeps: 12, damping: 0.9995, vmax: 1600, softCorr: 0.6, vPinch: 30, pileSqueeze: 0.18, immuneFrames: 12, ejectSpeed: 260,
      startRadius: range(seed, 150, 300, 11),
      pacing: { p0: 0.5, pmin: 0.02, capTime: Math.round(range(seed, 24.5, 29.5, 12) * 10) / 10, ...(opts.pacing || {}) },
      finaleHold: 3.0, outro: 2.5, safetyCap: 45, goldWaveSpeed: 1150,
      ending: { type: 'rim-break', gapHalf: 0.55, gravity: 1400, duration: 3.0 },
    };
    return {
      scenario: 'rotary-sweeper@1', seed, mode: 'packed',
      duration: { minS: 30, maxS: 45 },
      checks: { coverageMin: 0.018 },   // ~1,500 larger balls: emptiness threshold scaled to the packed cap
      tempo: { bpm, beatsPerBar: 4 },
      packed,
      render: { kind: 'packed', partTimeOffsetFrames: 1, arena, arms: packed.arms, wedges, ballR, ending: packed.ending, maxBalls, finaleHold: packed.finaleHold },
      versions: { ...VERSIONS },
    };
  },
  createSim(config) { return new PackedSim(config); },
  checks(config) { return { duration: config.duration }; },
};
