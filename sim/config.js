// split-chamber@1 defaults (the frozen v1 engine's constants). Logical pixels of the 1080x1920 frame.
// Global frame constants live in src/core/constants.js and are re-exported here for the v1 code.
import { W, H, FPS } from '../core/constants.js';
export { W, H, FPS };

export const SIM_VERSION = 1;
export const SUBSTEPS = 4;

export const ARENA = { cx: 540, cy: 1000, r: 460 };
export const COUNTER_Y = 380;

export const BALL_R = 6.5;
export const MAX_BALLS = 10000;

export const BASE_SPEED = 360;     // px/s the swarm relaxes toward
export const CHILD_SPEED = 470;    // px/s of freshly split balls
export const SPEED_RELAX = 1.4;    // 1/s relaxation rate toward BASE_SPEED
export const DRIFT = 0.12;         // max random heading change per frame (radians)
export const IMMUNE_FRAMES = 24;   // new balls ignore plates for 0.4 s
export const CHILD_SPREAD = 1.3;   // radians of random spread around the plate axis
// Fission probability for a caught ball: FLOOR + BOOST / (1 + n / KNEE). Tuned so the counter
// follows the reference curve (10,000 at ~16.5 s).
// squeeze: sideways squirt speed of a pressed ball as a fraction of the plate's closing speed
// (ramped in with the ball count: a lone ball is not squeezed out, a crowded pile is)
export const CRUSH = { floor: 0.2, boost: 0.8, knee: 1600, squeeze: 0.32, squeezeN: 3000 };

export const PISTON = {
  halfLen: 132,     // half of the plate's long side
  thick: 30,        // plate thickness
  retract: 362,     // face distance from centre when fully retracted
  rod: 16,          // rod thickness (render only)
  period: 1.2,      // seconds per full cycle of one pair
  offsetH: 0.20,    // left/right pair phase offset (s)
  offsetV: 0.80,    // top/bottom pair phase offset (s); first contact at 1.1 s
  tExtend: 0.30,
  tHold: 0.05,
  tRetract: 0.34,
};

// Finale timing after the 10,000 cap is reached.
export const GOLD_WAVE_SPEED = 1150;   // px/s
export const FINALE_HOLD = 4.5;        // seconds of gold swarm before end card
export const OUTRO = 3.5;              // seconds of end card
export const SAFETY_CAP_SECONDS = 45;  // force finale if the cap is never hit

export const PALETTE = [
  [64, 112, 255],   // blue
  [226, 240, 60],   // yellow
  [196, 80, 255],   // purple
  [70, 226, 110],   // green
  [40, 210, 255],   // cyan
  [255, 150, 48],   // orange
  [255, 78, 166],   // pink
  [255, 70, 70],    // red
  [150, 255, 70],   // lime
  [120, 130, 255],  // periwinkle
];
export const GOLD = PALETTE.length;          // colour index for gold balls
export const GOLD_RGB = [246, 196, 70];

const easeInQuad = (u) => u * u;
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** Extension of a piston pair in [0, 1] at time t (seconds). 1 = plates touching at centre. */
export function pistonExtension(pair, t) {
  const p = PISTON;
  const off = pair === 0 ? p.offsetH : p.offsetV;
  let u = (t - off) % p.period;
  if (u < 0) u += p.period;
  if (t < off) return 0;
  if (u < p.tExtend) return easeInQuad(u / p.tExtend);
  u -= p.tExtend;
  if (u < p.tHold) return 1;
  u -= p.tHold;
  if (u < p.tRetract) return 1 - easeInOutCubic(u / p.tRetract);
  return 0;
}

/** Distance from arena centre to the plate face for a pair at time t. */
export function plateFace(pair, t) {
  return PISTON.retract * (1 - pistonExtension(pair, t));
}
