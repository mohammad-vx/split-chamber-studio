// Deterministic math for new engines. Only IEEE-754 basic ops (+ - * / sqrt, Math.round/floor), so results
// are bit-identical across V8 versions (Node vs Electron). Math.sin/cos/pow/atan2 are NOT used in sim code.
const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** sin(x) via range reduction + odd polynomial (abs error < 2e-9 on [-pi/2, pi/2]). */
export function dsin(x) {
  x -= TWO_PI * Math.round(x / TWO_PI);          // [-pi, pi]
  if (x > HALF_PI) x = PI - x; else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))));
}
export function dcos(x) { return dsin(x + HALF_PI); }
export { TWO_PI, PI, HALF_PI };

const LN2 = 0.6931471805599453;
/** e^x using only basic ops (range reduction to |r| <= ln2/2, Taylor series, exact power-of-two scaling). */
export function dexp(x) {
  if (x > 700) x = 700; else if (x < -700) x = -700;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1, sum = 1;
  for (let n = 1; n <= 14; n++) { term = term * r / n; sum += term; }
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2; else for (let i = 0; i < -k; i++) scale *= 0.5;
  return sum * scale;
}
/** ln(x), x > 0, using only basic ops (exact binary exponent extraction + atanh series). */
export function dlog(x) {
  if (!(x > 0)) return -Infinity;
  let e = 0;
  while (x >= 2) { x *= 0.5; e++; }
  while (x < 1) { x *= 2; e--; }
  const z = (x - 1) / (x + 1), z2 = z * z;
  let term = z, sum = 0;
  for (let n = 1; n <= 41; n += 2) { sum += term / n; term *= z2; }
  return e * LN2 + 2 * sum;
}
