// orbit-crusher@1: balls orbit a gravity well; rotating blades cut the orbits and every cut can split a ball
// into three. Swarm mode, new deterministic engine (src/engine/orbit.js).
import { OrbitSim } from '../engine/orbit.js';
import { rand } from '../engine/rng.js';

export const ORBIT_PACING = { p0: 0.5, pmin: 0.02 };   // capTime chosen per video; see tools/tune-orbit.mjs
const VERSIONS = { engine: 1, renderer: 1, audio: 2, frame: 1 };
const pick = (seed, n, purpose) => Math.floor(rand(seed, 0xc0f, n, purpose) * n);
const range = (seed, lo, hi, purpose) => lo + rand(seed, 0xc0f, 1, purpose) * (hi - lo);

export const orbitCrusherV1 = {
  id: 'orbit-crusher', version: 1, key: 'orbit-crusher@1', mode: 'swarm', label: 'Orbit Crusher', listed: true,
  generate(seed, opts = {}) {
    seed >>>= 0;
    const bpm = Math.round(range(seed, 92, 124, 1));
    const count = [1, 2, 2, 3][pick(seed, 4, 2)];
    const beatsPerRev = [4, 8][pick(seed, 2, 3)];
    const omega = 6.283185307179586 / (beatsPerRev * 60 / bpm);
    const dir = rand(seed, 0xc0f, 4, 4) < 0.5 ? 1 : -1;
    const orbitDir = -dir;   // always counter-rotating: co-rotating orbits can ride along a blade and never get cut
    const softening = 60, r = 250;
    const v = range(seed, 240, 330, 6);
    const gm = v * v * (r * r + softening * softening) / r;
    const arena = { cx: 540, cy: 1000, r: 460 };
    const blades = { count, omega, dir, phase: rand(seed, 0xc0f, 7, 7) * 6.283185307179586, length: 460 - 6.5 - 8 }; // reach the rim: no orbit can hide outside the blades
    const orbit = {
      arena, blades, gm, softening, dir: orbitDir, hubR: 64, ballR: 6.5,
      startRadius: range(seed, 210, 300, 8),
      startAngle: blades.phase + dir * range(seed, 0.8, 2.0, 11),   // just ahead of blade 0: first cut (hook) within ~0.5 s
      maxBalls: opts.maxBalls || 10000, splitInto: 3,
      childSpread: 0.35, radialKick: range(seed, 40, 90, 9), immuneFrames: 16, vmax: 1100, substeps: 4,
      pacing: { ...ORBIT_PACING, capTime: Math.round(range(seed, 24.5, 29.5, 10) * 10) / 10, ...(opts.pacing || {}) }, finaleHold: 5.0, outro: 3.5, safetyCap: 50, goldWaveSpeed: 1150,
    };
    return {
      scenario: 'orbit-crusher@1', seed, mode: 'swarm',
      duration: { minS: 30, maxS: 45 },
      tempo: { bpm, beatsPerBar: 4 },
      orbit,
      render: { kind: 'orbit', partTimeOffsetFrames: 1, blades, hubR: orbit.hubR, arena },
      versions: { ...VERSIONS },
    };
  },
  createSim(config) { return new OrbitSim(config); },
  checks(config) { return { duration: config.duration }; },
};
