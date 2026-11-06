// Scenario registry. Keys are "id@version"; a version is frozen once any of its videos is accepted.
import { splitChamberV1, splitChamberV2 } from './split-chamber.js';
import { orbitCrusherV1 } from './orbit-crusher.js';
import { rotarySweeperV1 } from './rotary-sweeper.js';
import { jawsV1, ramsV1, kaleidoscopeV1, wallsV1 } from './machines.js';
import { rotarySweeperV2, jawsV2, ramsV2, kaleidoscopeV2, wallsV2 } from './contact-v2.js';

// @1 of the packed families stays registered (frozen, reproducible) but is no longer offered: @2 replaces it.
const ALL = [splitChamberV1, splitChamberV2, orbitCrusherV1, rotarySweeperV1, jawsV1, ramsV1, kaleidoscopeV1, wallsV1,
  rotarySweeperV2, jawsV2, ramsV2, kaleidoscopeV2, wallsV2];
for (const s of [rotarySweeperV1, jawsV1, ramsV1, kaleidoscopeV1, wallsV1]) s.listed = false;
export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.key, s]));
export const DEFAULT_SCENARIO = 'split-chamber@2';

export function getScenario(key) {
  const s = SCENARIOS[key || DEFAULT_SCENARIO];
  if (!s) throw new Error(`Unknown scenario "${key}"`);
  return s;
}

/** Scenarios offered in the UI / random generation. */
export function listedScenarios() { return ALL.filter((s) => s.listed !== false); }

/** Config of an existing session; sessions saved before scenarios existed are split-chamber@1. */
export function configOf(meta) {
  return meta && meta.config ? meta.config : splitChamberV1.generate(meta ? meta.seed : 0);  // pre-scenario sessions are @1
}
