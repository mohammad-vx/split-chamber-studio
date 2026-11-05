// Runs the determinism gate inside an Electron worker (same V8 as the production pipeline):
// the split-chamber@1 baseline seeds plus every frozen scenario's golden seeds.
import { GATE_SEEDS, GOLDENS, runGateSeed } from './gate.js';
import { createLegacySim } from '../scenarios/split-chamber.js';
import { getScenario } from '../scenarios/index.js';

self.onmessage = () => {
  try {
    const runs = GATE_SEEDS.map((s) => runGateSeed(createLegacySim, s));
    const goldens = GOLDENS.map((g) => {
      const sc = getScenario(g.key);
      return { key: g.key, seeds: g.seeds.map((s) => runGateSeed((x) => sc.createSim(sc.generate(x)), s)) };
    });
    self.postMessage({ type: 'done', runs, goldens });
  } catch (e) { self.postMessage({ type: 'error', message: String(e && e.stack || e) }); }
};
