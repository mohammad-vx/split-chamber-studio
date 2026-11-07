// Browser host: the same `window.host` surface the Electron preload exposes, implemented with web platform APIs so
// the Studio runs as a plain website (GitHub Pages). The library lives in IndexedDB, media is served to <img>/<video>
// by sw.js under ./lib/, and the media checks that ffmpeg does on the desktop are measured here in the page:
// loudness with the app's own BS.1770 meter, frames and thumbnails by seeking a <video>, SSIM against truth PNGs.
import { integratedLoudness } from './audio/loudness.js';

const DB = 'split-chamber-studio', DB_VERSION = 1, FPS = 60, QUOTA_CAP = 12 * 1024 ** 3;

// ------------------------------------------------------------------ IndexedDB
let dbp = null;
const db = () => dbp || (dbp = new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, DB_VERSION);
  r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
}));
const done = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const store = async (name, mode = 'readonly') => (await db()).transaction(name, mode).objectStore(name);
const get = async (s, k) => done((await store(s)).get(k));
const put = async (s, k, v) => done((await store(s, 'readwrite')).put(v, k));
const del = async (s, k) => done((await store(s, 'readwrite')).delete(k));
const range = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);
const keysUnder = async (s, prefix) => done((await store(s)).getAllKeys(range(prefix)));
const valuesUnder = async (s, prefix) => done((await store(s)).getAll(range(prefix)));

const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png', json: 'application/json' };
const typeOf = (name) => TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';
const vpath = (id, name = '') => `videos/${id}/${name}`;
const toBlob = (name, data) => (data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data)], { type: typeOf(name) }));
const readBlob = async (key) => { const b = await get('files', key); if (!b) throw new Error(`File not found: ${key}`); return b; };

// ------------------------------------------------------------------ library (mirrors lib/library.js)
const statusKey = (id) => `status:${id}`;
async function readStatus(id) { return (await get('kv', statusKey(id))) || null; }
async function writeStatus(id, status) { status.updatedAt = new Date().toISOString(); await put('kv', statusKey(id), status); return status; }
async function update(id, patch) { return writeStatus(id, { ...((await readStatus(id)) || { id }), ...patch }); }
async function list() {
  const out = await valuesUnder('kv', 'status:');
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function usage() {
  let bytes = 0;
  for (const b of await valuesUnder('files', 'videos/')) bytes += b.size || 0;
  let quotaBytes = QUOTA_CAP;
  try { const e = await navigator.storage.estimate(); if (e.quota) quotaBytes = Math.min(QUOTA_CAP, Math.floor(e.quota * 0.6)); } catch { /* keep the cap */ }
  return { bytes, quotaBytes, freeBytes: Math.max(0, quotaBytes - bytes) };
}
async function removeMedia(id, which = null) {
  const prefix = vpath(id);
  for (const k of await keysUnder('files', prefix)) {
    const name = k.slice(prefix.length);
    if (name === 'status.json' || name === 'config.json' || name === 'metrics.json') continue;
    if (which && !which.some((w) => name.startsWith(w))) continue;
    await del('files', k);
  }
}
function flatKeys(o, acc = {}) { if (o && typeof o === 'object') for (const k of Object.keys(o)) { acc[k] = 1; flatKeys(o[k], acc); } return acc; }
async function configId(config) {   // same canonical form as lib/library.js configId (sha1, 12 hex)
  const { appVersion, caption, ...rest } = config;
  const canon = JSON.stringify(rest, Object.keys(flatKeys(rest)).sort());
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(canon)));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
async function appendRejected(entry) {
  const log = (await get('kv', 'rejected')) || [];
  log.push({ ...entry, at: new Date().toISOString() });
  await put('kv', 'rejected', log.length > 5000 ? log.slice(-4000) : log);
}
async function seenSeeds(key) {
  const seen = new Set();
  for (const s of await list()) if (s.scenario === key) seen.add(s.seed);
  for (const e of (await get('kv', 'rejected')) || []) if (e.scenario === key) seen.add(e.seed);
  return [...seen];
}
const DEFAULT_SETTINGS = { libraryRoot: 'Browser storage', quotaGB: 12, pauseOnBattery: false };
async function settings(patch) {
  const cur = { ...DEFAULT_SETTINGS, ...((await get('kv', 'settings')) || {}) };
  if (patch) { const next = { ...cur, ...patch }; await put('kv', 'settings', next); return next; }
  return cur;
}

