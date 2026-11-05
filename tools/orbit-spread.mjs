// Orbit Crusher spread diagnostic: median / 25th-percentile radius of the swarm at fractions of the run.
// A swarm collapsing onto the hub shows up as a small median radius.
import { getScenario } from '../src/scenarios/index.js';
import { runHeadless } from '../src/sim/run.js';

const sc = getScenario('orbit-crusher@1');
for (const seed of [410, 201, 333, 77]) {
  const cfg = sc.generate(seed);
  const total = runHeadless(cfg).frameCount;
  const sim = sc.createSim(cfg);
  const out = [];
  for (const p of [0.4, 0.6, 0.75]) {
    while (sim.frame < Math.floor(total * p)) sim.step();
    const r = [];
    for (let i = 0; i < sim.count; i++) r.push(Math.hypot(sim.x[i] - 540, sim.y[i] - 1000));
    r.sort((a, b) => a - b);
    out.push(`${p}: n=${sim.count} median=${r[r.length >> 1].toFixed(0)} p25=${r[r.length >> 2].toFixed(0)}`);
  }
  console.log(`seed ${seed}  ${out.join(' | ')}`);
}
