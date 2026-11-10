// Builds a config off the UI thread (the inventor simulates its candidates to calibrate them: a few seconds).
import { getScenario } from '../scenarios/index.js';

self.onmessage = (e) => {
  const { key, seed, opts } = e.data;
  // the inventor reports each attempt, so the Studio can show that it is working
  const o = { ...(opts || {}), onAttempt: (attempt) => self.postMessage({ type: 'progress', attempt }) };
  try { self.postMessage({ type: 'done', config: getScenario(key).generate(seed, o) }); }
  catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
