// UI controller: Play (live simulation, no encoding), Replay (from session data), Export (offline).
import { W, H, FPS } from '../core/constants.js';
import { encodeFrame, makeMeta, serializeSession, parseSession, hashFrames } from '../sim/session.js';
import { createRenderer } from '../render/factory.js';
import { getScenario, configOf, DEFAULT_SCENARIO, listedScenarios } from '../scenarios/index.js';
import { applyControls } from '../scenarios/controls.js';
import { createLegacySim } from '../scenarios/split-chamber.js';
import { createStudio } from './studio.js';
import { Pipeline } from '../pipeline/pipeline.js';
import { Synth, frameEvents, renderSoundtrack } from '../audio/synth.js';
import { startExport, ENGINES } from '../export/exporter.js';

const $ = (id) => document.getElementById(id);
const host = window.host;
const canvas = $('stage');
const ctx = canvas.getContext('2d', { alpha: false });
let renderer = null;

const state = {
  mode: 'menu',          // menu | play | replay | ended | export
  paused: false,
  session: null,         // { meta, frames, complete, saved, path }
  keep: true,
  worker: null,
  clockStart: 0,         // performance.now() at frame 0
  pausedAt: 0,
  shown: -1,
  audio: null, synth: null,
  exportJob: null,
};
let info = null;

// ------------------------------------------------------------ layout
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const k = Math.min(vw / W, vh / H);
  const cw = Math.floor(W * k), ch = Math.floor(H * k);
  const wrap = $('wrap');
  wrap.style.width = `${cw}px`; wrap.style.height = `${ch}px`;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.min(W, Math.round(cw * dpr));
  const bh = Math.round(bw * H / W);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw; canvas.height = bh;
    if (renderer) renderer.setScale(bw / W); else renderer = createRenderer(configOf(null), ctx, bw / W);
    redraw();
  }
}
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(layout, 60); });

let rendererKey = '';
function useRendererFor(config) {
  const key = JSON.stringify(config.render || {});
  if (renderer && key === rendererKey) return;
  rendererKey = key;
  renderer = createRenderer(config, ctx, canvas.width / W);
}

function redraw() {
  if (state.session && state.shown >= 0 && state.session.frames[state.shown]) renderer.draw(state.session, state.shown);
}

// ------------------------------------------------------------ panels
const panels = ['menu', 'paused', 'end', 'export'];
function show(id) { for (const p of panels) $(p).classList.toggle('hidden', p !== id); }
function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms);
}
function hud(on) {
  $('hud').classList.toggle('hidden', !on);
  $('hud-session').classList.toggle('hidden', !state.keep || state.mode === 'replay');
  $('hud').classList.remove('quiet');
  clearTimeout(hud.t); hud.t = setTimeout(() => $('hud').classList.add('quiet'), 3500);
}

// ------------------------------------------------------------ audio
function ensureAudio() {
  if (!state.audio) {
    state.audio = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    state.synth = new Synth(state.audio);
  }
  if (state.audio.state === 'suspended') state.audio.resume();
}

// ------------------------------------------------------------ play
function newSeed() {
  const v = $('opt-seed').value.trim();
  if (/^\d+$/.test(v)) return Number(v) >>> 0;
  return crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
}

function play(seed = newSeed()) {
  state.watch = null; $('hud-live').classList.add('hidden');
  playConfig(applyControls(getScenario(state.scenarioKey || DEFAULT_SCENARIO).generate(seed), {}), $('opt-keep').checked);
}

/** Watch the video the factory is making right now: the same config, simulated again here in real time
 *  (deterministic, so it is frame-for-frame the video being rendered). Follows the batch to the next video. */
