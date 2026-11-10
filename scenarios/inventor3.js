// Machine Inventor v3: machines put together from independent choices instead of drawn from a few templates.
// v2 had eight families; each was one drawing whose numbers changed, about 90 machines that really differ. v3 builds
// a machine from: a layout (where the limbs are mounted) × how many limbs × how each limb is driven × an optional
// elbow × a tool at the end (15 shapes; stars, gears, anchors, hooks and combs are several convex parts on one parent)
// × whether the tool spins on its own × how the copies are phased × optional rim teeth and a laser.
//   hub    limbs on the central hub: spinner, swinger, striker, stepper or pump (pistons)
//   ring   tools or small rotors mounted on a carrier disc around the hub (planetary)
//   rim    limbs hinged on the rim reaching inward to a central anvil (an iris, a ring of hammers)
//   twin   two off-centre hubs turning against each other
//   classic  one of invent@2's eight families, unchanged
// Nothing is tuned by hand: after the draw, the limb lengths are fitted numerically so the farthest point of the
// machine passes the rim one ball apart (rim layout: the nearest point passes the anvil one ball apart). That gap is
// what the pinch rule needs, so every machine can split. The free space is measured, the first ball is put where a
// part strikes first, and the calibration aims the finale at 27 s (v2 aimed at 33 s and 9 of 10 machines ran out of
// time before the arena was full). Same rule and engine as invent@2: an invention reproduces from its config.
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';
import { baseMachine, finalize, wrap } from './machines.js';
import { machineModule, ARENA } from './phase2.js';
import { partPose, partGeometry } from '../engine/machines.js';
import { calibrate } from './inventor.js';
import { signature, closest, SIMILAR_FREE as SIMILAR } from './novelty.js';
import { invent2, FAMILY_NAMES as CLASSIC } from './inventor2.js';

const TAU = 6.283185307179586, DOWN = Math.PI / 2;
const VERSIONS = { engine: 4, renderer: 3, audio: 3, frame: 1, rule: 2, inventor: 3 };
const RULE = { pinchRule: 'contact', safetyCap: 40, checkSolid: true };
const FINALE_S = 27, MAX_PARTS = 36;

function rng(seed, salt) { let k = 0; const f = () => rand(seed, salt, k++, 0); f.range = (a, b) => a + f() * (b - a); f.pick = (arr) => arr[Math.floor(f() * arr.length)]; f.int = (a, b) => a + Math.floor(f() * (b - a + 1)); return f; }
const polar = (rho, th) => [rho * dcos(th), rho * dsin(th)];
const r1 = (v) => Math.round(v * 10) / 10;

