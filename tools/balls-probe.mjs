// Try a chosen ball count on a pattern with the real run checks.
// node tools/balls-probe.mjs <key> <balls> [from] [count] [length]
import { runHeadless } from '../src/sim/run.js';
import { getScenario } from '../src/scenarios/index.js';
import { checkRun } from '../src/pipeline/checks.js';
import { applyControls, wantedBalls } from '../src/scenarios/controls.js';

const [key, balls = 10000, from = 1, count = 4, length = 'short'] = process.argv.slice(2);
const sc = getScenario(key), want = wantedBalls(balls);
let bad = 0, short = 0;
for (let seed = Number(from); seed < Number(from) + Number(count); seed++) {
  const t0 = Date.now();
  const base = sc.generate(seed, want && sc.ballSized ? { balls: want } : {});
  const cfg = applyControls(base, { balls: want || 'auto', length });
  const tGen = Date.now() - t0, s = runHeadless(cfg), r = checkRun(cfg, s);
  if (r.length) bad++;
  if (s.capN < cfg.machine.maxBalls) short++;
  console.log(`seed ${seed}: ball ${cfg.machine.ballR} px · full at ${cfg.machine.maxBalls} · finale at ${s.capN}${s.capN < cfg.machine.maxBalls ? ' (TIME RAN OUT)' : ''} · cap ${(s.capFrame / 60).toFixed(1)} s · ${s.durationS.toFixed(1)} s · generate ${(tGen / 1000).toFixed(1)} s · sim ${(s.simMs / 1000).toFixed(1)} s${cfg.invented ? ` · ${cfg.invented.name} (${cfg.invented.precheck})` : ''}${r.length ? `\n    REJECTED: ${r.join('; ')}` : ''}`);
}
console.log(`${key} @ ${want || 'auto'} balls (${length}): ${Number(count) - bad}/${count} pass the checks · ${Number(count) - short}/${count} reached the count`);