function watchLive(ev, open) {
  if (!open && !state.watch) return;
  if (state.watch && state.watch.id === ev.id && state.mode === 'play') return;
  state.watch = ev;
  $('studio').classList.add('hidden');
  const b = ev.batch;
  $('hud-live').textContent = `${String(ev.id).startsWith('play-') ? '▶ REPLAY' : '● LIVE'} · ${b ? `video ${b.index + 1} of ${b.total} · ` : ''}${ev.label} · seed ${ev.seed}`;
  $('hud-live').classList.remove('hidden');
  playConfig(ev.config, false);
}

function playConfig(config, keep) {
  const seed = config.seed;
  stopWorker();
  ensureAudio();
  state.keep = keep;
  useRendererFor(config);
  state.session = { meta: { seed, capFrame: -1, outroFrame: -1, endFrame: -1, frameCount: -1, scenario: config.scenario, config }, frames: [], complete: false, saved: false };
  const w = new Worker(new URL('../sim/sim.worker.js', import.meta.url), { type: 'module' });
  state.worker = w;
  w.onmessage = (e) => {
    const m = e.data, s = state.session;
    if (w !== state.worker) return;
    if (m.type === 'frame') s.frames[m.index] = m.buf;
    else if (m.type === 'meta') Object.assign(s.meta, m.meta, { frameCount: -1 });
    else if (m.type === 'done') { s.meta = m.meta; s.complete = true; host.log('sim done', { seed, frames: m.meta.frameCount, simMs: Math.round(m.simMs) }); }
    else if (m.type === 'error') { toast(`Simulation error: ${m.message}`); host.log('sim error', m.message); }
  };
  w.postMessage({ type: 'start', config });
  startClock('play');
}

function replay() {
  if (!state.session || !state.session.complete) return;
  ensureAudio();
  startClock('replay');
}

function startClock(mode) {
  Object.assign(stats, { drawn: 0, holds: 0, skipped: 0, startedAt: 0, lastAt: 0, worstGap: 0 });
  state.mode = mode; state.paused = false; state.shown = -1;
  state.clockStart = performance.now() + 120; // tiny lead-in
  show(null); hud(true);
}

function stopWorker() {
  if (state.worker) { state.worker.postMessage({ type: 'stop' }); state.worker.terminate(); state.worker = null; }
}

function pause(on) {
  if (state.mode !== 'play' && state.mode !== 'replay') return;
  if (on === state.paused) return;
  state.paused = on;
  if (on) { state.pausedAt = performance.now(); state.audio && state.audio.suspend(); show('paused'); }
  else { state.clockStart += performance.now() - state.pausedAt; state.audio && state.audio.resume(); show(null); hud(true); }
}

function toMenu() {
  if (state.watch) { toStudio(); return; }
  stopWorker();
  state.mode = 'menu'; state.paused = false;
  if (state.audio) state.audio.suspend();
  $('hud').classList.add('hidden');
  show('menu');
}

const stats = { drawn: 0, holds: 0, startedAt: 0, lastAt: 0, worstGap: 0 };
function tick(now) {
  requestAnimationFrame(tick);
  if ((state.mode !== 'play' && state.mode !== 'replay') || state.paused) return;
  const s = state.session;
  const avail = contiguous(s);
  if (avail === 0) { state.clockStart = now + 50; return; }
  let target = Math.floor((now - state.clockStart) / 1000 * FPS);
  if (target < 0) return;
  if (target >= avail) {
    if (s.complete && avail === s.frames.length) target = avail - 1;
    else { target = avail - 1; state.clockStart = now - target / FPS * 1000; stats.holds++; } // sim behind: hold, never skip
  }
  if (target !== state.shown) {
    // sounds for frames since last draw (bounded catch-up)
    const from = Math.max(state.shown + 1, target - 3);
    const when = state.audio.currentTime + 0.005;
    for (let f = from; f <= target; f++) state.synth.frame(frameEvents(s.frames[f]), f, when);
    renderer.draw(s, target);
    if (target > state.shown + 1 && state.shown >= 0) stats.skipped = (stats.skipped || 0) + (target - state.shown - 1);
    state.shown = target;
    if (!stats.drawn) stats.startedAt = now; else stats.worstGap = Math.max(stats.worstGap, now - stats.lastAt);
    stats.drawn++; stats.lastAt = now;
    if (!state.keep && state.mode === 'play') for (let f = target - 40; f >= 0 && s.frames[f]; f--) s.frames[f] = null;
  }
  if (s.complete && target >= s.frames.length - 1) finish();
}

