// Runs a scenario's deterministic simulation off the UI thread and streams encoded frames back.
// Message: { type: 'start', config } (or legacy { type: 'start', seed } = split-chamber@1).
import { encodeFrame, makeMeta } from './session.js';
import { getScenario } from '../scenarios/index.js';

let run = 0;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    const config = msg.config || getScenario('split-chamber@1').generate(msg.seed);
    start(config, ++run);
  } else if (msg.type === 'stop') run++;
};

const metaOf = (sim, config, frameCount) => ({ ...makeMeta(sim, frameCount), scenario: config.scenario, config });

function start(config, id) {
  const sim = getScenario(config.scenario).createSim(config);
  const t0 = performance.now();
  const BATCH = 6;
  const tick = () => {
    if (id !== run) return;
    try {
      for (let k = 0; k < BATCH && !sim.done; k++) {
        const cap = sim.capFrame;
        const f = sim.step();
        // finale timing becomes known at the cap frame; send it before that frame so the renderer has it
        if (cap !== sim.capFrame) self.postMessage({ type: 'meta', meta: metaOf(sim, config, -1) });
        const buf = encodeFrame(sim);
        self.postMessage({ type: 'frame', index: f, buf }, [buf]);
      }
      if (sim.done) {
        self.postMessage({ type: 'done', meta: metaOf(sim, config, sim.frame), simMs: performance.now() - t0 });
      } else setTimeout(tick, 0);
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.stack || err) });
    }
  };
  tick();
}
