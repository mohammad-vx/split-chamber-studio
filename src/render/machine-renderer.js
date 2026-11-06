// Renderer for the generic machine engine: any capsule / circle / convex-polygon parts drawn in the Split Chamber
// metal style from their scripted poses, plus a breakable glass rim and the peak counter.
import { Renderer, mkCanvas, roundRect } from './renderer.js';
import { partPose } from '../engine/machines.js';
import { FPS } from '../core/constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const metal = (g, x0, y0, x1, y1) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#f4f7fb'); gr.addColorStop(0.3, '#c9d0da'); gr.addColorStop(0.65, '#8b94a1'); gr.addColorStop(1, '#4f5763');
  return gr;
};

export class MachineRenderer extends Renderer {
  constructor(ctx, scale, opts) { super(ctx, scale, { ...opts, housings: false, rim: false }); }

  build() {
    super.build();
    const s = this.scale;
    this.sprites = this.opts.parts.map((p) => this.buildPart(p, s));
    this.hubSprite = this.opts.hubR ? this.buildDisc(this.opts.hubR + 6, s, true) : null;
    this.boltSprite = this.buildDisc(14, s, true);
  }

  buildPart(p, s) {
    const pad = 4;
    if (p.type === 'beam') {                         // laser: a glowing line, clearly not a solid part
      const len = p.u1 - p.u0, G = 26, T = G * 2;
      const cv = mkCanvas((len + G * 2) * s, T * s), g = cv.getContext('2d');
      g.scale(s, s); g.translate(G, G);
      for (const [w, a] of [[22, 0.08], [12, 0.16], [6, 0.35]]) { g.strokeStyle = `rgba(70,170,255,${a})`; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke(); }
      g.strokeStyle = '#dff3ff'; g.lineWidth = Math.max(2, p.thick * 0.8); g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
      return { cv, pad: G, ox: p.u0, oy: -G + G, w: len, h: 0, beam: true };
    }
    if (p.type === 'capsule') {
      const len = p.u1 - p.u0, T = p.thick * 2;
      const cv = mkCanvas((len + pad * 2) * s, (T + pad * 2) * s), g = cv.getContext('2d');
      g.scale(s, s); g.translate(pad, pad);
      g.fillStyle = metal(g, 0, 0, 0, T); roundRect(g, 0, 0, len, T, T / 2); g.fill();
      g.strokeStyle = 'rgba(20,24,30,0.55)'; g.lineWidth = 1; roundRect(g, 0.5, 0.5, len - 1, T - 1, T / 2 - 0.5); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.42)'; g.fillRect(8, T * 0.14, Math.max(0, len - 18), 2);
      g.fillStyle = 'rgba(30,34,42,0.7)';
      for (let u = 26; u < len - 14; u += 64) { g.beginPath(); g.arc(u, T * 0.62, 2.2, 0, Math.PI * 2); g.fill(); }
      return { cv, pad, ox: p.u0, oy: -p.thick, w: len, h: T };
    }
    if (p.type === 'circle') {
      const d = this.buildDisc(p.r, s, false);
      return { ...d, circle: true };
    }
    // convex polygon in local coords
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const w = x1 - x0, h = y1 - y0;
    const cv = mkCanvas((w + pad * 2) * s, (h + pad * 2) * s), g = cv.getContext('2d');
    g.scale(s, s); g.translate(pad - x0, pad - y0);
    g.fillStyle = metal(g, 0, y0, 0, y1);
    g.beginPath(); p.pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(18,22,28,0.7)'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = 'rgba(40,46,56,0.4)'; g.lineWidth = 2;
    for (const f of [0.45, 0.65, 0.85]) { const x = x0 + w * f; g.beginPath(); g.moveTo(x, -h * 0.18 * f); g.lineTo(x, h * 0.18 * f); g.stroke(); }
    return { cv, pad, ox: x0, oy: y0, w, h };
  }

  buildDisc(R, s, hub) {
    const pad = 6, size = (R + pad) * 2;
    const cv = mkCanvas(size * s, size * s), g = cv.getContext('2d');
    g.scale(s, s); const m = size / 2;
    let gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.1, m, m, R);
    gr.addColorStop(0, '#eef2f7'); gr.addColorStop(0.55, '#9aa3ae'); gr.addColorStop(1, '#3a4049');
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(15,18,24,0.6)'; g.lineWidth = 1.5; g.stroke();
    if (hub) {
      gr = g.createRadialGradient(m, m, 2, m, m, R * 0.42);
      gr.addColorStop(0, '#5b636e'); gr.addColorStop(1, '#262b33');
      g.fillStyle = gr; g.beginPath(); g.arc(m, m, R * 0.42, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(m - R * 0.3, m - R * 0.35, R * 0.18, 0, Math.PI * 2); g.fill();
    }
    return { cv, size };
  }

  draw(session, f) { this._session = session; this._f = f; super.draw(session, f); }

  drawPistons(t) {
    const g = this.ctx, o = this.opts, { cx, cy, r } = o.arena;
    const pivots = new Set();
    g.save(); g.beginPath(); g.arc(cx, cy, r + 1, 0, Math.PI * 2); g.clip();   // parts live inside the chamber
    o.parts.forEach((p, k) => {
      const pose = partPose(p, t), sp = this.sprites[k];
      if (sp.circle) {
        const c = Math.cos(pose.a), s = Math.sin(pose.a);
        const x = pose.x + p.at[0] * c - p.at[1] * s, y = pose.y + p.at[0] * s + p.at[1] * c;
        g.drawImage(sp.cv, x - sp.size / 2, y - sp.size / 2, sp.size, sp.size);
        return;
      }
      g.save(); g.translate(pose.x, pose.y); g.rotate(pose.a);
      if (sp.beam) { g.globalCompositeOperation = 'lighter'; g.drawImage(sp.cv, sp.ox - sp.pad, -sp.pad, sp.w + sp.pad * 2, sp.pad * 2); }
      else g.drawImage(sp.cv, sp.ox - sp.pad, sp.oy - sp.pad, sp.w + sp.pad * 2, sp.h + sp.pad * 2);
      g.restore();
      if (p.type === 'capsule' && Math.abs(p.u0) < 1 && !o.hubR) pivots.add(`${pose.x},${pose.y}`);
    });
    g.restore();
    if (this.hubSprite) { const h = this.hubSprite; g.drawImage(h.cv, cx - h.size / 2, cy - h.size / 2, h.size, h.size); }
    for (const key of pivots) { const [x, y] = key.split(',').map(Number); const b = this.boltSprite; g.drawImage(b.cv, x - b.size / 2, y - b.size / 2, b.size, b.size); }
    // rim + break
    const m = this._session.meta, f = this._f;
    const flood = o.ending && o.ending.type === 'flood';
    const brk = o.ending && (o.ending.type === 'rim-break' || flood) && m.capFrame >= 0 ? m.capFrame + Math.round(o.finaleHold * FPS) : -1;
    if (flood) {                                     // the glass dissolves and the balls spill over the whole frame
      const fade = brk >= 0 && f >= brk ? clamp01(1 - (f - brk) / 20) : 1;
      if (fade > 0) { g.lineWidth = 4; g.strokeStyle = `rgba(214,222,234,${0.92 * fade})`; g.beginPath(); g.arc(cx, cy, r + 2 + (1 - fade) * 30, 0, Math.PI * 2); g.stroke(); }
      return;
    }
    const gapHalf = (o.ending && o.ending.gapHalf) || 0.5;
    const broken = brk >= 0 && f >= brk, open = broken ? clamp01((f - brk) / 6) : 0;
    g.lineWidth = 4; g.strokeStyle = 'rgba(214,222,234,0.92)';
    g.beginPath();
    if (open > 0) g.arc(cx, cy, r + 2, Math.PI / 2 + gapHalf * open, Math.PI / 2 - gapHalf * open + Math.PI * 2);
    else g.arc(cx, cy, r + 2, 0, Math.PI * 2);
    g.stroke();
    if (broken) {
      const tt = (f - brk) / FPS, frag = 7;
      g.strokeStyle = `rgba(214,222,234,${0.92 * clamp01(1 - tt / 2.2)})`;
      for (let k = 0; k < frag; k++) {
        const a0 = Math.PI / 2 - gapHalf + (2 * gapHalf) * (k + 0.5) / frag;
        const x = cx + Math.cos(a0) * (r + 2) + (Math.cos(a0) * 160 + (k - frag / 2) * 25) * tt;
        const y = cy + Math.sin(a0) * (r + 2) + (60 + k * 12) * tt + 700 * tt * tt;
        g.save(); g.translate(x, y); g.rotate(a0 + Math.PI / 2 + tt * (k % 2 ? 4 : -3));
        g.beginPath(); g.moveTo(-r * gapHalf / frag, 0); g.lineTo(r * gapHalf / frag, 0); g.stroke();
        g.restore();
      }
    }
  }

  drawCounter(session, f, fr) {
    const m = session.meta;
    if (m.capFrame >= 0 && f >= m.capFrame && fr.n < this.opts.maxBalls) fr = { ...fr, n: this.opts.maxBalls };
    super.drawCounter(session, f, fr);
  }
}
