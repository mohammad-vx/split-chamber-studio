// Batch controls chosen in the Generate panel (owner feedback 2026-11-06): gravity, the ball count the video stops at,
// the video length and the ending. They are applied to the generated config (so they are stored with the video and
// reproduce exactly). Only machine-engine configs are affected; frozen swarm/packed versions ignore them.

export const DEFAULT_CONTROLS = { gravity: 'auto', target: 'max', balls: 'auto', length: 'short', ending: 'auto' };

// "Balls" (3.6): the count the arena is full at. The ball is sized for the count (10,000 balls: radius ~3.3 px),
// between these limits; outside them the count still holds and the arena ends less full (or the count is capped).
export const BALLS_MIN = 100, BALLS_MAX = 20000, BALL_R_MIN = 2.6, BALL_R_MAX = 16;
const clampR = (r) => Math.max(BALL_R_MIN, Math.min(BALL_R_MAX, Math.floor(r * 10) / 10));
/** A whole count inside the limits, or 0 for "auto". */
export function wantedBalls(v) { const n = Math.floor(Number(v)); return n > 0 ? Math.max(BALLS_MIN, Math.min(BALLS_MAX, n)) : 0; }
/** Ball radius at which `n` balls fill a round arena of radius `arenaR` with `free` of it open (same 0.6 packing as baseMachine). */
export function radiusForBalls(n, free = 0.7, arenaR = 460) { return clampR(Math.sqrt(0.6 * free * arenaR * arenaR / n)); }
/**
 * Pieces per split for a ball size. A squeeze catches one layer of balls, so with small balls each stroke reaches a
 * smaller share of them (measured: 10,000 balls at 3 pieces filled 21–29 % in 41 s). More pieces per split keeps the
 * growth; the pacing curve still holds it back when it runs ahead.
 */
export function splitIntoFor(ballR) { return Math.max(3, Math.min(8, Math.round(1 + 2 * 10 / ballR))); }

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

/** Mutates and returns cfg. ctl: { gravity: auto|on|off|center, target: 'max'|number, balls: 'auto'|number, length: short|medium|long, ending: auto|rim-break|gold|flood } */
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
  const want = wantedBalls(c.balls);
  if (want && !FIXED_BALL[family]) {   // resize the ball so the arena is full at the count you asked for
    const r = clampR(w.ballR * Math.sqrt(w.maxBalls / want)), k = r / w.ballR;
    w.maxBalls = Math.floor(w.maxBalls / (k * k)); w.ballR = r; cfg.render.ballR = r;
    if (r < 10) w.splitInto = Math.max(w.splitInto || 3, splitIntoFor(r));
  } else if (L.ball !== 1 && !FIXED_BALL[family]) { w.ballR = Math.round(w.ballR * L.ball * 10) / 10; w.maxBalls = Math.floor(w.maxBalls / (L.ball * L.ball) / 50) * 50; cfg.render.ballR = w.ballR; }
  const full = w.maxBalls;
  if (want) w.maxBalls = Math.min(full, want);   // an invented machine was already built for this count's ball size
  else if (c.target !== 'max' && Number(c.target) > 0) w.maxBalls = Math.min(full, Math.floor(Number(c.target)));
  // length: slower machines for longer videos, and for smaller targets (they fill sooner)
  const slow = L.slow * (L.ball !== 1 && !want && !FIXED_BALL[family] ? (FAST_GROWTH[family] || 1) * (c.length === 'long' ? 1.25 : 1) : 1) * Math.pow(full / w.maxBalls, 0.3);
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
  cfg.controls = { gravity: gmode, target: c.target, ...(want ? { balls: want } : {}), length: c.length, ending: w.ending.type };
  return cfg;
}
