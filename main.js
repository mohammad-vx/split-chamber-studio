// Split Chamber — Electron main process.
// Owns everything that touches disk or child processes: sessions, export files, ffmpeg, ffprobe.
'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const zlib = require('node:zlib');
const { spawn, execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');

const W = 1080, H = 1920, FPS = 60;
const ROOT = __dirname;
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);

const args = process.argv.slice(1);
const argVal = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const BENCH = args.includes('--bench');
const GATE = args.includes('--gate');
const HEADLESS = BENCH || GATE;

let win = null;
const jobs = new Map();
let logFile = null;

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try { if (logFile) fs.appendFileSync(logFile, line); } catch { /* ignore */ }
  if (!app.isPackaged) process.stdout.write(line);
}

const dirs = () => {
  const videos = argVal('out-dir') || path.join(app.getPath('videos'), 'Split Chamber');
  return { videos, sessions: path.join(videos, 'Sessions') };
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function createWindow() {
  win = new BrowserWindow({
    width: 560, height: 980, minWidth: 360, minHeight: 560,
    useContentSize: true, backgroundColor: '#05070b', autoHideMenuBar: true,
    title: 'Split Chamber', show: !HEADLESS,
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, // exports keep full speed when minimised
    },
  });
  win.loadURL('app://bundle/src/index.html');
  win.webContents.on('render-process-gone', (_e, d) => {
    log('renderer gone', d);
    for (const id of [...jobs.keys()]) abortJob(id, 'renderer crashed').catch(() => {});
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  const { videos, sessions } = dirs();
  await fsp.mkdir(sessions, { recursive: true });
  const logDir = path.join(app.getPath('userData'), 'logs');
  await fsp.mkdir(logDir, { recursive: true });
  logFile = path.join(logDir, 'main.log');
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const abs = path.normalize(path.join(ROOT, rel));
    if (!abs.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
  log('start', { version: app.getVersion(), electron: process.versions.electron, ffmpeg: FFMPEG, videos });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const id of [...jobs.keys()]) abortJob(id, 'app closing').catch(() => {}); });
process.on('uncaughtException', (err) => log('uncaught', String(err && err.stack || err)));

// ---------------------------------------------------------------- helpers
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
async function uniquePath(dir, base, ext) {
  for (let i = 1; ; i++) {
    const p = path.join(dir, `${base}${i > 1 ? `_${i}` : ''}${ext}`);
    try { await fsp.access(p); } catch { return p; }
  }
}
async function freeBytes(dir) {
  try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return null; }
}
const run = promisify(execFile);

