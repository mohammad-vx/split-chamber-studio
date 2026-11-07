// v2 of the packed/machine families: the contact pinch rule (user feedback, 2026-11-06).
// A ball squeezed between a moving part and a fixed surface (or an opposing moving part) ALWAYS splits; a
// ball merely pushed through a pile never does. There is no split probability any more, so the climax time is
// shaped by the mechanism itself (split count, part speed) and a time limit: the finale starts when the arena
// is full or at `safetyCap` seconds, whichever comes first. Seeds whose climax is too small are rejected by the
// run checks (`checks.climaxFillMin`).
// Each v2 config is its v1 config (same seed → same layout) with these deterministic changes applied.
import { rotarySweeperV1 } from './rotary-sweeper.js';
import { jawsV1, ramsV1, kaleidoscopeV1, wallsV1 } from './machines.js';

const scalePeriods = (parts, k) => {
  if (k === 1) return;
  for (const p of parts) for (const m of Object.values(p.motion || {})) if (m && m.period) m.period *= k;
};

// Measured with tools/tune-contact.mjs (seeds 100-115 and 200-223); failures are honest stalls
// (climax too small) or over-fast growth, rejected cheaply right after the simulation.
export const TUNING = {
  'rotary-sweeper': { splitInto: 3, safetyCap: 40, minArms: 2, omega: 2.2, ballR: 12 },
  jaws: { splitInto: 2, safetyCap: 40, slow: 1 },
  rams: { splitInto: 3, safetyCap: 40, slow: 1.2 },
  kaleidoscope: { splitInto: 3, safetyCap: 40, period: 4.5, gravity: 650 },
  walls: { splitInto: 3, safetyCap: 40, slow: 1 },
};

function v2Of(v1) {
  const id = v1.id, key = `${id}@2`;
  return {
    ...v1, version: 2, key, listed: true,
    generate(seed, opts = {}) {
      const T = { ...TUNING[id], ...(opts.tune || {}) };
      const cfg = v1.generate(seed, opts);
      cfg.scenario = key;
      const w = cfg.machine || cfg.packed;
      w.pinchRule = 'contact';
      w.splitInto = T.splitInto;
      w.safetyCap = T.safetyCap;
      if (T.ballR && T.ballR !== w.ballR) {             // bigger balls: fewer of them fill the arena
        const k = (w.ballR / T.ballR) ** 2;
        w.maxBalls = Math.floor(w.maxBalls * k / 50) * 50;
        w.ballR = T.ballR;
        Object.assign(cfg.render, { ballR: w.ballR, maxBalls: w.maxBalls });
      }
      if (cfg.packed) {
        w.arms.count = Math.max(w.arms.count, T.minArms || 1);
        w.arms.omega *= T.speed || 1;
        if (T.omega) {                                   // whole beats per revolution, nearest to the target speed
          const beat = 60 / cfg.tempo.bpm, beats = Math.max(2, Math.round(6.283185307179586 / (T.omega * beat)));
          w.arms.omega = 6.283185307179586 / (beats * beat);
        }
      } else scalePeriods(w.parts, T.slow || 1);
      if (T.period && w.parts) {                         // whole beats per cycle, nearest to the target period
        const beat = 60 / cfg.tempo.bpm, per = Math.max(2, Math.round(T.period / beat)) * beat;
        for (const p of w.parts) for (const m of Object.values(p.motion || {})) if (m && m.period) m.period = per;
      }
      if (T.gravity && !w.gravity) w.gravity = T.gravity;   // weightless runs stalled for this family
      if (T.rimReach) {                                  // polygons reach the rim when open: balls resting on the
        for (const p of w.parts) {                       // rim are squeezed by the returning part instead of stalling
          if (p.type !== 'poly') continue;
          const [a, b, c] = p.pts, slope = b[1] / b[0];
          p.pts = [a, [T.rimReach, slope * T.rimReach], [T.rimReach, c[1] / c[0] * T.rimReach]];
        }
      }
      cfg.duration = { minS: 30, maxS: 50 };
      cfg.checks = { ...(cfg.checks || {}), climaxFillMin: 0.5 };
      cfg.versions = { ...cfg.versions, rule: 2 };
      return cfg;
    },
  };
}

export const rotarySweeperV2 = v2Of(rotarySweeperV1);
export const jawsV2 = v2Of(jawsV1);
export const ramsV2 = v2Of(ramsV1);
export const kaleidoscopeV2 = v2Of(kaleidoscopeV1);
export const wallsV2 = v2Of(wallsV1);
