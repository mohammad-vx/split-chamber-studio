// Machine Inventor v1 (phase 3): every seed builds a machine nobody wrote by hand. It follows the invention grammar of
// docs/MECHANISM-STUDY.md §8 with the rule learned in phase 2 — a machine grows only along its pinch lines, so each
// moving family is generated together with the surface it pinches against, one ball apart:
//   sweeper  arms from the hub (1–3), optional elbow, a head whose path runs one ball from the rim
//   press    a slab with a sloped roof driven toward a fixed plate (flat or V), from any side
//   blades   a pair of sector blades on the hub that swing apart against the rim and shut on each other
// plus an optional see-through laser. Mechanism, rhythm, sizes, symmetry and gravity are drawn from the seed, so an
// invented machine reproduces exactly from its config like any other pattern. The pipeline's checks reject the
// failures; the survivors reach the review queue with an "Invented" badge and a descriptive name.
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';
import { baseMachine, finalize, wrap } from './machines.js';
import { machineModule, bowlPieces, ARENA } from './phase2.js';
import { MachineSim, partPose, partGeometry } from '../engine/machines.js';
import { FPS } from '../core/constants.js';

const TAU = 6.283185307179586;
const VERSIONS = { engine: 4, renderer: 3, audio: 3, frame: 1, rule: 2, inventor: 1 };
const RULE = { pinchRule: 'contact', safetyCap: 40, checkSolid: true };
const MECH_NAMES = { quickReturn: 'quick-return', slam: 'slam', cam: 'cam', scissor: 'scissor', oscillate: 'swing', rotate: 'turning' };

function rng(seed, salt) { let k = 0; const f = () => rand(seed, salt, k++, 0); f.range = (a, b) => a + f() * (b - a); f.pick = (arr) => arr[Math.floor(f() * arr.length)]; return f; }

/** Arms from the hub; heads pass the rim one ball apart. */
function sweeper(R, ballR, beat) {
  const { cx, cy, r } = ARENA, arms = R.pick([1, 2, 2, 3]), elbow = R() < 0.5, headR = Math.round(R.range(30, 62));
  const reach = r - 1.1 * ballR - headR, L1 = elbow ? Math.round(reach * R.range(0.45, 0.6)) : reach, L2 = reach - L1;
  const turning = R() < 0.4, period = R.pick([4, 6, 8]) * beat, base = R() * TAU;
  const swing = turning ? { rotate: { dir: R() < 0.5 ? 1 : -1, omega: TAU / (R.pick([8, 12, 16]) * beat) } }
    : { oscillate: { amp: R.range(0.8, 1.5), period, phase: R() * TAU } };
  const kind = R.pick(['quickReturn', 'slam', 'cam']), bend = R.range(0.4, 0.9), parts = [];
  const counter = !turning && arms === 2 && R() < 0.7;              // a counter-swinging pair (like rams)
  for (let k = 0; k < arms; k++) {
    const up = parts.length;
    const motion = counter ? { oscillate: { ...swing.oscillate, phase: swing.oscillate.phase + k * Math.PI } } : swing;
    parts.push({ type: 'capsule', pivot: [cx, cy], angle: (counter ? Math.PI / 2 : base + k * TAU / arms), u0: 0, u1: L1, thick: Math.round(R.range(14, 22)), motion });
    if (elbow) parts.push({ type: 'capsule', parent: up, pivot: [L1, 0], angle: 0, u0: 0, u1: L2, thick: 16,
      motion: { mech: { kind, period: R.pick([2, 3, 4]) * beat, phase: k * 0.5, rise: 0.45, fall: 0.08, slow: 0.75, to: [0, 0, (k % 2 ? -1 : 1) * bend] } } });
    parts.push({ type: 'circle', parent: parts.length - 1, pivot: [elbow ? L2 : L1, 0], at: [0, 0], r: headR, motion: {} });
  }
  // the first ball waits where the first head will be 0.3 s in (so the very first swing strikes it: hook ≤ 3 s)
  const head = parts.findIndex((p) => p.type === 'circle');
  const hc = partGeometry(parts[head], partPose(parts[head], 0.3, parts)).c;
  const sa = Math.atan2(hc[1] - cy, hc[0] - cx);
  return { parts, hubR: 36, start: [cx + Math.cos(sa) * (r - ballR - 3), cy + Math.sin(sa) * (r - ballR - 3)], gravity: turning ? 'center' : 'on', beatPart: 0,
    name: `${arms === 1 ? 'one arm' : `${arms} arms`}${elbow ? (arms === 1 ? ' with an elbow' : ' with elbows') : ''} · ${headR > 46 ? 'heavy' : 'light'} heads · ${MECH_NAMES[turning ? 'rotate' : 'oscillate']}${elbow ? ` + ${MECH_NAMES[kind]}` : ''}`, freeFraction: 0.85 };
}