function contiguous(s) {
  if (s.complete) return s.frames.length;
  let n = s.frames.length;
  while (n > 0 && !s.frames[n - 1]) n--; // frames arrive in order; guard anyway
  return n;
}

async function finish() {
  const s = state.session;
  const wasPlay = state.mode === 'play';
  state.mode = 'ended';
  stopWorker();
  $('hud').classList.add('hidden');
  const exportable = s.frames.every(Boolean);
  $('end-title').textContent = state.keep || !wasPlay ? 'Session complete' : 'Run complete';
  const capS = s.meta.capFrame >= 0 ? (s.meta.capFrame / FPS).toFixed(1) : '—';
  $('end-sub').textContent = `Peak reached in ${capS} s · seed ${s.meta.seed} · ${(s.frames.length / FPS).toFixed(1)} s video`;
  $('btn-export').classList.toggle('hidden', !exportable);
  $('btn-replay').classList.toggle('hidden', !exportable);
  $('btn-save').classList.add('hidden');
  $('end-session').textContent = exportable ? '' : 'Session was not kept (turn on "Keep session" in the menu to export).';
  if (state.watch) {
    $('end-title').textContent = 'Live video finished';
    $('end-session').textContent = 'The factory is checking this video. When it starts the next one, this view follows it automatically.';
  }
  $('btn-again').classList.toggle('hidden', !!state.watch);
  $('btn-menu2').textContent = state.watch ? '← Back to Studio' : 'Main menu';
  show('end');
  if (exportable && wasPlay && !s.saved) await saveSession();
}

async function saveSession() {
  const s = state.session;
  try {
    const buf = serializeSession(s.meta, s.frames);
    const r = await host.saveSession(buf, s.meta);
    s.saved = true; s.path = r.path;
    $('end-session').textContent = `Session saved: ${r.path}`;
  } catch (e) {
    $('btn-save').classList.remove('hidden');
    $('end-session').textContent = `Could not save session: ${e.message}`;
  }
}

async function openSession(file) {
  try {
    const r = await host.openSession(typeof file === 'string' ? file : undefined);
    if (!r) return;
    const parsed = parseSession(r.buffer);
    stopWorker();
    state.session = { ...parsed, complete: true, saved: true, path: r.path };
    useRendererFor(configOf(parsed.meta));
    state.keep = true;
    state.shown = parsed.frames.length - 1;
    renderer.draw(state.session, state.shown);
    state.mode = 'ended';
    $('end-title').textContent = 'Session loaded';
    $('end-sub').textContent = `seed ${parsed.meta.seed} · ${(parsed.frames.length / FPS).toFixed(1)} s · recorded ${new Date(parsed.meta.createdAt).toLocaleString()}`;
    $('btn-export').classList.remove('hidden'); $('btn-replay').classList.remove('hidden'); $('btn-save').classList.add('hidden');
    $('end-session').textContent = r.path;
    show('end');
  } catch (e) { toast(`Could not open session: ${e.message}`, 5000); }
}