// ── tools ───────────────────────────────────────────────────────────────────────────────────────────────────────
// A tool is drawn once (its numbers) and then built at the end of a limb: build(parts, parent, x, spin) adds its
// parts with the tool centred on the parent's local point (x, 0), +x pointing away from the mount.
const rect = (a, b) => [[-a, -b], [a, -b], [a, b], [-a, b]];
const TOOLS = {
  ball: { draw: (R) => ({ s: R.range(26, 60) }), spins: false,
    build: (P, parent, x, t) => { P.push({ type: 'circle', parent, pivot: [x, 0], at: [0, 0], r: r1(t.s), motion: {} }); } },
  block: { draw: (R) => ({ s: R.range(30, 58), b: R.range(0.6, 1.1) }), spins: true,
    build: (P, parent, x, t, spin) => { P.push({ type: 'poly', parent, pivot: [x, 0], angle: 0, pts: rect(r1(t.s * 0.75), r1(t.s * t.b)), motion: spin }); } },
  hammer: { draw: (R) => ({ s: R.range(34, 62), b: R.range(1.2, 1.7) }), spins: false,
    build: (P, parent, x, t) => { P.push({ type: 'poly', parent, pivot: [x, 0], angle: 0, pts: rect(r1(t.s * 0.42), r1(t.s * t.b)), motion: {} }); } },
  wedge: { draw: (R) => ({ s: R.range(40, 78), b: R.range(0.55, 0.95) }), spins: false,
    build: (P, parent, x, t) => { const s = t.s; P.push({ type: 'poly', parent, pivot: [x, 0], angle: 0, pts: [[-s, r1(-s * t.b)], [s, r1(-s * 0.16)], [s, r1(s * 0.16)], [-s, r1(s * t.b)]].map(([a, b]) => [r1(a), b]), motion: {} }); } },
  fan: { draw: (R) => ({ s: R.range(40, 72), b: R.range(0.7, 1.15) }), spins: false,
    build: (P, parent, x, t) => { const s = t.s; P.push({ type: 'poly', parent, pivot: [x, 0], angle: 0, pts: [[-s, -s * 0.22], [s, -s * t.b], [s, s * t.b], [-s, s * 0.22]].map(([a, b]) => [r1(a), r1(b)]), motion: {} }); } },
  blob: { draw: (R) => { const nv = R.pick([3, 4, 5, 6, 8]), B = R.range(0.4, 1), off = R() * TAU, a = []; for (let i = 0; i < nv; i++) a.push(off + (i + R.range(-0.3, 0.3)) * TAU / nv); return { s: R.range(36, 70), B, a }; }, spins: true,
    build: (P, parent, x, t, spin) => { P.push({ type: 'poly', parent, pivot: [x, 0], angle: 0, pts: t.a.map((a) => [r1(t.s * dcos(a)), r1(t.s * t.B * dsin(a))]), motion: spin }); } },
  star: { draw: (R) => ({ s: R.range(42, 76), k: R.pick([3, 4, 5, 6, 7]) }), spins: true,
    build: (P, parent, x, t, spin) => {
      const s = t.s, core = P.push({ type: 'circle', parent, pivot: [x, 0], at: [0, 0], r: r1(s * 0.42), motion: spin }) - 1, w = r1(s * 0.42 * Math.sin(Math.PI / t.k) * 1.15);
      for (let j = 0; j < t.k; j++) P.push({ type: 'poly', parent: core, pivot: [0, 0], angle: j * TAU / t.k, pts: [[r1(s * 0.25), -w], [r1(s), 0], [r1(s * 0.25), w]], motion: {} });
    } },
  gear: { draw: (R) => ({ s: R.range(40, 74), k: R.pick([6, 7, 8, 9, 10]) }), spins: true,
    build: (P, parent, x, t, spin) => {
      const s = t.s, core = P.push({ type: 'circle', parent, pivot: [x, 0], at: [0, 0], r: r1(s * 0.74), motion: spin }) - 1, w = r1(s * 0.74 * Math.sin(Math.PI / t.k) * 0.72);
      for (let j = 0; j < t.k; j++) P.push({ type: 'poly', parent: core, pivot: [0, 0], angle: j * TAU / t.k, pts: [[r1(s * 0.62), -w], [r1(s), r1(-w * 0.55)], [r1(s), r1(w * 0.55)], [r1(s * 0.62), w]], motion: {} });
    } },
  cross: { draw: (R) => ({ s: R.range(40, 74), k: R.pick([2, 2, 3]), th: R.range(8, 13) }), spins: true,
    build: (P, parent, x, t, spin) => {
      const core = P.push({ type: 'circle', parent, pivot: [x, 0], at: [0, 0], r: r1(t.th * 1.5), motion: spin }) - 1;
      for (let j = 0; j < t.k; j++) P.push({ type: 'capsule', parent: core, pivot: [0, 0], angle: j * Math.PI / t.k, u0: r1(-t.s), u1: r1(t.s), thick: r1(t.th), motion: {} });
    } },
  anchor: { draw: (R) => ({ s: R.range(60, 120), A: R.range(1.3, 2.6), th: R.range(8, 12) }), spins: false,
    build: (P, parent, x, t) => arc(P, parent, x - t.s, t.s, -t.A / 2, t.A / 2, t.th) },
  scoop: { draw: (R) => ({ s: R.range(50, 95), A: R.range(1.6, 2.8), th: R.range(8, 12) }), spins: false,
    build: (P, parent, x, t) => arc(P, parent, x + t.s, t.s, Math.PI - t.A / 2, Math.PI + t.A / 2, t.th) },
  hook: { draw: (R) => ({ s: R.range(50, 95), A: R.range(1.8, 3.0), th: R.range(8, 12), sd: R() < 0.5 ? 1 : -1 }), spins: false,
    build: (P, parent, x, t) => arc(P, parent, x - t.s, t.s, 0, t.sd * t.A, t.th) },
  comb: { draw: (R) => ({ s: R.range(55, 100), k: R.pick([3, 4, 5]), d: R.range(22, 40), th: R.range(8, 11) }), spins: false,
    build: (P, parent, x, t) => {
      P.push({ type: 'capsule', parent, pivot: [x, 0], angle: Math.PI / 2, u0: r1(-t.s), u1: r1(t.s), thick: r1(t.th), motion: {} });
      const w = r1(t.s / t.k * 0.55);
      for (let j = 0; j < t.k; j++) { const y = r1(-t.s + (j + 0.5) * 2 * t.s / t.k); P.push({ type: 'poly', parent, pivot: [x + t.th * 0.5, y], angle: 0, pts: [[0, -w], [r1(t.d), 0], [0, w]], motion: {} }); }
    } },
  fork: { draw: (R) => ({ s: R.range(60, 110), a: R.range(0.35, 0.8), th: R.range(8, 12) }), spins: false,
    build: (P, parent, x, t) => { for (const sd of [1, -1]) P.push({ type: 'capsule', parent, pivot: [x, 0], angle: sd * t.a, u0: 0, u1: r1(t.s), thick: r1(t.th), motion: {} }); } },
  none: { draw: (R) => ({ s: R.range(10, 16) }), spins: false, build: () => {} },   // a bare arm: its rounded end is the tool
};
/** A curved bar: chords of a circle (centre (cx, 0) in the parent's frame, radius s) from angle a0 to a1. */
function arc(P, parent, cx, s, a0, a1, th) {
  const m = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 0.5));
  for (let i = 0; i < m; i++) {
    const p = a0 + (a1 - a0) * i / m, q = a0 + (a1 - a0) * (i + 1) / m;
    const ax = cx + s * dcos(p), ay = s * dsin(p), bx = cx + s * dcos(q), by = s * dsin(q);
    P.push({ type: 'capsule', parent, pivot: [r1(ax), r1(ay)], angle: Math.atan2(by - ay, bx - ax), u0: 0, u1: r1(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))), thick: r1(th), motion: {} });
  }
}
const TOOL_NAMES = { ball: 'ball', block: 'block', hammer: 'hammer', wedge: 'wedge', fan: 'fan', blob: 'stone', star: 'star', gear: 'gear', cross: 'cross', anchor: 'anchor', scoop: 'scoop', hook: 'hook', comb: 'comb', fork: 'fork', none: 'bare' };
const TOOL_KEYS = Object.keys(TOOLS).filter((k) => k !== 'none');
function drawTool(R, kinds = TOOL_KEYS) { const kind = R.pick(kinds); return { kind, ...TOOLS[kind].draw(R) }; }
function drawSpin(R, tool, beat) {
  if (!TOOLS[tool.kind].spins) return { motion: {}, tag: '' };
  const v = R(), dir = R() < 0.5 ? 1 : -1;
  if (v < 0.45) return { motion: {}, tag: '' };
  if (v < 0.75) return { motion: { rotate: { dir, omega: TAU / (R.pick([2, 3, 4, 6]) * beat) } }, tag: 'spinning ' };
  if (v < 0.9) return { motion: { mech: { kind: 'ratchet', period: R.pick([1, 2]) * beat, dwell: 0.5, to: [0, 0, dir * TAU / R.pick([3, 4, 6, 8])] } }, tag: 'ticking ' };
  return { motion: { oscillate: { amp: R.range(0.6, 1.6), period: R.pick([2, 3, 4]) * beat } }, tag: 'rocking ' };
}
const flip = (m) => {   // the same motion the other way round (mirrored copies)
  const o = {};
  for (const [k, v] of Object.entries(m)) o[k] = k === 'rotate' ? { ...v, dir: -v.dir } : k === 'mech' ? { ...v, to: [v.to[0], v.to[1], -v.to[2]] } : { ...v, amp: -v.amp };
  return o;
};