/** A roofed slab driven toward a fixed plate (flat or V) from the side gravity pulls toward. */
function press(R, ballR, beat) {
  const { cx, cy, r } = ARENA, vee = R() < 0.6, gap = 1.1 * ballR, w = Math.round(R.range(170, 250));
  const hBot = vee ? Math.round(R.range(70, 120)) : 0, hTop = 70, apex = Math.round(R.range(280, 340));
  const slope = hBot / w, d = vee ? gap * Math.sqrt(w * w + hBot * hBot) / w : gap;
  const kind = R.pick(['slam', 'slam', 'quickReturn', 'cam']), period = R.pick([2, 3, 4]) * beat, lift = Math.round(R.range(260, 360));
  const py = cy - r - 60, floorY0 = cy + apex, hd = vee ? hTop + hBot : hTop + 30;
  const Ls = floorY0 - d - hd - py, X1 = 480;                     // the head stops one ball above the plate
  const head = vee ? [[0, 0], [hTop, -w], [hTop + hBot, 0], [hTop, w]] : [[0, 0], [hTop, -w], [hTop + 30, -w], [hTop + 30, w], [hTop, w]];
  const floorY = cy + apex, parts = [
    { type: 'capsule', outside: true, pivot: [cx, py], angle: Math.PI / 2, u0: 0, u1: Ls, thick: 15,
      motion: { mech: { kind, period, rise: 0.6, fall: 0.1, slow: 0.7, to: [0, -lift, 0] } } },
    { type: 'poly', parent: 0, pivot: [Ls, 0], angle: 0, pts: head, motion: {} },
  ];
  if (vee) for (const s of [1, -1]) {
    const pts = [[0, floorY], [s * X1, floorY - X1 * slope], [s * X1, floorY - X1 * slope + 26], [0, floorY + 26]];
    parts.push({ type: 'poly', static: true, pivot: [cx, 0], angle: 0, motion: {}, pts: s > 0 ? pts : pts.reverse() });
  } else {
    parts.push({ type: 'poly', static: true, pivot: [cx, 0], angle: 0, motion: {}, pts: [[-X1, floorY], [X1, floorY], [X1, floorY + 30], [-X1, floorY + 30]] });
  }
  if (!vee && R() < 0.4) { const drift = { slide: { axis: [1, 0], amp: Math.round(R.range(60, 160)), period: R.pick([8, 12]) * beat } }; parts[0].motion = { ...parts[0].motion, ...drift }; }
  return { parts, hubR: 0, start: [cx + 3 * ballR, floorY - 3 * ballR * slope - ballR - 2], gravity: 'on', beatPart: 0,
    name: `${vee ? 'diamond hammer over a V bowl' : 'roofed slab over a flat anvil'} · ${MECH_NAMES[kind]}${parts[0].motion.slide ? ' · drifting' : ''}`, freeFraction: 0.72 };
}

