// Closed-form mechanisms (MECHANISM-STUDY §3–4) as pure functions of time. A part's motion may carry
// `mech: { kind, period, ... }`; the result is an offset { x, y, a } added to the part's local pose.
// Profile kinds produce a scalar v(t) in [0, 1] applied along `to: [dx, dy, da]`; path kinds produce x/y directly.
import { dsin, dcos } from '../dmath.js';

const TAU = 6.283185307179586;
const frac = (v) => v - Math.floor(v);
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const cycle = (m, t) => frac(t / m.period + (m.phase || 0));

const PROFILES = {
  /** Quick return: closes slowly over `slow` of the cycle, snaps back fast (crank-and-slotted-lever feel). */
  quickReturn(m, t) { const u = cycle(m, t), s = m.slow || 0.72; return u < s ? smooth(u / s) : 1 - smooth((u - s) / (1 - s)); },
  /** Hammer: slow lift over `rise`, free-fall drop (quadratic), dwell on the anvil. */
  slam(m, t) {
    const u = cycle(m, t), rise = m.rise || 0.55, fall = m.fall || 0.12;
    if (u < rise) return smooth(u / rise);
    if (u < rise + fall) { const k = (u - rise) / fall; return 1 - k * k; }
    return 0;
  },
  /** Cam: a lobed follower — dwell, rise, dwell, return (`lobes` per turn). */
  cam(m, t) { const u = frac(cycle(m, t) * (m.lobes || 1)); return u < 0.25 ? 0 : u < 0.5 ? smooth((u - 0.25) * 4) : u < 0.75 ? 1 : 1 - smooth((u - 0.75) * 4); },
  /** Scissor / pantograph: an eased open–close with a hold when shut. */
  scissor(m, t) { const u = cycle(m, t); return u < 0.4 ? smooth(u / 0.4) : u < 0.55 ? 1 : 1 - smooth((u - 0.55) / 0.45); },
};

const STEPPED = {
  /** Ratchet / Geneva: whole steps of `step` (radians or px), each eased, with a dwell of `dwell` per step. */
  ratchet(m, t) { const v = t / m.period + (m.phase || 0), n = Math.floor(v), f = frac(v), d = m.dwell == null ? 0.5 : m.dwell; return n + smooth((f - d) / (1 - d)); },
};

const PATHS = {
  /** Lissajous figure: x = ax sin(2π fx t + φ), y = ay sin(2π fy t). */
  lissajous(m, t) { return { x: m.ax * dsin(TAU * m.fx * t + (m.phi || 0)), y: m.ay * dsin(TAU * m.fy * t), a: 0 }; },
  /** Rose curve r = A cos(kθ). */
  rose(m, t) { const th = TAU * t / m.period, r = m.A * dcos(m.k * th); return { x: r * dcos(th), y: r * dsin(th), a: 0 }; },
  /** Planetary (epicycle): carrier radius R1 at w1 plus planet radius R2 at w2; the part spins with the planet. */
  planet(m, t) {
    const a1 = m.w1 * t, a2 = m.w2 * t;
    return { x: m.R1 * dcos(a1) + m.R2 * dcos(a2), y: m.R1 * dsin(a1) + m.R2 * dsin(a2), a: m.spin ? a2 : 0 };
  },
};

/** Evaluate a mechanism at time t → { x, y, a }. */
export function mechanism(m, t) {
  const P = PROFILES[m.kind] || STEPPED[m.kind];
  if (P) { const v = P(m, t), to = m.to || [0, 0, 1]; return { x: v * to[0], y: v * to[1], a: v * to[2] }; }
  const path = PATHS[m.kind];
  if (path) return path(m, t);
  throw new Error(`unknown mechanism: ${m.kind}`);
}

export const MECHANISMS = [...Object.keys(PROFILES), ...Object.keys(STEPPED), ...Object.keys(PATHS)];
