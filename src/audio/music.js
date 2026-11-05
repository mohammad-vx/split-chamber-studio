// Procedural music locked to the scenario's beat grid (ARCHITECTURE §6). Deterministic per seed: key, scale,
// progression and patterns come from the counter RNG; intensity follows the ball count from the Timeline.
// The same scheduler drives live preview (AudioContext) and export (OfflineAudioContext).
import { FPS } from '../core/constants.js';
import { rand } from '../engine/rng.js';

const ROOTS = [82.41, 87.31, 98.0, 110.0, 116.54, 130.81];          // E2 F2 G2 A2 Bb2 C3
const SCALES = { minorPenta: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10] };
const PROGRESSIONS = [[0, 8, 3, 10], [0, 5, 8, 7], [0, 10, 8, 7], [0, 3, 10, 5]];   // chord roots (semitones)
const midiRatio = (s) => Math.pow(2, s / 12);   // audio only (not part of simulation determinism)

export function makeMusicPlan(config) {
  const seed = config.seed >>> 0;
  const r = (k) => rand(seed, 0x6d75, k, 0);
  const scaleName = Object.keys(SCALES)[Math.floor(r(1) * 3)];
  return {
    bpm: (config.tempo && config.tempo.bpm) || 100,
    beatsPerBar: (config.tempo && config.tempo.beatsPerBar) || 4,
    root: ROOTS[Math.floor(r(2) * ROOTS.length)],
    scale: SCALES[scaleName], scaleName,
    progression: PROGRESSIONS[Math.floor(r(3) * PROGRESSIONS.length)],
    arpPattern: Math.floor(r(4) * 3),
    seed,
  };
}

/** Music voice manager. Call schedule(stepFrom, stepTo, when0, info) to schedule 16th-note steps. */
export class Music {
  constructor(ctx, destination, plan, noise) {
    this.ctx = ctx; this.out = destination; this.p = plan; this.noise = noise;
    this.step = 60 / plan.bpm / 4;                     // seconds per 16th note
    this.bus = ctx.createGain(); this.bus.gain.value = 0.55; this.bus.connect(destination);
  }

  stepTime(k) { return k * this.step; }

  /** intensity(t) in [0,1]; capT/outroT/endT in seconds (or -1). */
  schedule(kFrom, kTo, timeOf, info) {
    const p = this.p;
    for (let k = kFrom; k < kTo; k++) {
      const t = this.stepTime(k);
      if (info.endT > 0 && t >= info.endT) break;
      const when = timeOf(t);
      const inten = info.intensity(t);
      const outroFade = info.outroT > 0 && t > info.outroT ? Math.max(0, 1 - (t - info.outroT) / Math.max(0.1, info.endT - info.outroT)) : 1;
      const bar = Math.floor(k / (4 * p.beatsPerBar)), inBar = k % (4 * p.beatsPerBar);
      const chordRoot = p.progression[bar % p.progression.length];
      const g = outroFade;
      if (g <= 0.001) continue;
      // kick on beats 1 and 3 (after the first bar)
      if (bar >= 1 && inBar % 8 === 0) this.kick(when, (0.35 + 0.35 * inten) * g);
      // hats on 8ths once things get going
      if (inten > 0.2 && k % 2 === 0) this.hat(when, (0.03 + 0.05 * inten) * (inBar % 4 === 2 ? 1.4 : 1) * g);
      // bass: root on beats, fifth on the "and" of 3
      if (inBar % 4 === 0) this.bass(when, p.root * midiRatio(chordRoot), 0.16 * g, this.step * 3.5);
      if (inBar === 10) this.bass(when, p.root * midiRatio(chordRoot + 7), 0.12 * g, this.step * 1.8);
      // pad chord per bar
      if (inBar === 0) this.pad(when, p.root * 2 * midiRatio(chordRoot), 0.05 * (0.6 + 0.4 * inten) * g, this.step * 4 * p.beatsPerBar, info.capT > 0 && t >= info.capT);
      // arpeggio over chord tones when intensity is high
      if (inten > 0.45) {
        const pat = [[0, 2, 4, 2], [0, 4, 2, 4], [0, 2, 4, 6]][p.arpPattern];
        const deg = pat[k % 4];
        const semis = chordRoot + p.scale[deg % p.scale.length] + 12 * Math.floor(deg / p.scale.length);
        this.pluck(when, p.root * 4 * midiRatio(semis), (0.04 + 0.06 * (inten - 0.45) / 0.55) * g);
      }
    }
  }

  env(when, peak, a, d) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + a);
    g.gain.exponentialRampToValueAtTime(0.0001, when + a + d);
    return g;
  }

  kick(when, level) {
    const c = this.ctx, o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, when); o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
    const g = this.env(when, level, 0.003, 0.22);
    o.connect(g).connect(this.bus); o.start(when); o.stop(when + 0.3);
  }

  hat(when, level) {
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = this.env(when, level, 0.001, 0.045);
    n.connect(hp).connect(g).connect(this.bus); n.start(when, (when * 7.31) % 0.8, 0.06);
  }

  bass(when, freq, level, dur) {
    const c = this.ctx, o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    const g = this.env(when, level, 0.01, dur);
    o.connect(lp).connect(g).connect(this.bus); o.start(when); o.stop(when + dur + 0.05);
  }

  pad(when, freq, level, dur, bright) {
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright ? 2400 : 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + Math.min(0.8, dur * 0.3));
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    lp.connect(g).connect(this.bus);
    for (const [mul, det] of [[1, -6], [1.5, 4], [2, 7]]) {          // root, fifth, octave
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq * mul; o.detune.value = det;
      o.connect(lp); o.start(when); o.stop(when + dur + 0.05);
    }
  }

  pluck(when, freq, level) {
    const c = this.ctx, o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = this.env(when, level, 0.002, 0.16);
    o.connect(g).connect(this.bus); o.start(when); o.stop(when + 0.2);
  }
}

/** Intensity function from a Timeline: log(count)/log(max). */
export function intensityFromTimeline(timeline) {
  const n = timeline.n, maxN = Math.max(2, n[n.length - 1] || 2), L = Math.log(maxN);
  return (t) => {
    const f = Math.min(n.length - 1, Math.max(0, Math.floor(t * FPS)));
    return Math.min(1, Math.log(Math.max(1, n[f])) / L);
  };
}
