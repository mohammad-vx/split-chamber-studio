// Orbit Crusher pacing: cap time + growth curve for crush parameter sets. node tools/tune-orbit.mjs '[[floor,boost,knee],...]'
import { orbitCrusherV1 } from '../src/scenarios/orbit-crusher.js';
const grid = JSON.parse(process.argv[2] || '[[0.5,0.02]]');
for (const [p0, pmin] of grid) {
  const caps = [], ms = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const cfg = orbitCrusherV1.generate(seed, { pacing: { p0, pmin } });
    const sim = orbitCrusherV1.createSim(cfg);
    const t0 = performance.now();
    const curve = [];
    while (sim.capFrame < 0 && sim.frame < 50 * 60) { sim.step(); if (sim.frame % 300 === 0) curve.push(sim.count); }
    ms.push((performance.now() - t0) / sim.frame);
    caps.push((sim.capFrame / 60).toFixed(1) + `/${cfg.orbit.pacing.capTime}(${cfg.orbit.blades.count}b)`);
    if (seed === 1) console.log('  seed1 curve/5s:', curve.join(' '));
  }
  console.log(JSON.stringify({ p0, pmin }), 'caps', caps.join(' '), 'ms/frame', (ms.reduce((a, b) => a + b) / ms.length).toFixed(2));
}
