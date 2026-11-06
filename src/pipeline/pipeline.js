// Production pipeline (renderer process): Generate → Simulate (headless) → Check → Audio → Preview → Duplicate
// check → candidate; Accept → verified master. The main process owns all disk writes (library IPC).
import { FPS } from '../core/constants.js';
import { getScenario, listedScenarios } from '../scenarios/index.js';
import { applyControls } from '../scenarios/controls.js';
import { metaFromSummary } from '../sim/run.js';
import { renderSoundtrackFor } from '../audio/synth.js';
import { startExport, AUTO_ORDER } from '../export/exporter.js';
import { captionFor } from '../render/captions.js';
import { rand } from '../engine/rng.js';
import { explainRun, explainAudio, explainVideo, explainDuplicate, checkQuality, checkAudio, curveDescriptor, findDuplicate, score, scoreParts } from './checks.js';

export const APP_VERSION = '2.5.0';   // keep equal to package.json (unit test)
export const PREVIEW = { scale: 0.5, bitrateMbps: 4 };
export const MASTER = { scale: 1, bitrateMbps: 50 };
const TRUTH_FRAMES = (n) => [Math.floor(n * 0.08), Math.floor(n * 0.3), Math.floor(n * 0.5), Math.floor(n * 0.65), Math.floor(n * 0.8), n - 2];

const S = () => window.host.studio;
const b64 = (u32) => { const b = new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new Uint32Array(b.buffer); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function runHeadlessInWorker(config, onProgress) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./headless.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress && onProgress(m.frame);
      else { w.terminate(); if (m.type === 'done') resolve(m.summary); else reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'headless worker crashed')); };
    w.postMessage({ config });
  });
}

export class Pipeline {
  constructor({ onEvent = () => {}, debug = {} } = {}) {
    this.emit = onEvent; this.debug = debug;
    this.cancelled = false; this.current = null; this.paused = false;
  }

  cancel() { this.cancelled = true; if (this.current) this.current.cancel(); }

  stage(id, stage, extra = {}) { this.emit({ type: 'stage', id, stage, ...extra }); }

  async waitForPower(settings) {
    if (!settings.pauseOnBattery) return;
    let warned = false;
    while (!this.cancelled && (await S().powerState()).onBattery) {
      if (!warned) { this.emit({ type: 'paused', reason: 'On battery power — the batch resumes when you plug in the charger.' }); warned = true; }
      await sleep(5000);
    }
    if (warned) this.emit({ type: 'resumed' });
  }

  /** Runs a batch. opts: { count, pattern ('random' | scenario key), captions, seeds?, acceptAll?, owner } */
  async runBatch(opts) {
    const info = await S().info();
    const settings = info.settings;
    await S().lock(opts.owner || 'ui');
    await S().powerBlock(true);
    const results = [];
    const batchSeed = (Date.now() >>> 0) ^ 0x5eed;
    const started = new Date();
    const batch = { id: `b${started.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`, startedAt: started.toISOString(), total: opts.count, pattern: opts.pattern || 'random', captions: opts.captions || 'none', controls: opts.controls || null };
    this.batch = batch;
    this.emit({ type: 'batch-start', batch });
    try {
      await S().queue('save', { ...opts, done: 0, startedAt: new Date().toISOString() });
      for (let i = 0; i < opts.count && !this.cancelled; i++) {
        await this.waitForPower(settings);
        if (this.cancelled) break;
        const key = opts.pattern && opts.pattern !== 'random' ? opts.pattern
          : listedScenarios()[Math.floor(rand(batchSeed, i, 0, 1) * listedScenarios().length)].key;
        const seed = opts.seeds && opts.seeds[i] != null ? opts.seeds[i] : await this.freshSeed(key);
        this.emit({ type: 'batch', index: i, total: opts.count, scenario: key, seed });
        let st;
        try {
          st = await this.generateOne({ scenarioKey: key, seed, captions: opts.captions || 'none', batch: { ...batch, index: i }, controls: opts.controls });
          if (st.status === 'candidate' && (opts.acceptAll || (opts.autoAcceptScore != null && st.score >= opts.autoAcceptScore))) st = await this.accept(st.id);
        } catch (e) {
          if (this.cancelled) break;
          st = { status: 'failed', error: e.message };
          if (/quota/i.test(e.message)) { results.push(st); this.emit({ type: 'stopped', reason: e.message }); break; }
        }
        results.push(st);
        await S().queue('save', { ...opts, done: i + 1 });
      }
    } finally {
      await S().queue('clear');
      await S().powerBlock(false);
      await S().unlock();
    }
    this.batch = null;
    this.emit({ type: 'batch-done', results, batch });
    return results;
  }

