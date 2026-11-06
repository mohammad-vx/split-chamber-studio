// Studio library (main process only — the single writer, ARCHITECTURE §7.2–7.4).
// Layout: <root>/videos/<id>/{status.json, config.json, preview.mp4, thumb.jpg, master*.mp4, ...},
//         <root>/library.json (cache, rebuilt from status files), <root>/rejected.jsonl, <root>/queue.json,
//         <root>/studio.lock (pid lock: CLI and UI never run batches at the same time).
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PARTIAL = /\.(part|tmp)(\.|$)|\.part\.mp4$|\.wav\.tmp$|\.remux\.tmp\.mp4$/;

let tmpSeq = 0;
async function atomicWrite(file, text) {
  // a unique temp name per write: two overlapping writes of the same file must not rename each other's temp file
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  await fsp.writeFile(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try { await fsp.rename(tmp, file); return; }
    catch (e) {   // Windows: the target can be briefly locked by a reader or the other writer's rename
      if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { await fsp.rm(tmp, { force: true }); throw e; }
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Stable id of a config: sha1 of its canonical JSON without non-semantic fields. */
function configId(config) {
  const { appVersion, caption, ...rest } = config;
  const canon = JSON.stringify(rest, Object.keys(flatKeys(rest)).sort());
  return crypto.createHash('sha1').update(canon).digest('hex').slice(0, 12);
}
function flatKeys(o, acc = {}) {
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { acc[k] = 1; flatKeys(o[k], acc); }
  return acc;
}

function createLibrary(root, { quotaBytes = 12 * 1024 ** 3 } = {}) {
  const videos = path.join(root, 'videos');
  const lockFile = path.join(root, 'studio.lock');
  let haveLock = false;

  const lib = {
    root, videos, quotaBytes,
    dir: (id) => path.join(videos, id),
    async ensure() { await fsp.mkdir(videos, { recursive: true }); },

    async lock(owner) {
      await lib.ensure();
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await fsp.writeFile(lockFile, JSON.stringify({ pid: process.pid, owner, at: new Date().toISOString() }), { flag: 'wx' });
          haveLock = true; return true;
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          let info = null;
          try { info = JSON.parse(await fsp.readFile(lockFile, 'utf8')); } catch { /* unreadable → stale */ }
          if (info && info.pid !== process.pid && pidAlive(info.pid)) {
            throw new Error(`Another Split Chamber Studio instance (${info.owner || 'app'}, pid ${info.pid}) is using this library.`);
          }
          await fsp.rm(lockFile, { force: true });     // stale lock from a crashed run
        }
      }
      throw new Error('Could not acquire the library lock.');
    },
    async unlock() { if (haveLock) { await fsp.rm(lockFile, { force: true }); haveLock = false; } },

    idFor: configId,

    async readStatus(id) {
      try { return JSON.parse(await fsp.readFile(path.join(lib.dir(id), 'status.json'), 'utf8')); } catch { return null; }
    },
    async writeStatus(id, status) {
      await fsp.mkdir(lib.dir(id), { recursive: true });
      status.updatedAt = new Date().toISOString();
      await atomicWrite(path.join(lib.dir(id), 'status.json'), JSON.stringify(status, null, 1));
      return status;
    },
    async update(id, patch) {
      const cur = (await lib.readStatus(id)) || { id };
      return lib.writeStatus(id, { ...cur, ...patch });
    },

    async list() {
      await lib.ensure();
      const out = [];
      for (const id of await fsp.readdir(videos)) {
        const s = await lib.readStatus(id);
        if (s) out.push(s);
      }
      out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      await atomicWrite(path.join(root, 'library.json'), JSON.stringify({ rebuiltAt: new Date().toISOString(), items: out.map((s) => ({ id: s.id, status: s.status, scenario: s.scenario, seed: s.seed })) }));
      return out;
    },

    /** Startup recovery: delete partial files; interrupted generations fail, interrupted masters fall back. */
    async recover() {
      await lib.ensure();
      const fixed = [];
      for (const id of await fsp.readdir(videos)) {
        const d = lib.dir(id);
        let st; try { st = await fsp.stat(d); } catch { continue; }
        if (!st.isDirectory()) continue;
        for (const f of await fsp.readdir(d)) if (PARTIAL.test(f)) { await fsp.rm(path.join(d, f), { force: true }); fixed.push(`${id}/${f}`); }
        const s = await lib.readStatus(id);
        if (!s) { fixed.push(`${id}: no status`); continue; }
        if (s.status === 'generating') { await lib.update(id, { status: 'failed', reasons: [...(s.reasons || []), 'interrupted'] }); fixed.push(`${id}: interrupted generation`); }
        if (s.status === 'mastering') { await lib.update(id, { status: 'candidate', note: 'master export was interrupted; accept again to retry' }); fixed.push(`${id}: interrupted master`); }
      }
      return fixed;
    },

    async usage() {
      let bytes = 0;
      const walk = async (d) => {
        for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p); else bytes += (await fsp.stat(p)).size;
        }
      };
      await walk(videos);
      return { bytes, quotaBytes: lib.quotaBytes, freeBytes: Math.max(0, lib.quotaBytes - bytes) };
    },

    async appendRejected(entry) {
      const file = path.join(root, 'rejected.jsonl');
      await fsp.appendFile(file, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
      const lines = (await fsp.readFile(file, 'utf8')).split('\n').filter(Boolean);
      if (lines.length > 5000) await atomicWrite(file, `${lines.slice(-4000).join('\n')}\n`);
    },

    /** Seeds already used for a scenario key (library + rejected log), for seed dedup. */
    async seenSeeds(scenarioKey) {
      const seen = new Set();
      for (const s of await lib.list()) if (s.scenario === scenarioKey) seen.add(s.seed);
      try {
        for (const l of (await fsp.readFile(path.join(root, 'rejected.jsonl'), 'utf8')).split('\n')) {
          if (!l) continue; const e = JSON.parse(l); if (e.scenario === scenarioKey) seen.add(e.seed);
        }
      } catch { /* none yet */ }
      return [...seen];
    },

    /** Delete media files, keeping status/config (reproducible later). */
    async removeMedia(id, which = null) {
      const d = lib.dir(id);
      for (const f of await fsp.readdir(d).catch(() => [])) {
        if (f === 'status.json' || f === 'config.json' || f === 'metrics.json') continue;
        if (which && !which.some((w) => f.startsWith(w))) continue;
        await fsp.rm(path.join(d, f), { recursive: true, force: true });
      }
    },

    async saveQueue(q) { await atomicWrite(path.join(root, 'queue.json'), JSON.stringify(q)); },
    async loadQueue() { try { return JSON.parse(await fsp.readFile(path.join(root, 'queue.json'), 'utf8')); } catch { return null; } },
    async clearQueue() { await fsp.rm(path.join(root, 'queue.json'), { force: true }); },
  };
  return lib;
}

module.exports = { createLibrary, configId, atomicWrite };
