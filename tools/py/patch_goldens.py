import json
def sub(p, a, b):
    s = open(p, encoding='utf-8').read()
    assert a in s, (p, a[:60]); open(p, 'w', encoding='utf-8').write(s.replace(a, b))

sub('src/sim/gate.js', """  const inner = sim.rand;
  let draws = 0, rh = 0x811c9dc5;
  const f64 = new Float64Array(1), b = new Uint8Array(f64.buffer);
  sim.rand = () => { const v = inner(); draws++; f64[0] = v; rh = fnvBytes(rh, b); return v; };""",
"""  let draws = 0, rh = 0x811c9dc5;
  if (typeof sim.rand === 'function') {          // stream RNG (legacy engine); counter-based engines have none
    const inner = sim.rand;
    const f64 = new Float64Array(1), b = new Uint8Array(f64.buffer);
    sim.rand = () => { const v = inner(); draws++; f64[0] = v; rh = fnvBytes(rh, b); return v; };
  }""")
with open('src/sim/gate.js', 'a', encoding='utf-8') as f:
    f.write("""
/** Frozen scenario versions with golden hashes (baseline/goldens/<key>.json). rawPortable: Node == Electron. */
export const GOLDENS = [
  { key: 'split-chamber@2', seeds: [1, 7, 1234], rawPortable: false },
  { key: 'orbit-crusher@1', seeds: [1, 7, 1234], rawPortable: true },
];
""")
sub('main.js', "gate: GATE ? { capture: args.includes('--gate-capture'),",
    "gate: GATE ? { captureGoldens: args.includes('--gate-capture-goldens'), capture: args.includes('--gate-capture'),")
p = 'package.json'; d = json.load(open(p, encoding='utf-8'))
d['scripts']['gate'] = 'node tools/baseline.mjs verify baseline/v1/sim.json baseline/v1/sim-raw.node.json && node tools/goldens.mjs verify && electron . --gate'
json.dump(d, open(p, 'w', encoding='utf-8'), indent=2); open(p, 'a').write('\n')
print('ok')
