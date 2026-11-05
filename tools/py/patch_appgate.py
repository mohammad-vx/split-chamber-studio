def sub(p, a, b):
    s = open(p, encoding='utf-8').read()
    assert a in s, (p, a[:70]); open(p, 'w', encoding='utf-8').write(s.replace(a, b))
p = 'src/ui/app.js'
sub(p, """  const runs = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('../sim/gate.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); if (e.data.type === 'done') resolve(e.data.runs); else reject(new Error(e.data.message)); };""",
"""  const { runs, goldens } = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('../sim/gate.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); if (e.data.type === 'done') resolve(e.data); else reject(new Error(e.data.message)); };""")
sub(p, """    return host.gateDone({ ok: true, summary: `captured ${opts.raw}` });
  }""", """    return host.gateDone({ ok: true, summary: `captured ${opts.raw}` });
  }
  if (opts.captureGoldens) {
    for (const g of goldens) {
      await host.benchWrite(`${info.root}/baseline/goldens/${g.key}.json`,
        JSON.stringify({ key: g.key, createdAt: new Date().toISOString(), runtime: navigator.userAgent, seeds: g.seeds }));
    }
    return host.gateDone({ ok: true, summary: `captured goldens ${goldens.map((g) => g.key).join(', ')}` });
  }""")
sub(p, """  const ok = results.every((r) => !r.problem);""", """  for (const g of goldens) {
    const base = await fetch(`../baseline/goldens/${g.key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const run of g.seeds) {
      const b = base && base.seeds.find((x) => x.seed === run.seed);
      results.push({ seed: `${g.key}#${run.seed}`, hash: run.hash, problem: b ? compareGate(b, run, b) : 'no golden file' });
    }
  }
  const ok = results.every((r) => !r.problem);""")
print('ok')
