// Inventor v2 tuning: per family, how often an invention passes the speed calibration, and how similar inventions
// are to each other (novelty signatures). Usage: node tools/novelty-tune.mjs [seedsPerFamily] [calibrate=1]
import { invent2, FAMILY_NAMES } from '../src/scenarios/inventor2.js';
import { calibrate } from '../src/scenarios/inventor.js';
import { similarity } from '../src/scenarios/novelty.js';
import { baseMachine, finalize, wrap } from '../src/scenarios/machines.js';

const N = Number(process.argv[2] || 6), doCal = process.argv[3] !== '0';
const sigs = {};
for (const fam of FAMILY_NAMES) {
  let ok = 0; const t0 = Date.now(); const why = [];
  sigs[fam] = [];
  for (let s = 0; s < N; s++) {
    const inv = invent2(1000 + s * 7919, fam, 0);
    sigs[fam].push({ sig: inv.sig, name: inv.name });
    if (!doCal) continue;
    const machine = finalize(baseMachine(1000 + s, 0x2b7f, { pinchRule: 'contact', safetyCap: 40, checkSolid: true, parts: inv.parts, hubR: inv.hubR, ballR: inv.ballR, gravityChance: 1, freeFraction: inv.freeFraction, start: inv.start, splitInto: 3, beamImmune: 120 }));
    machine.beatPart = inv.beatPart;
    const cfg = wrap('invent@2', 'x', machine, 1000 + s, { bpm: inv.bpm, beatsPerBar: 4 });
    const c = calibrate(cfg);
    if (c.ok) ok++; else why.push(c.why || `est ${Math.round(c.est)}`);
  }
  console.log(`${fam.padEnd(9)} pass ${ok}/${N}  ${((Date.now() - t0) / 1000).toFixed(1)} s  ${why.join(', ')}`);
}
// similarity: same family vs different family
const within = [], across = [];
const fams = Object.keys(sigs);
for (let a = 0; a < fams.length; a++) for (let b = a; b < fams.length; b++)
  for (let i = 0; i < sigs[fams[a]].length; i++) for (let j = 0; j < sigs[fams[b]].length; j++) {
    if (a === b && j <= i) continue;
    const v = similarity(sigs[fams[a]][i].sig, sigs[fams[b]][j].sig);
    (a === b ? within : across).push({ v, x: sigs[fams[a]][i].name, y: sigs[fams[b]][j].name });
  }
const q = (arr, p) => { const s = arr.map((o) => o.v).sort((m, n) => m - n); return s[Math.floor(p * (s.length - 1))].toFixed(2); };
console.log(`within family: median ${q(within, 0.5)}  p90 ${q(within, 0.9)}  max ${q(within, 1)}`);
console.log(`across family: median ${q(across, 0.5)}  p90 ${q(across, 0.9)}  max ${q(across, 1)}`);
for (const o of within.sort((m, n) => n.v - m.v).slice(0, 6)) console.log(`  ${o.v.toFixed(2)}  ${o.x}  ~  ${o.y}`);
if (process.env.BAND) { const [lo, hi] = process.env.BAND.split(',').map(Number); for (const o of within.filter((m) => m.v >= lo && m.v < hi).slice(0, 14)) console.log(`  band ${o.v.toFixed(2)}  ${o.x}  ~  ${o.y}`); }