// ------------------------------------------------------------ export
function doExport() {
  const s = state.session;
  if (!s || !s.complete) return;
  state.mode = 'export';
  if (state.audio) state.audio.suspend();
  $('ex-title').textContent = 'Exporting video';
  $('ex-result').classList.add('hidden'); $('ex-error').classList.add('hidden');
  $('btn-ex-cancel').classList.remove('hidden'); $('btn-ex-done').classList.add('hidden');
  $('ex-bar').style.width = '0%'; $('ex-stats').textContent = ''; $('ex-stage').textContent = 'Preparing…';
  show('export');
  const engine = $('opt-engine').value;
  const job = startExport(s, {
    engine, bitrateMbps: Number($('opt-bitrate').value),
    onProgress: (p) => {
      if (p.stage === 'audio') $('ex-stage').textContent = 'Rendering soundtrack…';
      else if (p.stage === 'verify') { $('ex-stage').textContent = 'Finalising and verifying with ffprobe…'; $('ex-bar').style.width = '100%'; }
      else {
        $('ex-stage').textContent = `Rendering frames · ${ENGINES[p.engine].label}`;
        $('ex-bar').style.width = `${(p.frame / p.total * 100).toFixed(1)}%`;
        const eta = (p.total - p.frame) / Math.max(p.fps, 0.1);
        $('ex-stats').textContent = `Frame ${p.frame.toLocaleString()} / ${p.total.toLocaleString()} · ${p.fps.toFixed(0)} fps · ${eta < 1 ? '<1' : Math.round(eta)} s left`;
      }
    },
  });
  state.exportJob = job;
  job.promise.then((r) => {
    const v = r.verify.summary;
    $('ex-title').textContent = 'Video ready';
    $('ex-stage').textContent = ''; $('ex-stats').textContent = '';
    $('ex-path').textContent = r.path;
    $('ex-summary').innerHTML = '';
    for (const line of [
      `${v.width} × ${v.height} · ${eval_fps(v.fps)} fps · ${v.frames.toLocaleString()} frames · ${v.duration.toFixed(2)} s`,
      `${v.videoCodec} · ${v.bitrateMbps} Mbps · ${v.sizeMB} MB`,
      `Audio: ${v.audio}`,
      `Encoder: ${r.engineLabel} · ${r.seconds.toFixed(1)} s`,
    ]) { const li = document.createElement('li'); li.textContent = line; $('ex-summary').appendChild(li); }
    $('ex-result').classList.remove('hidden');
    $('btn-ex-cancel').classList.add('hidden'); $('btn-ex-done').classList.remove('hidden');
    $('btn-show').onclick = () => host.show(r.path);
  }).catch((e) => {
    $('ex-title').textContent = e.message === 'Export cancelled.' ? 'Export cancelled' : 'Export failed';
    $('ex-stage').textContent = 'No video was saved. Your session is kept, so you can try again.';
    if (e.message !== 'Export cancelled.') { $('ex-error').textContent = e.message; $('ex-error').classList.remove('hidden'); }
    $('btn-ex-cancel').classList.add('hidden'); $('btn-ex-done').classList.remove('hidden');
  }).finally(() => { state.exportJob = null; });
}
const eval_fps = (r) => { const [a, b] = String(r).split('/').map(Number); return b ? +(a / b).toFixed(3) : r; };