// ── drives ──────────────────────────────────────────────────────────────────────────────────────────────────────
const PROFILES = ['slam', 'slam', 'quickReturn', 'cam', 'scissor'];
const PROFILE_NAMES = { slam: 'slamming', quickReturn: 'quick-return', cam: 'cam-driven', scissor: 'scissoring' };
const mechShape = { rise: 0.55, fall: 0.1, slow: 0.72 };
/** Phase (0…1 of a cycle) of copy k of n. */
function phaseOf(mode, k, n) { return mode === 'travel' ? k / n : mode === 'alternate' ? (k % 2) * 0.5 : mode === 'pairs' ? (k % Math.max(1, Math.ceil(n / 2))) / n * 2 : 0; }
const MODE_NAMES = { together: 'together', travel: 'in a wave', alternate: 'alternating', pairs: 'in pairs' };
function carrierMotion(R, beat, kinds) {
  const kind = R.pick(kinds), dir = R() < 0.5 ? 1 : -1;
  if (kind === 'turn') return { motion: { rotate: { dir, omega: TAU / (R.pick([8, 12, 16, 24]) * beat) } }, tag: 'turning', moving: true };
  if (kind === 'step') { const steps = R.pick([3, 4, 5, 6, 8]); return { motion: { mech: { kind: 'ratchet', period: R.pick([2, 3, 4]) * beat, dwell: R.range(0.35, 0.65), to: [0, 0, dir * TAU / steps] } }, tag: `stepping in ${steps}`, moving: true }; }
  if (kind === 'rock') return { motion: { oscillate: { amp: R.range(0.35, 1.1), period: R.pick([6, 8, 12]) * beat } }, tag: 'rocking', moving: false };
  return { motion: {}, tag: '', moving: false };
}
/** An elbow: a second segment whose joint bends on its own rhythm. */
function drawElbow(R, beat) {
  const v = R(), dir = R() < 0.5 ? 1 : -1;
  if (v < 0.5) { const kind = R.pick(PROFILES); return { tag: `${PROFILE_NAMES[kind]} elbow`, amp: R.range(0.45, 1.0), period: R.pick([2, 3, 4]) * beat, kind, dir }; }
  if (v < 0.8) return { tag: 'swinging elbow', amp: R.range(0.5, 1.2), period: R.pick([2, 3, 4, 6]) * beat, kind: 'osc', dir };
  return { tag: 'flail', period: R.pick([2, 3, 4]) * beat, kind: 'spin', dir };
}
function elbowMotion(e, ph) {
  if (e.kind === 'osc') return { oscillate: { amp: e.dir * e.amp, period: e.period, phase: ph * TAU } };
  if (e.kind === 'spin') return { rotate: { dir: e.dir, omega: TAU / e.period } };
  return { mech: { kind: e.kind, period: e.period, phase: ph, ...mechShape, to: [0, 0, e.dir * e.amp] } };
}

/**
 * A limb in the parent's frame, from the point `at` in direction `th`: one or two segments and a tool.
 * `first` is the motion of the first segment; lengths are multiplied by k (the fit).
 */
