// Batch controls chosen in the Generate panel (owner feedback 2026-11-06): gravity, the ball count the video stops at,
// the video length and the ending. They are applied to the generated config (so they are stored with the video and
// reproduce exactly). Only machine-engine configs are affected; frozen swarm/packed versions ignore them.

export const DEFAULT_CONTROLS = { gravity: 'auto', target: 'max', length: 'short', ending: 'auto' };

export const LENGTHS = {
  short: { minS: 30, maxS: 50, slow: 1, ball: 1 },
  medium: { minS: 45, maxS: 65, slow: 1.15, ball: 0.8 },     // longer = more (smaller) balls to fill the arena
  long: { minS: 60, maxS: 95, slow: 1.3, ball: 0.64 },
};
// families whose growth is exponential (scissors / lasers) need extra slowing for the longer lengths
const FAST_GROWTH = { 'orbit-crusher': 2.1, 'laser-cross': 1.7, 'laser-spin': 1.7 };
// families whose squeeze depends on the ball size (the ram heads pass the rim one ball apart): never shrink their balls
const FIXED_BALL = { rams: true, 'croc-jaws': true, 'fist-arm': true, 'hammer-bowl': true, invent: true };
const AUTO_GRAVITY = { 'orbit-crusher': 'center', 'split-chamber': 'center', 'laser-spin': 'center' };   // everything else: down
const ENDINGS = {
  'rim-break': { type: 'rim-break', gapHalf: 0.55, gravity: 1400, duration: 3.0 },
  gold: { type: 'cap-gold', gapHalf: 0.5 },
  flood: { type: 'flood', gapHalf: 0.5, push: 900, duration: 3.5 },
};

function scaleTime(parts, k) {
  if (k === 1) return;
  for (const p of parts) {
    const m = p.motion || {};
    for (const v of Object.values(m)) {
      if (!v || typeof v !== 'object') continue;
      if (v.period) v.period *= k;
      if (v.omega) v.omega /= k;
      if (v.speedUp) v.speedUp /= k * k;
    }
  }
}

/** Mutates and returns cfg. ctl: { gravity: auto|on|off|center, target: 'max'|number, length: short|medium|long, ending: auto|rim-break|gold|flood } */
export function applyControls(cfg, ctl = {}) {
  const w = cfg.machine;
  if (!w) return cfg;
  const c = { ...DEFAULT_CONTROLS, ...ctl };
  const family = cfg.scenario.split('@')[0];
  // gravity: a decision, never a coin toss
  // an invented machine says which gravity it was designed for
  const gmode = c.gravity === 'auto' ? (AUTO_GRAVITY[family] || (cfg.invented && w.gravityMode === 'center' ? 'center' : 'on')) : c.gravity;
  if (gmode === 'off') { w.gravity = 0; delete w.gravityMode; }
  else if (gmode === 'center') { w.gravityMode = 'center'; if (!w.gravity) w.gravity = 520; }
  else { delete w.gravityMode; if (!w.gravity) w.gravity = 650; }
  // the count the finale starts at
  const L = LENGTHS[c.length] || LENGTHS.short;
  if (L.ball !== 1 && !FIXED_BALL[family]) { w.ballR = Math.round(w.ballR * L.ball * 10) / 10; w.maxBalls = Math.floor(w.maxBalls / (L.ball * L.ball) / 50) * 50; cfg.render.ballR = w.ballR; }
  const full = w.maxBalls;
  if (c.target !== 'max' && Number(c.target) > 0) w.maxBalls = Math.min(full, Math.floor(Number(c.target)));
  // length: slower machines for longer videos, and for smaller targets (they fill sooner)
  const slow = L.slow * (L.ball !== 1 && !FIXED_BALL[family] ? (FAST_GROWTH[family] || 1) * (c.length === 'long' ? 1.25 : 1) : 1) * Math.pow(full / w.maxBalls, 0.3);
  scaleTime(w.parts, slow);
  // ending
  if (c.ending !== 'auto' && ENDINGS[c.ending]) {
    w.ending = { ...ENDINGS[c.ending] };
    w.finaleHold = w.ending.type === 'cap-gold' ? 5.5 : 3.0;
  }
  const tail = w.finaleHold + (w.ending.duration || 0) + (w.outro || 2.5);
  cfg.duration = { minS: L.minS, maxS: L.maxS };
  w.safetyCap = Math.max(12, L.maxS - tail - 0.5);
  w.checkSolid = true;
  cfg.checks = { ...(cfg.checks || {}), climaxFillMin: cfg.checks && cfg.checks.climaxFillMin ? cfg.checks.climaxFillMin : 0.5, solidMax: family === 'orbit-crusher' ? 0.06 : 0.035 };
  Object.assign(cfg.render, { maxBalls: w.maxBalls, ending: w.ending, finaleHold: w.finaleHold, parts: w.parts });
  cfg.controls = { gravity: gmode, target: c.target, length: c.length, ending: w.ending.type };
  return cfg;
}
