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
     * accuracy (decoded frame N must match truth N better than N±1). One decode pass extracts every needed
     * frame (N-1, N, N+1); comparisons then run on small still images.
     */
    async qualityGate(file, truthDir, frames) {
      const work = path.join(truthDir, '_decoded');
      await fsp.mkdir(work, { recursive: true });
      const want = [...new Set(frames.flatMap((n) => [n - 1, n, n + 1]).filter((n) => n >= 0))].sort((a, b) => a - b);
      const expr = want.map((n) => `eq(n\,${n})`).join('+');
      await ff(['-y', '-i', file, '-vf', `select='${expr}',scale=out_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24`,
        '-fps_mode', 'passthrough', '-start_number', '0', path.join(work, 'f_%d.png')]);
      // select emits frames in ascending order, so output k is frame want[k]
      const compare = async (a, b) => {
        const { stderr } = await ff(['-i', a, '-i', b, '-lavfi', '[0:v]format=gbrp,split[a0][a1];[1:v]format=gbrp,split[b0][b1];[a0][b0]ssim;[a1][b1]psnr', '-f', 'null', '-']);
        return { ssim: num(/SSIM.*All:([\d.]+)/, stderr), psnr: num(/PSNR.*average:([\d.inf]+)/, stderr) };
      };
      const dec = (n) => path.join(work, `f_${want.indexOf(n)}.png`);
      const exists = async (f) => { try { await fsp.access(f); return true; } catch { return false; } };
      const per = [];
      let accurate = 0, checked = 0;
      for (const n of frames) {
        const png = path.join(truthDir, `frame_${String(n).padStart(5, '0')}.png`);
        if (!(await exists(png)) || !(await exists(dec(n)))) continue;
        const q = await compare(dec(n), png);
        per.push({ frame: n, ...q });
        if (n > 0 && (await exists(dec(n - 1))) && (await exists(dec(n + 1)))) {
          const before = await compare(dec(n - 1), png), after = await compare(dec(n + 1), png);
          checked++; if (q.ssim >= before.ssim && q.ssim >= after.ssim) accurate++;
        }
      }
      await fsp.rm(work, { recursive: true, force: true });
      const ssims = per.map((p) => p.ssim), psnrs = per.map((p) => p.psnr).filter(Number.isFinite);
      if (!per.length) return { frames: [], accurate: 0, checked: 0, ssimMin: 0, ssimMean: 0, psnrMin: 0, error: 'no frames compared' };
      return {
        frames: per, accurate, checked,
        ssimMin: Math.min(...ssims), ssimMean: ssims.reduce((a, b) => a + b, 0) / ssims.length,
        psnrMin: psnrs.length ? Math.min(...psnrs) : Infinity,
      };
    },
  };
}

module.exports = { createMedia };
