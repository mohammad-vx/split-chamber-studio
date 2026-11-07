// Procedural sound effects driven by session frame data. The same code schedules sounds on a live
// AudioContext (Play/Replay) and on an OfflineAudioContext (Export), so the exported soundtrack is
// sample-accurate to the video frames.
import { FPS } from '../core/constants.js';
import { mulberry32 } from '../sim/sim.js';
import { FLAG_HIT_H, FLAG_HIT_V, FLAG_CAP, FLAG_OUTRO } from '../sim/sim.js';
import { Music, makeMusicPlan, intensityFromTimeline } from './music.js';
import { master } from './loudness.js';
import { timelineFromFrames } from '../sim/run.js';

export const FLAG_BEAT = 16;

export const SAMPLE_RATE = 48000;

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    // deterministic noise
    const rnd = mulberry32(0x5eed);
    const len = Math.floor(ctx.sampleRate * 1.0);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  }

  /** Schedule all sounds belonging to frame f (flags/crushed from the session) at audio time `when`. */
  frame(fr, f, when) {
    if (fr.flags & (FLAG_HIT_H | FLAG_HIT_V)) this.slam(when, fr.flags & FLAG_HIT_V ? 1 : 0);
    if (fr.crushed > 0) this.pops(when, fr.crushed, f);
    if (fr.flags & FLAG_CAP) this.chime(when);
    if (fr.flags & FLAG_OUTRO) this.swell(when);
    if (fr.flags & FLAG_BEAT) this.swoosh(when);
  }

  swoosh(when) {
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(900, when); bp.frequency.exponentialRampToValueAtTime(3200, when + 0.18);
    const g = this.env(when, 0.06, 0.05, 0.16);
    n.connect(bp).connect(g).connect(this.master); n.start(when, 0.3, 0.25);
  }

  env(when, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return g;
  }

  slam(when, pair) {
    const c = this.ctx;
    // body thump
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(pair ? 92 : 80, when);
    o.frequency.exponentialRampToValueAtTime(38, when + 0.16);
    const g = this.env(when, 0.55, 0.004, 0.22);
    o.connect(g).connect(this.master); o.start(when); o.stop(when + 0.3);
    // metallic clank
    for (const [f, a] of [[pair ? 612 : 540, 0.07], [pair ? 1013 : 897, 0.04]]) {
      const m = c.createOscillator(); m.type = 'triangle'; m.frequency.value = f;
      const mg = this.env(when, a, 0.002, 0.12);
      m.connect(mg).connect(this.master); m.start(when); m.stop(when + 0.16);
    }
    // click
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.8;
    const ng = this.env(when, 0.22, 0.001, 0.035);
    n.connect(bp).connect(ng).connect(this.master); n.start(when, 0.1, 0.06);
  }

  pops(when, crushed, f) {
    const c = this.ctx;
    const voices = Math.min(3, 1 + Math.floor(Math.log2(crushed)));
    const level = Math.min(0.32, 0.1 + 0.05 * Math.log2(1 + crushed)) / Math.sqrt(voices);
    const rnd = mulberry32(f * 2654435761);
    for (let v = 0; v < voices; v++) {
      const t = when + v * 0.011 + rnd() * 0.006;
      const base = 700 + rnd() * 900;
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(base, t + 0.05);
      const g = this.env(t, level, 0.002, 0.07);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.1);
    }
    if (crushed > 20) { // crackle texture for big fission bursts
      const n = c.createBufferSource(); n.buffer = this.noise;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
      const g = this.env(when, Math.min(0.12, 0.02 * Math.log2(crushed)), 0.003, 0.09);
      n.connect(hp).connect(g).connect(this.master); n.start(when, (f % 50) / 100, 0.12);
    }
  }

  chime(when) {
    const c = this.ctx;
    [523.25, 659.25, 783.99, 1046.5, 1567.98].forEach((f, i) => {
      const t = when + i * 0.035;
      for (const [mul, a] of [[1, 0.13], [2.76, 0.035]]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
        const g = this.env(t, a, 0.006, 2.6);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 2.8);
      }
    });
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 7000; bp.Q.value = 2;
    const g = this.env(when, 0.06, 0.05, 1.6);
    n.connect(bp).connect(g).connect(this.master); n.start(when); n.stop(when + 1.8);
  }

  swell(when) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, when); lp.frequency.exponentialRampToValueAtTime(2600, when + 0.5);
    lp.frequency.exponentialRampToValueAtTime(200, when + 1.4);
    const g = this.env(when, 0.09, 0.4, 1.0);
    n.connect(lp).connect(g).connect(this.master); n.start(when); n.stop(when + 1.6);
  }
}

/** Header-only views of a frame buffer (flags/crushed) without decoding the balls. */
export function frameEvents(buf) {
  const h = new Uint32Array(buf, 0, 4);
  return { flags: h[2], crushed: h[3] };
}

/** Does this config use the v2 audio (music + mastering)? split-chamber@1 keeps the frozen v1 audio. */
export const hasMusic = (config) => !!(config && config.versions && config.versions.audio >= 2 && config.tempo);

/**
 * Render a run's soundtrack offline from its Timeline (ARCHITECTURE §5.2): SFX + (v2) tempo-locked music,
 * then (v2) loudness normalization to -14 LUFS with a -1.5 dBFS look-ahead limiter.
 * Returns { buffer: AudioBuffer, stats }.
 */
export async function renderSoundtrackFor(config, timeline, frameCount, meta = {}) {
  const length = Math.round(frameCount / FPS * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const synth = new Synth(ctx);
  for (let f = 0; f < frameCount; f++) {
    synth.frame({ flags: timeline.flags[f], crushed: timeline.crushed[f] }, f, f / FPS);
  }
  const music = hasMusic(config);
  if (music) {
    const plan = makeMusicPlan(config);
    const m = new Music(ctx, synth.master, plan, synth.noise);
    const total = Math.ceil(frameCount / FPS / m.step);
    m.schedule(0, total, (t) => t, {
      intensity: intensityFromTimeline(timeline),
      capT: meta.capFrame >= 0 ? meta.capFrame / FPS : -1,
      outroT: meta.outroFrame >= 0 ? meta.outroFrame / FPS : -1,
      endT: frameCount / FPS,
    });
  }
  const buffer = await ctx.startRendering();
  let stats = null;
  // audio v3: a lower sample ceiling leaves room for inter-sample peaks after AAC (hard strikes reached −0.3 dBTP)
  const ceilingDb = config && config.versions && config.versions.audio >= 3 ? -2.5 : -1.5;
  if (music) stats = master([buffer.getChannelData(0), buffer.getChannelData(1)], SAMPLE_RATE, { ceilingDb, passes: ceilingDb < -1.5 ? 3 : 1 });
  return { buffer, stats };
}

/** Render the whole soundtrack offline for a stored session (legacy path). */
export async function renderSoundtrack(session) {
  const config = session.meta && session.meta.config;
  const { buffer } = await renderSoundtrackFor(config, timelineFromFrames(session.frames), session.frames.length, session.meta || {});
  return buffer;
}
