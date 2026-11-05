// Headless run of the simulation: prints count-vs-time curve, timing and session size.
// Usage: node tools/simstats.mjs [seed] [seed2 ...]
import { Simulation } from '../src/sim/sim.js';
import { encodeFrame, hashFrames } from '../src/sim/session.js';
import { FPS } from '../src/sim/config.js';

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length) seeds.push(1, 2, 3);
// reference counter readings (seconds -> count) read from the video frames at 1 fps
const REF = { 1: 3, 2: 3, 3: 5, 4: 11, 5: 45, 6: 129, 7: 299, 8: 553, 9: 751, 10: 1259, 11: 1937, 12: 2937, 13: 4187, 14: 5717, 15: 6547, 16: 8307, 17: 10000 };
for (const seed of seeds) {
  const sim = new Simulation(seed);
  const frames = [];
  const t0 = performance.now();
  let worst = 0;
  while (!sim.done) {
    const a = performance.now();
    sim.step();
    frames.push(encodeFrame(sim));
    worst = Math.max(worst, performance.now() - a);
  }
  const ms = performance.now() - t0;
  const bytes = frames.reduce((s, f) => s + f.byteLength, 0);
  const curve = [];
  for (let s = 1; s * FPS < frames.length && s <= 22; s++) curve.push(`${s}s:${new Uint32Array(frames[s * FPS], 0, 1)[0]}${REF[s] ? '(' + REF[s] + ')' : ''}`);
  console.log(`seed ${seed}: frames=${frames.length} cap@${(sim.capFrame / FPS).toFixed(2)}s sim=${ms.toFixed(0)}ms (${(ms / frames.length).toFixed(2)}ms/f, worst ${worst.toFixed(1)}ms) size=${(bytes / 1e6).toFixed(1)}MB hash=${hashFrames(frames)}`);
  console.log('  ' + curve.join(' '));
}
