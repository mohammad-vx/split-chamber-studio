// Frame renderer. Draws frame f of a session as a pure function of (session, f): no hidden state, so the
// live preview, replay and the offline exporter produce identical pictures. Works on HTMLCanvasElement
// and OffscreenCanvas (including inside workers).
import {
  W, H, FPS, ARENA, COUNTER_Y, BALL_R, PISTON, PALETTE, GOLD, GOLD_RGB, GOLD_WAVE_SPEED,
  pistonExtension,
} from '../sim/config.js';
import { decodeFrame, POS_SCALE } from '../sim/session.js';
import { FLAG_HIT_H, FLAG_HIT_V } from '../sim/sim.js';
import { BallLayerGL } from './balls-gl.js';

const COLORS = [...PALETTE, GOLD_RGB];
const RING_FRAMES = 20;
const MAX_RINGS_PER_FRAME = 260;
const INV_Q = 1 / POS_SCALE;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

export const mkCanvas = (w, h) => new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c, d, t) => [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t].map(Math.round);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (u) => 1 - (1 - u) * (1 - u);

export class Renderer {
  /** @param ctx 2D context whose canvas is (W*scale) x (H*scale) */
  /**
   * Renderer for the split-chamber family (frozen v1 look).
   * opts.partTimeOffsetFrames: 0 for split-chamber@1 (v1 draws pistons at f/FPS, issue T1),
   * 1 for later versions (pistons drawn at (f+1)/FPS, matching the simulated state of frame f).
   */
  constructor(ctx, scale = 1, opts = {}) {
    const { gpu = true, partTimeOffsetFrames = 0, housings = true } = opts;
    this.opts = opts;
    this.ctx = ctx;
    this.scale = scale;
    this.partTimeOffsetFrames = partTimeOffsetFrames;
    this.housings = housings;
    this.cache = new Map();
    this.gl = gpu ? BallLayerGL.create(scale) : null;
    this.build();
  }

  get backend() { return this.gl ? 'webgl2' : 'canvas2d'; }

  setScale(scale) {
    if (Math.abs(scale - this.scale) > 1e-6) { this.scale = scale; if (this.gl) this.gl.setScale(scale); this.build(); }
  }

  build() {
    const s = this.scale;
    this.bg = this.buildBackground(s);
    this.overlay = this.buildOverlay(s);
    // ball sprites: normal + flash variant per colour
    const S = (BALL_R * 2 + 10);
    this.ballSize = S;
    this.balls = COLORS.map((c) => this.buildBall(c, s, S, 0));
    this.flash = COLORS.map((c) => this.buildBall(c, s, S, 1));
    this.plate = this.buildPlate(s);
    this.rod = this.buildRod(s);
  }

