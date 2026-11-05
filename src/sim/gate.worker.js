// Runs the determinism gate inside an Electron worker (same V8 as the production pipeline).
import { GATE_SEEDS, runGateSeed } from './gate.js';
import { createLegacySim } from '../scenarios/split-chamber-v1.js';

self.onmessage = () => {
  try {
    const runs = GATE_SEEDS.map((s) => runGateSeed(createLegacySim, s));
    self.postMessage({ type: 'done', runs });
  } catch (e) { self.postMessage({ type: 'error', message: String(e && e.stack || e) }); }
};