// ------------------------------------------------------------ wiring
$('btn-play').onclick = () => play();
$('btn-open').onclick = openSession;
$('btn-folder').onclick = () => host.show(null);
// Exit from live play returns to the Studio home (the app itself closes with the window's X).
function toStudio() { state.watch = null; $('hud-live').classList.add('hidden'); $('btn-again').classList.remove('hidden'); $('btn-menu2').textContent = 'Main menu'; stopWorker(); state.mode = 'menu'; if (state.audio) state.audio.suspend(); show(null); $('hud').classList.add('hidden'); if (studio) studio.show(); else host.quit(); }
$('btn-exit').onclick = toStudio;
const PATTERN_DESC = {
  'split-chamber': 'One ball. Four solid presses. Every squeeze splits it — until the chamber is full.',
  'laser-cross': 'A rotating laser splits everything it touches; balls pile up on fixed wedges.',
  'orbit-crusher': 'Balls are pulled to the centre while two blades turn in opposite directions and cut like scissors.',
  'rotary-sweeper': 'A rotating arm sweeps colliding balls against wedges until the glass rim breaks.',
  jaws: 'V-shaped jaws on a hub open, close and turn — every bite splits what it catches.',
  rams: 'Two pendulum rams swing a little faster with every strike.',
  kaleidoscope: 'Triangles contract into a mandala and release.',
  walls: 'Two walls slide in and squeeze everything between them.',
};
{
  const sel = $('opt-pattern');
  for (const sc of listedScenarios()) { const o = document.createElement('option'); o.value = sc.key; o.textContent = sc.label; sel.appendChild(o); }
  sel.value = DEFAULT_SCENARIO;
  sel.onchange = () => {
    state.scenarioKey = sel.value;
    const sc = getScenario(sel.value);
    $('menu-desc').textContent = PATTERN_DESC[sc.id] || '';
    document.querySelector('#menu .brand h1').textContent = sc.label;
  };
}
$('btn-resume').onclick = () => pause(false);
$('btn-restart').onclick = () => play();
$('btn-menu1').onclick = toMenu;
$('btn-menu2').onclick = toMenu;
$('btn-export').onclick = doExport;
$('btn-replay').onclick = replay;
$('btn-again').onclick = () => play();
$('btn-save').onclick = saveSession;
$('btn-ex-cancel').onclick = () => state.exportJob && state.exportJob.cancel();
$('btn-ex-done').onclick = () => { state.mode = 'ended'; show('end'); };

// touch screens: a tap on the picture pauses / resumes (the paused panel has Restart and Main menu)
$('stage').addEventListener('click', () => {
  if (!$('studio').classList.contains('hidden')) return;
  if ((state.mode === 'play' || state.mode === 'replay') && !state.paused) pause(true);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (!$('studio').classList.contains('hidden')) return; // the Studio home has its own shortcuts
  const playing = state.mode === 'play' || state.mode === 'replay';
  if (e.code === 'Space') { e.preventDefault(); if (playing) pause(!state.paused); else if (state.mode === 'menu') play(); }
  else if (e.code === 'KeyR' && !state.watch && (playing || state.mode === 'ended')) play();
  else if (e.code === 'Escape') { if (playing && !state.paused) pause(true); else if (state.mode === 'menu') toStudio(); else if (state.mode !== 'export') toMenu(); }
  else if (e.code === 'KeyF') host.fullscreen();
  else if (e.code === 'KeyE' && state.mode === 'ended' && !$('btn-export').classList.contains('hidden')) doExport();
});
window.addEventListener('beforeunload', () => { if (state.exportJob) state.exportJob.cancel(); });

// ------------------------------------------------------------ boot
let studio = null;

/** Headless batch: electron . --generate=N [--pattern=key|random] [--captions=en|ar|none] [--seeds=1,2] [--accept-all] */
async function runCli(cli, debug) {
  const pipeline = new Pipeline({ debug, onEvent: (ev) => { if (ev.type !== 'stage') host.log('cli', JSON.stringify(ev.type === 'item' ? { id: ev.status.id, status: ev.status.status, reasons: ev.status.reasons } : ev)); } });
  const results = await pipeline.runBatch({ count: cli.generate, pattern: cli.pattern, captions: cli.captions, seeds: cli.seeds, acceptAll: cli.accept, owner: 'cli' });
  const brief = results.map((r) => ({ id: r.id, status: r.status, scenario: r.scenario, seed: r.seed, reasons: r.reasons, error: r.error, durationS: r.durationS }));
  await host.studio.cliDone({ ok: results.length > 0 && results.every((r) => r.status !== 'failed'), results: brief });
}

