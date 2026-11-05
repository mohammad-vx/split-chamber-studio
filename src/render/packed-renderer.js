// Renderer for packed scenarios (rotary-sweeper): Split Chamber look with static metal wedges, rotating arms,
// a hub, and a glass rim that cracks open at the bottom for the rim-break ending (falling fragments).
import { Renderer, mkCanvas, roundRect } from './renderer.js';
import { armAngle } from '../engine/packed.js';
import { FPS } from '../core/constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class PackedRenderer extends Renderer {
  constructor(ctx, scale, opts) { super(ctx, scale, { ...opts, housings: false, rim: false }); }

  build() {
    super.build();
    this.wedgeLayer = this.buildWedges(this.scale);
    this.armSprite = this.buildArm(this.scale);
    this.hubSprite = this.buildHub(this.scale);
  }

  buildWedges(s) {
    const o = this.opts, { cx, cy } = o.arena;
    const cv = mkCanvas(1080 * s, 1920 * s), g = cv.getContext('2d');
    g.scale(s, s);
    g.save(); g.beginPath(); g.arc(cx, cy, o.arena.r, 0, Math.PI * 2); g.clip();
    for (const poly of o.wedges) {
      let mx = 0, my = 0; for (const [x, y] of poly) { mx += x; my += y; } mx /= poly.length; my /= poly.length;
      const ux = mx - cx, uy = my - cy, ul = Math.hypot(ux, uy) || 1, nx = -uy / ul, ny = ux / ul;
      const gr = g.createLinearGradient(mx - nx * 70, my - ny * 70, mx + nx * 70, my + ny * 70);
      gr.addColorStop(0, '#5d6571'); gr.addColorStop(0.35, '#c9d0da'); gr.addColorStop(0.55, '#e8edf3'); gr.addColorStop(1, '#6c7480');
      g.fillStyle = gr; g.beginPath(); poly.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(18,22,28,0.7)'; g.lineWidth = 1.5; g.stroke();
      // grooves along the wedge axis
      g.strokeStyle = 'rgba(40,46,56,0.45)'; g.lineWidth = 2;
      for (const f of [0.35, 0.55, 0.75]) {
        const px = cx + ux / ul * (ul * 0.6 + (o.arena.r - ul * 0.6) * f), py = cy + uy / ul * (ul * 0.6 + (o.arena.r - ul * 0.6) * f);
        const w = 10 + 18 * f;
        g.beginPath(); g.moveTo(px - nx * w, py - ny * w); g.lineTo(px + nx * w, py + ny * w); g.stroke();
      }
    }
    g.restore();
    return cv;
  }

  buildArm(s) {
    const a = this.opts.arms, len = a.length - a.hubR + 6, T = a.thick * 2, pad = 4;
    const cv = mkCanvas((len + pad * 2) * s, (T + pad * 2) * s), g = cv.getContext('2d');
    g.scale(s, s); g.translate(pad, pad);
    const gr = g.createLinearGradient(0, 0, 0, T);
    gr.addColorStop(0, '#f4f7fb'); gr.addColorStop(0.3, '#c9d0da'); gr.addColorStop(0.65, '#8b94a1'); gr.addColorStop(1, '#4f5763');
    g.fillStyle = gr; roundRect(g, 0, 0, len, T, T / 2); g.fill();
    g.strokeStyle = 'rgba(20,24,30,0.55)'; g.lineWidth = 1; roundRect(g, 0.5, 0.5, len - 1, T - 1, T / 2 - 0.5); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(8, 2.5, len - 18, 2);
    g.fillStyle = 'rgba(30,34,42,0.7)';
    for (let u = 28; u < len - 16; u += 64) { g.beginPath(); g.arc(u, T * 0.62, 2.2, 0, Math.PI * 2); g.fill(); }
    return { cv, pad, len, T };
  }

  buildHub(s) {
    const R = this.opts.arms.hubR + 6, pad = 6, size = (R + pad) * 2;
    const cv = mkCanvas(size * s, size * s), g = cv.getContext('2d');
    g.scale(s, s); const m = size / 2;
    let gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.1, m, m, R);
    gr.addColorStop(0, '#eef2f7'); gr.addColorStop(0.55, '#9aa3ae'); gr.addColorStop(1, '#3a4049');
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(15,18,24,0.6)'; g.lineWidth = 1.5; g.stroke();
    gr = g.createRadialGradient(m, m, 2, m, m, R * 0.42);
    gr.addColorStop(0, '#5b636e'); gr.addColorStop(1, '#262b33');
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, R * 0.42, 0, Math.PI * 2); g.fill();
    return { cv, size };
  }

  breakFrame(session) {
    const m = session.meta;
    return m.capFrame >= 0 ? m.capFrame + Math.round(this.opts.finaleHold * FPS) : -1;
  }

  draw(session, f) {
    this._session = session; this._f = f;
    super.draw(session, f);
  }

  // replaces press drawing: wedges, arms, hub, rim (t = (f + offset) / FPS)
  drawPistons(t) {
    const g = this.ctx, s = this.scale, o = this.opts, a = o.arms, { cx, cy, r } = o.arena;
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.wedgeLayer, 0, 0); g.setTransform(s, 0, 0, s, 0, 0);
    const sp = this.armSprite;
    for (let k = 0; k < a.count; k++) {
      g.save(); g.translate(cx, cy); g.rotate(armAngle(a, k, t));
      g.drawImage(sp.cv, a.hubR - 6 - sp.pad, -sp.T / 2 - sp.pad, sp.len + sp.pad * 2, sp.T + sp.pad * 2);
      g.restore();
    }
    const h = this.hubSprite;
    g.drawImage(h.cv, cx - h.size / 2, cy - h.size / 2, h.size, h.size);
    // rim with the break
    const bf = this.breakFrame(this._session), f = this._f;
    const gapHalf = o.ending.gapHalf;
    const broken = bf >= 0 && f >= bf;
    const open = broken ? clamp01((f - bf) / 6) : 0;          // crack opens over 0.1 s
    g.lineWidth = 4; g.strokeStyle = 'rgba(214,222,234,0.92)';
    g.beginPath();
    if (open > 0) g.arc(cx, cy, r + 2, Math.PI / 2 + gapHalf * open, Math.PI / 2 - gapHalf * open + Math.PI * 2);
    else g.arc(cx, cy, r + 2, 0, Math.PI * 2);
    g.stroke();
    if (broken) {
      // fragments of the broken arc fall and tumble (pure function of time since the break)
      const tt = (f - bf) / FPS, frag = 7;
      g.strokeStyle = `rgba(214,222,234,${0.92 * clamp01(1 - tt / 2.2)})`;
      for (let k = 0; k < frag; k++) {
        const a0 = Math.PI / 2 - gapHalf + (2 * gapHalf) * (k + 0.5) / frag;
        const px = cx + Math.cos(a0) * (r + 2), py = cy + Math.sin(a0) * (r + 2);
        const vx = (Math.cos(a0)) * 160 + (k - frag / 2) * 25, vy = 60 + k * 12;
        const x = px + vx * tt, y = py + vy * tt + 0.5 * 1400 * tt * tt;
        g.save(); g.translate(x, y); g.rotate(a0 + Math.PI / 2 + tt * (k % 2 ? 4 : -3));
        g.beginPath(); g.moveTo(-r * gapHalf / frag, 0); g.lineTo(r * gapHalf / frag, 0); g.stroke();
        g.restore();
      }
    }
  }

  // the counter shows the peak (balls pouring out at the end must not count down)
  drawCounter(session, f, fr) {
    const m = session.meta;
    if (m.capFrame >= 0 && f >= m.capFrame && fr.n < this.opts.maxBalls) fr = { ...fr, n: this.opts.maxBalls };
    super.drawCounter(session, f, fr);
  }
}
