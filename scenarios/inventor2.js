// Machine Inventor v2: more kinds of machine, and never the same machine twice.
// v1 drew three families (sweeper, press, blades) and only changed their numbers, so batches filled with the same
// machine shifted a little or turned. v2 adds five families built on mechanisms the engine already has
// (MECHANISM-STUDY §3–4, §6), and checks every invention against the machines you already have with a picture of
// what the machine covers over its cycle (novelty.js): turned, mirrored, shifted or slightly resized copies count as
// the same machine and are redrawn.
//   wave      a ring of pistons around the hub hammering the rim one after another (travelling / alternate / together)
//   kaleido   one random convex shape repeated 3–6 times around the centre, each copy spinning, stepping or rocking
//   pendulum  a chain of 2–3 links on swings with unequal periods (double / triple pendulum), alone or twinned
//   geneva    lobes on the hub turning in whole steps with a dwell (Geneva drive / ratchet)
//   orbit     1–3 bodies on epicycle paths (rosette orbits), optionally around fixed pegs
// plus v1's sweeper, press and blades. Same rule and engine as invent@1, so every invention reproduces from its config.
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';
import { baseMachine, finalize, wrap } from './machines.js';
import { machineModule, ARENA } from './phase2.js';
import { partPose, partGeometry } from '../engine/machines.js';
import { calibrate, FAMILIES as V1 } from './inventor.js';
import { signature, closest, SIMILAR } from './novelty.js';
import { splitIntoFor, radiusForBalls } from './controls.js';

const TAU = 6.283185307179586;
const VERSIONS = { engine: 4, renderer: 3, audio: 3, frame: 1, rule: 2, inventor: 2 };
const RULE = { pinchRule: 'contact', safetyCap: 40, checkSolid: true };

function rng(seed, salt) { let k = 0; const f = () => rand(seed, salt, k++, 0); f.range = (a, b) => a + f() * (b - a); f.pick = (arr) => arr[Math.floor(f() * arr.length)]; f.int = (a, b) => a + Math.floor(f() * (b - a + 1)); return f; }
const hub = (r, motion = {}) => ({ type: 'circle', pivot: [ARENA.cx, ARENA.cy], at: [0, 0], r, motion });
const polar = (rho, th) => [rho * dcos(th), rho * dsin(th)];
/**
 * The first ball waits, frozen, until a moving part strikes it (the hook rule). Put it where part `k` comes closest
 * to the rim within its first seconds, so the first strike lands early.
 */
function hookStart(parts, k, ballR) {
  let best = -1, bt = 0, ba = 0;
  for (let t = 0.3; t <= 4; t += 0.05) {
    const g = partGeometry(parts[k], partPose(parts[k], t, parts), t);
    const pts = g.c ? [[g.c[0], g.c[1], g.r]] : g.a ? [[g.a[0], g.a[1], g.thick / 2], [g.b[0], g.b[1], g.thick / 2]] : g.pts.map(([x, y]) => [x, y, 0]);
    for (const [x, y, rr] of pts) {
      const dx = x - ARENA.cx, dy = y - ARENA.cy, d = Math.sqrt(dx * dx + dy * dy) + rr;
      if (d > best + 2) { best = d; bt = t; ba = Math.atan2(dy, dx); }
    }
  }
  return { start: rimStart(ba, ballR), at: bt };
}
const rimStart = (th, ballR) => [ARENA.cx + dcos(th) * (ARENA.r - ballR - 3), ARENA.cy + dsin(th) * (ARENA.r - ballR - 3)];
function carrierMotion(R, beat) {
  const v = R();
  if (v < 0.35) return { motion: { rotate: { dir: R() < 0.5 ? 1 : -1, omega: TAU / (R.pick([16, 24, 32]) * beat) } }, tag: 'turning' };
  if (v < 0.55) return { motion: { oscillate: { amp: R.range(0.3, 0.8), period: R.pick([8, 12, 16]) * beat } }, tag: 'rocking' };
  return { motion: {}, tag: '' };
}