// A reload interrupts whatever was running: same recovery as the desktop library.
const ready = (async () => {
  try { await navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* best effort */ }
  for (const s of await list()) {
    if (s.status === 'generating') await update(s.id, { status: 'failed', reasons: [...(s.reasons || []), 'interrupted'] });
    if (s.status === 'mastering') await update(s.id, { status: 'candidate', note: 'master export was interrupted; accept again to retry' });
  }
  for (const k of await keysUnder('files', 'exports/')) if (/\.part$/.test(k)) await del('files', k);
})().catch((e) => console.warn('library recovery failed', e));
const R = (fn) => async (...a) => { await ready; return fn(...a); };

// ------------------------------------------------------------------ media helpers (seek a <video>, draw, measure)
async function openVideo(key) {
  const url = URL.createObjectURL(await readBlob(key));
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = () => reject(new Error(`The browser could not decode ${key}`)); });
  return { v, close: () => { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); } };
}
const seek = (v, t) => new Promise((resolve) => {
  const tt = Math.max(0, Math.min(t, (v.duration || t) - 0.001));
  if (Math.abs(v.currentTime - tt) < 1e-4 && v.readyState >= 2) return resolve();
  v.onseeked = () => { v.onseeked = null; resolve(); }; v.currentTime = tt;
});
function grayOf(src, w, h) {
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}
function ssim(a, b, w, h) {   // mean SSIM over 8x8 windows, 8-bit luma
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2; let sum = 0, n = 0;
  for (let y = 0; y + 8 <= h; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
    let ma = 0, mb = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i; ma += a[k]; mb += b[k]; }
    ma /= 64; mb /= 64; let va = 0, vb = 0, cv = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i, da = a[k] - ma, db = b[k] - mb; va += da * da; vb += db * db; cv += da * db; }
    va /= 63; vb /= 63; cv /= 63;
    sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? sum / n : 0;
}
function psnr(a, b) { let e = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; } e /= a.length; return e === 0 ? Infinity : 10 * Math.log10(255 * 255 / e); }

