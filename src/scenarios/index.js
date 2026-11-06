// Scenario registry. Keys are "id@version"; a version is frozen once any of its videos is accepted.
import { splitChamberV1, splitChamberV2 } from './split-chamber.js';
import { orbitCrusherV1 } from './orbit-crusher.js';
import { rotarySweeperV1 } from './rotary-sweeper.js';
import { jawsV1, ramsV1, kaleidoscopeV1, wallsV1 } from './machines.js';
import { rotarySweeperV2, jawsV2, ramsV2, kaleidoscopeV2, wallsV2 } from './contact-v2.js';
import { orbitCrusherV2, splitChamberV3, rotarySweeperV3, laserCrossV1, wallsV3, kaleidoscopeV3 } from './phase1.js';
import { PHASE2, PHASE3 } from './phase2.js';
import { inventV1 } from './inventor.js';
import { savedModule, orphanModule } from './saved.js';

// @1 of the packed families stays registered (frozen, reproducible) but is no longer offered: @2 replaces it.
const ALL = [splitChamberV1, splitChamberV2, orbitCrusherV1, rotarySweeperV1, jawsV1, ramsV1, kaleidoscopeV1, wallsV1,
  rotarySweeperV2, jawsV2, ramsV2, kaleidoscopeV2, wallsV2,
  splitChamberV3, orbitCrusherV2, rotarySweeperV3, laserCrossV1, wallsV3, kaleidoscopeV3, ...PHASE2, ...PHASE3, inventV1];
for (const s of PHASE3) if (s.key === 'claw-machine@1') s.listed = false;   // the claw still grows too slowly: registered, not offered
for (const s of [rotarySweeperV1, jawsV1, ramsV1, kaleidoscopeV1, wallsV1]) s.listed = false;
// phase 1: one engine, one rule. The swarm/packed versions stay registered (reproducible) but are no longer offered.
for (const s of [splitChamberV2, orbitCrusherV1, rotarySweeperV2, wallsV2, kaleidoscopeV2, kaleidoscopeV3]) s.listed = false;
export const SCENARIOS = Object.fromEntries(ALL.map((s) => [s.key, s]));
export const DEFAULT_SCENARIO = 'split-chamber@3';

/** Register the owner's saved machines (from the Studio settings); replaces any previously registered ones. */
export function registerSaved(list = []) {
  for (let i = ALL.length - 1; i >= 0; i--) if (ALL[i].saved) { delete SCENARIOS[ALL[i].key]; ALL.splice(i, 1); }
  for (const p of list) { const m = savedModule(p); ALL.push(m); SCENARIOS[m.key] = m; }
}

export function getScenario(key) {
  if (key && key.startsWith('mine-') && !SCENARIOS[key]) return orphanModule(key);   // a deleted saved pattern still replays
  const s = SCENARIOS[key || DEFAULT_SCENARIO];
  if (!s) throw new Error(`Unknown scenario "${key}"`);
  return s;
}

/** Scenarios offered in the UI / random generation. */
export function listedScenarios() { return ALL.filter((s) => s.listed !== false); }

/** Scenarios a "Random pattern" batch picks from (the inventor is chosen on purpose, never at random). */
export function randomScenarios() { return listedScenarios().filter((s) => s.random !== false); }

/** Config of an existing session; sessions saved before scenarios existed are split-chamber@1. */
export function configOf(meta) {
  return meta && meta.config ? meta.config : splitChamberV1.generate(meta ? meta.seed : 0);  // pre-scenario sessions are @1
}
