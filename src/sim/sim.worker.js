// Runs the deterministic simulation off the UI thread and streams encoded frames back.
import { Simulation } from './sim.js';
import { encodeFrame, makeMeta } from './session.js';

let run = 0;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') start(msg.seed, ++run);
  else if (msg.type === 'stop') run++;
};

function start(seed, id) {
  const sim = new Simulation(seed);
  const t0 = performance.now();
  const BATCH = 6;
  const tick = () => {
    if (id !== run) return;
    try {
      for (let k = 0; k < BATCH && !sim.done; k++) {
        const cap = sim.capFrame;
        const f = sim.step();
        // finale timing becomes known at the cap frame; send it before that frame so the renderer has it
        if (cap !== sim.capFrame) self.postMessage({ type: 'meta', meta: makeMeta(sim, -1) });
        const buf = encodeFrame(sim);
        self.postMessage({ type: 'frame', index: f, buf }, [buf]);
      }
      if (sim.done) {
        self.postMessage({ type: 'done', meta: makeMeta(sim, sim.frame), simMs: performance.now() - t0 });
      } else setTimeout(tick, 0);
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.stack || err) });
    }
  };
  tick();
}
