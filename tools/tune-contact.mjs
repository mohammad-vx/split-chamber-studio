// Measure a packed/machine scenario with the v2 contact pinch rule and optional overrides.
// node tools/tune-contact.mjs <key> '<json overrides for machine/packed>' [from] [count]
import { runHeadless } from '../src/sim/run.js';
import { getScenario } from '../src/scenarios/index.js';
import { checkRun } from '../src/pipeline/checks.js';
const [key, over = '{}', from = 1, count = 10] = process.argv.slice(2);
const sc = getScenario(key), o = JSON.parse(over);
const rows = []; let bad = 0;
for (let seed = +from; seed < +from + +count; seed++) {
  const cfg = sc.generate(seed, { tune: o }); const m = cfg.machine || cfg.packed;
  const s = runHeadless(cfg);
  const at = (t) => s.timeline.n[Math.min(s.frameCount - 1, Math.round(t * 60))];
  const r = checkRun(cfg, s); if (r.length) bad++;
  rows.push({ seed, cap: +(s.capFrame / 60).toFixed(1), fill: +(at(s.capFrame / 60) / m.maxBalls).toFixed(2), n10: at(10), n20: at(20), hook: +(s.hookFrame / 60).toFixed(1), dur: +s.durationS.toFixed(1), fail: r.join('; ').slice(0, 40) });
}
console.log(`${key} ${over}: bad ${bad}/${count} max ${(sc.generate(1).machine || sc.generate(1).packed).maxBalls}`);
console.table(rows);
