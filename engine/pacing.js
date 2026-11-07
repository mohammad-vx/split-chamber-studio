// Pacing controller shared by engines (review: exponential growth with fixed probabilities has huge seed
// variance). Split chance is a pure function of how far the count is behind/ahead of the target curve
// N*(t) = maxBalls^(t / capTime). Deterministic math only.
import { dexp, dlog } from './dmath.js';

export function splitChance(count, t, pacing, maxBalls) {
  const u = Math.min(1, t / pacing.capTime);
  const target = dexp(dlog(maxBalls) * u);
  const ratio = target / count;
  const p = pacing.p0 * ratio * ratio;
  return p < pacing.pmin ? pacing.pmin : p > 1 ? 1 : p;
}