function limb(P, parent, at, th, spec, k, first, ph, mirror) {
  const L = spec.len * k, L1 = spec.elbow ? L * spec.split : L, L2 = L - L1;
  const a = P.push({ type: 'capsule', parent, pivot: at, angle: th, u0: spec.u0 || 0, u1: r1(Math.max(L1, (spec.u0 || 0) + 4)), thick: spec.thick, motion: first }) - 1;
  let end = a, x = r1(Math.max(L1, (spec.u0 || 0) + 4));
  if (spec.elbow) {
    const m = elbowMotion(spec.elbow, ph);
    end = P.push({ type: 'capsule', parent: a, pivot: [x, 0], angle: 0, u0: 0, u1: r1(Math.max(L2, 8)), thick: Math.max(7, spec.thick - 2), motion: mirror ? flip(m) : m }) - 1;
    x = r1(Math.max(L2, 8));
  }
  TOOLS[spec.tool.kind].build(P, end, x, spec.tool, mirror ? flip(spec.spin.motion) : spec.spin.motion);
  return a;
}
function drawLimb(R, beat, o = {}) {
  const tool = drawTool(R, o.tools), elbow = R() < (o.elbowChance ?? 0.3) ? drawElbow(R, beat) : null;
  return { tool, spin: drawSpin(R, tool, beat), elbow, split: R.range(0.45, 0.62), len: o.len || 300, thick: Math.round(R.range(9, 14)), u0: 0 };
}
const limbName = (s) => `${s.spin.tag}${TOOL_NAMES[s.tool.kind]}${s.tool.k && ['star', 'gear'].includes(s.tool.kind) ? ` (${s.tool.k})` : ''}${s.elbow ? ` on a ${s.elbow.tag}` : ''}`;
const count = (n, word) => `${n === 1 ? 'one' : n} ${word}${n === 1 ? '' : 's'}`;

// ── layouts ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Each layout draws its numbers once and returns { build(k) → parts, fit, name, hubR, gravity }.
const hubPart = (r, motion = {}, pivot = [ARENA.cx, ARENA.cy]) => ({ type: 'circle', pivot, at: [0, 0], r, motion });

/** Limbs on the central hub. */
function hub(R, beat) {
  const style = R.pick(['spinner', 'spinner', 'swinger', 'striker', 'striker', 'stepper', 'pump', 'pump']);
  const n = style === 'swinger' ? R.pick([1, 2, 2, 3]) : style === 'pump' ? R.pick([3, 4, 5, 6, 7, 8]) : R.pick([1, 2, 2, 3, 3, 4, 5, 6]);
  const spec = drawLimb(R, beat, { elbowChance: style === 'pump' ? 0 : style === 'spinner' ? 0.45 : 0.3 });
  const hubR = Math.round(R.range(28, 46)), mode = R.pick(['together', 'travel', 'travel', 'alternate', 'pairs']), mirror = n % 2 === 0 && R() < 0.4;
  const car = carrierMotion(R, beat, style === 'spinner' ? ['turn'] : style === 'stepper' ? ['step'] : style === 'swinger' ? ['none'] : ['none', 'none', 'turn', 'rock']);
  const period = R.pick([2, 3, 4, 6]) * beat, amp = R.range(0.7, 1.4), kind = R.pick(PROFILES), sd = R() < 0.5 ? 1 : -1;
  const stroke = Math.round(R.range(90, 180)), base = car.moving ? R() * TAU : DOWN;
  if (style === 'pump') spec.u0 = stroke;
  const swingAll = style === 'swinger' && n > 1 && R() < 0.6;   // all hang down and swing through the bottom, out of step
  const first = (j) => {
    const ph = phaseOf(mode, j, n), s = mirror && j % 2 ? -sd : sd;
    if (style === 'swinger') return { oscillate: { amp: s * amp, period: period * 2, phase: swingAll ? j * TAU / n : ph * TAU } };
    if (style === 'striker') return { mech: { kind, period, phase: ph, ...mechShape, to: [0, 0, s * amp] } };
    if (style === 'pump') { const th = base + j * TAU / n; return { mech: { kind, period, phase: 0.35 + ph, ...mechShape, to: [r1(-stroke * dcos(th)), r1(-stroke * dsin(th)), 0] } }; }
    return {};
  };
  return {
    fit: 'rim', hubR, gravity: 'on',
    build(k) {
      const P = [hubPart(hubR, car.motion)];
      for (let j = 0; j < n; j++) limb(P, 0, [0, 0], swingAll ? DOWN : base + j * TAU / n, spec, k, first(j), phaseOf(mode, j, n), mirror && j % 2 === 1);
      return P;
    },
    name: `${count(n, style === 'pump' ? 'piston' : 'arm')} · ${limbName(spec)} · ${{ spinner: 'spinning', swinger: 'swinging', striker: PROFILE_NAMES[kind], stepper: 'stepping', pump: `pumping ${MODE_NAMES[mode]}` }[style]}${style !== 'spinner' && style !== 'stepper' && car.tag ? ` · ${car.tag} hub` : ''}${style === 'stepper' ? ` (${car.tag.replace('stepping in ', '')} steps)` : ''}${mirror ? ' · mirrored' : ''}`,
  };
}

