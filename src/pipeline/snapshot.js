// A still of a run drawn straight from the simulation (no video encode): used as the thumbnail of a video that was
// rejected before its preview was made, so every card in the Studio has a picture.
import { PALETTE, GOLD_RGB } from '../sim/config.js';
import { W, H, FPS } from '../core/constants.js';
import { getScenario } from '../scenarios/index.js';

const COLORS = [...PALETTE, GOLD_RGB];

/** Simulate `config` to time t (seconds) and draw it into a JPEG blob (width px wide, 9:16). Machine engine only. */
export async function snapshotJpeg(config, t, width = 270) {
  if (!config.machine) return null;
  const sim = getScenario(config.scenario).createSim(config);
  const until = Math.round(t * FPS);
  while (!sim.done && sim.frame < until) sim.step();
  const s = width / W, cv = new OffscreenCanvas(width, Math.round(H * s)), g = cv.getContext('2d');
  g.fillStyle = '#0d0f14'; g.fillRect(0, 0, cv.width, cv.height);
  g.scale(s, s);
  const { cx, cy, r } = config.machine.arena;
  g.strokeStyle = 'rgba(214,222,234,0.9)'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, r + 2, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#a7afba'; g.strokeStyle = '#a7afba';
  config.machine.parts.forEach((p, k) => {
    const G = sim.geo[k];
    if (!G) return;
    if (p.type === 'beam') { g.strokeStyle = 'rgba(120,200,255,0.95)'; g.lineWidth = 6; g.beginPath(); g.moveTo(...G.a); g.lineTo(...G.b); g.stroke(); g.strokeStyle = '#a7afba'; return; }
    if (p.type === 'capsule') { g.lineCap = 'round'; g.lineWidth = 2 * G.thick; g.beginPath(); g.moveTo(...G.a); g.lineTo(...G.b); g.stroke(); return; }
    if (p.type === 'circle') { g.beginPath(); g.arc(G.c[0], G.c[1], G.r, 0, Math.PI * 2); g.fill(); return; }
    g.beginPath(); G.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  });
  const br = config.machine.ballR;
  for (let i = 0; i < sim.count; i++) {
    const c = COLORS[sim.col[i]] || COLORS[0];
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.beginPath(); g.arc(sim.x[i], sim.y[i], br, 0, Math.PI * 2); g.fill();
  }
  return cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}
