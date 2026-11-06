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

// Every check is reported as an explanation row { stage, name, value, limit, ok, reason } so the Studio can
// show WHY a video was accepted into review or rejected. check*() return just the failure reasons.
const row = (stage, name, value, limit, ok, reason) => ({ stage, name, value, limit, ok: !!ok, reason: ok ? '' : reason });

export function explainRun(config, s) {
  const out = [];
  const d = config.duration;
  out.push(row('simulation', 'Stable physics', s.nonFinite ? 'invalid numbers' : 'ok', 'no invalid numbers', !s.nonFinite, 'unstable simulation (non-finite positions)'));
  out.push(row('simulation', 'Reaches its ending', s.completed ? 'yes' : 'no', 'must finish', s.completed, 'simulation did not reach its ending'));
  if (d) out.push(row('simulation', 'Length', `${s.durationS.toFixed(1)} s`, `${d.minS}–${d.maxS} s`, s.durationS >= d.minS && s.durationS <= d.maxS, `duration ${s.durationS.toFixed(1)} s outside ${d.minS}–${d.maxS} s`));
  const hookOk = s.hookFrame >= 0 && s.hookFrame / FPS <= LIMITS.hookMaxS;
  out.push(row('simulation', 'Hook (first split)', s.hookFrame < 0 ? 'never' : `${(s.hookFrame / FPS).toFixed(1)} s`, `≤ ${LIMITS.hookMaxS} s`, hookOk,
    `no hook: first split at ${s.hookFrame < 0 ? 'never' : (s.hookFrame / FPS).toFixed(1) + ' s'} (limit ${LIMITS.hookMaxS} s)`));
  out.push(row('simulation', 'Climax', s.capFrame < 0 ? 'never' : `at ${(s.capFrame / FPS).toFixed(1)} s`, 'must happen', s.capFrame >= 0, 'no climax (ball cap never reached)'));
  const fillMin = config.checks && config.checks.climaxFillMin;
  const world2 = config.machine || config.packed;
  if (fillMin && world2 && s.capFrame >= 0) {
    const fill = (s.timeline.n[s.capFrame] || 0) / world2.maxBalls;
    out.push(row('simulation', 'Climax size', `${Math.round(fill * 100)} % of ${world2.maxBalls} balls`, `≥ ${Math.round(fillMin * 100)} %`, fill >= fillMin,
      `climax too small: ${Math.round(fill * 100)} % of the ${world2.maxBalls} balls when time ran out (minimum ${Math.round(fillMin * 100)} %)`));
  }
  const world = config.orbit || config.packed || {};
  const ballR = world.ballR || 6.5, arenaR = (world.arena && world.arena.r) || 460;
  const coverageMin = (config.checks && config.checks.coverageMin) || LIMITS.coverageMin;
  const half = s.timeline.n[Math.floor(s.frameCount / 2)] || 0;
  const coverage = Math.min(1, half * ballR * ballR / (arenaR * arenaR));
  out.push(row('simulation', 'Scene filled at half time', `${(coverage * 100).toFixed(1)} %`, `≥ ${(coverageMin * 100).toFixed(1)} %`, coverage >= coverageMin,
    `scene too empty at half time (coverage ${(coverage * 100).toFixed(1)} %, minimum ${(coverageMin * 100).toFixed(1)} %)`));
  return out;
}

export function explainAudio(a) {
  return [
    row('preview', 'Loudness', `${a.lufs} LUFS`, `${LIMITS.lufs[0]}…${LIMITS.lufs[1]} LUFS`, a.lufs >= LIMITS.lufs[0] && a.lufs <= LIMITS.lufs[1], `loudness ${a.lufs} LUFS outside ${LIMITS.lufs[0]}…${LIMITS.lufs[1]}`),
    row('preview', 'True peak', `${a.truePeak} dBTP`, `≤ ${LIMITS.truePeakMax} dBTP`, a.truePeak <= LIMITS.truePeakMax, `true peak ${a.truePeak} dBTP above ${LIMITS.truePeakMax}`),
    row('preview', 'No silence gaps', `${a.longestSilence.toFixed(1)} s`, `< ${LIMITS.silenceMaxS} s`, a.longestSilence < LIMITS.silenceMaxS, `silence of ${a.longestSilence.toFixed(1)} s`),
  ];
}

export function explainVideo(v) {
  return [
    row('preview', 'Picture never freezes', `${v.longestFreeze.toFixed(1)} s`, `≤ ${LIMITS.freezeMaxS} s`, v.longestFreeze <= LIMITS.freezeMaxS, `picture frozen for ${v.longestFreeze.toFixed(1)} s`),
    row('preview', 'No black picture', `${v.longestBlack.toFixed(1)} s`, '0 s', !(v.longestBlack > 0), `black picture for ${v.longestBlack.toFixed(1)} s`),
  ];
}

export function explainDuplicate(dup) {
  const n = dup.nearest;
  return row('preview', 'Different from accepted videos', n ? `closest ${n.id}: curve ${n.curve.toFixed(3)}, frames ${n.hamming.toFixed(1)}` : 'no accepted videos yet',
    `not both curve < ${LIMITS.dupCurve} and frames < ${LIMITS.dupHamming}`, !dup.duplicate, n ? `too similar to accepted video ${n.id}` : '');
}

const fails = (rows) => rows.filter((r) => !r.ok).map((r) => r.reason);
export function checkRun(config, s) { return fails(explainRun(config, s)); }
export function checkAudio(a) { return fails(explainAudio(a)); }
export function checkVideo(v) { return fails(explainVideo(v)); }

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

/** Ranking score 0–100 (sorting, auto-accept) with its breakdown: base 50 + four bonuses. */
export function scoreParts(config, s, audio, nearest) {
  const hook = s.hookFrame / FPS;
  const d = config.duration, mid = d ? (d.minS + d.maxS) / 2 : s.durationS;
  const parts = [
    { name: 'Base', points: 50, max: 50, note: '' },
    { name: 'Early hook', points: Math.max(0, 15 - hook * 6), max: 15, note: `first split at ${hook.toFixed(1)} s` },
    { name: 'Comfortable length', points: Math.max(0, 10 - Math.abs(s.durationS - mid)), max: 10, note: `${s.durationS.toFixed(1)} s, ideal ${mid.toFixed(0)} s` },
    { name: 'Loudness on target', points: audio ? Math.max(0, 10 - Math.abs(audio.lufs + 14) * 4) : 0, max: 10, note: audio ? `${audio.lufs} LUFS, target −14` : 'not measured' },
    { name: 'Novelty', points: nearest ? Math.min(15, nearest.score / 2) : 15, max: 15, note: nearest ? `distance ${nearest.score.toFixed(1)} from ${nearest.id}` : 'nothing accepted yet' },
  ].map((p) => ({ ...p, points: Math.round(p.points * 10) / 10 }));
  return parts;
}

export function score(config, s, audio, nearest) {
  let sc = 50;
  const hook = s.hookFrame / FPS;
  sc += Math.max(0, 15 - hook * 6);
  const d = config.duration, mid = d ? (d.minS + d.maxS) / 2 : s.durationS;
  sc += Math.max(0, 10 - Math.abs(s.durationS - mid));
  if (audio) sc += Math.max(0, 10 - Math.abs(audio.lufs + 14) * 4);
  sc += nearest ? Math.min(15, nearest.score / 2) : 15;
  return Math.round(Math.max(0, Math.min(100, sc)));
}
