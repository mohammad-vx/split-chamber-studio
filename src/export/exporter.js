// Export orchestrator (renderer thread). Renders the soundtrack offline, drives the export worker,
// relays encoded bytes / raw frames to the main process and returns the ffprobe-verified result.
import { renderSoundtrack, renderSoundtrackFor } from '../audio/synth.js';

export const DEFAULT_BITRATE_MBPS = 32;

// Order used by "Automatic". Chosen from the measured benchmark (see docs/BENCHMARK.md).
export const AUTO_ORDER = ['mb-hw', 'ff-hw', 'mb-sw', 'ff-x264'];

export const ENGINES = {
  'mb-hw': { label: 'MediaBunny · WebCodecs (hardware)', mode: 'mediabunny', hw: 'prefer-hardware' },
  'mb-sw': { label: 'MediaBunny · WebCodecs (software)', mode: 'mediabunny', hw: 'prefer-software' },
  'ff-hw': { label: 'FFmpeg · GPU encoder', mode: 'ffmpeg', encoder: null },
  'ff-x264': { label: 'FFmpeg · x264 (software)', mode: 'ffmpeg', encoder: 'libx264' },
  'ff-lossless': { label: 'FFmpeg · lossless reference', mode: 'ffmpeg', encoder: 'lossless' },
};

let ffEncoders = null;
async function hwEncoder() {
  ffEncoders = ffEncoders || await window.host.ffmpegEncoders();
  return ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'].find((e) => ffEncoders[e]) || null;
}

/**
 * Start an export. Returns { promise, cancel }.
 * session: { meta, frames } (stored frames) or { meta, summary, config } (re-simulate; ARCHITECTURE §7.2)
 * opts: { engine: 'auto' | key of ENGINES, bitrateMbps, onProgress(p), pngFrames, pngDir, audioBuffer,
 *         scale (1 = 1080x1920), caption, metadata, finalPath, minBitrateRatio }
 */
export function startExport(session, opts = {}) {
  let cancelled = false;
  let current = null;
  const cancel = () => { cancelled = true; if (current) current.cancel(); };
  const promise = (async () => {
    const onProgress = opts.onProgress || (() => {});
    const total = session.summary ? session.summary.frameCount : session.frames.length;
    onProgress({ stage: 'audio', frame: 0, total });
    const audioBuffer = opts.audioBuffer || (session.summary
      ? (await renderSoundtrackFor(session.config, session.summary.timeline, total, session.meta)).buffer
      : await renderSoundtrack(session));
    const audio = { sampleRate: audioBuffer.sampleRate, channels: [audioBuffer.getChannelData(0), audioBuffer.getChannelData(1)] };
    const order = opts.engine && opts.engine !== 'auto' ? [opts.engine] : AUTO_ORDER;
    const attempts = [];
    for (const key of order) {
      if (cancelled) throw new Error('Export cancelled.');
      const eng = { ...ENGINES[key] };
      if (key === 'ff-hw') { eng.encoder = await hwEncoder(); if (!eng.encoder) { attempts.push({ key, error: 'no GPU encoder available' }); continue; } }
      try {
        current = runOnce(session, audio, key, eng, opts, onProgress);
        const res = await current.promise;
        res.engine = key; res.engineLabel = eng.label + (eng.encoder && key === 'ff-hw' ? ` (${eng.encoder})` : ''); res.attempts = attempts;
        return res;
      } catch (e) {
        if (cancelled) throw new Error('Export cancelled.');
        attempts.push({ key, error: e.message });
        window.host.log('export attempt failed', key, e.message);
        if (order.length === 1) throw e;
      }
    }
    throw new Error(`Every encoder failed:\n${attempts.map((a) => `${a.key}: ${a.error}`).join('\n')}`);
  })();
  return { promise, cancel };
}

function runOnce(session, audio, key, eng, opts, onProgress) {
  const frameCount = session.summary ? session.summary.frameCount : session.frames.length;
  const scale = opts.scale || 1;
  const worker = new Worker(new URL('./export.worker.js', import.meta.url), { type: 'module' });
  let jobId = null;
  let stop = null;
  const t0 = performance.now();
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const fail = async (err) => {
      if (settled) return; settled = true;
      worker.terminate();
      if (jobId) await window.host.exportAbort(jobId, err.message).catch(() => {});
      reject(err);
    };
    stop = () => { worker.postMessage({ type: 'cancel' }); fail(new Error('Export cancelled.')); };
    worker.onerror = (e) => fail(new Error(e.message || 'Export worker crashed.'));
    worker.onmessage = async (e) => {
      const m = e.data;
      try {
        if (m.type === 'chunk') { await window.host.exportWrite(jobId, m.data, m.position); worker.postMessage({ type: 'ack', id: m.id }); }
        else if (m.type === 'rgba') { await window.host.exportFrame(jobId, m.data); worker.postMessage({ type: 'ack', id: m.id }); }
        else if (m.type === 'png') { if (opts.pngDir) await window.host.exportPng(opts.pngDir, m.frame, m.data); worker.postMessage({ type: 'ack', id: m.id }); }
        else if (m.type === 'progress') onProgress({ stage: 'video', frame: m.frame, total: m.total, fps: m.fps, engine: key });
        else if (m.type === 'error') fail(new Error(m.message));
        else if (m.type === 'done') {
          onProgress({ stage: 'verify', frame: frameCount, total: frameCount });
          const res = await window.host.exportFinish(jobId, { audioMuxed: m.audioMuxed, audioCodec: m.audioCodec });
          settled = true; worker.terminate();
          res.renderSeconds = (performance.now() - t0) / 1000;
          res.encoderConfig = m.encoderConfig || null;
          resolve(res);
        }
      } catch (err) {
        if (m.id) worker.postMessage({ type: 'ack', id: m.id, error: err.message });
        fail(err);
      }
    };
    (async () => {
      const job = await window.host.exportBegin({
        seed: session.meta.seed, frameCount, mode: eng.mode, encoder: eng.encoder,
        bitrateMbps: opts.bitrateMbps || DEFAULT_BITRATE_MBPS, audio, finalPath: opts.finalPath,
        expected: { w: Math.round(1080 * scale), h: Math.round(1920 * scale) },
        metadata: opts.metadata || null, minBitrateRatio: opts.minBitrateRatio,
      });
      jobId = job.id;
      worker.postMessage({
        type: 'start', mode: eng.mode, meta: session.meta, audio,
        source: session.summary ? 'sim' : 'frames', frames: session.summary ? null : session.frames,
        config: session.config || null, hashes: session.summary ? session.summary.hashes : null,
        scale, caption: opts.caption || null,
        video: { bitrate: (opts.bitrateMbps || DEFAULT_BITRATE_MBPS) * 1e6, hardwareAcceleration: eng.hw },
        pngFrames: opts.pngFrames || null, allowOpus: !!window.host.web,
      });
    })().catch(fail);
  });
  return { promise, cancel: () => stop && stop() };
}
