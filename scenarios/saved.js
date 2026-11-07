// Saved machines (phase 3.3): an invented machine you liked becomes a pattern of its own. Every new video of it is a
// small variation of the same machine — motion periods and amplitudes move by up to ±12 % with the seed, the shapes
// (and so the one-ball pinch gaps) never change. Patterns are stored in the library's patterns.json as
// { key: 'mine-<slug>@1', label, base } where base is the config of the video they were saved from.
import { MachineSim } from '../engine/machines.js';
import { rand } from '../engine/rng.js';

const JITTER = 0.12;

/** A new video of the machine in `base`: same parts, rhythm and reach jittered by the seed. Pure. */
export function deriveMachine(base, seed, key) {
  const cfg = JSON.parse(JSON.stringify(base));
  const j = (k) => 1 + (rand(seed >>> 0, 0x5a7e, k, 0) * 2 - 1) * JITTER;
  let k = 0;
  for (const p of cfg.machine.parts) {
    for (const m of Object.values(p.motion || {})) {
      if (!m || typeof m !== 'object') continue;
      if (m.period) m.period *= j(k++);
      if (m.omega) m.omega *= j(k++);
      if (m.amp && !p.parent) m.amp *= Math.min(1, j(k++));        // never wider than the original (keeps clear of the rim)
    }
  }
  cfg.seed = seed >>> 0;
  cfg.scenario = key;
  cfg.render.parts = cfg.machine.parts;
  cfg.invented = { ...(cfg.invented || {}), variationOf: base.invented && base.invented.from ? base.invented.from : (base.seed + ':' + base.scenario) };
  delete cfg.controls;
  return cfg;
}

/** Strip a stored config down to what a saved pattern needs (controls are re-applied per batch). */
export function baseFrom(config, from) {
  const base = JSON.parse(JSON.stringify(config));
  delete base.controls;
  base.invented = { ...(base.invented || {}), from };
  return base;
}

export function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'machine'; }

/** A scenario module for a saved pattern. */
export function savedModule({ key, label, base }) {
  return {
    id: key.split('@')[0], version: 1, key, mode: 'packed', label, listed: true, saved: true, random: false,
    generate(seed) { const cfg = deriveMachine(base, seed, key); cfg.invented.name = label; return cfg; },
    createSim(config) { return new MachineSim(config); },
    checks(config) { return { duration: config.duration }; },
  };
}

/** A pattern that is no longer saved can still replay and re-render its videos from their stored configs. */
export function orphanModule(key) {
  return {
    id: key.split('@')[0], version: 1, key, mode: 'packed', label: key, listed: false, saved: true, random: false,
    generate() { throw new Error(`Saved pattern "${key}" no longer exists`); },
    createSim(config) { return new MachineSim(config); },
    checks(config) { return { duration: config.duration }; },
  };
}