/** A ring of pistons that strike outward against the rim, one after another. */
function wave(R, ballR, beat) {
  const { r } = ARENA, g = 1.1 * ballR, hubR = 38;
  let n = R.pick([4, 5, 6, 7, 8, 9]);
  const len = Math.round(R.range(80, 160)), amp = Math.round(R.range(90, 170));
  const rhoExt = r - g - len, rhoIn = rhoExt - amp;                 // piston base when extended / retracted
  let w = Math.round(R.range(50, 120));
  while (n > 3 && w > 0.75 * 2 * Math.max(rhoIn, hubR + 10) * Math.sin(Math.PI / n)) n--;
  w = Math.max(3 * ballR, Math.min(w, Math.round(0.75 * 2 * Math.max(rhoIn, hubR + 10) * Math.sin(Math.PI / n))));
  const shape = R.pick(['block', 'wedge', 'fan']);
  const pts = shape === 'block' ? [[0, -w / 2], [len, -w / 2], [len, w / 2], [0, w / 2]]
    : shape === 'wedge' ? [[0, -w / 2], [len, -w / 6], [len, w / 6], [0, w / 2]]
      : [[0, -w / 4], [len * 0.6, -w / 2], [len, -w / 3], [len, w / 3], [len * 0.6, w / 2], [0, w / 4]];
  const kind = R.pick(['slam', 'slam', 'cam', 'quickReturn', 'scissor']), period = R.pick([2, 3, 4, 6]) * beat;
  const mode = R.pick(['travel', 'travel', 'alternate', 'together', 'pairs']), m = R.pick([1, 1, 2, -1]);
  const phaseOf = (k) => (mode === 'travel' ? (m * k) / n : mode === 'alternate' ? (k % 2) * 0.5 : mode === 'pairs' ? (k % (n % 2 ? n : n / 2)) / n * 2 : 0);
  const car = carrierMotion(R, beat), base = Math.PI / 2, parts = [hub(hubR, car.motion)];   // one piston points down, where the balls rest
  for (let k = 0; k < n; k++) {
    const th = base + k * TAU / n;
    parts.push({ type: 'poly', parent: 0, pivot: polar(rhoExt, th), angle: th, pts: pts.map(([x, y]) => [x, y]),
      motion: { mech: { kind, period, phase: 0.35 + phaseOf(k), rise: 0.55, fall: 0.12, slow: 0.7, to: [-amp * dcos(th), -amp * dsin(th), 0] } } });
  }
  const names = { travel: m < 0 ? 'wave (backward)' : m > 1 ? 'double wave' : 'wave', alternate: 'alternating', together: 'all at once', pairs: 'in pairs' };
  return { parts, hubR, hook: 1, start: null, gravity: 'on', beatPart: 1,
    name: `${n} ${shape} pistons · ${names[mode]}${car.tag ? ` · ${car.tag} ring` : ''}`, freeFraction: 0.8 };
}