  async freshSeed(key) {
    const seen = new Set(await S().seenSeeds(key));
    for (;;) { const s = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000; if (!seen.has(s)) return s; }
  }

  async quotaCheck(bytesNeeded, what) {
    const u = await S().usage();
    if (u.bytes + bytesNeeded > u.quotaBytes) {
      throw new Error(`Library quota reached: ${(u.bytes / 1e9).toFixed(2)} of ${(u.quotaBytes / 1e9).toFixed(2)} GB used, ${what} needs about ${(bytesNeeded / 1e6).toFixed(0)} MB. Delete masters you no longer need (they can be re-rendered).`);
    }
  }

  /** One candidate. Returns its status object (candidate | rejected | failed). */
  async generateOne({ scenarioKey, seed, captions, batch = null, controls = null }) {
    const sc = getScenario(scenarioKey);
    const config = applyControls(sc.generate(seed), controls || {});
    const id = await S().id(config);
    const existing = await S().get(id);
    if (existing && (existing.status === 'candidate' || existing.status === 'accepted')) return { ...existing, duplicateOf: id };
    const caption = captionFor(config, captions);
    const t0 = performance.now();
    const status = {
      id, status: 'generating', scenario: scenarioKey, label: sc.label, seed, caption,
      createdAt: new Date().toISOString(), appVersion: APP_VERSION, versions: config.versions, reasons: [],
      ...(batch ? { batch } : {}), ...(config.controls ? { controls: config.controls } : {}),
    };
    this.emit({ type: 'config', id, config, scenario: scenarioKey, label: sc.label, seed, batch });
    await S().writeStatus(id, status);
    await S().writeFile(id, 'config.json', JSON.stringify(config, null, 1));
    try {
      return await this.generateBody(id, sc, config, scenarioKey, seed, caption, t0);
    } catch (e) {
      this.current = null;
      await S().removeMedia(id).catch(() => {});
      const st = await S().update(id, { status: 'failed', reasons: [this.cancelled ? 'cancelled' : e.message.split('\n')[0]] });
      this.emit({ type: 'item', status: st });
      throw e;
    }
  }

