// Phase 2 reference machines on the v2.3 engine (part tree + closed-form mechanisms). Same rule as phase 1: solid
// parts collide, a ball pinched between a moving part and another surface always splits.
//   croc-jaws@1    Crocodile Jaws — a head block on the rim with two jaws (and teeth mounted on them) that open
//                  slowly and snap shut (quick return)
//   fist-arm@1     Fist Arm — a shoulder on the rim, an upper arm, a forearm on an elbow and a fist; the arm sweeps
//                  while the forearm cocks slowly and punches fast onto a fixed anvil
//   hammer-bowl@1  Hammer & Bowl — a drop hammer from above the arena lifts slowly and falls onto the anvil in a bowl
//   shears-fan@1   Shears Fan — 3–5 blades hinged on one pin above the arena open like a fan and shut like shears
//   laser-spin@1   Laser Spin — a laser bar on a rotating carrier sweeps planet-style past fixed pegs
//   claw-machine@1 Claw Machine — a trolley on a rail, a cable and a claw whose fingers close into a cage; no gravity
//   fan-blades@1   Fan Blades — two sector blades hinged at the bottom swing against each other
import { MachineSim } from '../engine/machines.js';
import { rand } from '../engine/rng.js';
import { dsin, dcos } from '../engine/dmath.js';
import { baseMachine, finalize, wrap } from './machines.js';

const TAU = 6.283185307179586;
export const ARENA = { cx: 540, cy: 1000, r: 460 };
const VERSIONS = { engine: 4, renderer: 3, audio: 2, frame: 1, rule: 2 };
const r01 = (seed, salt, k) => rand(seed, salt, k, 0);
const range = (seed, salt, lo, hi, k) => lo + r01(seed, salt, k) * (hi - lo);
const pick = (seed, salt, arr, k) => arr[Math.floor(r01(seed, salt, k) * arr.length)];
const RULE = { pinchRule: 'contact', safetyCap: 40, checkSolid: true };
const T = (o, k, d) => (o.tune && o.tune[k] != null ? o.tune[k] : d);

function v2(cfg) {
  cfg.duration = { minS: 30, maxS: 50 };
  cfg.checks = { ...(cfg.checks || {}), climaxFillMin: 0.5, solidMax: 0.035 };
  cfg.versions = { ...VERSIONS };
  return cfg;
}
export const machineModule = (key, label, gen, defaults = {}) => ({
  id: key.split('@')[0], version: Number(key.split('@')[1]), key, mode: 'packed', label, listed: true, defaults,
  generate: (seed, opts = {}) => gen(seed >>> 0, opts),
  createSim(config) { return new MachineSim(config); },
  checks(config) { return { duration: config.duration }; },
});
/** Rotate local points by a. */
const rot = (pts, a) => pts.map(([x, y]) => [x * dcos(a) - y * dsin(a), x * dsin(a) + y * dcos(a)]);