  buildBackground(s) {
    const cv = mkCanvas(W * s, H * s), g = cv.getContext('2d');
    g.scale(s, s);
    let gr = g.createRadialGradient(ARENA.cx, ARENA.cy - 80, 40, ARENA.cx, ARENA.cy, H * 0.75);
    gr.addColorStop(0, '#121826'); gr.addColorStop(0.45, '#090d15'); gr.addColorStop(1, '#020305');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // arena floor
    gr = g.createRadialGradient(ARENA.cx - 60, ARENA.cy - 90, 20, ARENA.cx, ARENA.cy, ARENA.r);
    gr.addColorStop(0, '#151b28'); gr.addColorStop(0.7, '#0c1019'); gr.addColorStop(1, '#070a10');
    g.fillStyle = gr; g.beginPath(); g.arc(ARENA.cx, ARENA.cy, ARENA.r, 0, Math.PI * 2); g.fill();
    // soft outer halo
    g.save(); g.globalCompositeOperation = 'lighter';
    gr = g.createRadialGradient(ARENA.cx, ARENA.cy, ARENA.r - 4, ARENA.cx, ARENA.cy, ARENA.r + 60);
    gr.addColorStop(0, 'rgba(120,150,200,0.10)'); gr.addColorStop(1, 'rgba(120,150,200,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(ARENA.cx, ARENA.cy, ARENA.r + 60, 0, Math.PI * 2); g.fill();
    g.restore();
    return cv;
  }

  buildOverlay(s) {
    const cv = mkCanvas(W * s, H * s), g = cv.getContext('2d');
    g.scale(s, s);
    const { cx, cy, r } = ARENA;
    // inner shadow ring to give the glass some depth
    let gr = g.createRadialGradient(cx, cy, r - 26, cx, cy, r);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.arc(cx, cy, r - 26, 0, Math.PI * 2, true); g.fill();
    // rim
    g.lineWidth = 4; g.strokeStyle = 'rgba(214,222,234,0.92)';
    g.beginPath(); g.arc(cx, cy, r + 2, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(cx, cy, r - 2, Math.PI * 1.05, Math.PI * 1.65); g.stroke();
    // piston housings
    for (let k = 0; k < (this.housings ? 4 : 0); k++) {
      g.save(); g.translate(cx, cy); g.rotate(k * Math.PI / 2);
      drawHousing(g, r);
      g.restore();
    }
    return cv;
  }

  buildBall(c, s, S, flash) {
    const cv = mkCanvas(S * s, S * s), g = cv.getContext('2d');
    g.scale(s, s);
    const m = S / 2, r = BALL_R;
    // faint glow
    let gr = g.createRadialGradient(m, m, r * 0.6, m, m, m);
    gr.addColorStop(0, rgb(c, flash ? 0.55 : 0.28)); gr.addColorStop(1, rgb(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    // shaded sphere
    const hi = mix(c, [255, 255, 255], flash ? 0.85 : 0.55), lo = mix(c, [0, 0, 0], 0.35);
    gr = g.createRadialGradient(m - r * 0.38, m - r * 0.42, r * 0.1, m, m, r);
    gr.addColorStop(0, rgb(hi)); gr.addColorStop(0.45, rgb(flash ? mix(c, [255, 255, 255], 0.5) : c)); gr.addColorStop(1, rgb(lo));
    g.fillStyle = gr; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill();
    return cv;
  }

  // Plate in local piston space: u (outward) horizontal, v vertical. Sprite spans u:[0,thick], v:[-L,L].
  buildPlate(s) {
    const { thick: T, halfLen: L } = PISTON;
    const pad = 4;
    const cv = mkCanvas((T + pad * 2) * s, (L * 2 + pad * 2) * s), g = cv.getContext('2d');
    g.scale(s, s); g.translate(pad, pad);
    // two stacked bars give the "double plate" look of a press head
    const bar = (u0, w, light) => {
      const gr = g.createLinearGradient(u0, 0, u0 + w, 0);
      gr.addColorStop(0, light ? '#f4f7fb' : '#d4dae3'); gr.addColorStop(0.35, light ? '#c9d0da' : '#aab2be');
      gr.addColorStop(0.7, '#8b94a1'); gr.addColorStop(1, '#5d6571');
      g.fillStyle = gr; roundRect(g, u0, 0, w, L * 2, 3); g.fill();
      g.strokeStyle = 'rgba(20,24,30,0.55)'; g.lineWidth = 1; roundRect(g, u0 + 0.5, 0.5, w - 1, L * 2 - 1, 3); g.stroke();
    };
    bar(0, T * 0.42, true);
    bar(T * 0.46, T * 0.54, false);
    // specular streak
    const gr = g.createLinearGradient(0, 0, 0, L * 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(2, 4, 2, L * 2 - 8);
    return { cv, pad };
  }

  buildRod(s) {
    const R = PISTON.rod, len = 64;
    const cv = mkCanvas(len * s, R * s), g = cv.getContext('2d');
    g.scale(s, s);
    const gr = g.createLinearGradient(0, 0, 0, R);
    gr.addColorStop(0, '#6c7480'); gr.addColorStop(0.3, '#e8edf3'); gr.addColorStop(0.55, '#aeb6c1'); gr.addColorStop(1, '#4b525c');
    g.fillStyle = gr; g.fillRect(0, 0, len, R);
    return cv;
  }

  frame(session, f) {
    let d = this.cache.get(f);
    if (!d) {
      d = decodeFrame(session.frames[f]);
      this.cache.set(f, d);
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
    }
    return d;
  }

  draw(session, f) {
    const g = this.ctx, s = this.scale, meta = session.meta;
    const fr = this.frame(session, f);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(this.bg, 0, 0);
    g.setTransform(s, 0, 0, s, 0, 0);

    const T = this.timing;
    let t0 = T ? performance.now() : 0;
    const lap = (k) => { if (T) { const n = performance.now(); T[k] = (T[k] || 0) + n - t0; t0 = n; } };
    lap('bg');
    this.drawBalls(fr); lap('balls');
    this.drawRings(session, f); lap('rings');
    this.drawImpacts(session, f); lap('impacts');
    if (meta.capFrame >= 0 && f >= meta.capFrame) this.drawGoldWave(f - meta.capFrame);
    lap('gold');
    this.drawPistons((f + this.partTimeOffsetFrames) / FPS); lap('pistons');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.overlay, 0, 0);
    g.setTransform(s, 0, 0, s, 0, 0);
    lap('overlay');
    this.drawCounter(session, f, fr); lap('counter');
    if (this.opts.caption) this.drawCaption(f);
    if (meta.outroFrame >= 0 && f >= meta.outroFrame) this.drawOutro(session, f - meta.outroFrame);
    lap('outro');
  }

  drawBalls(fr) {
    const g = this.ctx, S = this.ballSize, half = S / 2;
    if (this.gl) {
      const layer = this.gl.draw(fr);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(layer, 0, 0);
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      return;
    }
    const { xy, col, age, n } = fr;
    for (let i = 0; i < n; i++) {
      const x = xy[2 * i] * INV_Q, y = xy[2 * i + 1] * INV_Q;
      const a = age[i];
      if (a < 10) {
        const k = 1 + (1 - a / 10) * 0.9;
        const w = S * k;
        g.drawImage(a < 5 ? this.flash[col[i]] : this.balls[col[i]], x - w / 2, y - w / 2, w, w);
      } else {
        g.drawImage(this.balls[col[i]], x - half, y - half, S, S);
      }
    }
  }

  drawRings(session, f) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let k = RING_FRAMES - 1; k >= 0; k--) {
      const ff = f - k;
      if (ff < 0) continue;
      const fr = this.frame(session, ff);
      if (fr.m === 0) continue;
      const p = (k + 1) / RING_FRAMES;
      const rad = BALL_R + 30 * easeOut(p);
      const alpha = (1 - p) * 0.9;
      g.lineWidth = 1 + 3 * (1 - p);
      const step = Math.max(1, Math.ceil(fr.m / MAX_RINGS_PER_FRAME));
      // batch by colour
      for (let c = 0; c < PALETTE.length; c++) {
        let any = false;
        for (let j = 0; j < fr.m; j += step) {
          if (fr.scol[j] !== c) continue;
          if (!any) { g.beginPath(); any = true; }
          const x = fr.sxy[2 * j] * INV_Q, y = fr.sxy[2 * j + 1] * INV_Q;
          g.moveTo(x + rad, y); g.arc(x, y, rad, 0, Math.PI * 2);
        }
        if (any) { g.strokeStyle = rgb(PALETTE[c], alpha); g.stroke(); }
      }
    }
    g.restore();
  }

  drawImpacts(session, f) {
    const g = this.ctx;
    const { cx, cy } = ARENA;
    for (let k = 0; k < 12; k++) {
      const ff = f - k;
      if (ff < 0) break;
      const fl = this.frame(session, ff).flags;
      if (!(fl & (FLAG_HIT_H | FLAG_HIT_V))) continue;
      const p = k / 12, a = (1 - p) * (1 - p);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.translate(cx, cy);
      if (fl & FLAG_HIT_V) g.rotate(Math.PI / 2);
      g.scale(1, 3.2);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 34 + p * 26);
      gr.addColorStop(0, `rgba(255,255,255,${0.32 * a})`); gr.addColorStop(0.45, `rgba(190,215,255,${0.12 * a})`); gr.addColorStop(1, 'rgba(160,190,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 34 + p * 26, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  drawGoldWave(df) {
    const g = this.ctx, { cx, cy, r } = ARENA;
    const rad = df / FPS * GOLD_WAVE_SPEED;
    const fade = clamp01(1 - df / (FPS * 0.9));
    if (fade <= 0) return;
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(cx, cy, Math.max(0, rad - 70), cx, cy, rad + 10);
    gr.addColorStop(0, 'rgba(255,200,80,0)'); gr.addColorStop(0.8, `rgba(255,214,110,${0.45 * fade})`); gr.addColorStop(1, 'rgba(255,214,110,0)');
    g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.restore();
  }

  drawPistons(t) {
    const g = this.ctx, { cx, cy, r } = ARENA;
    const { thick: T, halfLen: L, retract, rod: RW } = PISTON;
    const p = this.plate;
    for (let k = 0; k < 4; k++) {
      const pair = k % 2 === 0 ? 0 : 1;   // k: 0 right, 1 down, 2 left, 3 up
      const d = retract * (1 - pistonExtension(pair, t));
      g.save(); g.translate(cx, cy); g.rotate(k * Math.PI / 2);
      const rodStart = d + T - 2, rodEnd = r - 14;
      if (rodEnd > rodStart) g.drawImage(this.rod, rodStart, -RW / 2, rodEnd - rodStart, RW);
      g.drawImage(p.cv, d - p.pad, -L - p.pad, T + p.pad * 2, L * 2 + p.pad * 2);
      g.restore();
    }
  }

  drawCounter(session, f, fr) {
    const g = this.ctx, meta = session.meta;
    const capped = meta.capFrame >= 0 && f >= meta.capFrame;
    const prev = f >= 8 ? this.frame(session, f - 8).n : fr.n;
    const bump = Math.min(0.07, Math.log10(1 + fr.n - prev) * 0.03);
    const goldT = capped ? clamp01((f - meta.capFrame) / 18) : 0;
    g.save();
    g.translate(W / 2, COUNTER_Y);
    g.scale(1 + bump, 1 + bump);
    g.font = `700 168px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const c = mix([236, 240, 246], [250, 200, 72], goldT);
    if (goldT > 0) { g.shadowColor = `rgba(255,190,60,${0.55 * goldT})`; g.shadowBlur = 36 * this.scale; }
    g.fillStyle = rgb(c);
    g.fillText(fr.n.toLocaleString('en-US'), 0, 0);
    g.restore();
  }

  /** Hook caption: fully visible for 3 s, then fades out by 3.6 s. No-op when no caption is set. */
  drawCaption(f) {
    const cap = this.opts.caption, t = f / FPS;
    const a = t < 3 ? 1 : 1 - clamp01((t - 3) / 0.6);
    if (a <= 0) return;
    const g = this.ctx;
    g.save();
    g.globalAlpha = a;
    const rtl = cap.lang === 'ar';
    g.direction = rtl ? 'rtl' : 'ltr';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `600 ${rtl ? 60 : 56}px ${FONT}`;
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 18 * this.scale;
    g.fillStyle = 'rgba(240,243,248,0.95)';
    // wrap to at most two lines within 940 px
    const words = cap.text.split(' '), lines = [];
    let line = '';
    for (const w of words) { const test = line ? `${line} ${w}` : w; if (g.measureText(test).width > 940 && line) { lines.push(line); line = w; } else line = test; }
    if (line) lines.push(line);
    const y0 = 200 - (lines.length - 1) * 36;
    lines.slice(0, 2).forEach((l, i) => g.fillText(l, W / 2, y0 + i * 72));
    g.restore();
  }

  drawOutro(session, df) {
    const g = this.ctx, meta = session.meta;
    const t = df / FPS;
    const dim = clamp01(t / 0.7) * 0.74;
    g.save();
    g.fillStyle = `rgba(3,5,9,${dim})`;
    g.beginPath(); g.arc(ARENA.cx, ARENA.cy, ARENA.r + 8, 0, Math.PI * 2); g.fill();
    const a = clamp01((t - 0.35) / 0.6);
    if (a > 0) {
      const y = ARENA.cy - 20 + (1 - easeOut(a)) * 24;
      g.globalAlpha = a;
      drawLogo(g, ARENA.cx - 250, y, 54);
      g.font = `700 76px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = '#f2f4f8';
      g.fillText('Split Chamber', ARENA.cx - 172, y - 4);
      g.font = `500 30px ${FONT}`; g.textAlign = 'center';
      g.fillStyle = 'rgba(232,236,244,0.72)';
      g.fillText(`One ball. Three splits. Ten thousand.  ·  seed ${meta.seed}`, ARENA.cx, y + 96);
    }
    g.restore();
  }
}

function drawHousing(g, r) {
  // local space: u outward; housing straddles the rim at u = r
  const gr = g.createLinearGradient(0, -34, 0, 34);
  gr.addColorStop(0, '#59616c'); gr.addColorStop(0.3, '#d9dfe7'); gr.addColorStop(0.55, '#9aa3ae'); gr.addColorStop(1, '#3f464f');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(r - 26, -24); g.lineTo(r + 10, -36); g.lineTo(r + 10, 36); g.lineTo(r - 26, 24); g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(15,18,24,0.6)'; g.lineWidth = 1.2; g.stroke();
  // collar
  g.fillStyle = gr; roundRect(g, r - 40, -16, 16, 32, 3); g.fill(); g.stroke();
  // end cap
  const cap = g.createRadialGradient(r + 18, -8, 2, r + 16, 0, 26);
  cap.addColorStop(0, '#eef2f7'); cap.addColorStop(0.6, '#8e97a3'); cap.addColorStop(1, '#3a4049');
  g.fillStyle = cap; g.beginPath(); g.ellipse(r + 14, 0, 12, 36, 0, -Math.PI / 2, Math.PI / 2); g.fill();
}

function drawLogo(g, x, y, R) {
  // Original mark: a chamber ring with four press heads and a gold core.
  g.save(); g.translate(x, y);
  g.lineWidth = 4; g.strokeStyle = 'rgba(230,236,245,0.95)';
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#cfd6e0';
  for (let k = 0; k < 4; k++) { g.save(); g.rotate(k * Math.PI / 2); roundRect(g, R * 0.38, -R * 0.34, R * 0.16, R * 0.68, 3); g.fill(); g.restore(); }
  const gr = g.createRadialGradient(-4, -4, 1, 0, 0, R * 0.24);
  gr.addColorStop(0, '#fff3c4'); gr.addColorStop(1, '#e8a92e');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 0.2, 0, Math.PI * 2); g.fill();
  g.restore();
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
