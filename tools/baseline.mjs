// Simulation baseline: capture or verify bit-exact frame hashes for a fixed set of seeds.
//   node tools/baseline.mjs capture baseline/v1/sim.json
//   node tools/baseline.mjs verify  baseline/v1/sim.json     (exit 1 + first differing frame on mismatch)
import fs from 'node:fs';
import { Simulation } from '../src/sim/sim.js';
import { encodeFrame, hashFrames } from '../src/sim/session.js';

const SEEDS = [1, 7, 1234, 4242, 99999];
const [mode, file] = process.argv.slice(2);
if (!['capture', 'verify'].includes(mode) || !file) {
  console.error('usage: node tools/baseline.mjs capture|verify <file.json>');
  process.exit(2);
}

function run(seed) {
  const sim = new Simulation(seed);
  const frames = [];
  while (!sim.done) { sim.step(); frames.push(encodeFrame(sim)); }
  return {
    seed, frames: frames.length, capFrame: sim.capFrame, outroFrame: sim.outroFrame,
    hash: hashFrames(frames),
    frameHashes: frames.map((f) => hashFrames([f])),
  };
}

if (mode === 'capture') {
  const out = { createdAt: new Date().toISOString(), node: process.version, seeds: SEEDS.map(run) };
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  for (const s of out.seeds) console.log(`seed ${s.seed}: ${s.frames} frames, cap ${s.capFrame}, hash ${s.hash}`);
} else {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = true;
  for (const b of base.seeds) {
    const r = run(b.seed);
    if (r.hash === b.hash && r.frames === b.frames) { console.log(`seed ${b.seed}: OK ${r.hash}`); continue; }
    ok = false;
    const i = b.frameHashes.findIndex((h, k) => h !== r.frameHashes[k]);
    console.log(`seed ${b.seed}: MISMATCH (baseline ${b.hash}, now ${r.hash}; frames ${b.frames} vs ${r.frames}; first differing frame ${i})`);
  }
  process.exit(ok ? 0 : 1);
}