async function boot() {
  info = await host.info();
  layout();
  // idle picture behind the menu: frame 0 of a fresh simulation
  const sim = createLegacySim(7); sim.step();
  state.session = { meta: makeMeta(sim, 1), frames: [encodeFrame(sim)], complete: true, saved: true };
  state.shown = 0; redraw();
  state.session = null;
  if (info.cleaned) toast(`Removed ${info.cleaned} incomplete export file(s) from a previous run.`);
  requestAnimationFrame(tick);
  if (!info.bench && !info.gate) {
    const sinfo = await host.studio.info();
    if (sinfo.cli) { runCli(sinfo.cli, sinfo.debug).catch((e) => host.studio.cliDone({ ok: false, error: e.message })); return; }
    studio = createStudio({ onLivePlay: () => { state.mode = 'menu'; show('menu'); }, onWatch: watchLive, toast,
      onPlayConfig: (config, it) => watchLive({ id: `play-${it.id}`, config, label: it.label || it.scenario, seed: it.seed, batch: null }, true) });
    show(null);
    await studio.init();
    studio.show();
  }
  if (info.bench) bench(info.bench).catch((e) => { host.log('bench failed', e.message); host.quit(); });
  if (info.gate) runGate(info.gate).catch((e) => host.gateDone({ ok: false, summary: `gate crashed: ${e.message}` }));
}
boot();
// hooks for automated tests (read-only state + opening a session file without the native dialog)
window.__splitChamber = { state, stats, openSession, renderer: () => renderer && renderer.backend };

// ------------------------------------------------------------ determinism gate (electron . --gate)
async function runGate(opts) {
  const { compareGate } = await import('../sim/gate.js');
  const { runs, goldens } = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('../sim/gate.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { w.terminate(); if (e.data.type === 'done') resolve(e.data); else reject(new Error(e.data.message)); };
    w.postMessage('go');
  });
  if (opts.capture) {
    const seeds = runs.map(({ seed, frames, raw, rng }) => ({ seed, frames, raw, rng }));
    await host.benchWrite(`${info.root}/baseline/v1/${opts.raw}`, JSON.stringify({ createdAt: new Date().toISOString(), runtime: navigator.userAgent, seeds }));
    return host.gateDone({ ok: true, summary: `captured ${opts.raw}` });
  }
  if (opts.captureGoldens) {
    for (const g of goldens) {
      await host.benchWrite(`${info.root}/baseline/goldens/${g.key}.json`,
        JSON.stringify({ key: g.key, createdAt: new Date().toISOString(), runtime: navigator.userAgent, seeds: g.seeds }));
    }
    return host.gateDone({ ok: true, summary: `captured goldens ${goldens.map((g) => g.key).join(', ')}` });
  }
  const [base, raw] = await Promise.all(['sim.json', opts.raw].map((f) => fetch(`../baseline/v1/${f}`).then((r) => r.json())));
  const results = base.seeds.map((b) => {
    const r = runs.find((x) => x.seed === b.seed);
    return { seed: b.seed, hash: r.hash, problem: compareGate(b, r, raw.seeds.find((s) => s.seed === b.seed)) };
  });
  for (const g of goldens) {
    const base = await fetch(`../baseline/goldens/${g.key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    for (const run of g.seeds) {
      const b = base && base.seeds.find((x) => x.seed === run.seed);
      results.push({ seed: `${g.key}#${run.seed}`, hash: run.hash, problem: b ? compareGate(b, run, b) : 'no golden file' });
    }
  }
  const ok = results.every((r) => !r.problem);
  await host.gateDone({ ok, runtime: navigator.userAgent, results, summary: results.map((r) => `${r.seed}:${r.problem || 'OK'}`).join(' ') });
}

// ------------------------------------------------------------ benchmark (electron . --bench)
function simulateInWorker(seed, key = 'split-chamber@1') {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../sim/sim.worker.js', import.meta.url), { type: 'module' });
    const frames = [];
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'frame') frames[m.index] = m.buf;
      else if (m.type === 'done') { w.terminate(); resolve({ meta: m.meta, frames, complete: true, simMs: m.simMs }); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.postMessage({ type: 'start', config: getScenario(key).generate(seed) });
  });
}