/** Two sector blades on the hub. */
function blades(R, ballR, beat) {
  // ranges kept near the hand-tuned Fan Blades (wider ones stalled after the first split)
  const { cx, cy, r } = ARENA, g = 1.1 * ballR, rad = r - 1.1 * ballR - g, w = R.range(0.5, 0.72), n = 8;
  const down = Math.PI / 2, amp = R.range(1.1, 1.35), kind = R.pick(['scissor', 'scissor', 'quickReturn']);
  const period = R.pick([5, 6, 7]) * beat, parts = [];
  for (const sd of [-1, 1]) {
    const pts = [[0, 0]]; for (let k = 0; k <= n; k++) { const th = -sd * w * k / n; pts.push([rad * Math.cos(th), rad * Math.sin(th)]); }
    const nx = dsin(down), ny = -dcos(down);                         // blades side by side across their axis (left blade on the left)
    parts.push({ type: 'poly', pivot: [cx + sd * nx * g / 2, cy + sd * ny * g / 2], angle: down, pts, motion: { mech: { kind, period, slow: 0.7, to: [0, 0, -sd * amp] } } });
  }
  const sa = down + w + 0.25;
  return { parts, hubR: 30, start: [cx + dcos(sa) * (r - 40), cy + dsin(sa) * (r - 40)], gravity: down === Math.PI / 2 ? 'on' : 'center', beatPart: 0,
    name: `twin sector blades · ${Math.round(w * 57)}° wide · ${MECH_NAMES[kind]}`, freeFraction: 0.85 };
}

const FAMILIES = { sweeper, press, blades };

/** Invent a machine from a seed: { machine parts…, name, family }. Pure and deterministic. */
export function invent(seed, o = {}) {
  const R = rng(seed, 0x1a7e + (o.attempt || 0) * 0x101);   // attempt 0 = the original v1 draw
  const bpm = Math.round(R.range(86, 122)), beat = 60 / bpm, ballR = Math.round(R.range(9, 11) * 2) / 2;
  const fam = R.pick(['sweeper', 'sweeper', 'press', 'blades']);
  // the seed's own family for the first attempts (only the details are redrawn), so the mix of families survives
  const family = o.family || ((o.attempt || 0) < 4 ? rng(seed, 0x1a7e).pick(['sweeper', 'sweeper', 'press', 'blades']) : fam);
  const m = FAMILIES[family](R, ballR, beat);
  if (family === 'sweeper' && R() < 0.3) {                           // a see-through laser crossing the arms (with blades it pushed balls into the metal)
    const omega = TAU / (R.pick([12, 16, 24]) * beat);
    m.parts.push({ type: 'beam', pivot: [ARENA.cx, ARENA.cy], angle: R() * TAU, u0: 40, u1: ARENA.r - 6, thick: 3, motion: { rotate: { dir: R() < 0.5 ? 1 : -1, omega } } });
    m.name += ' · laser';
  }
  return { ...m, bpm, ballR, family };
}

/**
 * Quick pre-check (12 s of simulation, well under a second): does the machine start the way the good ones do?
 * Measured on the first inventions: survivors had 18 … 13 % of the target balls at 12 s; stalls stayed at 3,
 * runaways had > 15 %. Returns { ok, n12, why }.
 */
export function precheck(cfg) {
  const sim = new MachineSim(cfg), max = cfg.machine.maxBalls;
  while (sim.frame < 12 * FPS && !sim.done) sim.step();
  const n = sim.count;
  if (n < 18) return { ok: false, n12: n, why: 'stalls' };
  if (n > 0.13 * max) return { ok: false, n12: n, why: 'too fast' };
  return { ok: true, n12: n };
}

/** Balls at 12 s and 24 s, and the frame the finale would start at (if it comes within 24 s). */
function growth(cfg) {
  const sim = new MachineSim(cfg);
  let n12 = 0;
  while (sim.frame < 24 * FPS && !sim.done && sim.capFrame < 0) { sim.step(); if (sim.frame === 12 * FPS) n12 = sim.count; }
  return { n12: n12 || sim.count, n24: sim.count, cap: sim.capFrame >= 0 ? sim.capFrame / FPS : -1, max: cfg.machine.maxBalls };
}

/** When the finale would start, extrapolated from the growth between 12 s and 24 s. */
function finaleEstimate(g) {
  if (g.cap > 0) return g.cap;
  if (g.n24 <= g.n12 || g.n24 < 6) return Infinity;
  return 24 + 12 * Math.log(g.max / g.n24) / Math.log(g.n24 / g.n12);
}

