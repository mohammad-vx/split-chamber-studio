// Determinism gate core (shared by Node `tools/baseline.mjs` and the Electron worker gate).
// For each seed it records, per frame:
//   canonical: FNV-1a of the v1 frame encoding (what the renderer/export consume)
//   raw:       FNV-1a of the full internal Float64/typed-array state of every live ball
//   rng:       number of RNG draws and FNV-1a of their values (catches RNG-order changes)
import { encodeFrame, hashFrames } from './session.js';

export const GATE_SEEDS = [1, 7, 1234, 4242, 99999];

function fnvBytes(h, bytes) {
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return h;
}
const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');

function rawStateHash(sim) {
  const n = sim.count;
  let h = 0x811c9dc5;
  for (const arr of [sim.x, sim.y, sim.vx, sim.vy, sim.gen, sim.age, sim.immune, sim.col]) {
    const view = arr.subarray(0, n);
    h = fnvBytes(h, new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  return hex(h);
}

/** Runs one seed. `makeSim(seed)` must return a v1-compatible Simulation. */
export function runGateSeed(makeSim, seed) {
  const sim = makeSim(seed);
  // Wrap the RNG after construction: all later draws go through sim.rand.
  let draws = 0, rh = 0x811c9dc5;
  if (typeof sim.rand === 'function') {          // stream RNG (legacy engine); counter-based engines have none
    const inner = sim.rand;
    const f64 = new Float64Array(1), b = new Uint8Array(f64.buffer);
    sim.rand = () => { const v = inner(); draws++; f64[0] = v; rh = fnvBytes(rh, b); return v; };
  }
  const frameHashes = [], raw = [], rng = [];
  const frames = [];
  while (!sim.done) {
    sim.step();
    const buf = encodeFrame(sim);
    frames.push(buf);
    frameHashes.push(hashFrames([buf]));
    raw.push(rawStateHash(sim));
    rng.push(`${draws}:${hex(rh)}`);
  }
  return {
    seed, frames: frames.length, capFrame: sim.capFrame, outroFrame: sim.outroFrame,
    hash: hashFrames(frames), frameHashes, raw, rng,
  };
}

/** Compare a run against a baseline entry. Returns null when identical, else a description. */
export function compareGate(base, run, rawBase) {
  if (run.frames !== base.frames || run.hash !== base.hash) {
    const i = base.frameHashes.findIndex((h, k) => h !== run.frameHashes[k]);
    return `canonical mismatch (frames ${base.frames} vs ${run.frames}, first differing frame ${i})`;
  }
  if (rawBase) {
    const i = rawBase.raw.findIndex((h, k) => h !== run.raw[k]);
    if (i >= 0) return `raw state mismatch at frame ${i}`;
    const j = rawBase.rng.findIndex((h, k) => h !== run.rng[k]);
    if (j >= 0) return `rng sequence mismatch at frame ${j} (${rawBase.rng[j]} vs ${run.rng[j]})`;
  }
  return null;
}

/** Frozen scenario versions with golden hashes (baseline/goldens/<key>.json). rawPortable: Node == Electron. */
export const GOLDENS = [
  { key: 'split-chamber@2', seeds: [1, 7, 1234], rawPortable: false },
  { key: 'orbit-crusher@1', seeds: [1, 7, 1234], rawPortable: true },
  { key: 'rotary-sweeper@1', seeds: [1, 7, 1234], rawPortable: true },
  { key: 'jaws@1', seeds: [1, 7], rawPortable: true },
  { key: 'rams@1', seeds: [1, 7], rawPortable: true },
  { key: 'kaleidoscope@1', seeds: [1, 8], rawPortable: true },
  { key: 'walls@1', seeds: [1, 7], rawPortable: true },
  { key: 'rotary-sweeper@2', seeds: [1, 7], rawPortable: true },
  { key: 'jaws@2', seeds: [1, 7], rawPortable: true },
  { key: 'rams@2', seeds: [1, 7], rawPortable: true },
  { key: 'kaleidoscope@2', seeds: [1, 7], rawPortable: true },
  { key: 'walls@2', seeds: [1, 7], rawPortable: true },
];
