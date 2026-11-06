// node tools/snap.mjs <key> <seed> <t1,t2,...> <out.json> ['<controls json>' ['<tune json>']]
// Dumps balls and part geometry at chosen times (seconds) for a quick look (draw with any plotter).
import fs from 'node:fs';
import { getScenario } from '../src/scenarios/index.js';
import { applyControls } from '../src/scenarios/controls.js';
const [key, seed, times, out, ctl = '{}', tune = '{}'] = process.argv.slice(2);
const sc = getScenario(key), cfg = applyControls(sc.generate(+seed, { tune: JSON.parse(tune) }), JSON.parse(ctl));
const sim = sc.createSim(cfg), want = times.split(',').map((s) => Math.round(+s * 60)), frames = [];
while (!sim.done && want.length) {
  sim.step();
  if (sim.frame === want[0]) { want.shift(); frames.push({ t: sim.frame / 60, n: sim.count, balls: Array.from({ length: sim.count }, (_, i) => [+sim.x[i].toFixed(1), +sim.y[i].toFixed(1), sim.col[i]]), parts: sim.geo.map((g, k) => ({ type: cfg.machine.parts[k].type, ...g, edges: undefined, pose: undefined })) }); }
}
fs.writeFileSync(out, JSON.stringify({ arena: cfg.machine.arena, ballR: cfg.machine.ballR, frames }));