  async generateBody(id, sc, config, scenarioKey, seed, caption, t0) {
    const checks = [];
    const reject = async (reasons, stage) => {
      await S().removeMedia(id);
      const st = await S().update(id, { status: 'rejected', reasons, rejectedAt: stage, checks, timings: { totalS: (performance.now() - t0) / 1000 } });
      await S().rejectLog({ scenario: scenarioKey, seed, id, reasons, auto: true });
      this.emit({ type: 'item', status: st });
      return st;
    };

    // 2. simulate headless
    this.stage(id, 'simulate');
    const summary = await runHeadlessInWorker(config, (f) => this.stage(id, 'simulate', { frame: f }));
    const metrics = {
      frameCount: summary.frameCount, durationS: summary.durationS, hookS: summary.hookFrame / FPS,
      capS: summary.capFrame / FPS, capN: summary.capN, simMs: Math.round(summary.simMs), curve: curveDescriptor(summary.timeline),
      hashes: b64(summary.hashes),
    };
    await S().writeFile(id, 'metrics.json', JSON.stringify(metrics));
    checks.push(...explainRun(config, summary));
    const runReasons = checks.filter((c) => !c.ok).map((c) => c.reason);
    if (runReasons.length) return reject(runReasons, 'simulate');

    // 3. audio
    this.stage(id, 'audio');
    const meta = metaFromSummary(config, summary);
    const { buffer: audioBuffer, stats: audioStats } = await renderSoundtrackFor(config, summary.timeline, summary.frameCount, meta);

    // 4. preview
    await this.quotaCheck(summary.durationS * PREVIEW.bitrateMbps / 8 * 1e6 * 1.3, 'the preview');
    const previewPath = await S().path(id, 'preview.mp4');
    this.current = startExport({ meta, summary, config }, {
      engine: 'auto', bitrateMbps: PREVIEW.bitrateMbps, scale: PREVIEW.scale, caption, audioBuffer,
      finalPath: previewPath, metadata: `split-chamber-studio preview id=${id} scenario=${scenarioKey} seed=${seed}`,
      onProgress: (p) => this.stage(id, 'preview', p),
    });
    const preview = await this.current.promise; this.current = null;

    // 5. analysis on the encoded preview (authoritative for audio/picture problems)
    this.stage(id, 'analyse');
    const [audio, video, dhash] = await Promise.all([
      S().audioReport(previewPath), S().videoReport(previewPath), S().dhash(previewPath, summary.durationS, 8),
    ]);
    await S().thumb(previewPath, summary.durationS * 0.62, await S().path(id, 'thumb.jpg'));
    const descriptor = { curve: metrics.curve, dhash };
    const accepted = (await S().list()).filter((x) => x.status === 'accepted' && x.id !== id);
    const dup = findDuplicate(descriptor, accepted);
    checks.push(...explainAudio(audio), ...explainVideo(video), explainDuplicate(dup));
    const reasons = checks.filter((c) => !c.ok).map((c) => c.reason);
    if (reasons.length) return reject(reasons, 'analyse');

    const st = await S().update(id, {
      status: 'candidate', durationS: summary.durationS, frameCount: summary.frameCount, capN: summary.capN, capS: summary.capFrame / FPS,
      preview: { file: 'preview.mp4', verify: preview.verify.summary, engine: preview.engineLabel },
      thumb: 'thumb.jpg', audio, audioMastering: audioStats, video, descriptor, nearest: dup.nearest,
      score: score(config, summary, audio, dup.nearest), scoreParts: scoreParts(config, summary, audio, dup.nearest), checks,
      timings: { totalS: (performance.now() - t0) / 1000, simMs: metrics.simMs, previewS: preview.seconds },
    });
    this.emit({ type: 'item', status: st });
    return st;
  }

  async loadRun(id) {
    const st = await S().get(id);
    if (!st) throw new Error(`Unknown video ${id}`);
    const config = await S().readJson(id, 'config.json');
    return { st, config };
  }

