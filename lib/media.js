// ffmpeg-based media analysis for the production pipeline (main process).
'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fsp = require('node:fs/promises');
const path = require('node:path');
const run = promisify(execFile);

function createMedia(FFMPEG) {
  const ff = async (args, opts = {}) => {
    try {
      const r = await run(FFMPEG, ['-hide_banner', '-nostats', ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000, encoding: opts.binary ? 'buffer' : 'utf8' });
      return { stdout: r.stdout, stderr: String(r.stderr) };
    } catch (e) {
      if (e.stdout !== undefined || e.stderr) return { stdout: e.stdout, stderr: String(e.stderr || ''), error: e };
      throw e;
    }
  };
  const num = (re, s) => { const m = s.match(re); return m ? Number(m[1]) : NaN; };

  return {
    /** EBU R128 integrated loudness, true peak and long silences of an audio/video file. */
    async audioReport(file) {
      const { stderr } = await ff(['-i', file, '-vn', '-af', 'ebur128=peak=true,silencedetect=n=-50dB:d=1.5', '-f', 'null', '-']);
      const tail = stderr.slice(stderr.lastIndexOf('Summary:'));
      const silences = [...stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
      return {
        lufs: num(/I:\s+(-?[\d.]+) LUFS/, tail), truePeak: num(/Peak:\s+(-?[\d.inf]+) dBFS/, tail),
        lra: num(/LRA:\s+([\d.]+) LU/, tail), silences, longestSilence: silences.length ? Math.max(...silences) : 0,
      };
    },

    /** Frozen / black segments in a video (seconds). */
    async videoReport(file) {
      const { stderr } = await ff(['-i', file, '-an', '-vf', 'freezedetect=n=0.001:d=1,blackdetect=d=0.5:pix_th=0.05', '-f', 'null', '-']);
      const freezes = [...stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
      const blacks = [...stderr.matchAll(/black_duration:([\d.]+)/g)].map((m) => Number(m[1]));
      return { freezes, blacks, longestFreeze: freezes.length ? Math.max(...freezes) : 0, longestBlack: blacks.length ? Math.max(...blacks) : 0 };
    },

    /** 64-bit difference hashes (hex) of `count` frames sampled evenly from a video. */
    async dHashes(file, durationS, count = 8) {
      const out = [];
      for (let k = 0; k < count; k++) {
        const t = (durationS * (k + 0.5)) / count;
        const { stdout } = await ff(['-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'], { binary: true });
        const px = Buffer.from(stdout || []);
        if (px.length < 72) { out.push(null); continue; }
        let bits = '';
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? '1' : '0';
        out.push(BigInt(`0b${bits}`).toString(16).padStart(16, '0'));
      }
      return out;
    },

    async thumbnail(file, atS, outFile) {
      await ff(['-y', '-ss', atS.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', outFile]);
      return outFile;
    },

    /**
     * Quality gate: SSIM/PSNR of decoded frames vs ground-truth PNGs rendered during export, and frame
     * accuracy (decoded frame N must match truth N better than N±1).
     */
    async qualityGate(file, truthDir, frames) {
      const per = [];
      const ssimAt = async (n, png) => {
        const { stderr } = await ff(['-i', file, '-i', png, '-lavfi',
          `[0:v]select=eq(n\\,${n}),scale=out_color_matrix=bt709:in_range=tv:out_range=pc,format=gbrp,split[a0][a1];[1:v]format=gbrp,split[b0][b1];[a0][b0]ssim;[a1][b1]psnr`,
          '-frames:v', '1', '-f', 'null', '-']);
        return { ssim: num(/SSIM.*All:([\d.]+)/, stderr), psnr: num(/PSNR.*average:([\d.inf]+)/, stderr) };
      };
      let accurate = 0, checked = 0;
      for (const n of frames) {
        const png = path.join(truthDir, `frame_${String(n).padStart(5, '0')}.png`);
        try { await fsp.access(png); } catch { continue; }
        const q = await ssimAt(n, png);
        per.push({ frame: n, ...q });
        if (n > 0) {
          const before = await ssimAt(n - 1, png), after = await ssimAt(n + 1, png);
          checked++; if (q.ssim >= before.ssim && q.ssim >= after.ssim) accurate++;
        }
      }
      const ssims = per.map((p) => p.ssim), psnrs = per.map((p) => p.psnr).filter(Number.isFinite);
      return {
        frames: per, accurate, checked,
        ssimMin: Math.min(...ssims), ssimMean: ssims.reduce((a, b) => a + b, 0) / Math.max(1, ssims.length),
        psnrMin: psnrs.length ? Math.min(...psnrs) : Infinity,
      };
    },
  };
}

module.exports = { createMedia };
