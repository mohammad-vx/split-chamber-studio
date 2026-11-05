// Golden hashes for frozen scenario versions (Node side).
//   node tools/goldens.mjs capture  -> baseline/goldens/<key>.node.json (canonical + raw, Node runtime)
//   node tools/goldens.mjs verify   -> canonical vs baseline/goldens/<key>.json (captured in Electron with
//                                      `electron . --gate --gate-capture-goldens`); raw too when rawPortable
import fs from 'node:fs';
import { GOLDENS, runGateSeed, compareGate } from '../src/sim/gate.js';
import { getScenario } from '../src/scenarios/index.js';

const mode = process.argv[2];
const runKey = (key, seed) => { const sc = getScenario(key); return runGateSeed((s) => sc.createSim(sc.generate(s)), seed); };
let ok = true;
for (const g of GOLDENS) {
  if (mode === 'capture') {
    const seeds = g.seeds.map((s) => runKey(g.key, s));
    fs.writeFileSync(`baseline/goldens/${g.key}.node.json`, JSON.stringify({ key: g.key, node: process.version, seeds }));
    console.log(`${g.key}: captured ${seeds.map((s) => `${s.seed}:${s.hash}`).join(' ')}`);
    continue;
  }
  const file = `baseline/goldens/${g.key}.json`;
  if (!fs.existsSync(file)) { console.log(`${g.key}: no Electron golden yet`); ok = false; continue; }
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const b of base.seeds) {
    const r = runKey(g.key, b.seed);
    const problem = compareGate(b, r, g.rawPortable ? b : null);
    if (problem) { ok = false; console.log(`${g.key} seed ${b.seed}: MISMATCH — ${problem}`); }
    else console.log(`${g.key} seed ${b.seed}: OK ${r.hash}${g.rawPortable ? ' (+raw, portable)' : ''}`);
  }
}
process.exit(ok ? 0 : 1);
