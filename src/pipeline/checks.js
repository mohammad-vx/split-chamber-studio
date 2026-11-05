// Automatic quality checks (ARCHITECTURE §7.1). Pure functions → unit-testable. Each returns a list of
// human-readable rejection reasons (empty = pass).
import { FPS } from '../core/constants.js';

export const LIMITS = {
  hookMaxS: 3.0,                 // first split must happen within 3 s (presses/blades move from frame 0)
  coverageMin: 0.05,             // ball area / arena area at half time
  lufs: [-17, -13], truePeakMax: -1.0, silenceMaxS: 1.5,
  freezeMaxS: 1.0,
  dupHamming: 6, dupCurve: 0.03, // duplicate if BOTH the frames and the growth curve are this close
  quality: { ssimMin: 0.94, ssimMean: 0.96 },
};

export function checkRun(config, s) {
  const r = [];
  if (s.nonFinite) r.push('unstable simulation (non-finite positions)');
  if (!s.completed) r.push('simulation did not reach its ending');
  const d = config.duration;
  if (d && (s.durationS < d.minS || s.durationS > d.maxS)) r.push(`duration ${s.durationS.toFixed(1)} s outside ${d.minS}–${d.maxS} s`);
  if (s.hookFrame < 0 || s.hookFrame / FPS > LIMITS.hookMaxS) r.push(`no hook: first split at ${s.hookFrame < 0 ? 'never' : (s.hookFrame / FPS).toFixed(1) + ' s'} (limit ${LIMITS.hookMaxS} s)`);
  if (s.capFrame < 0) r.push('no climax (ball cap never reached)');
  const world = config.orbit || config.packed || {};
  const ballR = world.ballR || 6.5, arenaR = (world.arena && world.arena.r) || 460;
  const coverageMin = (config.checks && config.checks.coverageMin) || LIMITS.coverageMin;
  const half = s.timeline.n[Math.floor(s.frameCount / 2)] || 0;
  const coverage = Math.min(1, half * ballR * ballR / (arenaR * arenaR));
  if (coverage < coverageMin) r.push(`scene too empty at half time (coverage ${(coverage * 100).toFixed(1)} %, minimum ${(coverageMin * 100).toFixed(1)} %)`);
  return r;
}

export function checkAudio(a) {
  const r = [];
  if (!(a.lufs >= LIMITS.lufs[0] && a.lufs <= LIMITS.lufs[1])) r.push(`loudness ${a.lufs} LUFS outside ${LIMITS.lufs[0]}…${LIMITS.lufs[1]}`);
  if (!(a.truePeak <= LIMITS.truePeakMax)) r.push(`true peak ${a.truePeak} dBTP above ${LIMITS.truePeakMax}`);
  if (a.longestSilence >= LIMITS.silenceMaxS) r.push(`silence of ${a.longestSilence.toFixed(1)} s`);
  return r;
}

export function checkVideo(v) {
  const r = [];
  if (v.longestFreeze > LIMITS.freezeMaxS) r.push(`picture frozen for ${v.longestFreeze.toFixed(1)} s`);
  if (v.longestBlack > 0) r.push(`black picture for ${v.longestBlack.toFixed(1)} s`);
  return r;
}

export function checkQuality(q) {
  const r = [];
  if (!(q.ssimMin >= LIMITS.quality.ssimMin)) r.push(`quality: min SSIM ${q.ssimMin.toFixed(4)} < ${LIMITS.quality.ssimMin}`);
  if (!(q.ssimMean >= LIMITS.quality.ssimMean)) r.push(`quality: mean SSIM ${q.ssimMean.toFixed(4)} < ${LIMITS.quality.ssimMean}`);
  if (q.checked > 0 && q.accurate !== q.checked) r.push(`frame accuracy ${q.accurate}/${q.checked}`);
  return r;
}

/** Growth-curve descriptor: 32 samples of log(n)/log(max). */
export function curveDescriptor(timeline) {
  const n = timeline.n, len = n.length, maxN = Math.max(2, n[len - 1]), L = Math.log(maxN), out = [];
  for (let k = 0; k < 32; k++) out.push(+(Math.log(Math.max(1, n[Math.floor((k + 0.5) / 32 * len)])) / L).toFixed(4));
  return out;
}

export function hamming(a, b) {
  if (!a || !b) return 64;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

/** Closest accepted video by descriptor; duplicate if both distances are under the limits. */
export function findDuplicate(desc, accepted) {
  let best = null;
  for (const a of accepted) {
    if (!a.descriptor) continue;
    const cd = desc.curve.reduce((s, v, i) => s + Math.abs(v - (a.descriptor.curve[i] || 0)), 0) / desc.curve.length;
    const hd = desc.dhash.reduce((s, h, i) => s + hamming(h, a.descriptor.dhash[i]), 0) / desc.dhash.length;
    const score = cd * 100 + hd;
    if (!best || score < best.score) best = { id: a.id, curve: cd, hamming: hd, score };
  }
  const dup = best && best.curve < LIMITS.dupCurve && best.hamming < LIMITS.dupHamming;
  return { duplicate: !!dup, nearest: best };
}

/** Ranking score 0–100 (used for sorting and, later, automatic selection). */
export function score(config, s, audio, nearest) {
  let sc = 50;
  const hook = s.hookFrame / FPS;
  sc += Math.max(0, 15 - hook * 6);                                   // early hook
  const d = config.duration, mid = d ? (d.minS + d.maxS) / 2 : s.durationS;
  sc += Math.max(0, 10 - Math.abs(s.durationS - mid));                // comfortable length
  if (audio) sc += Math.max(0, 10 - Math.abs(audio.lufs + 14) * 4);   // on-target loudness
  sc += nearest ? Math.min(15, nearest.score / 2) : 15;              // novelty vs accepted
  return Math.round(Math.max(0, Math.min(100, sc)));
}
