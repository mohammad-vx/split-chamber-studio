// Pixel gate: re-renders the baseline truth frames through the real export renderer and compares them
// byte-for-byte with baseline/v1/render/truth (valid on the machine/GPU driver the baseline was captured on).
// Usage: node tools/pixelgate.mjs [workDir]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'sc-pixelgate-'));
fs.mkdirSync(work, { recursive: true });
const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const r = spawnSync(electron, ['.', '--bench', '--seed=1234', '--engines=mb-hw', `--out-dir=${path.join(work, 'out')}`, `--bench-out=${work}`],
  { cwd: ROOT, encoding: 'utf8', timeout: 15 * 60 * 1000 });
if (r.status !== 0 && !fs.existsSync(path.join(work, 'results.json'))) { console.error('bench failed', r.stderr); process.exit(2); }
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sums = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'baseline/v1/SHA256SUMS'), 'utf8').trim().split('\n')
  .map((l) => l.trim().split(/\s+\*?/)).map(([h, f]) => [f.replace(/^\*/, ''), h]));
let ok = true, n = 0;
for (const [file, hash] of Object.entries(sums)) {
  if (!file.startsWith('render/truth/')) continue;
  const now = path.join(work, 'truth', path.basename(file));
  const same = fs.existsSync(now) && sha(now) === hash;
  n++; if (!same) { ok = false; console.log(`DIFF ${path.basename(file)}`); }
}
const res = JSON.parse(fs.readFileSync(path.join(work, 'results.json'), 'utf8'));
const eng = res.engines['mb-hw'];
console.log(`pixel gate: ${ok ? 'PASS' : 'FAIL'} (${n} frames) · export ${eng && eng.ok ? 'verified' : 'FAILED ' + (eng && eng.error)}`);
process.exit(ok && eng && eng.ok ? 0 : 1);
