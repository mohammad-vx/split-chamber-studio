// Builds a config off the UI thread (the inventor simulates its candidates to calibrate them: a few seconds).
import { getScenario } from '../scenarios/index.js';

self.onmessage = (e) => {
  const { key, seed, opts } = e.data;
  try { self.postMessage({ type: 'done', config: getScenario(key).generate(seed, opts || {}) }); }
  catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
