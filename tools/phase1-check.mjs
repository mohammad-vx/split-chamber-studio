// node tools/phase1-check.mjs <key> '<controls json>' '<tune json>' [from] [count]
import { runHeadless } from '../src/sim/run.js';
import { getScenario } from '../src/scenarios/index.js';
import { applyControls } from '../src/scenarios/controls.js';
import { checkRun } from '../src/pipeline/checks.js';
const [key, ctl = '{}', tune = '{}', from = 1, count = 8] = process.argv.slice(2);
const sc = getScenario(key); const rows = []; let bad = 0;
for (let seed = +from; seed < +from + +count; seed++) {
  const cfg = applyControls(sc.generate(seed, { tune: JSON.parse(tune) }), JSON.parse(ctl));
  const s = runHeadless(cfg); const r = checkRun(cfg, s); if (r.length) bad++;
  rows.push({ seed, max: cfg.machine.maxBalls, cap: +(s.capFrame / 60).toFixed(1), capN: s.capN, dur: +s.durationS.toFixed(1), hook: +(s.hookFrame / 60).toFixed(1), solid: +(s.passMax * 100).toFixed(1), fail: r.join('; ').slice(0, 46) });
}
console.log(`${key} ctl=${ctl} tune=${tune}: bad ${bad}/${count}`); console.table(rows);