/** Tools or small rotors on a carrier disc around the hub. */
function ring(R, beat) {
  const n = R.pick([2, 3, 3, 4, 4, 5, 6]), rotor = R() < 0.5, hubR = Math.round(R.range(28, 44));
  const s = Math.sin(Math.PI / n);
  const tool = drawTool(R, rotor ? TOOL_KEYS : ['block', 'blob', 'star', 'gear', 'cross', 'blob', 'star', 'gear']);
  const maxS = Math.max(26, Math.min(tool.s, 150 * s + 20)); tool.s = maxS;
  const armLen = rotor ? Math.round(R.range(40, 95) * Math.min(1, s * 1.6)) : 0, arms = rotor ? R.pick([1, 1, 2, 3]) : 0;
  const spec = { tool, spin: rotor ? drawSpin(R, tool, beat) : { motion: {}, tag: '' }, elbow: null, split: 1, len: armLen, thick: Math.round(R.range(8, 12)), u0: 0 };
  const car = carrierMotion(R, beat, ['none', 'turn', 'turn', 'rock', 'step']), mirror = R() < 0.45, dir = R() < 0.5 ? 1 : -1;
  const how = R.pick(['spin', 'spin', 'step', 'rock']), period = R.pick([2, 3, 4, 6, 8]) * beat, base = DOWN;
  const steps = R.pick([3, 4, 6]), amp = R.range(1.0, 2.2);
  const own = (j) => {
    const d = mirror && j % 2 ? -dir : dir;
    return how === 'spin' ? { rotate: { dir: d, omega: TAU / period } } : how === 'step' ? { mech: { kind: 'ratchet', period: period / 2, dwell: 0.5, to: [0, 0, d * TAU / steps] } } : { oscillate: { amp: d * amp, period, phase: mirror && j % 2 ? Math.PI : 0 } };
  };
  return {
    fit: 'rim', hubR, gravity: 'on',
    build(k) {
      const P = [hubPart(hubR, car.motion)], rho = 210 * k;
      for (let j = 0; j < n; j++) {
        const th = base + j * TAU / n, at = polar(rho, th).map(r1);
        if (rotor) {
          const c = P.push({ type: 'circle', parent: 0, pivot: at, at: [0, 0], r: 16, motion: own(j) }) - 1;
          for (let a = 0; a < arms; a++) limb(P, c, [0, 0], th + a * TAU / arms, spec, 1, {}, 0, mirror && j % 2 === 1);
        } else {
          const before = P.length;
          TOOLS[tool.kind].build(P, 0, 0, tool, own(j));
          P[before].pivot = at; P[before].angle = (P[before].angle || 0) + th;
        }
      }
      return P;
    },
    name: `${n} ${rotor ? `${arms === 1 ? '' : `${arms}-armed `}${limbName(spec)} rotors` : `${TOOL_NAMES[tool.kind]}${tool.kind === 'cross' ? 'es' : 's'}`} around the hub · ${how === 'spin' ? 'spinning' : how === 'step' ? 'stepping' : 'rocking'}${mirror ? ' · mirrored' : ''}${car.tag ? ` · ${car.tag} ring` : ''}`,
  };
}

/** Limbs hinged on the rim, reaching inward to a central anvil. */
function rim(R, beat) {
  const n = R.pick([2, 3, 3, 4, 4, 5, 6, 8]), anvil = Math.round(R.range(46, 120)), style = R.pick(['swing', 'swing', 'strike', 'strike', 'plunge']);
  const spec = drawLimb(R, beat, { elbowChance: style === 'plunge' ? 0 : 0.2, tools: ['ball', 'block', 'hammer', 'wedge', 'blob', 'star', 'gear', 'anchor', 'scoop', 'hook', 'comb', 'fork', 'none'] });
  spec.tool.s = Math.min(spec.tool.s, 40 + 260 / n);
  const mode = R.pick(['together', 'together', 'travel', 'alternate']), mirror = n % 2 === 0 && R() < 0.4, sd = R() < 0.5 ? 1 : -1;
  const tilt = style === 'plunge' ? 0 : R.range(0, 0.5) * (R() < 0.5 ? 1 : -1), period = R.pick([2, 3, 4, 6]) * beat, amp = R.range(0.3, 0.7), kind = R.pick(PROFILES);
  const stroke = Math.round(R.range(100, 190)), base = R() * TAU, hinge = ARENA.r + 6;
  if (style === 'plunge') spec.u0 = stroke;
  const first = (j, th) => {
    const ph = phaseOf(mode, j, n), s = mirror && j % 2 ? -sd : sd;
    if (style === 'swing') return { oscillate: { amp: s * amp, period: period * 2, phase: ph * TAU } };
    if (style === 'strike') return { mech: { kind, period, phase: ph, ...mechShape, to: [0, 0, s * (amp + Math.abs(tilt))] } };
    return { mech: { kind, period, phase: 0.35 + ph, ...mechShape, to: [r1(-stroke * dcos(th)), r1(-stroke * dsin(th)), 0] } };
  };
  return {
    fit: 'core', hubR: anvil, gravity: 'center',
    build(k) {
      const P = [];
      for (let j = 0; j < n; j++) {
        const at = base + j * TAU / n, th = at + Math.PI + (style === 'strike' ? 0 : (mirror && j % 2 ? -tilt : tilt));
        const [x, y] = polar(hinge, at);
        limb(P, undefined, [r1(ARENA.cx + x), r1(ARENA.cy + y)], th, spec, k, first(j, th), phaseOf(mode, j, n), mirror && j % 2 === 1);
      }
      for (const p of P) if (p.parent === undefined) delete p.parent;
      return P;
    },
    name: `${count(n, 'rim arm')} · ${limbName(spec)} · ${style === 'swing' ? 'swinging' : style === 'strike' ? PROFILE_NAMES[kind] : 'plunging'} ${MODE_NAMES[mode]} onto a ${anvil > 85 ? 'big' : 'small'} anvil${mirror ? ' · mirrored' : ''}`,
  };
}

