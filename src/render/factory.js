// Picks the renderer implementation for a run's config.
import { Renderer } from './renderer.js';
import { OrbitRenderer } from './orbit-renderer.js';

export function createRenderer(config, ctx, scale, opts = {}) {
  const r = config.render || { kind: 'split-chamber', partTimeOffsetFrames: 0 };
  switch (r.kind) {
    case 'split-chamber': return new Renderer(ctx, scale, { ...opts, partTimeOffsetFrames: r.partTimeOffsetFrames || 0 });
    case 'orbit': return new OrbitRenderer(ctx, scale, { ...opts, ...r });
    default: throw new Error(`Unknown renderer kind "${r.kind}"`);
  }
}