/** One random convex shape, repeated around the centre. */
function kaleido(R, ballR, beat) {
  const { r } = ARENA, g = 1.1 * ballR, hubR = 34;
  const k = R.pick([3, 4, 5, 6]), s = Math.sin(Math.PI / k), limit = ((r - g) * s - 2.5 * ballR) / (1 + s);
  const maxR = Math.round(R.range(0.55, 0.92) * Math.min(limit, 175));
  const nv = R.pick([3, 4, 5, 6, 8]), A = 1, B = R.range(0.35, 1), ecc = R() < 0.6 ? R.range(0.15, 0.55) : 0;
  const offs = R() * TAU, angs = [];
  for (let i = 0; i < nv; i++) angs.push(offs + (i + R.range(-0.3, 0.3)) * TAU / nv);
  let pts = angs.map((a) => [A * dcos(a) + ecc, B * dsin(a)]);
  const far = Math.max(...pts.map(([x, y]) => Math.sqrt(x * x + y * y)));
  pts = pts.map(([x, y]) => [Math.round(x / far * maxR * 10) / 10, Math.round(y / far * maxR * 10) / 10]);
  const rho = r - g - maxR, mirror = R() < 0.5, how = R.pick(['spin', 'spin', 'step', 'rock']);
  const period = R.pick([3, 4, 6, 8]) * beat, dir = R() < 0.5 ? 1 : -1;
  const car = carrierMotion(R, beat), base = Math.PI / 2, parts = [hub(hubR, car.motion)];
  for (let j = 0; j < k; j++) {
    const th = base + j * TAU / k, d = mirror && j % 2 ? -dir : dir;
    const motion = how === 'spin' ? { rotate: { dir: d, omega: TAU / period } }
      : how === 'step' ? { mech: { kind: 'ratchet', period, dwell: 0.55, to: [0, 0, d * TAU / Math.max(3, nv)] } }
        : { oscillate: { amp: R.range(1.2, 2.4), period, phase: mirror && j % 2 ? Math.PI : 0 } };
    parts.push({ type: 'poly', parent: 0, pivot: polar(rho, th), angle: th + (mirror && j % 2 ? Math.PI : 0), pts: pts.map(([x, y]) => [x, mirror && j % 2 ? -y : y]), motion });
  }
  const shapeName = { 3: 'triangles', 4: 'quads', 5: 'pentagons', 6: 'hexagons', 8: 'octagons' }[nv];
  return { parts, hubR, hook: 1, start: null, gravity: 'on', beatPart: 1,
    name: `${k}-fold kaleidoscope · ${ecc ? 'off-centre ' : ''}${B < 0.6 ? 'long ' : ''}${shapeName} · ${how === 'spin' ? 'spinning' : how === 'step' ? 'stepping' : 'rocking'}${mirror ? ' · mirrored' : ''}${car.tag ? ` · ${car.tag}` : ''}`, freeFraction: 0.82 };
}

/** A chain of links on swings with unequal periods. */
function pendulum(R, ballR, beat) {
  const { r } = ARENA, g = 1.1 * ballR, hubR = 32;
  const links = R.pick([2, 2, 3]), headR = Math.round(R.range(24, 50)), reach = r - g - headR;
  const fr = links === 2 ? [R.range(0.45, 0.65)] : [R.range(0.35, 0.45), R.range(0.25, 0.35)];
  const L = []; let left = reach;
  for (const f of fr) { const l = Math.round(reach * f); L.push(l); left -= l; }
  L.push(Math.round(left));
  const P1 = R.pick([4, 6, 8]) * beat, ratios = [R.pick([2 / 3, 3 / 5, 3 / 4, 3 / 2, 5 / 4, 4 / 3]), R.pick([1 / 2, 2 / 5, 5 / 7, 7 / 5])];
  const twin = R() < 0.35, thick = Math.round(R.range(12, 20)), parts = [hub(hubR)];
  const chain = (baseA, phase) => {
    let parent = 0;
    for (let i = 0; i < links; i++) {
      const motion = i === 0 ? { swing: { amp: R.range(0.7, 1.5), period: P1, phase } } : { swing: { amp: R.range(1.2, 2.6), period: P1 * ratios[i - 1], phase: phase * (i + 1) } };
      parts.push({ type: 'capsule', parent, pivot: i === 0 ? [0, 0] : [L[i - 1], 0], angle: i === 0 ? baseA : 0, u0: 0, u1: L[i], thick: i === 0 ? thick : Math.max(10, thick - 4 * i), motion });
      parent = parts.length - 1;
    }
    parts.push({ type: 'circle', parent, pivot: [L[links - 1], 0], at: [0, 0], r: headR, motion: {} });
  };
  chain(Math.PI / 2, 0);
  const bob = parts.length - 1;
  if (twin) chain(R() < 0.5 ? -Math.PI / 2 : Math.PI / 2, Math.PI);
  return { parts, hubR, hook: bob, start: null, gravity: 'on', beatPart: 1,
    name: `${twin ? 'twin ' : ''}${links === 2 ? 'double' : 'triple'} pendulum · ${headR > 40 ? 'heavy' : 'light'} bob`, freeFraction: 0.85 };
}

