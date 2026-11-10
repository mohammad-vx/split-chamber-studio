// IPC surface for the production pipeline (ARCHITECTURE §7.2): library, media analysis, power, settings, CLI.
// The main process is the single writer of the library; the renderer runs the pipeline.
'use strict';
const { ipcMain, app, powerSaveBlocker, powerMonitor, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');
const { createLibrary } = require('./library');
const { createMedia } = require('./media');

function defaultLibraryRoot() {
  try { if (fs.existsSync('D:\\')) return 'D:\\Split Chamber Studio'; } catch { /* ignore */ }
  return path.join(app.getPath('videos'), 'Split Chamber Studio');
}

function registerStudio({ FFMPEG, argVal, args, log }) {
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  let settings = { libraryRoot: defaultLibraryRoot(), quotaGB: 12, pauseOnBattery: true };
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch { /* defaults */ }
  if (argVal('library')) settings.libraryRoot = argVal('library');
  const quotaBytes = argVal('quota-mb') ? Number(argVal('quota-mb')) * 1024 * 1024 : settings.quotaGB * 1024 ** 3;
  const lib = createLibrary(settings.libraryRoot, { quotaBytes });
  const media = createMedia(FFMPEG);
  let blocker = null;

  const inLib = (p) => { const abs = path.resolve(p); if (!abs.startsWith(path.resolve(lib.root))) throw new Error('Path outside the library.'); return abs; };

  // Library files are served from the first moment (registered before anything is awaited): thumbnails and
  // previews must never depend on the startup recovery pass finishing.
  const TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.wav': 'audio/wav' };
  protocol.handle('lib', async (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const abs = path.normalize(path.join(lib.root, rel));
      if (!abs.startsWith(path.resolve(lib.root))) return new Response('Forbidden', { status: 403 });
      const st = await fsp.stat(abs);
      const type = TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
      const size = st.size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
      let start = 0, end = size - 1, status = 200;
      if (m && size > 0) {
        if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); }
        else { start = Number(m[1] || 0); if (m[2] !== '') end = Math.min(size - 1, Number(m[2])); }
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        status = 206;
      }
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      const body = size === 0 ? null : Readable.toWeb(fs.createReadStream(abs, { start, end }));
      return new Response(body, { status, headers });
    } catch (e) {
      log('lib protocol error', req.url, e.message);
      return new Response('Not found', { status: 404 });
    }
  });

  const ready = (async () => {
    await lib.ensure();
    try {
      const fixed = await lib.recover();
      if (fixed.length) log('library recovered', fixed);
    } catch (e) { log('library recovery failed (the library still works)', e.message); }
  })();

  const h = (name, fn) => ipcMain.handle(name, async (_e, ...a) => { await ready; return fn(...a); });

  h('studio:info', async () => ({
    root: lib.root, settings, usage: await lib.usage(),
    cli: argVal('generate') ? {
      generate: Number(argVal('generate')), pattern: argVal('pattern') || 'random', captions: argVal('captions') || 'none',
      seeds: argVal('seeds') ? argVal('seeds').split(',').map(Number) : null, accept: args.includes('--accept-all'),
      balls: argVal('balls') ? Number(argVal('balls')) : null, length: argVal('length') || null,
    } : null,
    debug: { minBitrateRatio: argVal('min-bitrate-ratio') ? Number(argVal('min-bitrate-ratio')) : null },
  }));
  h('studio:settings', async (patch) => {
    if (patch) { settings = { ...settings, ...patch }; await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 1)); }
    return settings;
  });

  // saved machines belong to the library (patterns.json next to library.json)
  h('library:patterns', async (list) => {
    const file = path.join(lib.root, 'patterns.json');
    if (Array.isArray(list)) { await fsp.writeFile(file + '.tmp', JSON.stringify(list, null, 1)); await fsp.rename(file + '.tmp', file); return list; }
    try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return []; }
  });
  h('library:lock', (owner) => lib.lock(owner));
  h('library:unlock', () => lib.unlock());
  h('library:list', () => lib.list());
  h('library:get', (id) => lib.readStatus(id));
  h('library:write-status', (id, status) => lib.writeStatus(id, status));
  h('library:update', (id, patch) => lib.update(id, patch));
  h('library:usage', () => lib.usage());
  h('library:id', (config) => lib.idFor(config));
  h('library:path', (id, name) => path.join(lib.dir(id), name || ''));
  h('library:write-file', async (id, name, data) => {
    const file = inLib(path.join(lib.dir(id), name));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, typeof data === 'string' ? data : Buffer.from(data));
    return file;
  });
  h('library:read-json', async (id, name) => JSON.parse(await fsp.readFile(inLib(path.join(lib.dir(id), name)), 'utf8')));
  h('library:exists', async (id, name) => { try { await fsp.access(inLib(path.join(lib.dir(id), name))); return true; } catch { return false; } });
  h('library:remove-media', (id, which) => lib.removeMedia(id, which));
  h('library:delete', async (id) => { await fsp.rm(lib.dir(id), { recursive: true, force: true }); });
  h('library:reject-log', (entry) => lib.appendRejected(entry));
  h('library:seen-seeds', (key) => lib.seenSeeds(key));
  h('library:queue', async (op, q) => (op === 'save' ? lib.saveQueue(q) : op === 'clear' ? lib.clearQueue() : lib.loadQueue()));

  h('media:audio', (file) => media.audioReport(inLib(file)));
  h('media:video', (file) => media.videoReport(inLib(file)));
  h('media:dhash', (file, dur, n) => media.dHashes(inLib(file), dur, n));
  h('media:thumb', (file, at, out) => media.thumbnail(inLib(file), at, inLib(out)));
  h('media:quality', (file, truthDir, frames) => media.qualityGate(inLib(file), inLib(truthDir), frames));

  h('power:block', (on) => {
    if (on && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if (!on && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
    return blocker !== null;
  });
  h('power:state', () => ({ onBattery: powerMonitor.isOnBatteryPower() }));

  h('cli:done', async (result) => {
    log('cli', JSON.stringify(result));
    process.stdout.write(`STUDIO_RESULT ${JSON.stringify(result)}\n`);
    await lib.unlock().catch(() => {});
    app.exit(result.ok ? 0 : 1);
  });

  return { lib, settings, ready };
}

module.exports = { registerStudio };
