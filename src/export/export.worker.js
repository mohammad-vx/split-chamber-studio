// Offline, frame-by-frame video export in a worker (OffscreenCanvas keeps the UI responsive).
// Frame sources:
//   frames: a stored session (legacy Play/Replay sessions)
//   sim:    re-simulates the scenario config in lockstep with rendering; every frame's state hash must equal
//           the headless run's (ARCHITECTURE §5.1/§7.2) — no full frame storage, only a lookback ring.
// Encoders:
//   mediabunny: WebCodecs H.264 (+AAC) muxed by MediaBunny, bytes streamed to disk via the host.
//   ffmpeg:     raw RGBA frames handed to the host, which pipes them into a bundled ffmpeg process.
import {
  Output, Mp4OutputFormat, StreamTarget, CanvasSource, AudioSampleSource, AudioSample, Quality,
  canEncodeVideo, canEncodeAudio,
} from '../../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs';
import { createRenderer } from '../render/factory.js';
import { configOf, getScenario } from '../scenarios/index.js';
import { encodeFrame, frameHash32 } from '../sim/session.js';
import { W, H, FPS } from '../core/constants.js';

const RING = 48; // >= max renderer lookback (rings 20, impacts 12, counter 8) + margin

let nextId = 1;
const pending = new Map();
let cancelled = false;

function request(msg, transfer) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    self.postMessage({ ...msg, id }, transfer || []);
  });
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ack') { const p = pending.get(m.id); pending.delete(m.id); if (!p) return; if (m.error) p.reject(new Error(m.error)); else p.resolve(m); }
  else if (m.type === 'cancel') cancelled = true;
  else if (m.type === 'start') run(m).catch((err) => self.postMessage({ type: 'error', message: err && err.message || String(err) }));
  else if (m.type === 'probe') probe().then((r) => self.postMessage({ type: 'probe', result: r }));
};

async function probe() {
  const out = {};
  for (const hw of ['prefer-hardware', 'prefer-software']) {
    out[hw] = await canEncodeVideo('avc', { width: W, height: H, frameRate: FPS, quality: new Quality({ bitrate: 30e6 }), hardwareAcceleration: hw }).catch(() => false);
  }
  out.aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 192e3 }) }).catch(() => false);
  return out;
}

/** Frame source: advance(f) makes frame f available in session.frames (in increasing f order). */
function makeSource(job) {
  if (job.source === 'sim') {
    const config = job.config;
    const sim = getScenario(config.scenario).createSim(config);
    const frames = [];
    const session = { meta: job.meta, frames };
    const hashes = job.hashes;
    return {
      session, total: job.meta.frameCount,
      advance(f) {
        while (sim.frame <= f) {
          const k = sim.step();
          const buf = encodeFrame(sim);
          if (hashes && frameHash32(buf) !== hashes[k]) throw new Error(`Re-simulation diverged at frame ${k} (state hash mismatch).`);
          frames[k] = buf;
          if (k >= RING) frames[k - RING] = undefined;
        }
      },
    };
  }
  const session = { meta: job.meta, frames: job.frames };
  return { session, total: job.frames.length, advance() {} };
}

async function run(job) {
  const src = makeSource(job);
  const { session, total } = src;
  const scale = job.scale || 1;
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false });
  const renderer = createRenderer(configOf(job.meta), ctx, scale, { caption: job.caption || null });
  const started = performance.now();
  const progress = (f) => {
    if (f % 10 === 0 || f === total) {
      const el = (performance.now() - started) / 1000;
      self.postMessage({ type: 'progress', frame: f, total, fps: f / Math.max(el, 1e-3) });
    }
  };
  const snapshot = async (f) => {
    if (job.pngFrames && job.pngFrames.includes(f)) {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const data = await blob.arrayBuffer();
      await request({ type: 'png', frame: f, data }, [data]);
    }
  };
  const drawFrame = (f) => { src.advance(f); renderer.draw(session, f); };

  if (job.mode === 'ffmpeg') {
    // Keep two frames in flight so rendering overlaps the IPC + encode of the previous frame.
    const inflight = [];
    for (let f = 0; f < total; f++) {
      if (cancelled) throw new Error('Export cancelled.');
      drawFrame(f);
      await snapshot(f);
      const data = ctx.getImageData(0, 0, w, h).data.buffer;
      inflight.push(request({ type: 'rgba', frame: f, data }, [data]));
      if (inflight.length >= 2) await inflight.shift();
      progress(f + 1);
    }
    await Promise.all(inflight);
    self.postMessage({ type: 'done', audioMuxed: false, encoder: 'ffmpeg' });
    return;
  }

  // ---- MediaBunny / WebCodecs ----
  const hw = job.video.hardwareAcceleration;
  const quality = new Quality({ bitrate: job.video.bitrate });
  const ok = await canEncodeVideo('avc', { width: w, height: h, frameRate: FPS, quality, hardwareAcceleration: hw });
  if (!ok) throw new Error(`WebCodecs cannot encode H.264 ${w}x${h}@60 (${hw}).`);
  const withAudio = !!job.audio && await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: job.audio.sampleRate, quality: new Quality({ bitrate: 192e3 }) });

  const writable = new WritableStream({
    write: (chunk) => {
      const copy = chunk.data.slice().buffer; // detach-safe copy for transfer
      return request({ type: 'chunk', position: chunk.position, data: copy }, [copy]);
    },
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }),
  });
  let encoderConfig = null;
  const video = new CanvasSource(canvas, {
    codec: 'avc', quality, hardwareAcceleration: hw, keyFrameInterval: 1, latencyMode: 'quality',
    onEncoderConfig: (cfg) => { encoderConfig = cfg; },
  });
  output.addVideoTrack(video, { frameRate: FPS });
  let audio = null;
  if (withAudio) {
    audio = new AudioSampleSource({ codec: 'aac', quality: new Quality({ bitrate: 192e3 }) });
    output.addAudioTrack(audio);
  }
  await output.start();

  const sr = withAudio ? job.audio.sampleRate : 0;
  const seconds = Math.ceil(total / FPS);
  for (let sec = 0; sec < seconds; sec++) {
    if (withAudio) {
      const a = Math.round(sec * sr), b = Math.min(job.audio.channels[0].length, Math.round((sec + 1) * sr));
      if (b > a) {
        const len = b - a;
        const planar = new Float32Array(len * 2);
        planar.set(job.audio.channels[0].subarray(a, b), 0);
        planar.set(job.audio.channels[1].subarray(a, b), len);
        const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 2, sampleRate: sr, timestamp: a / sr });
        await audio.add(sample);
        sample.close();
      }
    }
    const end = Math.min(total, (sec + 1) * FPS);
    for (let f = sec * FPS; f < end; f++) {
      if (cancelled) { await output.cancel(); throw new Error('Export cancelled.'); }
      drawFrame(f);
      await video.add(f / FPS, 1 / FPS);
      await snapshot(f);
      progress(f + 1);
    }
  }
  await output.finalize();
  self.postMessage({ type: 'done', audioMuxed: withAudio, encoder: 'mediabunny', encoderConfig: encoderConfig && { codec: encoderConfig.codec, hardwareAcceleration: encoderConfig.hardwareAcceleration, bitrate: encoderConfig.bitrate } });
}