const media = {
  async audioReport(key) {
    let ch;
    try {
      const buf = await (await readBlob(key)).arrayBuffer();
      const audio = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(buf);
      ch = [audio.getChannelData(0), audio.numberOfChannels > 1 ? audio.getChannelData(1) : audio.getChannelData(0)];
    } catch {
      return { lufs: -99, truePeak: -99, lra: null, silences: [], longestSilence: 99, note: 'no audio track could be decoded' };
    }
    const sr = 48000, lufs = integratedLoudness(ch, sr);
    let peak = 0;   // 4x linear-interpolated peak: close to a true-peak reading for this material
    for (const c of ch) for (let i = 1; i < c.length; i++) { const a = c[i - 1], b = c[i]; for (let k = 0; k < 4; k++) { const v = Math.abs(a + (b - a) * k / 4); if (v > peak) peak = v; } }
    const win = sr / 10, silences = []; let run = 0;   // silencedetect n=-50dB d=1.5
    for (let s = 0; s + win <= ch[0].length; s += win) {
      let e = 0; for (const c of ch) for (let i = s; i < s + win; i++) e += c[i] * c[i];
      const db = 10 * Math.log10(e / (win * ch.length) + 1e-12);
      if (db < -50) run += 0.1; else { if (run >= 1.5) silences.push(+run.toFixed(2)); run = 0; }
    }
    if (run >= 1.5) silences.push(+run.toFixed(2));
    return { lufs: +lufs.toFixed(1), truePeak: +(20 * Math.log10(peak || 1e-9)).toFixed(1), lra: null, silences, longestSilence: silences.length ? Math.max(...silences) : 0 };
  },

  async videoReport(key) {   // freezedetect d=1 / blackdetect d=0.5, sampled every 0.25 s
    const { v, close } = await openVideo(key);
    try {
      const step = 0.25, W = 36, H = 64, freezes = [], blacks = [];
      let prev = null, fr = 0, bl = 0;
      for (let t = step / 2; t < v.duration; t += step) {
        await seek(v, t);
        const g = grayOf(v, W, H);
        const dark = g.reduce((n, x) => n + (x < 0.1 * 255 ? 1 : 0), 0) / g.length;
        if (dark >= 0.98) bl += step; else { if (bl >= 0.5) blacks.push(bl); bl = 0; }
        if (prev) {
          let d = 0; for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - prev[i]);
          if (d / g.length / 255 < 0.001) fr += step; else { if (fr >= 1) freezes.push(fr); fr = 0; }
        }
        prev = g;
      }
      if (bl >= 0.5) blacks.push(bl); if (fr >= 1) freezes.push(fr);
      return { freezes, blacks, longestFreeze: freezes.length ? Math.max(...freezes) : 0, longestBlack: blacks.length ? Math.max(...blacks) : 0 };
    } finally { close(); }
  },

  async dHashes(key, durationS, count = 8) {
    const { v, close } = await openVideo(key);
    try {
      const out = [];
      for (let k = 0; k < count; k++) {
        await seek(v, (durationS * (k + 0.5)) / count);
        const px = grayOf(v, 9, 8); let bits = '';
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? '1' : '0';
        out.push(BigInt(`0b${bits}`).toString(16).padStart(16, '0'));
      }
      return out;
    } finally { close(); }
  },

  async thumbnail(key, atS, outKey) {
    const { v, close } = await openVideo(key);
    try {
      await seek(v, atS);
      const w = 270, h = Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2;
      const c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(v, 0, 0, w, h);
      await put('files', outKey, await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 }));
      return outKey;
    } finally { close(); }
  },

  /** Quality gate: decoded frames n-1, n, n+1 vs the truth PNG of n (SSIM/PSNR on 270x480 luma). */
  async qualityGate(key, truthDir, frames) {
    const { v, close } = await openVideo(key);
    const W = 270, H = 480, at = async (n) => { await seek(v, (n + 0.5) / FPS); return grayOf(v, W, H); };
    try {
      const per = []; let accurate = 0, checked = 0;
      for (const n of frames) {
        const png = await get('files', `${truthDir}/frame_${String(n).padStart(5, '0')}.png`);
        if (!png) continue;
        const truth = grayOf(await createImageBitmap(png), W, H);
        const dec = await at(n), q = { ssim: ssim(dec, truth, W, H), psnr: psnr(dec, truth) };
        per.push({ frame: n, ...q });
        if (n > 0 && n + 1 < Math.round(v.duration * FPS)) {
          const before = ssim(await at(n - 1), truth, W, H), after = ssim(await at(n + 1), truth, W, H);
          checked++; if (q.ssim >= before && q.ssim >= after) accurate++;
        }
      }
      if (!per.length) return { frames: [], accurate: 0, checked: 0, ssimMin: 0, ssimMean: 0, psnrMin: 0, error: 'no frames compared' };
      const ss = per.map((p) => p.ssim), ps = per.map((p) => p.psnr).filter(Number.isFinite);
      return { frames: per, accurate, checked, ssimMin: Math.min(...ss), ssimMean: ss.reduce((a, b) => a + b, 0) / ss.length, psnrMin: ps.length ? Math.min(...ps) : Infinity };
    } finally { close(); }
  },
};

// ------------------------------------------------------------------ export jobs (bytes from the MediaBunny worker)
const jobs = new Map();
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
async function probe(blob) {
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.preload = 'metadata'; v.src = url;
  try {
    await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = () => reject(new Error('the browser cannot open the encoded file')); });
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}
const exportApi = {
  async exportBegin(opts) {
    if (opts.mode !== 'mediabunny') throw new Error('FFmpeg encoders are only available in the desktop app.');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const finalPath = opts.finalPath || `exports/SplitChamber_${stamp()}_seed${opts.seed}.mp4`;
    jobs.set(id, { id, finalPath, chunks: [], frameCount: opts.frameCount, exp: opts.expected || { w: 1080, h: 1920 }, mbps: opts.bitrateMbps, t0: performance.now() });
    return { id, finalPath };
  },
  async exportWrite(id, data, position) {
    const j = jobs.get(id); if (!j) throw new Error('Export job not found.');
    j.chunks.push({ position, data: new Uint8Array(data) });
  },
  async exportFrame() { throw new Error('Raw-frame export needs the desktop app.'); },
  async exportPng(dir, frame, data) { await put('files', `${dir}/frame_${String(frame).padStart(5, '0')}.png`, new Blob([data], { type: 'image/png' })); },
  async exportAbort(id) { jobs.delete(id); },
  async exportFinish(id, info) {
    const j = jobs.get(id); if (!j) throw new Error('Export job not found.');
    jobs.delete(id);
    const size = j.chunks.reduce((m, c) => Math.max(m, c.position + c.data.length), 0);
    const bytes = new Uint8Array(size);
    for (const c of j.chunks) bytes.set(c.data, c.position);   // later writes (header patches) win, as on disk
    j.chunks = null;
    const blob = new Blob([bytes], { type: 'video/mp4' });
    const m = await probe(blob), expDur = j.frameCount / FPS, problems = [];
    if (m.width !== j.exp.w || m.height !== j.exp.h) problems.push(`size ${m.width}x${m.height}, expected ${j.exp.w}x${j.exp.h}`);
    if (!(Math.abs(m.duration - expDur) < 0.1)) problems.push(`duration ${m.duration.toFixed(3)} s vs ${expDur.toFixed(3)} s`);
    if (problems.length) throw new Error(`The video did not pass verification: ${problems.join('; ')}`);
    await put('files', j.finalPath, blob);
    const mbps = +((size * 8) / expDur / 1e6).toFixed(2);
    const summary = {
      width: m.width, height: m.height, fps: '60/1', frames: j.frameCount, duration: m.duration, videoCodec: 'h264', pixFmt: 'yuv420p', color: 'bt709/tv',
      audio: info && info.audioMuxed ? `${info.audioCodec || 'aac'} 48000 Hz 2ch` : 'none', sizeMB: +(size / 1e6).toFixed(1), bitrateMbps: mbps, videoMbps: mbps,
    };
    return { path: j.finalPath, bytes: size, verify: { ok: true, problems: [], summary }, seconds: (performance.now() - j.t0) / 1000 };
  },
};