function writeWav(file, channels, sampleRate) {
  // 32-bit float stereo WAV
  const n = channels[0].length, nc = channels.length;
  const data = Buffer.alloc(n * nc * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) data.writeFloatLE(channels[c][i], (i * nc + c) * 4);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(nc, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * nc * 4, 28); h.writeUInt16LE(nc * 4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return fsp.writeFile(file, Buffer.concat([h, data]));
}

// ffmpeg encoder settings. All targets: H.264 High, yuv420p/nv12, BT.709 limited range, 60 fps CFR.
const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
function videoArgs(enc, mbps) {
  const sw = (fmt) => ['-vf', `scale=out_color_matrix=bt709:out_range=tv,format=${fmt}`];
  const rate = ['-b:v', `${mbps}M`, '-maxrate', `${Math.round(mbps * 1.4)}M`, '-bufsize', `${mbps * 2}M`];
  switch (enc) {
    case 'libx264': return [...sw('yuv420p'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-maxrate', `${Math.round(mbps * 1.4)}M`, '-bufsize', `${mbps * 2}M`, '-profile:v', 'high', '-g', '60'];
    case 'lossless': return [...sw('yuv420p'), '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-g', '60'];
    case 'h264_qsv': return [...sw('nv12'), '-c:v', 'h264_qsv', '-preset', 'slower', ...rate, '-profile:v', 'high', '-g', '60'];
    case 'h264_nvenc': return [...sw('yuv420p'), '-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', ...rate, '-profile:v', 'high', '-g', '60'];
    case 'h264_amf': return [...sw('nv12'), '-c:v', 'h264_amf', '-quality', 'quality', ...rate, '-profile:v', 'high', '-g', '60'];
    case 'h264_mf': return [...sw('nv12'), '-c:v', 'h264_mf', '-hw_encoding', '1', ...rate, '-g', '60'];
    default: throw new Error(`Unknown encoder ${enc}`);
  }
}

let encoderProbe = null;
async function probeEncoders() {
  if (encoderProbe) return encoderProbe;
  encoderProbe = (async () => {
    const res = {};
    for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf', 'libx264']) {
      try {
        await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=0.1`,
          ...videoArgs(enc, 20), '-f', 'null', '-'], { timeout: 20000, windowsHide: true });
        res[enc] = true;
      } catch { res[enc] = false; }
    }
    log('ffmpeg encoders', res);
    return res;
  })();
  return encoderProbe;
}

async function ffprobe(file) {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-count_frames',
    '-show_entries', 'stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames,duration,sample_rate,channels,color_space,color_range:format=duration,size,bit_rate',
    '-of', 'json', file], { timeout: 180000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

/** Checks the finished file against what the session says it must be. */
async function verify(file, frameCount) {
  const problems = [];
  let info;
  try { info = await ffprobe(file); } catch (e) { return { ok: false, problems: [`ffprobe could not open the file: ${e.message}`] }; }
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  const expectedDur = frameCount / FPS;
  if (!v) problems.push('no video stream');
  else {
    if (v.codec_name !== 'h264') problems.push(`video codec ${v.codec_name}`);
    if (v.width !== W || v.height !== H) problems.push(`resolution ${v.width}x${v.height}`);
    if (v.r_frame_rate !== '60/1') problems.push(`r_frame_rate ${v.r_frame_rate}`);
    if (v.avg_frame_rate !== '60/1') problems.push(`avg_frame_rate ${v.avg_frame_rate}`);
    if (Number(v.nb_read_frames) !== frameCount) problems.push(`frames ${v.nb_read_frames} != ${frameCount}`);
    if (Math.abs(Number(v.duration) - expectedDur) > 0.5 / FPS) problems.push(`video duration ${v.duration} != ${expectedDur.toFixed(4)}`);
    if (!/yuv420p|nv12/.test(v.pix_fmt || '')) problems.push(`pix_fmt ${v.pix_fmt}`);
  }
  if (!a) problems.push('no audio stream');
  else {
    if (a.codec_name !== 'aac') problems.push(`audio codec ${a.codec_name}`);
    if (Math.abs(Number(a.duration) - expectedDur) > 0.05) problems.push(`audio duration ${a.duration} vs ${expectedDur.toFixed(3)}`);
  }
  const size = Number(info.format.size);
  return {
    ok: problems.length === 0, problems,
    summary: v && {
      width: v.width, height: v.height, fps: v.avg_frame_rate, frames: Number(v.nb_read_frames),
      duration: Number(v.duration), videoCodec: `${v.codec_name} ${v.profile || ''}`.trim(), pixFmt: v.pix_fmt,
      color: `${v.color_space || '?'}/${v.color_range || '?'}`,
      audio: a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels}ch ${Number(a.duration).toFixed(3)}s` : 'none',
      sizeMB: +(size / 1e6).toFixed(1), bitrateMbps: +(Number(info.format.bit_rate) / 1e6).toFixed(1),
    },
  };
}

function ffmpegProc(argv) {
  const p = spawn(FFMPEG, argv, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
  p.done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
  });
  p.stdin.on('error', () => { /* surfaced via close code */ });
  return p;
}

async function abortJob(id, reason) {
  const j = jobs.get(id);
  if (!j) return;
  jobs.delete(id);
  log('abort', id, reason);
  try { if (j.proc) { j.proc.stdin.destroy(); j.proc.kill('SIGKILL'); await j.proc.done.catch(() => {}); } } catch { /* ignore */ }
  try { if (j.fd) await j.fd.close(); } catch { /* ignore */ }
  for (const f of [j.part, j.wav, j.remux]) if (f) await fsp.rm(f, { force: true }).catch(() => {});
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('app:info', async () => {
  const { videos, sessions } = dirs();
  // clean incomplete exports left behind by a crash or forced close
  let cleaned = 0;
  for (const f of await fsp.readdir(videos).catch(() => [])) {
    if (/\.part(\.|$)|\.wav\.tmp$|\.remux\.tmp\.mp4$/.test(f) && ![...jobs.values()].some((j) => [j.part, j.wav, j.remux].includes(path.join(videos, f)))) {
      await fsp.rm(path.join(videos, f), { force: true }).catch(() => {}); cleaned++;
    }
  }
  return { videos, sessions, cleaned, root: ROOT, version: app.getVersion(), gate: GATE ? { captureGoldens: args.includes('--gate-capture-goldens'), capture: args.includes('--gate-capture'), raw: argVal('gate-raw') || 'sim-raw.json' } : null, bench: BENCH ? { seed: Number(argVal('seed') || 1234), out: argVal('bench-out'), engines: argVal('engines'), scenario: argVal('scenario') || 'split-chamber@1', bitrate: Number(argVal('bitrate') || 0) || null } : null };
});

ipcMain.handle('ffmpeg:encoders', () => probeEncoders());

ipcMain.handle('session:save', async (_e, buffer, meta) => {
  const { sessions } = dirs();
  const file = await uniquePath(sessions, `SplitChamber_${stamp()}_seed${meta.seed}`, '.scsession');
  const gz = await promisify(zlib.gzip)(Buffer.from(buffer), { level: 6 });
  const tmp = `${file}.part`;
  await fsp.writeFile(tmp, gz);
  await fsp.rename(tmp, file);
  log('session saved', file, gz.length);
  return { path: file, bytes: gz.length };
});

ipcMain.handle('session:open', async (_e, file) => {
  if (!file) {
    const r = await dialog.showOpenDialog(win, { title: 'Open session', defaultPath: dirs().sessions, properties: ['openFile'], filters: [{ name: 'Split Chamber session', extensions: ['scsession'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  const raw = await fsp.readFile(file);
  const buf = await promisify(zlib.gunzip)(raw);
  return { path: file, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

ipcMain.handle('export:begin', async (_e, opts) => {
  const { videos } = dirs();
  const { seed, frameCount, mode, encoder, bitrateMbps, audio } = opts;
  const durS = frameCount / FPS;
  const need = durS * bitrateMbps * 1.6 / 8 * 1e6 + durS * 48000 * 8 + 200e6;
  const free = await freeBytes(videos);
  if (free !== null && free < need) throw new Error(`Not enough disk space: ${(free / 1e9).toFixed(2)} GB free, about ${(need / 1e9).toFixed(2)} GB needed.`);
  const finalPath = opts.finalPath || await uniquePath(videos, `SplitChamber_${stamp()}_seed${seed}`, '.mp4');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fsp.mkdir(path.dirname(finalPath), { recursive: true }); // B1: bench/custom paths may not exist yet
  const job = { id, mode, encoder, frameCount, finalPath, part: `${finalPath}.part.mp4`, wav: `${finalPath}.wav.tmp`, remux: null, written: 0, t0: Date.now() };
  jobs.set(id, job);
  await writeWav(job.wav, audio.channels, audio.sampleRate);
  if (mode === 'ffmpeg') {
    job.proc = ffmpegProc(['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0',
      '-i', job.wav, '-map', '0:v:0', '-map', '1:a:0',
      ...videoArgs(encoder, bitrateMbps), ...COLOR, '-r', String(FPS), '-fps_mode', 'cfr',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', job.part]);
    job.proc.done.catch((e) => { job.failed = e; });
  } else {
    job.fd = await fsp.open(job.part, 'w');
  }
  log('export begin', { id, mode, encoder, frameCount, finalPath, free });
  return { id, finalPath };
});

ipcMain.handle('export:write', async (_e, id, data, position) => {
  const j = jobs.get(id);
  if (!j) throw new Error('Export job not found.');
  const b = Buffer.from(data);
  await j.fd.write(b, 0, b.length, position);
  j.written += b.length;
});

ipcMain.handle('export:frame', async (_e, id, data) => {
  const j = jobs.get(id);
  if (!j) throw new Error('Export job not found.');
  if (j.failed) throw j.failed;
  const b = Buffer.from(data);
  if (!j.proc.stdin.write(b)) {
    await new Promise((resolve, reject) => {
      const onDrain = () => { cleanup(); resolve(); };
      const onClose = () => { cleanup(); reject(j.failed || new Error('ffmpeg closed its input.')); };
      const cleanup = () => { j.proc.stdin.off('drain', onDrain); j.proc.off('close', onClose); };
      j.proc.stdin.once('drain', onDrain); j.proc.once('close', onClose);
    });
  }
});

ipcMain.handle('export:png', async (_e, dir, frame, data) => {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `frame_${String(frame).padStart(5, '0')}.png`), Buffer.from(data));
});

ipcMain.handle('export:finish', async (_e, id, info) => {
  const j = jobs.get(id);
  if (!j) throw new Error('Export job not found.');
  try {
    if (j.mode === 'ffmpeg') {
      j.proc.stdin.end();
      await j.proc.done;
    } else {
      await j.fd.close(); j.fd = null;
      // Lossless remux: moves the index to the front (+faststart) and adds the audio track if the
      // WebCodecs AAC encoder was unavailable.
      j.remux = `${j.finalPath}.remux.tmp.mp4`;
      const argv = ['-hide_banner', '-loglevel', 'error', '-y', '-i', j.part];
      if (info.audioMuxed) argv.push('-map', '0:v:0', '-map', '0:a:0', '-c', 'copy');
      else argv.push('-i', j.wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
      argv.push('-movflags', '+faststart', '-f', 'mp4', j.remux);
      await ffmpegProc(argv).done;
      await fsp.rm(j.part, { force: true });
      j.part = j.remux; j.remux = null;
    }
    const check = await verify(j.part, j.frameCount);
    if (!check.ok) {
      log('verify failed', id, check.problems);
      const err = new Error(`The video did not pass verification: ${check.problems.join('; ')}`);
      await abortJob(id, 'verification failed');
      throw err;
    }
    await fsp.rename(j.part, j.finalPath);
    await fsp.rm(j.wav, { force: true });
    jobs.delete(id);
    const stat = await fsp.stat(j.finalPath);
    log('export ok', j.finalPath, check.summary, (Date.now() - j.t0) / 1000);
    return { path: j.finalPath, bytes: stat.size, verify: check, seconds: (Date.now() - j.t0) / 1000 };
  } catch (e) {
    await abortJob(id, e.message);
    throw e;
  }
});

ipcMain.handle('export:abort', (_e, id, reason) => abortJob(id, reason || 'cancelled'));

ipcMain.handle('shell:show', (_e, p) => { if (p) shell.showItemInFolder(p); else shell.openPath(dirs().videos); });
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
ipcMain.handle('bench:write', async (_e, file, text) => {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text);
});
ipcMain.handle('log', (_e, ...parts) => log('renderer', ...parts));
ipcMain.handle('gate:done', async (_e, result) => {
  const out = argVal('gate-out');
  if (out) { await fsp.mkdir(path.dirname(out), { recursive: true }); await fsp.writeFile(out, JSON.stringify(result, null, 1)); }
  log('gate', result.ok ? 'PASS' : 'FAIL', result.summary);
  app.exit(result.ok ? 0 : 1);
});
