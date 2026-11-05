// ASCII density map of the swarm at given seconds (quick visual check without rendering).
import { Simulation } from '../src/sim/sim.js';
import { ARENA, FPS } from '../src/sim/config.js';
const seed = Number(process.argv[2] || 1234);
const times = (process.argv[3] || '14,18.5,21').split(',').map(Number);
const sim = new Simulation(seed);
const G = 24, chars = ' .:-=+*#%@';
for (const t of times) {
  while (sim.frame < Math.round(t * FPS) && !sim.done) sim.step();
  const grid = new Array(G * G).fill(0);
  for (let i = 0; i < sim.count; i++) {
    const gx = Math.floor((sim.x[i] - (ARENA.cx - ARENA.r)) / (2 * ARENA.r) * G), gy = Math.floor((sim.y[i] - (ARENA.cy - ARENA.r)) / (2 * ARENA.r) * G);
    if (gx >= 0 && gx < G && gy >= 0 && gy < G) grid[gy * G + gx]++;
  }
  const max = Math.max(...grid);
  console.log(`t=${t}s count=${sim.count} cap=${(sim.capFrame / FPS).toFixed(1)}`);
  for (let y = 0; y < G; y++) console.log('  ' + grid.slice(y * G, y * G + G).map((v) => chars[Math.min(9, Math.round(v / max * 9))].repeat(2)).join(''));
}
