// Compact per-frame snapshot format + session file container.
// A session is everything needed to render/replay/export without re-running the simulation.
import { FPS, W, H, SIM_VERSION } from './config.js';

export const POS_SCALE = 32; // 1/32 px precision

/** Encode the simulation's current state (after step()) into a standalone ArrayBuffer. */
export function encodeFrame(sim) {
  const n = sim.count, m = sim.splits.length / 3;
  const size = align4(16 + 4 * n + 4 * m + 2 * n + m);
  const buf = new ArrayBuffer(size);
  const hdr = new Uint32Array(buf, 0, 4);
  hdr[0] = n; hdr[1] = m; hdr[2] = sim.flags; hdr[3] = sim.crushed;
  const xy = new Uint16Array(buf, 16, 2 * n);
  for (let i = 0; i < n; i++) {
    xy[2 * i] = q(sim.x[i]); xy[2 * i + 1] = q(sim.y[i]);
  }
  const sxy = new Uint16Array(buf, 16 + 4 * n, 2 * m);
  const bytes = new Uint8Array(buf);
  const colOff = 16 + 4 * n + 4 * m;
  bytes.set(sim.col.subarray(0, n), colOff);
  const ageOff = colOff + n;
  for (let i = 0; i < n; i++) bytes[ageOff + i] = sim.age[i] > 255 ? 255 : sim.age[i];
  const scolOff = ageOff + n;
  const s = sim.splits;
  for (let k = 0; k < m; k++) {
    sxy[2 * k] = q(s[3 * k]); sxy[2 * k + 1] = q(s[3 * k + 1]); bytes[scolOff + k] = s[3 * k + 2];
  }
  return buf;
}

/** Zero-copy views into an encoded frame. */
export function decodeFrame(buf) {
  const hdr = new Uint32Array(buf, 0, 4);
  const n = hdr[0], m = hdr[1];
  const colOff = 16 + 4 * n + 4 * m;
  return {
    n, m, flags: hdr[2], crushed: hdr[3],
    xy: new Uint16Array(buf, 16, 2 * n),
    sxy: new Uint16Array(buf, 16 + 4 * n, 2 * m),
    col: new Uint8Array(buf, colOff, n),
    age: new Uint8Array(buf, colOff + n, n),
    scol: new Uint8Array(buf, colOff + 2 * n, m),
  };
}

export function makeMeta(sim, frameCount) {
  return {
    app: 'split-chamber', simVersion: SIM_VERSION, seed: sim.seed,
    fps: FPS, width: W, height: H, frameCount,
    capFrame: sim.capFrame, outroFrame: sim.outroFrame, endFrame: sim.endFrame,
    createdAt: new Date().toISOString(),
  };
}

const MAGIC = 0x53484353; // 'SCHS' little-endian

/** Serialize a session into one ArrayBuffer (uncompressed; the main process gzips it). */
export function serializeSession(meta, frames) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const head = align4(12 + metaBytes.length);
  const table = 4 + 4 * (frames.length + 1);
  let total = head + table;
  for (const f of frames) total += f.byteLength;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, 1, true); dv.setUint32(8, metaBytes.length, true);
  new Uint8Array(out, 12, metaBytes.length).set(metaBytes);
  dv.setUint32(head, frames.length, true);
  let off = head + table;
  const bytes = new Uint8Array(out);
  for (let i = 0; i < frames.length; i++) {
    dv.setUint32(head + 4 + 4 * i, off, true);
    bytes.set(new Uint8Array(frames[i]), off);
    off += frames[i].byteLength;
  }
  dv.setUint32(head + 4 + 4 * frames.length, off, true);
  return out;
}

export function parseSession(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Not a Split Chamber session file.');
  if (dv.getUint32(4, true) !== 1) throw new Error('Unsupported session file version.');
  const metaLen = dv.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen)));
  const head = align4(12 + metaLen);
  const count = dv.getUint32(head, true);
  if (count !== meta.frameCount) throw new Error('Session file is corrupt (frame count mismatch).');
  const frames = new Array(count);
  for (let i = 0; i < count; i++) {
    const a = dv.getUint32(head + 4 + 4 * i, true), b = dv.getUint32(head + 8 + 4 * i, true);
    if (b > buffer.byteLength || a > b) throw new Error('Session file is truncated.');
    frames[i] = buffer.slice(a, b);
  }
  return { meta, frames };
}

/** FNV-1a 32-bit over all frame bytes; used to prove determinism. */
export function hashFrames(frames) {
  let h = 0x811c9dc5;
  for (const f of frames) {
    const b = new Uint8Array(f);
    for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function q(v) { const k = Math.round(v * POS_SCALE); return k < 0 ? 0 : k > 65535 ? 65535 : k; }
function align4(n) { return (n + 3) & ~3; }

/** FNV-1a 32-bit of one encoded frame as a number (per-frame state hash, ARCHITECTURE §5.1). */
export function frameHash32(buf) {
  const b = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
