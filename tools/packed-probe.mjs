// Quick headless probe of rotary-sweeper@1 seeds (pacing, timing, cost). node tools/packed-probe.mjs [seeds...]
import { rotarySweeperV1 as sc } from '../src/scenarios/rotary-sweeper.js';
import { encodeFrame } from '../src/sim/session.js';
const seeds = process.argv.slice(2).map(Number); if (!seeds.length) seeds.push(1, 2, 3, 4);
for (const seed of seeds) {
  const cfg = sc.generate(seed); const sim = sc.createSim(cfg);
  const t0 = performance.now(); let hook = -1, worst = 0; const curve = [];
  while (!sim.done && sim.frame < 70 * 60) {
    const a = performance.now(); sim.step(); encodeFrame(sim); worst = Math.max(worst, performance.now() - a);
    if (hook < 0 && sim.crushed > 0) hook = sim.frame / 60;
    if (sim.frame % 300 === 0) curve.push(sim.count);
    let bad = false; for (let i = 0; i < sim.count; i += 50) if (!Number.isFinite(sim.x[i])) bad = true; if (bad) { console.log('NaN!'); break; }
  }
  const ms = (performance.now() - t0) / sim.frame;
  console.log(`seed ${seed}: arms ${cfg.packed.arms.count} wedges ${cfg.packed.wedges.length} g ${cfg.packed.gravity.toFixed(0)} max ${cfg.packed.maxBalls} | hook ${hook.toFixed(2)}s cap ${(sim.capFrame / 60).toFixed(1)}/${cfg.packed.pacing.capTime} dur ${(sim.frame / 60).toFixed(1)}s | ${ms.toFixed(2)} ms/frame (worst ${worst.toFixed(1)}) | n/5s: ${curve.join(' ')}`);
}