  /** Accept: render and verify the master (50 Mbps, 1080x1920@60) with the quality gate. */
  async accept(id, { lang } = {}) {
    const { st, config } = await this.loadRun(id);
    const caption = lang === undefined ? st.caption : captionFor(config, lang);
    const name = lang === undefined ? 'master.mp4' : `master_${lang}.mp4`;
    await S().update(id, { status: st.status === 'accepted' ? 'accepted' : 'mastering' });
    try {
      this.stage(id, 'simulate');
      const summary = await runHeadlessInWorker(config);
      const stored = await S().readJson(id, 'metrics.json');
      const sameRun = stored.hashes === b64(summary.hashes);
      if (!sameRun) throw new Error('Reproduction check failed: the simulation no longer produces the same frames as when this video was generated.');
      await this.quotaCheck(summary.durationS * MASTER.bitrateMbps / 8 * 1e6 * 1.15, 'the master');
      const meta = metaFromSummary(config, summary);
      this.stage(id, 'audio');
      const { buffer: audioBuffer } = await renderSoundtrackFor(config, summary.timeline, summary.frameCount, meta);
      const finalPath = await S().path(id, name);
      const truthDir = await S().path(id, '_truth');
      const frames = TRUTH_FRAMES(summary.frameCount);
      const attempts = [];
      for (const engine of AUTO_ORDER) {
        if (this.cancelled) throw new Error('Export cancelled.');
        try {
          this.current = startExport({ meta, summary, config }, {
            engine, bitrateMbps: MASTER.bitrateMbps, scale: MASTER.scale, caption, audioBuffer, finalPath,
            pngFrames: frames, pngDir: truthDir, minBitrateRatio: this.debug.minBitrateRatio == null ? undefined : this.debug.minBitrateRatio,
            metadata: `split-chamber-studio id=${id} scenario=${config.scenario} seed=${config.seed} engine=${config.versions.engine}`,
            onProgress: (p) => this.stage(id, 'master', p),
          });
          const master = await this.current.promise; this.current = null;
          this.stage(id, 'quality');
          const quality = await S().quality(finalPath, truthDir, frames);
          const audio = await S().audioReport(finalPath);
          const problems = [...checkQuality(quality), ...checkAudio(audio)];
          if (problems.length) { await S().removeMedia(id, [name]); attempts.push({ engine, problems }); continue; }
          await S().removeMedia(id, ['_truth']);
          const masters = { ...(st.masters || {}), [lang === undefined ? 'default' : lang]: { file: name, verify: master.verify.summary, engine: master.engineLabel, quality: { ssimMin: quality.ssimMin, ssimMean: quality.ssimMean, psnrMin: quality.psnrMin, accuracy: `${quality.accurate}/${quality.checked}` }, audio, seconds: master.seconds } };
          const out = await S().update(id, { status: 'accepted', acceptedAt: st.acceptedAt || new Date().toISOString(), masters, attempts, reproduced: true });
          this.emit({ type: 'item', status: out });
          return out;
        } catch (e) {
          this.current = null;
          if (this.cancelled) throw new Error('Export cancelled.');
          attempts.push({ engine, error: e.message });
        }
      }
      throw new Error(`No encoder produced a master that passed verification and the quality gate:\n${attempts.map((a) => `${a.engine}: ${a.error || a.problems.join('; ')}`).join('\n')}`);
    } catch (e) {
      await S().removeMedia(id, ['_truth', name]).catch(() => {});
      const back = await S().update(id, { status: st.status === 'accepted' ? 'accepted' : 'candidate', lastError: e.message });
      this.emit({ type: 'item', status: back });
      throw e;
    }
  }

  async reject(id, reasons = []) {
    const st = await S().get(id);
    await S().removeMedia(id);
    const out = await S().update(id, { status: 'rejected', reasons: reasons.length ? reasons : ['rejected by reviewer'], rejectedAt: 'review' });
    await S().rejectLog({ scenario: st.scenario, seed: st.seed, id, reasons, auto: false });
    this.emit({ type: 'item', status: out });
    return out;
  }

  /** Reproduce: re-run the simulation and prove it yields identical frames; re-render a missing master. */
  async reproduce(id) {
    const { st, config } = await this.loadRun(id);
    const summary = await runHeadlessInWorker(config);
    const stored = await S().readJson(id, 'metrics.json');
    const identical = stored.hashes === b64(summary.hashes);
    let status = st;
    if (identical && st.status === 'accepted' && !(st.masters && st.masters.default && await this.exists(id, st.masters.default.file))) status = await this.accept(id);
    return { identical, frames: summary.frameCount, status };
  }

  async exists(id, file) { return S().exists(id, file); }

  async variation(id, captions) {
    const st = await S().get(id);
    const ctl = st.controls ? { ...st.controls, gravity: st.controls.gravity, ending: st.controls.ending === 'cap-gold' ? 'gold' : st.controls.ending } : null;
    return this.generateOne({ scenarioKey: st.scenario, seed: await this.freshSeed(st.scenario), captions: captions || (st.caption ? st.caption.lang : 'none'), controls: ctl });
  }
}

export { unb64 };
