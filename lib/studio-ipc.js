// IPC surface for the production pipeline (ARCHITECTURE §7.2): library, media analysis, power, settings, CLI.
// The main process is the single writer of the library; the renderer runs the pipeline.
'use strict';
const { ipcMain, app, powerSaveBlocker, powerMonitor, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
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

  const ready = (async () => {
    await lib.ensure();
    const fixed = await lib.recover();
    if (fixed.length) log('library recovered', fixed);
    protocol.handle('lib', (req) => {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const abs = path.normalize(path.join(lib.root, rel));
      if (!abs.startsWith(path.resolve(lib.root))) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(abs).toString(), { headers: req.headers });
    });
  })();

  const h = (name, fn) => ipcMain.handle(name, async (_e, ...a) => { await ready; return fn(...a); });

  h('studio:info', async () => ({
    root: lib.root, settings, usage: await lib.usage(),
    cli: argVal('generate') ? {
      generate: Number(argVal('generate')), pattern: argVal('pattern') || 'random', captions: argVal('captions') || 'none',
      seeds: argVal('seeds') ? argVal('seeds').split(',').map(Number) : null, accept: args.includes('--accept-all'),
    } : null,
    debug: { minBitrateRatio: argVal('min-bitrate-ratio') ? Number(argVal('min-bitrate-ratio')) : null },
  }));
  h('studio:settings', async (patch) => {
    if (patch) { settings = { ...settings, ...patch }; await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 1)); }
    return settings;
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