// ── Crocodile Jaws ──────────────────────────────────────────────────────────────────────────────────────────────
export const crocJawsV1 = machineModule('croc-jaws@1', 'Crocodile Jaws', (seed, o) => {
  const S = 0xc01, bpm = Math.round(range(seed, S, 88, 116, 1));
  const period = pick(seed, S, [2, 4, 4], 2) * 60 / bpm * T(o, 'slow', 1);
  const sd = r01(seed, S, 3) < 0.5 ? 1 : -1;                       // hinge on the left (1) or the right (-1) rim
  const ballR = T(o, 'ballR', 10), gap = 1.1 * ballR, teethH = 0.45 * ballR;
  const { cx, cy, r: R } = ARENA, hy0 = T(o, 'hy', 250), hx0 = -Math.sqrt((R - 34) * (R - 34) - hy0 * hy0);
  const hx = cx + sd * hx0, hy = cy + hy0;                          // hinge: the upper jaw's back corner
  const a0 = T(o, 'tilt', -0.1), L = T(o, 'jaw', 700), amp = T(o, 'amp', 0.75), back = 70;
  const tan = Math.tan(a0), d = gap / Math.cos(a0);
  const plateY = (x) => hy + sd * (x - hx) * tan + d;              // the fixed lower jaw, parallel to the closed bite
  const X0 = cx - 490, X1 = cx + 490;
  const parts = [
    // lower jaw: a plate across the arena (both ends outside the rim, nothing falls under it)
    { type: 'poly', static: true, pivot: [0, 0], angle: 0, motion: {}, pts: [[X0, plateY(X0)], [X1, plateY(X1)], [X1, plateY(X1) + 34], [X0, plateY(X0) + 34]] },
    // upper jaw: inner edge on its local x axis, body on the far side, tapering to the snout
    { type: 'poly', pivot: [hx, hy], angle: sd > 0 ? a0 : Math.PI - a0, motion: { mech: { kind: 'quickReturn', period, slow: 0.72, to: [0, 0, -sd * amp] } },
      pts: [[-back, 0], [L, 0], [L - 40, -sd * 34], [-back, -sd * 92]].map(([x, y]) => [x, y]) },
  ];
  if (sd < 0) parts[1].pts.reverse();
  for (let k = 0; k < 7; k++) {                                     // teeth mounted on the upper jaw (they move with it)
    const u = 60 + k * (L - 110) / 6;
    const tooth = [[-10, 0], [10, 0], [0, sd * teethH]]; if (sd < 0) tooth.reverse();
    parts.push({ type: 'poly', parent: 1, pivot: [u, 0], angle: 0, pts: tooth, motion: {} });
  }
  // the head behind the hinge fills the corner against the rim
  parts.push({ type: 'poly', static: true, pivot: [hx, hy], angle: 0, motion: {}, pts: (sd > 0
    ? [[-back - 260, -200], [-back + 6, -96], [-back + 6, d], [-back - 260, d]] : [[back + 260, -200], [back + 260, d], [back - 6, d], [back - 6, -96]]) });
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, ballR, gravityChance: 1, freeFraction: 0.55,   // the space under the lower jaw is not part of the play area
    start: [hx + sd * L * 0.6, plateY(hx + sd * L * 0.6) - ballR - 1], ...(o.tune || {}) }));
  m.beatPart = 1;
  return v2(wrap('croc-jaws@1', 'Crocodile Jaws', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

// ── Fist Arm ────────────────────────────────────────────────────────────────────────────────────────────────────
export const fistArmV1 = machineModule('fist-arm@1', 'Fist Arm', (seed, o) => {
  const S = 0xc02, bpm = Math.round(range(seed, S, 88, 116, 1));
  const beat = 60 / bpm, ballR = T(o, 'ballR', 10), fistR = T(o, 'fist', 56);
  const sx = ARENA.cx, sy = ARENA.cy;                              // shoulder on the hub at the centre
  const reach = ARENA.r - 1.1 * ballR - fistR;                     // straight arm: the fist passes the rim one ball apart
  const L1 = Math.round(reach * 0.53), L2 = reach - L1;
  const sweep = T(o, 'sweep', 1.5), bend = T(o, 'bend', 0.7);
  const armP = pick(seed, S, [4, 4, 6], 2) * beat * T(o, 'slow', 1), punchP = pick(seed, S, [2, 3, 3], 4) * beat * T(o, 'slow', 1);
  const ph = r01(seed, S, 3) * TAU, bs = r01(seed, S, 5) < 0.5 ? 1 : -1, parts = [];
  for (const k of [0, 1]) {                                        // two arms swinging against each other
    const up = parts.length;
    parts.push({ type: 'capsule', pivot: [sx, sy], angle: Math.PI / 2, u0: 0, u1: L1, thick: 22,                          // upper arm
      motion: { oscillate: { amp: sweep, period: armP, phase: ph + k * Math.PI } } });
    parts.push({ type: 'capsule', parent: up, pivot: [L1, 0], angle: 0, u0: 0, u1: L2, thick: 19,                         // forearm: cock slowly, punch fast
      motion: { mech: { kind: 'slam', period: punchP, phase: k * 0.5, rise: 0.45, fall: 0.08, to: [0, 0, (k ? -bs : bs) * bend] } } });
    parts.push({ type: 'circle', parent: up + 1, pivot: [L2, 0], at: [0, 0], r: fistR, motion: {} });                    // fist
  }
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, hubR: 40, ballR, gravityChance: 1, freeFraction: 0.85,
    start: [sx + 0.3 * reach, sy + 0.95 * (reach + fistR)], ...(o.tune || {}) }));
  m.beatPart = 0;
  return v2(wrap('fist-arm@1', 'Fist Arm', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

// ── Hammer & Bowl ───────────────────────────────────────────────────────────────────────────────────────────────
/** Convex pieces of a circular bowl (annular sector from a0 to a1, inner radius ri, thickness w). */
export function bowlPieces(cx, cy, ri, w, a0, a1, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const b0 = a0 + (a1 - a0) * k / n, b1 = a0 + (a1 - a0) * (k + 1) / n;
    out.push({ type: 'poly', static: true, pivot: [cx, cy], angle: 0, motion: {},
      pts: [[dcos(b0) * ri, dsin(b0) * ri], [dcos(b0) * (ri + w), dsin(b0) * (ri + w)], [dcos(b1) * (ri + w), dsin(b1) * (ri + w)], [dcos(b1) * ri, dsin(b1) * ri]] });
  }
  return out;
}

export const hammerBowlV1 = machineModule('hammer-bowl@1', 'Hammer & Bowl', (seed, o) => {
  const S = 0xc03, bpm = Math.round(range(seed, S, 86, 114, 1));
  const period = pick(seed, S, [2, 2, 4], 2) * 60 / bpm * T(o, 'slow', 1), ballR = T(o, 'ballR', 10);
  const { cx, cy } = ARENA;
  // a diamond head (peaked roof: nothing rests on it) over a V bowl whose plates run parallel to its lower edges
  const w = T(o, 'w', 230), hTop = 80, hBot = T(o, 'hBot', 110), gap = 1.1 * ballR;
  const apex = cy + T(o, 'apex', 330), slope = hBot / w, d = gap * Math.sqrt(w * w + hBot * hBot) / w;
  const py = cy - ARENA.r - 60;                                   // the shaft comes in from above the arena
  const strikeTop = apex - d - hBot - hTop;                       // head top apex when it strikes
  const Ls = strikeTop - py, lift = T(o, 'lift', 330);
  const X1 = 472;                                                 // the plate ends outside the rim: no pocket at its corner
  const plate = (s) => { const pts = [[0, apex], [s * X1, apex - X1 * slope], [s * X1, apex - X1 * slope + 26], [0, apex + 26]]; return s > 0 ? pts : pts.reverse(); };
  const parts = [
    { type: 'capsule', outside: true, pivot: [cx, py], angle: Math.PI / 2, u0: 0, u1: Ls, thick: 15,
      motion: { mech: { kind: 'slam', period, rise: 0.62, fall: 0.1, to: [0, -lift, 0] } } },
    // head in shaft coordinates (x down, y = −world x): top apex, right, bottom apex, left
    { type: 'poly', parent: 0, pivot: [Ls, 0], angle: 0, pts: [[0, 0], [hTop, -w], [hTop + hBot, 0], [hTop, w]], motion: {} },
    { type: 'poly', static: true, pivot: [cx, 0], angle: 0, pts: plate(1), motion: {} },
    { type: 'poly', static: true, pivot: [cx, 0], angle: 0, pts: plate(-1), motion: {} },
  ];
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, ballR, gravityChance: 1, freeFraction: 0.72,
    start: [cx + 3 * ballR, apex - 3 * ballR * slope - ballR - 2], ...(o.tune || {}) }));
  m.beatPart = 0;
  return v2(wrap('hammer-bowl@1', 'Hammer & Bowl', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

export const PHASE2 = [crocJawsV1, fistArmV1, hammerBowlV1];

// ── Shears Fan ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Distance from an inside point (hx, hy) to the arena rim along the unit direction (dx, dy). */
function toRim(hx, hy, dx, dy) {
  const px = hx - ARENA.cx, py = hy - ARENA.cy, b = px * dx + py * dy;
  return -b + Math.sqrt(b * b - (px * px + py * py - ARENA.r * ARENA.r));
}

export const shearsFanV1 = machineModule('shears-fan@1', 'Shears Fan', (seed, o) => {
  const S = 0xc04, bpm = Math.round(range(seed, S, 88, 116, 1)), beat = 60 / bpm;
  const ballR = T(o, 'ballR', 10), N = pick(seed, S, [3, 4, 4, 5], 2);
  const { cx, cy, r: R } = ARENA, pinY = cy - R - 40;               // one pin above the arena
  const Rc = T(o, 'cradle', 880), thick = 8, L = Rc - 1.1 * ballR - thick;
  const spread = T(o, 'spread', 0.3), closed = T(o, 'closed', 0.12), sway = T(o, 'sway', 0.22), u0 = T(o, 'u0', 260);
  const swayP = pick(seed, S, [8, 16], 3) * beat * T(o, 'slow', 1), cutP = pick(seed, S, [2, 4], 4) * beat * T(o, 'slow', 1);
  const parts = [];
  for (let k = 0; k < N; k++) {
    const c = k - (N - 1) / 2;
    parts.push({ type: 'capsule', outside: true, pivot: [cx, pinY], angle: Math.PI / 2 + c * closed, u0, u1: L, thick,   // blades start low: no narrow wedge near the pin
      motion: { oscillate: { amp: sway, period: swayP, phase: r01(seed, S, 5) * TAU }, mech: { kind: 'scissor', period: cutP, to: [0, 0, c * (spread - closed)] } } });
  }
  // the cradle: an arc concentric with the pin, so every blade tip passes it one ball apart
  parts.push(...bowlPieces(cx, pinY, Rc, 26, Math.PI / 2 - 0.47, Math.PI / 2 + 0.47, 12));
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, ballR, gravityChance: 1, freeFraction: 0.78,
    start: [cx + 40, pinY + Rc - ballR - 2], ...(o.tune || {}) }));
  m.beatPart = 0; m.bladeCount = N;
  return v2(wrap('shears-fan@1', 'Shears Fan', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

// ── Fan Blades ──────────────────────────────────────────────────────────────────────────────────────────────────
export const fanBladesV1 = machineModule('fan-blades@1', 'Fan Blades', (seed, o) => {
  const S = 0xc05, bpm = Math.round(range(seed, S, 88, 116, 1)), beat = 60 / bpm;
  const ballR = T(o, 'ballR', 10), { cx, cy, r: R } = ARENA;
  // two sector blades hinged side by side at the centre, hanging down; their arcs pass the rim one ball apart
  const g = 1.1 * ballR, rad = R - 1.1 * ballR - g, w = T(o, 'w', 0.6), n = 8, amp = T(o, 'amp', 1.25);
  const period = pick(seed, S, [5, 6, 6, 7], 2) * beat * T(o, 'slow', 1);
  const parts = [];
  for (const sd of [-1, 1]) {                                        // left (−1) and right (+1)
    const pts = [[0, 0]]; for (let k = 0; k <= n; k++) { const th = -sd * w * k / n; pts.push([rad * Math.cos(th), rad * Math.sin(th)]); }
    parts.push({ type: 'poly', pivot: [cx + sd * g / 2, cy], angle: Math.PI / 2, pts,
      motion: { mech: { kind: 'scissor', period, to: [0, 0, -sd * amp] } } });   // both swing outward and back together
  }
  const sa = w + 0.25;
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, hubR: 30, ballR, gravityChance: 1, freeFraction: 0.85,
    start: [cx + Math.sin(sa) * (R - 40), cy + Math.cos(sa) * (R - 40)], ...(o.tune || {}) }));   // in the right blade's path
  m.beatPart = 0;
  return v2(wrap('fan-blades@1', 'Fan Blades', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

// ── Claw Machine ────────────────────────────────────────────────────────────────────────────────────────────────
export const clawMachineV1 = machineModule('claw-machine@1', 'Claw Machine', (seed, o) => {
  const S = 0xc06, bpm = Math.round(range(seed, S, 86, 112, 1)), beat = 60 / bpm;
  const ballR = T(o, 'ballR', 10), { cx, cy } = ARENA;
  const railY = cy - 330, travel = T(o, 'travel', 230), finger = T(o, 'finger', 230), open = T(o, 'open', 1.0), shut = 0.1, floorY = cy + T(o, 'floor', 300);
  const tipsDown = 26 + finger * Math.cos(shut) + 9, drop = floorY - 1.1 * ballR - tipsDown - (railY + 22 + 120);   // closed tips skim the floor
  const P = pick(seed, S, [2, 4, 4], 2) * beat * T(o, 'slow', 1), grab = P / 2;
  const parts = [
    { type: 'capsule', static: true, pivot: [cx - 330, railY], angle: 0, u0: 0, u1: 660, thick: 10, motion: {} },                         // rail
    { type: 'poly', parent: 0, pivot: [330, 0], angle: 0, pts: [[-46, -22], [46, -22], [46, 22], [-46, 22]],                                // trolley
      motion: { slide: { axis: [1, 0], amp: travel, period: P * 1.5, phase: r01(seed, S, 3) * TAU } } },
    { type: 'capsule', parent: 1, pivot: [0, 22], angle: Math.PI / 2, u0: 0, u1: 120, thick: 4,                                            // cable (drops and rises)
      motion: { mech: { kind: 'cam', period: P, to: [0, drop, 0] } } },
    // palm: a bar that widens into the cage roof while the fingers close (a changing shape)
    { type: 'poly', parent: 2, pivot: [120, 0], angle: 0, pts: [[0, -40], [16, -40], [16, 40], [0, 40]],
      morph: { period: grab, to: [[0, -56], [26, -50], [26, 50], [0, 56]] }, motion: {} },
  ];
  for (const sd of [-1, 1]) {                                         // fingers: open wide, close into a cage
    parts.push({ type: 'capsule', parent: 3, pivot: [20, sd * 34], angle: sd * open, u0: 0, u1: finger, thick: 9,
      motion: { mech: { kind: 'scissor', period: grab, to: [0, 0, -sd * (open - shut)] } } });
  }
  parts.push({ type: 'poly', static: true, pivot: [cx, 0], angle: 0, motion: {}, pts: [[-470, floorY], [470, floorY], [470, floorY + 30], [-470, floorY + 30]] });   // floor
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, ballR, gravityChance: 1, freeFraction: 0.72,
    ending: { type: 'flood', gapHalf: 0.5, push: 900, duration: 3.5 }, start: [cx, floorY - ballR - 1], ...(o.tune || {}) }));
  m.beatPart = 2;
  return v2(wrap('claw-machine@1', 'Claw Machine', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'on' });

// ── Laser Spin ──────────────────────────────────────────────────────────────────────────────────────────────────
export const laserSpinV1 = machineModule('laser-spin@1', 'Laser Spin', (seed, o) => {
  const S = 0xc07, bpm = Math.round(range(seed, S, 92, 120, 1)), beat = 60 / bpm;
  const ballR = T(o, 'ballR', 8.5), { cx, cy } = ARENA, dir = r01(seed, S, 2) < 0.5 ? 1 : -1;
  const w1 = dir * TAU / (pick(seed, S, [16, 32], 3) * beat * T(o, 'slow', 1)), w2 = -dir * TAU / (pick(seed, S, [4, 8], 4) * beat * T(o, 'slow', 1));
  const parts = [{ type: 'beam', pivot: [cx, cy], angle: 0, u0: -230, u1: 230, thick: 3, motion: { mech: { kind: 'planet', R1: T(o, 'orbit', 150), w1, R2: 0, w2, spin: true } } }];
  const pegs = pick(seed, S, [5, 6, 7], 5), pr = 300, ph = r01(seed, S, 6) * TAU;
  for (let k = 0; k < pegs; k++) { const a = ph + k * TAU / pegs; parts.push({ type: 'circle', static: true, pivot: [cx + pr * dcos(a), cy + pr * dsin(a)], at: [0, 0], r: 26, motion: {} }); }
  const m = finalize(baseMachine(seed, S, { ...RULE, parts, ballR, gravityChance: 1, splitInto: 2,
    beamImmune: Math.round(T(o, 'immune', 2.0) * 60), start: [cx + 150, cy], ...(o.tune || {}) }));
  m.bladeCount = 1; m.beatPart = null;
  return v2(wrap('laser-spin@1', 'Laser Spin', m, seed, { bpm, beatsPerBar: 4 }));
}, { gravity: 'center' });

export const PHASE3 = [shearsFanV1, fanBladesV1, clawMachineV1, laserSpinV1];