async function bench({ seed, out, engines: engineList, bitrate, scenario }) {
  const outDir = out || `${info.videos}\\bench`;
  const results = { seed, scenario, startedAt: new Date().toISOString(), engines: {} };
  const a = await simulateInWorker(seed, scenario);
  const b = await simulateInWorker(seed, scenario);
  results.sim = { frames: a.frames.length, capFrame: a.meta.capFrame, simMs: Math.round(a.simMs), hashA: hashFrames(a.frames), hashB: hashFrames(b.frames) };
  results.sim.deterministic = results.sim.hashA === results.sim.hashB;
  // session round-trip through the file format
  const rt = parseSession(serializeSession(a.meta, a.frames));
  results.sim.fileRoundTrip = hashFrames(rt.frames) === results.sim.hashA;
  // play-mode render cost at preview resolution and at 1080x1920
  results.render = {};
  for (const [sc, gpu] of [[renderer.scale, true], [1, true], [1, false]]) {
    const cv = new OffscreenCanvas(Math.round(W * sc), Math.round(H * sc));
    const r = createRenderer(configOf(a.meta), cv.getContext('2d', { alpha: false }), sc, { gpu });
    const tag = `${r.backend}_${sc.toFixed(3)}`;
    const times = [];
    r.timing = {};
    for (let f = 0; f < a.frames.length; f += 3) { const t = performance.now(); r.draw(a, f); times.push(performance.now() - t); }
    // force GPU flush so queued work is counted
    const t1 = performance.now(); cv.getContext('2d').getImageData(0, 0, 1, 1); const flush = performance.now() - t1;
    const n = Math.ceil(a.frames.length / 3);
    results.render[`sections_${tag}`] = Object.fromEntries(Object.entries(r.timing).map(([k, v]) => [k, +(v / n).toFixed(2)]));
    results.render[`flush_${tag}`] = +flush.toFixed(1);
    times.sort((x, y) => x - y);
    results.render[`frame_${tag}`] = { p50: +times[times.length >> 1].toFixed(2), p95: +times[Math.floor(times.length * 0.95)].toFixed(2), max: +times[times.length - 1].toFixed(2) };
  }
  if (engineList === 'none') { await host.benchWrite(`${outDir}/results.json`, JSON.stringify(results, null, 2)); host.quit(); return; }
  const audioBuffer = await renderSoundtrack(a);
  const pngFrames = [0, 60, 300, 480, 600, 720, 840, 960, a.meta.capFrame, a.meta.capFrame + 30, a.meta.outroFrame + 60, a.frames.length - 1];
  const engines = (engineList || 'ff-lossless,mb-hw,mb-sw,ff-hw,ff-x264').split(',');
  for (const [i, key] of engines.entries()) {
    const t = performance.now();
    try {
      const job = startExport(a, { engine: key, audioBuffer, bitrateMbps: bitrate || undefined, finalPath: `${outDir}\\bench_${key}.mp4`, pngFrames: i === 0 ? pngFrames : null, pngDir: `${outDir}\\truth`,
        onProgress: (p) => { if (p.stage === 'video' && p.frame % 150 === 0) host.log('bench progress', key, p.frame, p.fps.toFixed(1)); } });
      const r = await job.promise;
      results.engines[key] = { ok: true, wallSeconds: +((performance.now() - t) / 1000).toFixed(2), renderSeconds: +r.renderSeconds.toFixed(2), label: r.engineLabel, encoderConfig: r.encoderConfig, verify: r.verify.summary, path: r.path };
    } catch (e) {
      results.engines[key] = { ok: false, error: e.message, wallSeconds: +((performance.now() - t) / 1000).toFixed(2) };
    }
    host.log('bench', key, results.engines[key]);
  }
  results.pngFrames = pngFrames;
  await host.benchWrite(`${outDir}\\results.json`, JSON.stringify(results, null, 2));
  host.quit();
}