/** Lobes on the hub, turning in whole steps with a dwell. */
function geneva(R, ballR, beat) {
  const { r } = ARENA, g = 1.1 * ballR, hubR = 44;
  const n = R.pick([2, 3, 3, 4, 5, 6]), shape = R.pick(['wedge', 'bar', 'hammer']), L = r - g;
  const step = R.pick([1, 1, 0.5]), dwell = R.range(0.35, 0.7), period = R.pick([2, 3, 4]) * beat, dir = R() < 0.5 ? 1 : -1;
  const parts = [hub(hubR, { mech: { kind: 'ratchet', period, dwell, to: [0, 0, dir * step * TAU / n] } })], base = R() * TAU;
  const wMax = Math.min(140, 0.8 * 2 * 120 * Math.sin(Math.PI / n));
  const w0 = Math.round(R.range(0.4, 1) * wMax), w1 = Math.round(R.range(0.2, 0.9) * w0);
  const headR = Math.round(R.range(30, 55));
  for (let j = 0; j < n; j++) {
    const th = base + j * TAU / n;
    if (shape === 'wedge') {
      const cap = Math.max(26, Math.round(w1 / 2));
      parts.push({ type: 'poly', parent: 0, pivot: [0, 0], angle: th, motion: {}, pts: [[hubR * 0.6, -w0 / 2], [L - cap, -cap * 0.8], [L - cap, cap * 0.8], [hubR * 0.6, w0 / 2]] });
      parts.push({ type: 'circle', parent: parts.length - 1, pivot: [L - cap, 0], at: [0, 0], r: cap, motion: {} });
    } else if (shape === 'bar') { const t = Math.round(R.range(44, 80)); parts.push({ type: 'capsule', parent: 0, pivot: [0, 0], angle: th, u0: hubR * 0.5, u1: L - t / 2, thick: t, motion: {} }); }
    else {
      parts.push({ type: 'capsule', parent: 0, pivot: [0, 0], angle: th, u0: hubR * 0.5, u1: L - headR, thick: 16, motion: {} });
      parts.push({ type: 'circle', parent: parts.length - 1, pivot: [L - headR, 0], at: [0, 0], r: headR, motion: {} });
    }
  }
  return { parts, hubR, hook: parts.length - 1, start: null, gravity: 'on', beatPart: 0,
    name: `Geneva drive · ${n} ${shape === 'wedge' ? 'wedges' : shape === 'bar' ? 'bars' : 'hammers'} · ${step === 1 ? 'full' : 'half'} steps`, freeFraction: 0.82 };
}

