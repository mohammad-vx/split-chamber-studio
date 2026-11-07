// Machine kinematics: where every part is at time t. Pure functions of time, shared by the sim and the renderer.
//   Motion primitives: rotate, oscillate (angle), swing (pendulum), slide (translation), radial (contraction).
//   Part tree: a part with `parent: k` lives in part k's local frame — its pivot and motion are expressed relative
//   to the parent, so an elbow arm, a crane on a rail or a claw on a cable are just chains of simple motions.
//   Parts without a parent use exactly the original arithmetic (old patterns stay bit-exact).
import { dsin, dcos } from '../dmath.js';
import { mechanism } from './mechanisms.js';

export const TAU = 6.283185307179586;

/** Phase (radians) of a periodic motion whose frequency rises linearly: f(t) = f0 (1 + k t). */
export function phaseOf(m, t) { return TAU * (t / m.period + (m.speedUp || 0) * t * t / (2 * m.period)) + (m.phase || 0); }

// smooth "press" profile: dwell open, close fast, dwell, open (keeps velocities bounded)
function squareish(ph) { const s = dsin(ph); return s * (1.5 - 0.5 * s * s); }

/** Pose of a part in its own frame (the parent's local frame, or the world for a root part). */
export function localPose(p, t) {
  let x = p.pivot[0], y = p.pivot[1], a = p.angle || 0;
  const m = p.motion || {};
  if (m.rotate) a += m.rotate.dir * m.rotate.omega * t + (m.rotate.accel || 0) * t * t / 2;
  if (m.oscillate) { const o = m.oscillate; a += o.amp * dsin(phaseOf(o, t)); }
  if (m.swing) { const o = m.swing; a += o.amp * dsin(phaseOf(o, t)); }
  if (m.slide) {
    const o = m.slide; const s = o.amp * (o.square ? squareish(phaseOf(o, t)) : dsin(phaseOf(o, t)));
    x += o.axis[0] * s; y += o.axis[1] * s;
  }
  if (m.radial) {                                  // move along the part's own outward direction (contraction)
    const o = m.radial, s = o.amp * (0.5 - 0.5 * dcos(phaseOf(o, t)));   // 0 → amp → 0
    x += o.dir[0] * s; y += o.dir[1] * s;
  }
  if (m.mech) {                                    // closed-form mechanisms (phase 2): see mechanisms.js
    const e = mechanism(m.mech, t);
    x += e.x; y += e.y; a += e.a;
  }
  return { x, y, a };
}

/** Compose a local pose with its parent's world pose. */
export function compose(P, L) {
  const c = dcos(P.a), s = dsin(P.a);
  return { x: P.x + L.x * c - L.y * s, y: P.y + L.x * s + L.y * c, a: P.a + L.a };
}

/** World pose of a part at time t: { x, y, a }. `parts` is required only for parts with a parent. */
export function partPose(p, t, parts) {
  const L = localPose(p, t);
  if (p.parent == null) return L;
  if (!parts) throw new Error('partPose: a child part needs the parts list');
  return compose(partPose(parts[p.parent], t, parts), L);
}

/** Local shape of a part at time t (a morphing part blends two point sets). */
export function partShape(p, t) {
  if (!p.morph) return p.pts;
  const o = p.morph, k = 0.5 - 0.5 * dcos(phaseOf(o, t));   // 0 → 1 → 0
  return p.pts.map(([x, y], i) => [x + (o.to[i][0] - x) * k, y + (o.to[i][1] - y) * k]);
}

/** World geometry of a part at pose. */
export function partGeometry(p, pose, t = 0) {
  const c = dcos(pose.a), s = dsin(pose.a);
  const W = (lx, ly) => [pose.x + lx * c - ly * s, pose.y + lx * s + ly * c];
  if (p.type === 'capsule' || p.type === 'beam') return { a: W(p.u0, 0), b: W(p.u1, 0), thick: p.thick };
  if (p.type === 'circle') return { c: W(p.at[0], p.at[1]), r: p.r };
  return { pts: partShape(p, t).map(([lx, ly]) => W(lx, ly)) };
}

/** Outward edge normals of a convex polygon (world points). */
export function polyEdges(pts) {
  const m = pts.length; let mx = 0, my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= m; my /= m;
  const edges = [];
  for (let e = 0; e < m; e++) {
    const [ax, ay] = pts[e], [bx, by] = pts[(e + 1) % m];
    let nx = by - ay, ny = -(bx - ax); const l = Math.sqrt(nx * nx + ny * ny); nx /= l; ny /= l;
    let d = nx * ax + ny * ay; if (nx * mx + ny * my - d > 0) { nx = -nx; ny = -ny; d = -d; }
    edges.push({ ax, ay, bx, by, nx, ny, d });
  }
  return edges;
}

/** Check a parts list: parents must exist and come earlier (no cycles). Throws on a bad tree. */
export function validateTree(parts) {
  parts.forEach((p, k) => {
    if (p.parent == null) return;
    if (!Number.isInteger(p.parent) || p.parent < 0 || p.parent >= k) throw new Error(`part ${k}: parent ${p.parent} must be an earlier part`);
  });
  return true;
}
