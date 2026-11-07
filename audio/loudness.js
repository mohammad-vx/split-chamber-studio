// Loudness mastering for the offline soundtrack: EBU R128 / ITU-R BS.1770 integrated loudness (K-weighted,
// gated), gain normalization, and a look-ahead peak limiter. The final MP4 is re-measured with ffmpeg's
// ebur128 filter (authoritative check, main process).

// BS.1770 K-weighting biquads for 48 kHz (pre-filter shelf + RLB high-pass).
const K48 = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] },
  { b: [1.0, -2.0, 1.0], a: [1, -1.99004745483398, 0.99007225036621] },
];

function kWeight(x) {
  let y = x;
  for (const { b, a } of K48) {
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  return y;
}

/** Integrated loudness in LUFS of stereo channels at sampleRate (48 kHz expected). */
export function integratedLoudness(channels, sampleRate) {
  const w = channels.map(kWeight);
  const block = Math.round(0.4 * sampleRate), hop = Math.round(0.1 * sampleRate);
  const zs = [];
  for (let s = 0; s + block <= w[0].length; s += hop) {
    let sum = 0;
    for (const ch of w) { let e = 0; for (let i = s; i < s + block; i++) e += ch[i] * ch[i]; sum += e / block; }
    zs.push(sum);
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = zs.filter((z) => lk(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** Normalize to targetLUFS, then limit sample peaks to ceilingDb with look-ahead (in place). */
export function master(channels, sampleRate, opts = {}) {
  const passes = opts.passes || 1;
  let first = null;
  for (let k = 0; k < passes; k++) {           // v3: limiting lowers loudness; repeat normalize + limit to win it back
    const r = masterPass(channels, sampleRate, opts);
    if (!first) first = r;
    if (Math.abs(r.afterLUFS - (opts.targetLUFS ?? -14)) < 0.3) break;
  }
  return { ...first, afterLUFS: integratedLoudness(channels, sampleRate) };
}

function masterPass(channels, sampleRate, { targetLUFS = -14, ceilingDb = -1.5, lookaheadMs = 5, releaseMs = 80 } = {}) {
  const before = integratedLoudness(channels, sampleRate);
  const gain = Number.isFinite(before) ? Math.pow(10, (targetLUFS - before) / 20) : 1;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
  const ceil = Math.pow(10, ceilingDb / 20);
  const la = Math.max(1, Math.round(lookaheadMs / 1000 * sampleRate));
  const rel = Math.exp(-1 / (releaseMs / 1000 * sampleRate));
  const n = channels[0].length;
  // required gain per sample = min over look-ahead window of ceil/peak
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0; for (const ch of channels) { const v = Math.abs(ch[i]); if (v > p) p = v; }
    need[i] = p > ceil ? ceil / p : 1;
  }
  let g = 1;
  const minAhead = new Float32Array(n);
  // sliding minimum over [i, i+la] with a monotonic deque (O(n))
  const dq = new Int32Array(n + 1); let head = 0, tail = 0;
  for (let j = 0; j < n + la; j++) {
    if (j < n) { while (tail > head && need[dq[tail - 1]] >= need[j]) tail--; dq[tail++] = j; }
    const i = j - la;
    if (i >= 0) { while (dq[head] < i) head++; minAhead[i] = need[dq[head]]; }
  }
  for (let i = 0; i < n; i++) {
    const target = minAhead[i];
    g = target < g ? target : target + (g - target) * rel;   // instant attack (look-ahead), smooth release
    for (const ch of channels) ch[i] *= g;
  }
  return { beforeLUFS: before, gainDb: 20 * Math.log10(gain), afterLUFS: integratedLoudness(channels, sampleRate) };
}