/** Bodies on epicycle (rosette) paths, optionally around fixed pegs. */
function orbit(R, ballR, beat) {
  const { r } = ARENA, g = 1.1 * ballR, hubR = 30;
  const nb = R.pick([1, 2, 2, 3]), round = R() < 0.5, bodyR = Math.round(R.range(34, 70));
  // R2 below the cusp ratio (R1 w1 + R2 w2 = 0): the body still moves fast where it passes the rim, so it wedges balls
  const q = R.pick([-2, -3, -3, -4, -5]), P = R.pick([4, 6, 8]) * beat, w1 = TAU / P * (R() < 0.5 ? 1 : -1), w2 = w1 * q;
  const span = r - g - bodyR, f = R.range(0.3, 0.6), R1 = Math.round(span / (1 + f / -q)), R2 = span - R1, parts = [];
  let pts = null;
  if (!round) {
    const nv = R.pick([3, 4, 5]), B = R.range(0.5, 1);
    pts = []; for (let i = 0; i < nv; i++) { const a = i * TAU / nv; pts.push([Math.round(bodyR * dcos(a)), Math.round(bodyR * B * dsin(a))]); }
  }
  // a star's points are fixed in space: one points straight down, where the balls rest (or the star turns slowly)
  const base = Math.PI / 2, bodies = [], turn = R() < 0.5 ? { rotate: { dir: R() < 0.5 ? 1 : -1, omega: TAU / (R.pick([24, 32]) * beat) } } : null;
  for (let j = 0; j < nb; j++) {
    parts.push(turn ? { ...hub(hubR, turn), angle: base + j * TAU / nb } : { ...hub(hubR), static: true, angle: base + j * TAU / nb });
    // `period` is not used by the path; the beat accent reads it (without it the accent fired every frame: a buzz)
    const c = parts.length - 1, mech = { kind: 'planet', R1, R2, w1, w2, spin: !round, period: P };
    parts.push(round ? { type: 'circle', parent: c, pivot: [0, 0], at: [0, 0], r: bodyR, motion: { mech } }
      : { type: 'poly', parent: c, pivot: [0, 0], angle: 0, pts: pts.map(([x, y]) => [x, y]), motion: { mech } });
    bodies.push(parts.length - 1);
  }
  const pegs = R() < 0.4 ? R.pick([3, 4, 6]) : 0;
  if (pegs) {
    const pr = Math.round(R.range(14, 24)), rho = Math.round(R.range(0.3, 0.5) * span);
    for (let j = 0; j < pegs; j++) {
      const [x, y] = polar(rho, base + (j + 0.5) * TAU / pegs);
      parts.push({ type: 'poly', static: true, pivot: [ARENA.cx + x, ARENA.cy + y], angle: 0, motion: {}, pts: [[-pr, -pr], [pr, -pr], [pr, pr], [-pr, pr]] });
    }
  }
  return { parts, hubR, hook: bodies[0], start: null, gravity: 'on', beatPart: bodies[0],
    name: `${nb === 1 ? 'one' : nb} ${round ? 'disc' : 'spinning block'}${nb > 1 ? 's' : ''} on a ${1 - q}-point star orbit${turn ? ' · turning' : ''}${pegs ? ` · ${pegs} pegs` : ''}`, freeFraction: 0.8 };
}

export const FAMILIES = { wave, kaleido, pendulum, geneva, orbit, sweeper: V1.sweeper, press: V1.press, blades: V1.blades };
export const FAMILY_NAMES = Object.keys(FAMILIES);
/** Open share of the arena each family leaves (its freeFraction): the ball size for a chosen count follows it. */
export const FREE = { wave: 0.8, kaleido: 0.82, pendulum: 0.85, geneva: 0.82, orbit: 0.8, sweeper: 0.85, press: 0.72, blades: 0.85 };

/** Invent one machine: { parts…, name, family, bpm, ballR, sig }. Pure and deterministic. */
export function invent2(seed, family, attempt, balls) {
  const R = rng(seed, 0x2b7e + attempt * 0x101);
  const bpm = Math.round(R.range(84, 124)), beat = 60 / bpm, drawn = Math.round(R.range(9, 11) * 2) / 2, ballR = balls ? radiusForBalls(balls + 50, FREE[family]) : drawn;   // a ball count you chose sets the size (+50: the count is rounded down to 50s)
  const m = FAMILIES[family](R, ballR, beat);
  if (m.hook != null) { m.start = hookStart(m.parts, m.hook, ballR).start; delete m.hook; }
  if (!['press', 'blades', 'pendulum'].includes(family) && R() < 0.18) {   // a see-through laser crossing the machine
    m.parts.push({ type: 'beam', pivot: [ARENA.cx, ARENA.cy], angle: R() * TAU, u0: 50, u1: ARENA.r - 6, thick: 3,
      motion: { rotate: { dir: R() < 0.5 ? 1 : -1, omega: TAU / (R.pick([12, 16, 24]) * beat) } } });
    m.name += ' · laser';
  }
  return { ...m, bpm, ballR, family, sig: signature(m.parts) };
}

