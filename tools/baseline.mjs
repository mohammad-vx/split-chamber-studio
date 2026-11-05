// Simulation baseline gate.
//   node tools/baseline.mjs capture baseline/v1/sim.json         canonical frame hashes (step 0 format)
//   node tools/baseline.mjs capture-raw baseline/v1/sim-raw.json raw state + RNG hashes
//   node tools/baseline.mjs verify baseline/v1/sim.json [baseline/v1/sim-raw.json]
// Exit code 1 on any mismatch, with the first differing frame.
import fs from 'node:fs';
import { GATE_SEEDS, runGateSeed, compareGate } from '../src/sim/gate.js';
import { createLegacySim } from '../src/scenarios/split-chamber-v1.js';

const [mode, file, rawFile] = process.argv.slice(2);
const run = (seed) => runGateSeed(createLegacySim, seed);

if (mode === 'capture') {
  const seeds = GATE_SEEDS.map(run).map(({ raw, rng, ...rest }) => rest);
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), node: process.version, seeds }, null, 1));
  for (const s of seeds) console.log(`seed ${s.seed}: ${s.frames} frames, cap ${s.capFrame}, hash ${s.hash}`);
} else if (mode === 'capture-raw') {
  const seeds = GATE_SEEDS.map(run).map(({ seed, frames, raw, rng }) => ({ seed, frames, raw, rng }));
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), node: process.version, seeds }));
  for (const s of seeds) console.log(`seed ${s.seed}: raw ${s.raw[s.raw.length - 1]} rng ${s.rng[s.rng.length - 1]}`);
} else if (mode === 'verify') {
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rawBase = rawFile ? JSON.parse(fs.readFileSync(rawFile, 'utf8')) : null;
  let ok = true;
  for (const b of base.seeds) {
    const r = run(b.seed);
    const problem = compareGate(b, r, rawBase && rawBase.seeds.find((s) => s.seed === b.seed));
    if (problem) { ok = false; console.log(`seed ${b.seed}: MISMATCH — ${problem}`); }
    else console.log(`seed ${b.seed}: OK ${r.hash}${rawBase ? ' (+raw +rng)' : ''}`);
  }
  process.exit(ok ? 0 : 1);
} else {
  console.error('usage: node tools/baseline.mjs capture|capture-raw|verify <file> [rawFile]');
  process.exit(2);
}
