// Headless run → RunSummary + Timeline (ARCHITECTURE §5). Pure JS, usable in workers and Node.
// The Timeline is the only input for audio, counter-independent checks and captions; per-frame state hashes
// let every later re-simulation (preview, master, reproduce) prove it produced exactly the same frames.
import { encodeFrame, frameHash32 } from './session.js';
import { getScenario } from '../scenarios/index.js';
import { FPS } from '../core/constants.js';

/** Runs a config to completion. Returns a structured-clone/transfer-friendly summary. */
export function runHeadless(config, { onProgress } = {}) {
  const sc = getScenario(config.scenario);
  const sim = sc.createSim(config);
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const cap = Math.round((config.duration ? config.duration.maxS + 20 : 120) * FPS);
  const n = [], flags = [], crushed = [], splits = [], hashes = [];
  let hookFrame = -1, nonFinite = false;
  while (!sim.done) {
    if (sim.frame > cap) break;                    // runaway guard: the duration check will reject it
    const f = sim.step();
    const buf = encodeFrame(sim);
    hashes.push(frameHash32(buf));
    n.push(sim.count); flags.push(sim.flags); crushed.push(sim.crushed); splits.push(sim.splits.length / 3);
    if (hookFrame < 0 && sim.crushed > 0) hookFrame = f;
    if ((f & 63) === 0) {
      for (let i = 0; i < sim.count; i += 97) if (!Number.isFinite(sim.x[i]) || !Number.isFinite(sim.y[i])) { nonFinite = true; break; }
      if (onProgress) onProgress(f);
    }
  }
  const frameCount = n.length;
  return {
    scenario: config.scenario, seed: config.seed,
    frameCount, durationS: frameCount / FPS, completed: sim.done,
    capFrame: sim.capFrame, outroFrame: sim.outroFrame, endFrame: sim.endFrame, hookFrame, nonFinite,
    maxBalls: Math.max(0, ...n.slice(-1)),
    timeline: {
      n: Uint32Array.from(n), flags: Uint32Array.from(flags),
      crushed: Uint16Array.from(crushed), splits: Uint16Array.from(splits),
    },
    hashes: Uint32Array.from(hashes),
    simMs: (typeof performance !== 'undefined' ? performance : Date).now() - t0,
  };
}

/** Timeline from stored frames (legacy sessions / Play mode). */
export function timelineFromFrames(frames) {
  const len = frames.length;
  const t = { n: new Uint32Array(len), flags: new Uint32Array(len), crushed: new Uint16Array(len), splits: new Uint16Array(len) };
  for (let f = 0; f < len; f++) {
    const h = new Uint32Array(frames[f], 0, 4);
    t.n[f] = h[0]; t.splits[f] = h[1]; t.flags[f] = h[2]; t.crushed[f] = h[3];
  }
  return t;
}

/** Transferable buffers of a summary (for postMessage). */
export function summaryTransfer(s) {
  return [s.timeline.n.buffer, s.timeline.flags.buffer, s.timeline.crushed.buffer, s.timeline.splits.buffer, s.hashes.buffer];
}

/** Meta object the renderers expect, built from a config + summary. */
export function metaFromSummary(config, s) {
  return {
    app: 'split-chamber', seed: config.seed, scenario: config.scenario, config,
    fps: FPS, frameCount: s.frameCount, capFrame: s.capFrame, outroFrame: s.outroFrame, endFrame: s.endFrame,
  };
}