/** Two off-centre hubs turning against each other. */
function twin(R, beat) {
  const n = R.pick([1, 2, 2, 3, 3, 4]), d = Math.round(R.range(110, 190)), vertical = R() < 0.35;
  const spec = drawLimb(R, beat, { elbowChance: 0.2, len: 200 });
  spec.tool.s = Math.min(spec.tool.s, 30 + 110 / n);
  const style = R.pick(['turn', 'turn', 'turn', 'swing']), same = R() < 0.3, period = R.pick([6, 8, 12, 16]) * beat, amp = R.range(0.9, 1.6), dir = R() < 0.5 ? 1 : -1;
  const hubR = Math.round(R.range(22, 34)), offset = R() < 0.5 ? 0.5 : 0;
  return {
    fit: 'rim', hubR: 0, gravity: 'on',
    build(k) {
      const P = [];
      for (const sd of [1, -1]) {
        const pivot = vertical ? [ARENA.cx, ARENA.cy + sd * d] : [ARENA.cx + sd * d, ARENA.cy], dd = same ? dir : sd * dir;
        const motion = style === 'turn' ? { rotate: { dir: dd, omega: TAU / period } } : { oscillate: { amp: dd * amp, period: period / 2 } };
        const c = P.push(hubPart(hubR, motion, pivot)) - 1;
        for (let j = 0; j < n; j++) limb(P, c, [0, 0], DOWN + (j + (sd < 0 ? offset : 0)) * TAU / n, spec, k, {}, j / n, sd < 0 && !same);
      }
      return P;
    },
    name: `twin hubs ${vertical ? 'one above the other' : 'side by side'} · ${count(n, 'arm')} each · ${limbName(spec)} · ${style === 'turn' ? (same ? 'turning the same way' : 'counter-turning') : 'swinging'}`,
  };
}

export const LAYOUTS = { hub, ring, rim, twin };
/** 'classic': one of invent@2's eight families (wave, kaleidoscope, pendulum, Geneva, orbit, sweeper, press, blades). */
export const LAYOUT_NAMES = [...Object.keys(LAYOUTS), 'classic'];