function build(seed, inv, attempt, sized) {
  const machine = finalize(baseMachine(seed, 0x2b7f, { ...RULE, parts: inv.parts, hubR: inv.hubR, ballR: inv.ballR, gravityChance: 1,
    freeFraction: inv.freeFraction, start: inv.start, splitInto: sized ? Math.max(4, splitIntoFor(inv.ballR)) : 3, beamImmune: 120 }));
  machine.beatPart = inv.beatPart; machine.bladeCount = inv.parts.length;
  if (inv.gravity === 'center') machine.gravityMode = 'center';
  const cfg = wrap('invent@2', '✦ Invent', machine, seed, { bpm: inv.bpm, beatsPerBar: 4 });
  cfg.duration = { minS: 30, maxS: 50 };
  cfg.checks = { ...(cfg.checks || {}), climaxFillMin: 0.5, solidMax: 0.035 };
  cfg.versions = { ...VERSIONS };
  cfg.invented = { name: inv.name, family: inv.family, attempt, sig: inv.sig };
  return cfg;
}

export const ATTEMPTS = 30;   // a redraw that looks like a kept machine is skipped before calibration, so extra attempts are cheap
/**
 * o.balls   build the machine for this ball count: the ball is sized for it and the gaps follow the ball.
 * o.family  the family to try first (batches spread the families), o.avoid  signatures of the machines you already
 * have: an attempt that looks like one of them (similarity ≥ SIMILAR) is skipped. After 6 attempts in the preferred
 * family the other families are tried too. Deterministic: same seed and same avoid list → same machine.
 */
export const inventV2 = machineModule('invent@2', '✦ Invent', (seed, o) => {
  const avoid = o.avoid || [], R = rng(seed, 0x2b80);
  const order = FAMILY_NAMES.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const first = o.family && FAMILIES[o.family] ? o.family : order[0];
  const others = order.filter((f) => f !== first);
  let fallback = null;
  const kept = [];   // signatures of this call's earlier attempts (a redraw must differ from them too)
  for (let k = 0; k < ATTEMPTS; k++) {
    const family = k < 6 ? first : others[(k - 6) % others.length];
    const inv = invent2(seed, family, k, o.balls);
    const near = closest(inv.sig, avoid);
    if (near.sim >= SIMILAR) continue;
    if (closest(inv.sig, kept).sim >= SIMILAR) continue;
    kept.push(inv.sig);
    const cfg = build(seed, inv, k, !!o.balls);
    cfg.invented.nearest = +near.sim.toFixed(3);
    if (!fallback) fallback = cfg;
    if (o.precheck === false) { cfg.invented.precheck = 'skipped'; return cfg; }
    // a count you chose should be reached: the estimate (made at 24 s) runs late (measured: 8 of 10 machines at 500
    // balls ran out of time at 40–90 %), so aim the finale at 27 s instead of 33 s
    const c = o.balls ? calibrate(cfg, 27) : calibrate(cfg);
    cfg.render.parts = cfg.machine.parts;
    if (c.ok) { cfg.invented.precheck = `speed ×${(1 / c.k).toFixed(2)} · finale ≈ ${c.est.toFixed(0)} s`; cfg.invented.speed = +(1 / c.k).toFixed(3); return cfg; }
  }
  if (fallback) { fallback.invented.precheck = 'no variant passed; kept the first new one'; return fallback; }
  const cfg = build(seed, invent2(seed, first, 0, o.balls), 0, !!o.balls);
  cfg.invented.precheck = 'no new machine found for this seed';
  cfg.invented.repeat = true;
  return cfg;
}, { gravity: 'auto' });
inventV2.random = false;
inventV2.heavyGenerate = true;
inventV2.ballSized = true;   // generate(seed, { balls }) builds the machine for a ball count
inventV2.families = FAMILY_NAMES;
