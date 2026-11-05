// Legacy factory for split-chamber@1: the frozen v1 simulation.
// Kept as a thin seam so tools and the scenario registry share one constructor.
import { Simulation } from '../sim/sim.js';

export function createLegacySim(seed) {
  return new Simulation(seed);
}