// ── measuring ───────────────────────────────────────────────────────────────────────────────────────────────────
const segDist = (ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy || 1, u = Math.max(0, Math.min(1, (-ax * vx - ay * vy) / L)); return Math.sqrt((ax + u * vx) * (ax + u * vx) + (ay + u * vy) * (ay + u * vy)); };
/** Farthest and nearest distance of a part's surface from the arena centre, at one moment. */
function extent(g) {
  const { cx, cy } = ARENA;
  if (g.c) { const d = Math.hypot(g.c[0] - cx, g.c[1] - cy); return [d + g.r, Math.max(0, d - g.r)]; }
  if (g.a) return [Math.max(Math.hypot(g.a[0] - cx, g.a[1] - cy), Math.hypot(g.b[0] - cx, g.b[1] - cy)) + g.thick, Math.max(0, segDist(g.a[0] - cx, g.a[1] - cy, g.b[0] - cx, g.b[1] - cy) - g.thick)];
  let far = 0, near = Infinity;
  for (let i = 0; i < g.pts.length; i++) { const [ax, ay] = g.pts[i], [bx, by] = g.pts[(i + 1) % g.pts.length]; far = Math.max(far, Math.hypot(ax - cx, ay - cy)); near = Math.min(near, segDist(ax - cx, ay - cy, bx - cx, by - cy)); }
  return [far, near];
}
/** Over 24 s: the farthest reach, the nearest approach to the centre, and where and when each happens first (0.3–4 s). */
function reach(parts) {
  let far = 0, near = Infinity; const early = { far: -1, farAt: 0, near: Infinity, nearAt: 0 };
  for (let t = 0; t < 24; t += 0.04) {
    for (const p of parts) {
      if (p.type === 'beam' || p.static) continue;
      const pose = partPose(p, t, parts), g = partGeometry(p, pose, t), [f, nr] = extent(g);
      if (f > far) far = f;
      if (nr < near) near = nr;
      if (t >= 0.3 && t <= 4) {
        const c = g.c || (g.a ? (Math.hypot(g.a[0] - ARENA.cx, g.a[1] - ARENA.cy) > Math.hypot(g.b[0] - ARENA.cx, g.b[1] - ARENA.cy) ? g.a : g.b) : g.pts.reduce((m, q) => (Math.hypot(q[0] - ARENA.cx, q[1] - ARENA.cy) > Math.hypot(m[0] - ARENA.cx, m[1] - ARENA.cy) ? q : m)));
        if (f > early.far + 2) { early.far = f; early.farAt = Math.atan2(c[1] - ARENA.cy, c[0] - ARENA.cx); }
        if (nr < early.near - 2) {
          early.near = nr;
          const q = g.c || (g.a ? (Math.hypot(g.a[0] - ARENA.cx, g.a[1] - ARENA.cy) < Math.hypot(g.b[0] - ARENA.cx, g.b[1] - ARENA.cy) ? g.a : g.b) : g.pts.reduce((m, v) => (Math.hypot(v[0] - ARENA.cx, v[1] - ARENA.cy) < Math.hypot(m[0] - ARENA.cx, m[1] - ARENA.cy) ? v : m)));
          early.nearAt = Math.atan2(q[1] - ARENA.cy, q[0] - ARENA.cx);
        }
      }
    }
  }
  return { far, near, early };
}
/** Scale k so measure(k) = want (the reach grows with k almost linearly): secant steps. Null when it will not fit. */
function fitScale(measure, want) {
  let k0 = 1, m0 = measure(k0);
  if (!(m0 > 0) || !Number.isFinite(m0)) return null;
  let k1 = Math.max(0.25, Math.min(3, k0 * want / m0)), m1 = measure(k1);
  for (let i = 0; i < 8 && Math.abs(m1 - want) > 0.4; i++) {
    const slope = (m1 - m0) / (k1 - k0 || 1e-9);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) return null;
    const k2 = Math.max(0.2, Math.min(3.5, k1 + (want - m1) / slope));
    k0 = k1; m0 = m1; k1 = k2; m1 = measure(k1);
  }
  return Math.abs(m1 - want) <= 1.5 && k1 > 0.22 && k1 < 3.4 ? k1 : null;
}
function insidePart(g, x, y) {
  if (g.c) return (x - g.c[0]) * (x - g.c[0]) + (y - g.c[1]) * (y - g.c[1]) <= g.r * g.r;
  if (g.a) { const vx = g.b[0] - g.a[0], vy = g.b[1] - g.a[1], L = vx * vx + vy * vy || 1, u = Math.max(0, Math.min(1, ((x - g.a[0]) * vx + (y - g.a[1]) * vy) / L)), dx = x - g.a[0] - u * vx, dy = y - g.a[1] - u * vy; return dx * dx + dy * dy <= g.thick * g.thick; }
  let s = 0;
  for (let k = 0; k < g.pts.length; k++) { const [ax, ay] = g.pts[k], [bx, by] = g.pts[(k + 1) % g.pts.length], c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c !== 0) { const sg = c > 0 ? 1 : -1; if (s && sg !== s) return false; s = sg; } }
  return true;
}
/** Share of the arena the machine leaves open (mean of four moments, on a 40 × 40 grid). */
function freeShare(parts, hubR) {
  let inA = 0, solid = 0;
  for (const t of [0, 1.7, 3.9, 6.1]) {
    const geos = parts.filter((p) => p.type !== 'beam').map((p) => partGeometry(p, partPose(p, t, parts), t));
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const x = ARENA.cx + (i + 0.5 - 20) / 20 * ARENA.r, y = ARENA.cy + (j + 0.5 - 20) / 20 * ARENA.r, d = Math.hypot(x - ARENA.cx, y - ARENA.cy);
      if (d > ARENA.r) continue;
      inA++;
      if (d < hubR || geos.some((g) => insidePart(g, x, y))) solid++;
    }
  }
  return 1 - solid / inA;
}

