// Renderer for orbit-crusher: the Split Chamber look (background, glass rim, glossy balls, rings, counter,
// gold finale, outro) with a central hub and rotating blades instead of presses.
import { Renderer, mkCanvas, roundRect } from './renderer.js';
import { bladeAngle } from '../engine/orbit.js';

export class OrbitRenderer extends Renderer {
  constructor(ctx, scale, opts) { super(ctx, scale, { ...opts, housings: false }); }

  build() {
    super.build();
    this.bladeSprite = this.buildBlade(this.scale);
    this.hubSprite = this.buildHub(this.scale);
  }

  // blade in local space: u along the blade from the hub outward, v across; sprite spans u:[0,len], v:[-T/2,T/2]
  buildBlade(s) {
    const r = this.opts.blades, len = r.length - this.opts.hubR + 8, T = 22, pad = 4;
    const cv = mkCanvas((len + pad * 2) * s, (T + pad * 2) * s), g = cv.getContext('2d');
    g.scale(s, s); g.translate(pad, pad);
    const gr = g.createLinearGradient(0, 0, 0, T);
    gr.addColorStop(0, '#f4f7fb'); gr.addColorStop(0.3, '#c9d0da'); gr.addColorStop(0.65, '#8b94a1'); gr.addColorStop(1, '#4f5763');
    g.fillStyle = gr; roundRect(g, 0, 0, len, T, T / 2); g.fill();
    g.strokeStyle = 'rgba(20,24,30,0.55)'; g.lineWidth = 1; roundRect(g, 0.5, 0.5, len - 1, T - 1, T / 2 - 0.5); g.stroke();
    // cutting edge highlight + rivets
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(10, 3, len - 22, 2);
    g.fillStyle = 'rgba(30,34,42,0.7)';
    for (let u = 30; u < len - 20; u += 70) { g.beginPath(); g.arc(u, T * 0.62, 2.4, 0, Math.PI * 2); g.fill(); }
    return { cv, pad, len, T };
  }

  buildHub(s) {
    const R = this.opts.hubR + 6, pad = 6, size = (R + pad) * 2;
    const cv = mkCanvas(size * s, size * s), g = cv.getContext('2d');
    g.scale(s, s); const m = size / 2;
    let gr = g.createRadialGradient(m - R * 0.35, m - R * 0.4, R * 0.1, m, m, R);
    gr.addColorStop(0, '#eef2f7'); gr.addColorStop(0.55, '#9aa3ae'); gr.addColorStop(1, '#3a4049');
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(15,18,24,0.6)'; g.lineWidth = 1.5; g.stroke();
    gr = g.createRadialGradient(m, m, 2, m, m, R * 0.42);
    gr.addColorStop(0, '#5b636e'); gr.addColorStop(1, '#262b33');
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, R * 0.42, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(230,236,245,0.85)';
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.beginPath(); g.arc(m + Math.cos(a) * R * 0.7, m + Math.sin(a) * R * 0.7, 2.6, 0, Math.PI * 2); g.fill(); }
    return { cv, size };
  }

  // replaces the press drawing; t is already (f + partTimeOffsetFrames) / FPS
  drawPistons(t) {
    const g = this.ctx, o = this.opts, b = o.blades, { cx, cy } = o.arena;
    const sp = this.bladeSprite;
    for (let k = 0; k < b.count; k++) {
      g.save(); g.translate(cx, cy); g.rotate(bladeAngle(b, k, t));
      g.drawImage(sp.cv, o.hubR - 8 - sp.pad, -sp.T / 2 - sp.pad, sp.len + sp.pad * 2, sp.T + sp.pad * 2);
      g.restore();
    }
    const h = this.hubSprite;
    g.drawImage(h.cv, cx - h.size / 2, cy - h.size / 2, h.size, h.size);
  }
}