// ------------------------------------------------------------------ files out / in
async function download(key, name) {
  const blob = await readBlob(key);
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name || key.split('/').pop(); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function gz(buffer, mode) {
  const s = new Blob([buffer]).stream().pipeThrough(mode === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Response(s).arrayBuffer();
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null); i.click();
  });
}

let wakeLock = null;
const noop = async () => {};

window.host = {
  web: true,
  libUrl: (id, file) => `lib/${vpath(id, file)}`,
  download: (id, file) => download(vpath(id, file), `SplitChamber_${id}_${file}`),
  info: async () => ({ videos: 'Browser storage', sessions: 'Browser storage', cleaned: 0, root: '.', version: '__APP_VERSION__', gate: null, bench: null }),
  ffmpegEncoders: async () => ({}),
  async saveSession(buffer, meta) {
    const name = `SplitChamber_${stamp()}_seed${meta.seed}.scsession`, data = await gz(buffer, 'c');
    await put('files', `sessions/${name}`, new Blob([data])); await download(`sessions/${name}`, name);
    return { path: name, bytes: data.byteLength };
  },
  async openSession() {
    const f = await pickFile('.scsession'); if (!f) return null;
    return { path: f.name, buffer: await gz(await f.arrayBuffer(), 'd') };
  },
  ...exportApi,
  show: async (p) => { if (p) await download(p); },
  quit: noop,
  fullscreen: async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); },
  benchWrite: noop,
  log: async (...a) => console.debug('[studio]', ...a),
  gateDone: noop,
  studio: {
    info: R(async () => ({ root: 'Browser storage', settings: await settings(), usage: await usage(), cli: null, debug: { minBitrateRatio: null } })),
    settings: R(settings),
    lock: async () => true, unlock: async () => {},
    list: R(list), get: R(readStatus), writeStatus: R(writeStatus), update: R(update), usage: R(usage),
    id: configId, path: async (id, name) => vpath(id, name),
    writeFile: R(async (id, name, data) => { const k = vpath(id, name); await put('files', k, toBlob(name, data)); return k; }),
    readJson: R(async (id, name) => JSON.parse(await (await readBlob(vpath(id, name))).text())),
    exists: R(async (id, name) => !!(await get('files', vpath(id, name)))),
    removeMedia: R(removeMedia),
    remove: R(async (id) => { for (const k of await keysUnder('files', vpath(id))) await del('files', k); await del('kv', statusKey(id)); }),
    rejectLog: R(appendRejected), seenSeeds: R(seenSeeds),
    queue: R(async (op, q) => (op === 'save' ? put('kv', 'queue', q) : op === 'clear' ? del('kv', 'queue') : (await get('kv', 'queue')) || null)),
    patterns: R(async (l) => { if (Array.isArray(l)) { await put('kv', 'patterns', l); return l; } return (await get('kv', 'patterns')) || []; }),
    audioReport: R(media.audioReport), videoReport: R(media.videoReport), dhash: R(media.dHashes), thumb: R(media.thumbnail), quality: R(media.qualityGate),
    async powerBlock(on) {
      try { if (on && !wakeLock && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch { wakeLock = null; }
      return !!wakeLock;
    },
    powerState: async () => ({ onBattery: false }),
    cliDone: noop,
  },
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('media service worker failed', e));