/** Invent one machine: { parts, name, family (its layout), bpm, ballR, sig, … } or null when the draw does not fit. */
export function invent3(seed, layout, attempt) {
  if (layout === 'classic') { const inv = invent2(seed, rng(seed, 0x3c94 + attempt).pick(CLASSIC), attempt); return { ...inv, family: 'classic' }; }
  const R = rng(seed, 0x3c91 + attempt * 0x101);
  const bpm = Math.round(R.range(84, 124)), beat = 60 / bpm, ballR = Math.round(R.range(9, 11) * 2) / 2, g = 1.1 * ballR;
  const m = LAYOUTS[layout](R, beat);
  const teeth = m.fit === 'rim' && R() < 0.22 ? { n: R.pick([6, 8, 10, 12, 16]), depth: Math.round(R.range(18, 40)), base: R() * TAU } : null;
  const laser = R() < 0.14;
  const want = m.fit === 'rim' ? ARENA.r - g - (teeth ? teeth.depth : 0) : m.hubR + g;
  const k = fitScale((s) => { const v = reach(m.build(s)); return m.fit === 'rim' ? v.far : v.near; }, want);
  if (k == null) return null;
  const parts = m.build(k), v = reach(parts);
  if (parts.length > MAX_PARTS) return null;   // every part is tested against every ball
  if (v.far > ARENA.r - g + 1.5 && m.fit === 'rim') return null;
  if (m.fit === 'core' && v.near < m.hubR + 0.5 * g) return null;
  // the first ball waits, frozen, where a part strikes first
  const start = m.fit === 'rim'
    ? [ARENA.cx + dcos(v.early.farAt) * (ARENA.r - ballR - 3 - (teeth ? teeth.depth : 0)), ARENA.cy + dsin(v.early.farAt) * (ARENA.r - ballR - 3 - (teeth ? teeth.depth : 0))]
    : [ARENA.cx + dcos(v.early.nearAt) * (m.hubR + ballR + 2), ARENA.cy + dsin(v.early.nearAt) * (m.hubR + ballR + 2)];
  let name = m.name;
  if (teeth) {
    const w = Math.min(40, Math.PI * ARENA.r / teeth.n * 0.5);
    for (let j = 0; j < teeth.n; j++) {
      const th = teeth.base + j * TAU / teeth.n, [x, y] = polar(ARENA.r + 4, th);
      parts.push({ type: 'poly', static: true, pivot: [r1(ARENA.cx + x), r1(ARENA.cy + y)], angle: th + Math.PI, motion: {}, pts: [[0, -w], [teeth.depth + 4, 0], [0, w]].map(([a, b]) => [r1(a), r1(b)]) });
    }
    name += ` · ${teeth.n} rim teeth`;
  }
  if (laser) {
    parts.push({ type: 'beam', pivot: [ARENA.cx, ARENA.cy], angle: R() * TAU, u0: m.hubR + 14, u1: ARENA.r - 6, thick: 3, motion: { rotate: { dir: R() < 0.5 ? 1 : -1, omega: TAU / (R.pick([12, 16, 24]) * beat) } } });
    name += ' · laser';
  }
  const beatPart = Math.max(0, parts.findIndex((p) => p.motion && Object.values(p.motion).some((q) => q && q.period)));
  const free = Math.max(0.5, Math.min(0.9, freeShare(parts, m.hubR) - 0.04));
  return { parts, hubR: m.hubR, start: start.map(r1), gravity: m.gravity, beatPart, name, freeFraction: Math.round(free * 100) / 100, bpm, ballR, family: layout, sig: signature(parts) };
}

function build(seed, inv, attempt) {
  const machine = finalize(baseMachine(seed, 0x3c92, { ...RULE, parts: inv.parts, hubR: inv.hubR, ballR: inv.ballR, gravityChance: 1,
    freeFraction: inv.freeFraction, start: inv.start, splitInto: 3, beamImmune: 120 }));
  machine.beatPart = inv.beatPart; machine.bladeCount = inv.parts.length;
  if (inv.gravity === 'center') machine.gravityMode = 'center';
  const cfg = wrap('invent@3', '✦ Invent', machine, seed, { bpm: inv.bpm, beatsPerBar: 4 });
  cfg.duration = { minS: 30, maxS: 50 };
  cfg.checks = { ...(cfg.checks || {}), climaxFillMin: 0.5, solidMax: 0.035 };
  cfg.versions = { ...VERSIONS };
  cfg.invented = { name: inv.name, family: inv.family, attempt, sig: inv.sig };
  return cfg;
}

export const ATTEMPTS = 30;
/**
 * o.family  the layout to try first (batches spread the layouts), o.avoid  signatures of the machines you already
 * have: an attempt that looks like one of them (similarity ≥ SIMILAR) is skipped. After 8 attempts in the preferred
 * layout the others are tried too. Deterministic: same seed and same avoid list → same machine.
 */
export const inventV3 = machineModule('invent@3', '✦ Invent', (seed, o) => {
  const avoid = o.avoid || [], R = rng(seed, 0x3c93);
  const order = LAYOUT_NAMES.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const first = o.family && LAYOUT_NAMES.includes(o.family) ? o.family : order[0];
  const others = order.filter((f) => f !== first);
  let fallback = null;
  const kept = [];
  for (let k = 0; k < ATTEMPTS; k++) {
    const layout = k < 8 ? first : others[(k - 8) % others.length];
    const inv = invent3(seed, layout, k);
    if (!inv) continue;
    const near = closest(inv.sig, avoid, SIMILAR);
    if (near.sim >= SIMILAR) continue;
    if (closest(inv.sig, kept, SIMILAR).sim >= SIMILAR) continue;
    kept.push(inv.sig);
    const cfg = build(seed, inv, k);
    cfg.invented.nearest = +near.sim.toFixed(3);
    if (!fallback) fallback = cfg;
    if (o.precheck === false) { cfg.invented.precheck = 'skipped'; return cfg; }
    const c = calibrate(cfg, FINALE_S);
    cfg.render.parts = cfg.machine.parts;
    if (c.ok) { cfg.invented.precheck = `speed ×${(1 / c.k).toFixed(2)} · finale ≈ ${c.est.toFixed(0)} s`; cfg.invented.speed = +(1 / c.k).toFixed(3); return cfg; }
  }
  if (fallback) { fallback.invented.precheck = 'no variant passed; kept the first new one'; return fallback; }
  throw new Error('the inventor found no machine that fits for this seed');
}, { gravity: 'auto' });
inventV3.random = false;
inventV3.heavyGenerate = true;
inventV3.families = LAYOUT_NAMES;
