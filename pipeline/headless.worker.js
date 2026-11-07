// Headless simulation stage (no rendering): config → RunSummary + Timeline.
import { runHeadless, summaryTransfer } from '../sim/run.js';

self.onmessage = (e) => {
  try {
    const summary = runHeadless(e.data.config, { onProgress: (f) => self.postMessage({ type: 'progress', frame: f }) });
    self.postMessage({ type: 'done', summary }, summaryTransfer(summary));
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