const TARGET_S = 33, K_MIN = 0.6, K_MAX = 2.2;   // aim early: growth slows near the end, the estimate runs optimistic
function scaleRhythm(cfg, k) {
  for (const p of cfg.machine.parts) for (const m of Object.values(p.motion || {})) {
    if (!m || typeof m !== 'object') continue;
    if (m.period) m.period *= k;
    if (m.omega) m.omega /= k;
    if (m.w1) m.w1 /= k;
    if (m.w2) m.w2 /= k;
  }
}

/**
 * Speed calibration (3.2): measure how fast the machine grows and scale its rhythm (0.6–1.6×) so the finale lands
 * near 33 s — the inventor used to pick the speed at random and the checks then rejected machines that were fine
 * but too slow or too fast. Two rounds; returns { ok, k, est } and mutates cfg.
 */
export function calibrate(cfg) {
  let k = 1, est = Infinity;
  for (let round = 0; round < 2; round++) {
    const g = growth(cfg);
    if (g.n12 < 4) return { ok: false, k, est: Infinity, why: 'stalls' };
    est = finaleEstimate(g);
    if (est >= 28 && est <= 38) return { ok: true, k, est };
    const step = Math.min(K_MAX / k, Math.max(K_MIN / k, TARGET_S / Math.min(est, 120)));
    if (Math.abs(step - 1) < 0.02) break;
    scaleRhythm(cfg, step); k *= step;
  }
  const g = growth(cfg); est = finaleEstimate(g);
  return { ok: est >= 27 && est <= 39, k, est };
}

function build(seed, o, attempt) {
  const inv = invent(seed, { ...o, attempt });
  const S = 0x1a7f;
  const machine = finalize(baseMachine(seed, S, { ...RULE, parts: inv.parts, hubR: inv.hubR, ballR: inv.ballR, gravityChance: 1,
    freeFraction: inv.freeFraction, start: inv.start, splitInto: 3, beamImmune: 120, ...(o.tune || {}) }));
  machine.beatPart = inv.beatPart; machine.bladeCount = inv.parts.length;
  if (inv.gravity === 'center') machine.gravityMode = 'center';
  const cfg = wrap('invent@1', '✦ Invent', machine, seed, { bpm: inv.bpm, beatsPerBar: 4 });
  cfg.duration = { minS: 30, maxS: 50 };
  cfg.checks = { ...(cfg.checks || {}), climaxFillMin: 0.5, solidMax: 0.035 };
  cfg.versions = { ...VERSIONS };
  cfg.invented = { name: inv.name, family: inv.family, attempt };
  return cfg;
}

export const ATTEMPTS = 6;
export const inventV1 = machineModule('invent@1', '✦ Invent', (seed, o) => {
  // try up to ATTEMPTS variants of this seed; keep the first that starts well (deterministic: same seed → same machine)
  let first = null;
  const avoid = new Set(o.avoid || []);
  for (let k = 0; k < ATTEMPTS; k++) {
    const cfg = build(seed, o, k);
    if (avoid.has(`${cfg.invented.family}: ${cfg.invented.name}`)) continue;   // a structure you already accepted
    if (!first) first = cfg;
    if (o.precheck === false) { cfg.invented.precheck = 'skipped'; return cfg; }
    const c = calibrate(cfg);
    cfg.render.parts = cfg.machine.parts;
    if (c.ok) { cfg.invented.precheck = `speed ×${(1 / c.k).toFixed(2)} · finale ≈ ${c.est.toFixed(0)} s`; cfg.invented.speed = +(1 / c.k).toFixed(3); return cfg; }
  }
  if (!first) first = build(seed, o, 0);
  first.invented.precheck = 'no variant passed; kept the first';
  return first;
}, { gravity: 'auto' });
inventV1.random = false;
inventV1.heavyGenerate = true;   // calibration simulates: the pipeline generates it in a worker   // never picked by "Random pattern": you ask for an invention
