// The pinch rule: which squeezed balls split and which are ejected, once per substep.
//   pinchRule 'contact' (v2+): a ball caught between a moving part and a fixed one (or two opposed moving parts)
//   always splits; a push through a pile only ejects. Laser beams split on any touch.
//   Legacy rule (v1): squeezes split with the pacing probability, else eject.
import { rand } from '../rng.js';
import { splitChance } from '../pacing.js';

export const FLAG_SMASH = 64;
const P_SPLIT = 21;

export function resolvePinches(sim, step, t) {
  const c = sim.cfg, n = sim.count, r = c.ballR;
  const capped = sim.capFrame >= 0;
  const contactRule = c.pinchRule === 'contact';
  for (let i = 0; i < n; i++) {
    const fl = sim.cflags[i];
    let squeezed = false, wall = 0;
    if ((fl & 1) && sim.immune[i] === 0) {
      const ax = sim.closeN[2 * i], ay = sim.closeN[2 * i + 1];
      if ((fl & 2) && ax * sim.otherN[2 * i] + ay * sim.otherN[2 * i + 1] < -0.5) { squeezed = true; wall = 1; }
      else if (contactRule) { if (sim.nbD[i] > c.pileSqueeze * r) squeezed = true; }   // v2: piles only eject
      else if (sim.nbD[i] > c.pileSqueeze * r) squeezed = true;
      else {
        const j = sim.nb[i];
        if (j >= 0 && (sim.cflags[j] & 2) && sim.nbD[i] > 0.05 * r) {
          const dx = sim.x[j] - sim.x[i], dy = sim.y[j] - sim.y[i], dd = Math.sqrt(dx * dx + dy * dy) || 1;
          if ((ax * dx + ay * dy) / dd > 0.5 && ax * sim.otherN[2 * j] + ay * sim.otherN[2 * j + 1] < -0.5) squeezed = true;
        }
      }
    }
    if (sim.beamHit[i] && sim.immune[i] === 0 && !capped && sim.count < c.maxBalls) {
      sim.split(i, step); sim.flags |= FLAG_SMASH; sim.immune[i] = c.beamImmune || c.immuneFrames;
      continue;
    }
    if (squeezed) sim.pinch[i]++; else sim.pinch[i] = 0;
    // hook rule: the very first ball splits as soon as a moving part strikes it
    if (sim.count === 1 && (fl & 1) && sim.immune[i] === 0) sim.pinch[i] = 2;
    if (contactRule && wall && sim.immune[i] === 0) sim.pinch[i] = 2;
    if (sim.pinch[i] >= 2) {
      sim.pinch[i] = 0;
      if (contactRule) {                                        // v2: a real pinch always splits, a pile push never does
        if ((wall || sim.count === 1) && !capped && sim.count < c.maxBalls) { sim.split(i, step); sim.flags |= FLAG_SMASH; }
        else sim.eject(i, step);
        continue;
      }
      const p = sim.count === 1 ? 1 : splitChance(sim.count, t, c.pacing, c.maxBalls);
      if (!capped && sim.count < c.maxBalls && rand(sim.seed, sim.id[i], step, P_SPLIT) < p) { sim.split(i, step); sim.flags |= FLAG_SMASH; }
      else sim.eject(i, step);
    }
  }
}
