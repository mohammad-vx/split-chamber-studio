// Measurements over a running machine sim (read-only).

/** Share of balls sitting deep inside a solid part (a "transparent part" bug if it is ever large). Updates sim.passMax. */
export function measureSolid(sim) {
  const parts = sim.cfg.parts, r = sim.cfg.ballR, n = sim.count; if (n < 50) return;   // a share of a handful of balls means nothing
  let inside = 0;
  for (let i = 0; i < n; i++) {
    if (sim.immune[i] > 0) continue;               // being split or ejected right now: overlap is expected
    const x = sim.x[i], y = sim.y[i];
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k], G = sim.geo[k];
      if (p.type === 'beam') continue;
      let pen = 0;
      if (p.type === 'capsule') {
        const ax = G.a[0], ay = G.a[1], ex = G.b[0] - ax, ey = G.b[1] - ay;
        let u = ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey); u = u < 0 ? 0 : u > 1 ? 1 : u;
        const dx = x - ax - ex * u, dy = y - ay - ey * u; pen = G.thick + r - Math.sqrt(dx * dx + dy * dy);
      } else if (p.type === 'circle') {
        const dx = x - G.c[0], dy = y - G.c[1]; pen = G.r + r - Math.sqrt(dx * dx + dy * dy);
      } else {
        let sd = -Infinity; for (const e of G.edges) { const v = e.nx * x + e.ny * y - e.d; if (v > sd) sd = v; } pen = r - sd;
      }
      if (pen > r * 1.9) { inside++; break; }      // the centre is (almost) on the part's own axis / deep inside
    }
  }
  const share = inside / n; if (share > sim.passMax) sim.passMax = share;
}
