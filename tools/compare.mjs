// Quality + frame-accuracy comparison of benchmark exports.
// Usage: node tools/compare.mjs <benchDir>
//  - full-video SSIM/PSNR of each encode vs the lossless reference (every frame)
//  - per-frame SSIM vs ground-truth PNGs rendered straight from the session (RGB, before any encoding)
//  - frame-accuracy: truth frame N must match decoded frame N better than N-1 / N+1
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const FF = process.env.FFMPEG || 'ffmpeg';
const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
const ref = path.join(dir, 'bench_ff-lossless.mp4');

function ff(args) {
  const r = spawnSync(FF, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.stderr;
}
const num = (re, s) => { const m = s.match(re); return m ? Number(m[1]) : NaN; };

function fullCompare(file) {
  const out = ff(['-i', file, '-i', ref, '-lavfi', '[0:v]split[a0][a1];[1:v]split[b0][b1];[a0][b0]ssim;[a1][b1]psnr', '-f', 'null', '-']);
  return { ssim: num(/SSIM .*All:([\d.]+)/, out), psnr: num(/PSNR .*average:([\d.inf]+)/, out) };
}

function frameSsim(file, n, png) {
  const out = ff(['-i', file, '-i', png, '-lavfi', `[0:v]select=eq(n\\,${n}),scale=out_color_matrix=bt709:in_range=tv:out_range=pc,format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim`, '-frames:v', '1', '-f', 'null', '-']);
  return num(/All:([\d.]+)/, out);
}

const truthDir = path.join(dir, 'truth');
const truth = fs.existsSync(truthDir) ? fs.readdirSync(truthDir).filter((f) => f.endsWith('.png')).map((f) => ({ n: Number(f.match(/(\d+)/)[1]), png: path.join(truthDir, f) })) : [];
const report = {};
for (const [key, r] of Object.entries(results.engines)) {
  if (!r.ok) { report[key] = { error: r.error }; continue; }
  const file = path.join(dir, `bench_${key}.mp4`);
  const full = key === 'ff-lossless' ? { ssim: 1, psnr: Infinity } : fullCompare(file);
  const perFrame = truth.map(({ n, png }) => frameSsim(file, n, png));
  let accurate = 0, checked = 0;
  for (const { n, png } of truth.filter((t) => t.n > 0 && t.n < results.sim.frames - 1).slice(0, 6)) {
    const s = [n - 1, n, n + 1].map((k) => frameSsim(file, k, png));
    checked++; if (s[1] >= s[0] && s[1] >= s[2]) accurate++;
  }
  report[key] = {
    seconds: r.wallSeconds, sizeMB: r.verify.sizeMB, mbps: r.verify.bitrateMbps,
    ssimVsLossless: +full.ssim.toFixed(5), psnrVsLossless: Number.isFinite(full.psnr) ? +full.psnr.toFixed(2) : 'inf',
    ssimVsTruthMean: +(perFrame.reduce((a, b) => a + b, 0) / perFrame.length).toFixed(5),
    ssimVsTruthMin: +Math.min(...perFrame).toFixed(5),
    frameAccuracy: `${accurate}/${checked}`,
  };
  console.log(key, JSON.stringify(report[key]));
}
fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify(report, null, 2));
