// Grid search: crush params for split-chamber@2 so the cap lands near a target time.
import { Simulation } from '../src/sim/sim.js';
import { CRUSH } from '../src/sim/config.js';
const target = Number(process.argv[3] || 25);
const grid = JSON.parse(process.argv[2]);
for (const [floor, boost, knee] of grid) {
  const crush = { ...CRUSH, floor, boost, knee };
  const caps = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = new Simulation(seed, { crush, safetyCap: 60 });
    while (s.capFrame < 0 && s.frame < 60 * 60) s.step();
    caps.push(s.capFrame / 60);
  }
  const mean = caps.reduce((a, b) => a + b) / caps.length;
  console.log(JSON.stringify({ floor, boost, knee }), 'mean', mean.toFixed(1), 'caps', caps.map((c) => c.toFixed(1)).join(','), Math.abs(mean - target) < 1.5 ? '<==' : '');
}
