// split-chamber scenario family. @1 is the frozen v1 engine and look (bit-exact with baseline/v1).
import { Simulation } from '../sim/sim.js';
import { CRUSH } from '../sim/config.js';
import { hash32 } from '../engine/rng.js';

export const VERSIONS = { engine: 1, renderer: 1, audio: 1, frame: 1 };

/** Frozen v1 simulation factory (also used by the determinism gate). */
export function createLegacySim(seed) {
  return new Simulation(seed);
}

export const splitChamberV1 = {
  id: 'split-chamber', version: 1, key: 'split-chamber@1', mode: 'swarm',
  label: 'Split Chamber (v1)', listed: false, // superseded for the factory by @2; kept for reproduction
  generate(seed) {
    return {
      scenario: 'split-chamber@1', seed: seed >>> 0, mode: 'swarm',
      duration: { minS: 20, maxS: 30 },
      render: { kind: 'split-chamber', partTimeOffsetFrames: 0 },
      versions: { ...VERSIONS },
    };
  },
  createSim(config) { return createLegacySim(config.seed); },
  checks(config) { return { duration: config.duration }; },
};

/** split-chamber@2: same physics and look as @1, longer arc (cap ~25 s, total ~34 s) and the T1 timing fix. */
// startSpeed 60: the first ball lingers in both press lanes, so the first closure (0.5 s) always catches it (hook)
export const SPLIT_V2_PARAMS = { crush: CRUSH, finaleHold: 5.5, outro: 3.5, safetyCap: 55, startSpeed: 60, pacing: { p0: 0.5, pmin: 0.02, capTime: 25 } };
export const splitChamberV2 = {
  id: 'split-chamber', version: 2, key: 'split-chamber@2', mode: 'swarm', label: 'Split Chamber', listed: true,
  generate(seed) {
    seed >>>= 0;
    const capTime = 23 + (hash32(seed, 0x5c2, 1, 1) % 41) / 10;   // 23.0–27.0 s, per video
    return {
      scenario: 'split-chamber@2', seed: seed >>> 0, mode: 'swarm',
      duration: { minS: 30, maxS: 40 },
      tempo: { bpm: 100, beatsPerBar: 4 },   // press cycle 1.2 s = 2 beats at 100 BPM
      params: { ...SPLIT_V2_PARAMS, pacing: { ...SPLIT_V2_PARAMS.pacing, capTime } },
      render: { kind: 'split-chamber', partTimeOffsetFrames: 1 },
      versions: { ...VERSIONS, renderer: 2, audio: 2 },
    };
  },
  createSim(config) { return new Simulation(config.seed, config.params); },
  checks(config) { return { duration: config.duration }; },
};
