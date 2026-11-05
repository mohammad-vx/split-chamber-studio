// Validate a scenario over many seeds with the real run checks. node tools/scenario-check.mjs <key> [from] [count]
import { runHeadless } from '../src/sim/run.js';
import { getScenario } from '../src/scenarios/index.js';
import { checkRun } from '../src/pipeline/checks.js';
const [key, from = 1, count = 12] = process.argv.slice(2);
const sc = getScenario(key);
let bad = 0; const d = [], h = [], ms = [];
for (let seed = Number(from); seed < Number(from) + Number(count); seed++) {
  const cfg = sc.generate(seed); const s = runHeadless(cfg);
  d.push(s.durationS); h.push(s.hookFrame / 60); ms.push(s.simMs / s.frameCount);
  const r = checkRun(cfg, s);
  if (r.length) { bad++; console.log(`  seed ${seed}: ${r.join('; ')} (cap ${(s.capFrame / 60).toFixed(1)}/${(cfg.machine || cfg.packed || cfg.orbit || {}).pacing?.capTime})`); }
}
console.log(`${key}: bad ${bad}/${count} · duration ${Math.min(...d).toFixed(1)}–${Math.max(...d).toFixed(1)} s · hook max ${Math.max(...h).toFixed(2)} s · ${(ms.reduce((a, b) => a + b) / ms.length).toFixed(2)} ms/frame`);
