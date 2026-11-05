// Grid search of fission probability constants against the reference counter curve.
import { Simulation } from '../src/sim/sim.js';
import { CRUSH, FPS } from '../src/sim/config.js';
const REF = { 2: 3, 3: 5, 4: 11, 5: 45, 6: 129, 7: 299, 8: 553, 9: 751, 10: 1259, 11: 1937, 12: 2937, 13: 4187, 14: 5717, 15: 6547, 16: 8307 };
const seeds = [1, 2, 3, 4, 5, 6];
const grid = JSON.parse(process.argv[2]);
for (const [floor, boost, knee, squeeze, squeezeN] of grid) {
  Object.assign(CRUSH, { floor, boost, knee, squeeze, squeezeN });
  let err = 0, caps = [];
  for (const seed of seeds) {
    const sim = new Simulation(seed);
    const counts = {};
    while (!sim.done && sim.frame < 40 * FPS) { sim.step(); if (sim.frame % FPS === 0) counts[sim.frame / FPS] = sim.count; if (sim.capFrame >= 0) break; }
    caps.push(sim.capFrame >= 0 ? sim.capFrame / FPS : 99);
    for (const [t, c] of Object.entries(REF)) { const v = counts[t] ?? 10000; err += (Math.log(v) - Math.log(c)) ** 2; }
  }
  console.log(JSON.stringify({ floor, boost, knee, squeeze, squeezeN }), 'rms', Math.sqrt(err / (seeds.length * 15)).toFixed(3), 'cap', caps.map((c) => c.toFixed(1)).join(','));
}
