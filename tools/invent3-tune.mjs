// Inventor v3 tuning: how many draws fit, how many machines really differ (novelty signatures), and — with
// calibrate=1 — how many pass the speed calibration. node tools/invent3-tune.mjs [seeds] [calibrate=0|1] [layout]
import { invent3, LAYOUT_NAMES, inventV3 } from '../src/scenarios/inventor3.js';
import { closest, SIMILAR_FREE } from '../src/scenarios/novelty.js';
const SIMILAR = Number(process.env.THRESH || SIMILAR_FREE);

const N = Number(process.argv[2] || 200), doCal = process.argv[3] === '1', only = process.argv[4];
const layouts = only ? [only] : LAYOUT_NAMES;
const kept = [], sigs = []; let drawn = 0, fit = 0; const per = {}; const t0 = Date.now();
for (let s = 0; s < N; s++) {
  const layout = layouts[s % layouts.length], seed = 1000 + s * 7919;
  drawn++;
  let inv; try { inv = invent3(seed, layout, 0); } catch (e) { console.log(`seed ${seed} ${layout}: ${e.message}`); continue; }
  per[layout] = per[layout] || { drawn: 0, fit: 0, novel: 0, parts: 0 }; per[layout].drawn++;
  if (!inv) continue;
  fit++; per[layout].fit++; per[layout].parts += inv.parts.length;
  const near = closest(inv.sig, sigs, SIMILAR).sim;
  if (near < SIMILAR) { kept.push({ sig: inv.sig, name: inv.name, layout }); sigs.push(inv.sig); per[layout].novel++; }
  if ((s + 1) % 250 === 0) console.log(`  … ${s + 1} draws: ${fit} fit, ${kept.length} different (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
console.log(`${drawn} draws · ${fit} fit · ${kept.length} really different (below ${SIMILAR}) · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const [k, v] of Object.entries(per)) console.log(`  ${k.padEnd(5)} fit ${v.fit}/${v.drawn} · different ${v.novel} · ${(v.parts / Math.max(1, v.fit)).toFixed(0)} parts on average`);
for (const k of kept.slice(0, 14)) console.log(`   ${k.name}`);
if (doCal) {
  let ok = 0, n = 0; const t1 = Date.now(), why = {};
  for (let s = 0; s < Math.min(N, 40); s++) {
    n++;
    try { const cfg = inventV3.generate(1000 + s * 7919, { family: layouts[s % layouts.length] }); const p = cfg.invented.precheck; if (p.startsWith('speed')) ok++; else why[cfg.invented.family] = (why[cfg.invented.family] || 0) + 1; }
    catch (e) { why.error = (why.error || 0) + 1; }
  }
  console.log(`calibration: ${ok}/${n} pass · ${((Date.now() - t1) / n / 1000).toFixed(1)} s each · failures ${JSON.stringify(why)}`);
}
