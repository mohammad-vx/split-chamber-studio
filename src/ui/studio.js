// Studio home screen (owner decision D9): review queue, accepted library, batch generation, reproduce,
// new variation, other-language masters. Keyboard: ←/→ select · Enter play · A accept · R reject · Esc close.
import { listedScenarios, registerSaved } from '../scenarios/index.js';
import { baseFrom, slug } from '../scenarios/saved.js';
import { Pipeline } from '../pipeline/pipeline.js';

const $ = (id) => document.getElementById(id);
const S = () => window.host.studio;
// library media URL: lib:// in the desktop app, ./lib/… (service worker) in the website build
const libUrl = (id, file) => (window.host.libUrl ? window.host.libUrl(id, file) : `lib://library/videos/${id}/${file}`);
const fmtGB = (b) => (b / 1024 ** 3).toFixed(2);   // quota is 12 GiB; show it as 12.00 GB
const REASONS = ['boring', 'too similar', 'glitch', 'audio', 'other'];

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createStudio({ onLivePlay, onWatch, onPlayConfig, toast }) {
  const state = { tab: 'review', items: [], sel: 0, busy: false, pipeline: null, info: null, reasons: new Set(), debug: {}, current: null, batch: null, timing: {}, etaTimer: 0 };

  /** The most recent batch: the running one, else the newest batch id found in the library. */
  function lastBatchId() {
    if (state.batch) return state.batch.id;
    let best = null;
    for (const x of state.items) if (x.batch && (!best || x.batch.id > best)) best = x.batch.id;
    return best;
  }

  function itemsFor(tab) {
    const want = tab === 'review' ? ['candidate', 'mastering'] : tab === 'accepted' ? ['accepted'] : ['rejected', 'failed'];
    const pat = $('st-filter-pattern').value, q = $('st-search').value.trim(), sort = $('st-sort').value;
    const bid = $('st-filter-batch').value === 'last' ? lastBatchId() : null;
    const list = state.items.filter((x) => want.includes(x.status) && (!pat || x.scenario === pat) && (!bid || (x.batch && x.batch.id === bid))
      && (!q || String(x.seed).includes(q) || String(x.id).startsWith(q)));
    const by = { score: (a, b) => (b.score || 0) - (a.score || 0), new: (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)), duration: (a, b) => (b.durationS || 0) - (a.durationS || 0) };
    list.sort(by[sort] || by.score);
    return list;
  }

  async function refresh() {
    state.items = await S().list();
    const u = await S().usage();
    $('st-quota').textContent = `${fmtGB(u.bytes)} / ${fmtGB(u.quotaBytes)} GB · about ${Math.max(0, Math.floor(u.freeBytes / (50e6 / 8 * 40)))} more 40 s masters fit`;
    $('st-quota-bar').style.width = `${Math.min(100, u.bytes / u.quotaBytes * 100).toFixed(1)}%`;
    for (const t of ['review', 'accepted', 'rejected']) $(`st-tab-${t}`).querySelector('b').textContent = itemsFor(t).length;
    const all = state.items, acc = all.filter((x) => x.status === 'accepted').length, rev = all.filter((x) => x.status === 'rejected' && x.rejectedAt === 'review').length;
    const auto = all.filter((x) => x.status === 'rejected' && x.rejectedAt !== 'review').length, failed = all.filter((x) => x.status === 'failed').length;
    const times = all.map((x) => x.timings && x.timings.totalS).filter(Boolean);
    $('st-stats').textContent = `${all.length} generated · ${acc} accepted · ${rev} rejected by you · ${auto} auto-rejected · ${failed} failed`
      + (acc + rev ? ` · acceptance ${Math.round(acc / (acc + rev) * 100)} %` : '') + (times.length ? ` · avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)} s per candidate` : '');
    renderBatch();
    render();
  }

  const labelOf = (key) => (listedScenarios().find((s) => s.key === key) || {}).label || key;

  /** "Last batch" panel: what happened to every video of the most recent batch. */
  function renderBatch() {
    const box = $('st-batch'), bid = lastBatchId();
    if (!bid) { box.classList.add('hidden'); return; }
    const items = state.items.filter((x) => x.batch && x.batch.id === bid);
    const running = !!(state.batch && state.batch.id === bid);
    const meta = running ? state.batch : (items[0] && items[0].batch) || {};
    const by = (f) => items.filter(f);
    const review = by((x) => x.status === 'candidate' || x.status === 'mastering'), accepted = by((x) => x.status === 'accepted');
    const auto = by((x) => x.status === 'rejected' && x.rejectedAt !== 'review'), mine = by((x) => x.status === 'rejected' && x.rejectedAt === 'review');
    const failed = by((x) => x.status === 'failed'), working = by((x) => x.status === 'generating');
    const notMade = Math.max(0, (meta.total || 0) - items.length);
    const why = {};
    for (const x of [...auto, ...failed]) {
      for (const r of x.reasons || ['unknown']) {
        const k = r.split(':')[0].replace(/ [\d.]+ s outside/, ' outside').replace(/accepted video \w+/, 'an accepted video');
        why[k] = (why[k] || 0) + 1;
      }
    }
    const pattern = !meta.pattern || meta.pattern === 'random' ? 'random patterns' : labelOf(meta.pattern);
    const when = meta.startedAt ? new Date(meta.startedAt).toLocaleString() : '';
    const chip = (cls, n, label, go) => `<span class="chip ${cls}" data-go="${go}"><b>${n}</b>${label}</span>`;
    const only = $('st-filter-batch').value === 'last';
    box.innerHTML = `<div class="head"><strong>${running ? 'Running batch' : 'Last batch'}</strong>
        <span class="muted">${meta.total || items.length} requested · ${esc(pattern)} · ${esc(when)}</span>
        <button id="st-batch-only" class="ghost">${only ? 'Show all videos' : 'Show only this batch'}</button></div>
      <div class="chips">
        ${chip('review', review.length, 'waiting for review', 'review')}
        ${accepted.length ? chip('ok', accepted.length, 'accepted', 'accepted') : ''}
        ${chip('bad', auto.length, 'rejected by the checks', 'rejected')}
        ${mine.length ? chip('bad', mine.length, 'rejected by you', 'rejected') : ''}
        ${failed.length ? chip('bad', failed.length, 'failed / stopped', 'rejected') : ''}
        ${working.length ? chip('', working.length, 'being made now', 'review') : ''}
        ${notMade ? chip('', notMade, running ? 'still to make' : 'not made (batch stopped)', 'review') : ''}
      </div>
      ${Object.keys(why).length ? `<ul>${Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li>${n} × ${esc(k)}</li>`).join('')}</ul>` : ''}`;
    box.classList.remove('hidden');
    box.querySelectorAll('.chip').forEach((c) => { c.onclick = () => { $('st-filter-batch').value = 'last'; state.tab = c.dataset.go; state.sel = 0; renderBatch(); render(); }; });
    $('st-batch-only').onclick = () => { $('st-filter-batch').value = only ? '' : 'last'; state.sel = 0; renderBatch(); render(); };
  }

  /** Every check the video went through, with value and limit, and how its score was calculated. */
  function explanation(it) {
    const el = document.createElement('div'); el.className = 'st-why';
    const verdict = it.status === 'candidate' || it.status === 'mastering' ? 'Passed every automatic check. Waiting for your decision.'
      : it.status === 'accepted' ? 'Passed every automatic check and was accepted; the master passed the quality gate.'
      : it.status === 'rejected' && it.rejectedAt === 'review' ? `Rejected by you${it.reasons && it.reasons.length ? ': ' + it.reasons.join(', ') : ''}.`
      : it.status === 'rejected' ? `Rejected automatically at the ${it.rejectedAt === 'simulate' ? 'simulation' : 'preview'} checks (✗ below).`
      : it.status === 'failed' ? `Not finished: ${(it.reasons || []).join(', ')}` : it.status;
    let html = `<h3>Why</h3><p>${esc(verdict)}</p>`;
    if (it.batch) html += `<p class="muted">Video ${it.batch.index + 1} of ${it.batch.total} in the batch of ${esc(new Date(it.batch.startedAt).toLocaleString())}</p>`;
    if (it.checks && it.checks.length) {
      html += '<table>' + it.checks.map((c) => `<tr class="${c.ok ? '' : 'fail'}"><td class="ico">${c.ok ? '✓' : '✗'}</td><td>${esc(c.name)}</td><td class="v">${esc(c.value)}<br><span class="muted">limit ${esc(c.limit)}</span></td></tr>`).join('') + '</table>';
      if (it.status === 'rejected' && it.rejectedAt === 'simulate') html += '<p class="muted">Sound and picture checks were skipped: the simulation had already failed.</p>';
    } else if (it.reasons && it.reasons.length) {
      html += `<ul>${it.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p class="muted">Made before detailed checks were recorded.</p>`;
    }
    if (it.scoreParts) {
      html += `<h3>Score ${it.score} / 100</h3><table>` + it.scoreParts.map((p) => `<tr><td>${esc(p.name)}</td><td class="v">${p.points} / ${p.max}${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ''}</td></tr>`).join('') + '</table>';
    }
    el.innerHTML = html;
    return el;
  }

  function card(it, i) {
    const el = document.createElement('div');
    el.className = `card${i === state.sel ? ' sel' : ''}`;
    el.tabIndex = 0;
    const thumb = it.thumb ? `<img src="${libUrl(it.id, it.thumb)}" alt="">` : `<div class="noimg">${it.status}</div>`;
    const reasons = (it.reasons || []).slice(0, 2).map((r) => `<li>${r}</li>`).join('');
    el.innerHTML = `${thumb}<div class="meta">${it.invented ? '<span class="badge-invented">✦ Invented</span>' : ''}<strong>${it.label || it.scenario}</strong>
      <span>seed ${it.seed}${it.durationS ? ` · ${it.durationS.toFixed(1)} s` : ''}${it.score != null ? ` · score ${it.score}` : ''}</span>
      ${it.capN ? `<span>finale at ${it.capN.toLocaleString('en-US')} balls · ${it.capS.toFixed(1)} s</span>` : ''}
      ${it.controls ? `<span class="cap">gravity ${it.controls.gravity} · ${it.controls.length} · ${it.controls.ending}</span>` : ''}
      ${it.caption ? `<span class="cap">${it.caption.lang.toUpperCase()}: <bdi dir="auto">${it.caption.text}</bdi></span>` : ''}
      ${reasons ? `<ul class="why">${reasons}</ul>` : ''}${it.lastError ? `<ul class="why"><li>${it.lastError.split('\n')[0]}</li></ul>` : ''}</div>`;
    el.onclick = () => { state.sel = i; state.sheet = true; render(); };   // phones: tapping a card opens its action sheet
    el.ondblclick = () => open(it);
    return el;
  }

  function render() {
    for (const t of ['review', 'accepted', 'rejected']) $(`st-tab-${t}`).classList.toggle('on', state.tab === t);
    const list = itemsFor(state.tab);
    state.sel = Math.max(0, Math.min(state.sel, list.length - 1));
    const grid = $('st-grid'); grid.innerHTML = '';
    if (!list.length) grid.innerHTML = `<p class="empty">${state.tab === 'review' ? 'Nothing waiting for review. Press <b>Generate</b> to make new videos.' : 'Nothing here yet.'}</p>`;
    list.forEach((it, i) => grid.appendChild(card(it, i)));
    const it = list[state.sel];
    renderActions(it);
  }

  function renderActions(it) {
    const box = $('st-actions');
    box.innerHTML = '';
    box.classList.toggle('open', !!(it && state.sheet));
    if (!it) return;
    const head = document.createElement('div'); head.className = 'sheet-head';   // shown on phones only (CSS)
    head.innerHTML = `<strong>${it.label || it.scenario} · seed ${it.seed}</strong><button class="ghost" aria-label="Close">✕</button>`;
    head.querySelector('button').onclick = () => { state.sheet = false; box.classList.remove('open'); };
    box.appendChild(head);
    const btn = (label, fn, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.disabled = state.busy; b.onclick = fn; box.appendChild(b); };
    btn('▶ Play', () => open(it));
    if (it.status === 'rejected') {                 // see it anyway, and keep it if you like it
      btn('✓ Accept anyway', () => run(`Making the master of ${it.id}`, () => state.pipeline.accept(it.id)), 'primary');
    }
    if (it.status === 'candidate') {
      btn('✓ Accept (A)', () => doAccept(it), 'primary');
      btn('✗ Reject (R)', () => doReject(it));
      const tags = document.createElement('div'); tags.className = 'tags';
      for (const r of REASONS) {
        const t = document.createElement('span'); t.textContent = r; t.className = state.reasons.has(r) ? 'on' : '';
        t.onclick = () => { state.reasons.has(r) ? state.reasons.delete(r) : state.reasons.add(r); renderActions(it); };
        tags.appendChild(t);
      }
      box.appendChild(tags);
    }
    if (it.status === 'accepted') {
      btn('↻ Reproduce', () => run(`Reproducing ${it.id}`, async () => {
        const r = await state.pipeline.reproduce(it.id);
        toast(r.identical ? `Identical: all ${r.frames} frames reproduce exactly.` : 'Reproduction differs — see the log.');
      }));
      for (const lang of ['en', 'ar', 'none']) {
        const have = it.masters && it.masters[lang];
        if (!have && (!it.caption || it.caption.lang !== lang)) btn(`Export ${lang === 'none' ? 'no-text' : lang.toUpperCase()} version`, () => run(`Exporting ${lang} version`, () => state.pipeline.accept(it.id, { lang })));
      }
      if (window.host.web) {   // website: no folder to open, so hand over the files
        for (const m of Object.values(it.masters || {})) btn(`⬇ Download ${m.file}`, () => window.host.download(it.id, m.file));
      } else btn('📁 Open folder', () => window.host.show(null));
      if (it.masters && Object.keys(it.masters).length) btn('🗑 Delete master (keep reproducible)', () => run('Deleting master', async () => {
        await S().removeMedia(it.id, ['master']);
        await S().update(it.id, { masters: {}, note: 'master deleted to save space — Reproduce re-renders it' });
      }));
    }
    if (it.status === 'accepted' || it.status === 'candidate' || it.status === 'rejected') {
      btn('✦ New variation', () => run('Generating a variation', () => state.pipeline.variation(it.id)));
    }
    if (it.invented && (it.status === 'accepted' || it.status === 'candidate')) {   // keep this machine as a pattern
      const row = document.createElement('div'); row.className = 'save-pattern';
      row.innerHTML = '<input id="st-save-name" maxlength="40" placeholder="Name for this machine"><button id="st-save-btn">★ Save as pattern</button>';
      box.appendChild(row);
      $('st-save-name').value = it.invented.name.split(' · ').slice(0, 2).join(' ');
      $('st-save-btn').onclick = () => run('Saving the machine as a pattern', async () => {
        const label = $('st-save-name').value.trim() || 'My machine';
        const list = (await S().patterns()).filter((p) => p.label !== label);
        let key = `mine-${slug(label)}@1`; for (let n = 2; list.some((p) => p.key === key); n++) key = `mine-${slug(label)}-${n}@1`;
        list.push({ key, label, base: baseFrom(await S().readJson(it.id, 'config.json'), it.id), savedAt: new Date().toISOString() });
        await S().patterns(list);
        registerSaved(list); fillPatternPickers();
        toast(`Saved "${label}": it is now in the pattern list.`);
      });
    }
    box.appendChild(explanation(it));
  }

  function open(it) {
    const file = it.status === 'accepted' && it.masters && it.masters.default ? it.masters.default.file : it.preview ? it.preview.file : null;
    if (!file) {                                    // no video file (rejected before its preview): play it live from its config
      S().readJson(it.id, 'config.json').then((config) => { if (onPlayConfig) onPlayConfig(config, it); }).catch(() => toast('This video has no saved settings to play.'));
      return;
    }
    const v = $('st-video');
    v.src = libUrl(it.id, file);
    const info = [];
    if (it.preview) info.push(`Preview: ${it.preview.verify.width}×${it.preview.verify.height}, ${it.preview.verify.frames} frames`);
    if (it.masters && it.masters.default) {
      const m = it.masters.default;
      info.push(`Master: ${m.verify.width}×${m.verify.height} · ${m.verify.fps} fps · ${m.verify.frames} frames · ${m.verify.videoMbps} Mbps · SSIM ${m.quality.ssimMean.toFixed(4)} · ${m.engine}`);
    }
    if (it.audio) info.push(`Audio: ${it.audio.lufs} LUFS, true peak ${it.audio.truePeak} dBTP`);
    $('st-player-info').textContent = info.join('  ·  ');
    $('st-player').showModal();
    v.play().catch(() => {});
  }

  async function run(label, fn) {
    if (state.busy) return;
    state.busy = true; state.pipeline.cancelled = false;
    jobBar(label);
    try { await fn(); } catch (e) { if (e.message !== 'Export cancelled.') toast(e.message.split('\n')[0], 7000); }
    finally { state.busy = false; state.current = null; liveButton(); jobBar(null); await refresh(); }
  }

  async function doAccept(it) { await run(`Rendering master for ${it.id}`, () => state.pipeline.accept(it.id)); }
  async function doReject(it) { await run('Rejecting', () => state.pipeline.reject(it.id, [...state.reasons])); state.reasons.clear(); }

  function jobBar(label, p) {
    const bar = $('st-job');
    bar.classList.toggle('hidden', !label);
    if (label) $('st-job-label').textContent = label;
    if (p && p.total) $('st-job-progress').style.width = `${(p.frame / p.total * 100).toFixed(1)}%`;
    else if (!p) $('st-job-progress').style.width = '0%';
  }

  const STAGES = { simulate: 'Simulating', audio: 'Rendering soundtrack', preview: 'Rendering preview', analyse: 'Checking audio & picture', master: 'Rendering master', quality: 'Quality check', verify: 'Verifying' };
  function onEvent(ev) {
    if (ev.type === 'stage') {
      const p = ev.stage === 'preview' || ev.stage === 'master' ? ev : null;
      const sub = p && p.step === 'video' ? ` · ${p.frame}/${p.total} · ${p.fps.toFixed(0)} fps` : p && p.step === 'verify' ? ' · verifying' : '';
      $('st-job-stage').textContent = `${STAGES[ev.stage] || ev.stage}${sub}`;
      if (p && p.step === 'video') { jobBar($('st-job-label').textContent, p); if (ev.stage === 'preview' && state.timing) state.timing.previewFrac = p.frame / p.total; }
    } else if (ev.type === 'batch') {
      $('st-job-label').textContent = `Video ${ev.index + 1} of ${ev.total} · ${labelOf(ev.scenario)} · seed ${ev.seed}`;
      Object.assign(state.timing, { index: ev.index, total: ev.total, videoStart: performance.now(), previewFrac: 0 });
      showEta();
    } else if (ev.type === 'batch-start') {
      state.batch = ev.batch; $('st-filter-batch').value = 'last'; refresh();
      state.timing = { start: performance.now(), index: 0, total: ev.batch.total, videoStart: performance.now(), previewFrac: 0 };
      clearInterval(state.etaTimer); state.etaTimer = setInterval(showEta, 5000);
      $('st-job-note').classList.toggle('hidden', !window.host.web);
    } else if (ev.type === 'batch-done') {
      state.batch = null; state.current = null; liveButton(); refresh();
      clearInterval(state.etaTimer); state.timing = {}; $('st-job-eta').textContent = ''; $('st-job-note').classList.add('hidden');
      document.title = TITLE;
      notifyDone(ev.results || [], ev.batch);
    } else if (ev.type === 'config') {
      state.current = ev; liveButton();
      if (onWatch) onWatch(ev, false);       // the live view (if open) follows the batch to the next video
      refresh();
    } else if (ev.type === 'item') {
      refresh();
    } else if (ev.type === 'paused') toast(ev.reason, 8000);
    else if (ev.type === 'stopped') toast(ev.reason, 9000);
  }

  // ---- time left: average time of this batch's finished videos (the first video estimates from its preview progress)
  const TITLE = document.title;
  function fmtLeft(ms) {
    const m = Math.round(ms / 60000);
    return ms < 60000 ? 'less than a minute left' : m < 60 ? `about ${m} min left` : `about ${Math.floor(m / 60)} h ${m % 60} min left`;
  }
  function showEta() {
    const t = state.timing; if (!t || !t.total) return;
    const now = performance.now(), doneN = t.index, inVideo = now - t.videoStart;
    let per = doneN > 0 ? (t.videoStart - t.start) / doneN : null;
    if (per == null && t.previewFrac > 0.05) per = inVideo / (0.35 + 0.6 * t.previewFrac);   // the preview is ~60 % of a video's time
    const left = per == null ? null : Math.max(0, per * (t.total - doneN) - inVideo);
    $('st-job-eta').textContent = left == null ? '· estimating time…' : `· ${fmtLeft(left)}`;
    document.title = `(${doneN}/${t.total}) ${TITLE}`;
  }

  // ---- browser notification when a batch ends (website only: the page may be in the background)
  function askNotify() {
    if (!window.host.web || typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    try { const p = Notification.requestPermission(); if (p && p.catch) p.catch(() => {}); } catch { /* unsupported */ }
  }
  async function notifyDone(results, batch) {
    if (!window.host.web || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = (s) => results.filter((r) => r.status === s).length;
    const body = `${n('candidate')} waiting for review${n('accepted') ? `, ${n('accepted')} accepted` : ''}, ${n('rejected')} rejected${batch && results.length < batch.total ? `, ${batch.total - results.length} not made` : ''}.`;
    const opts = { body, tag: 'split-chamber-batch' };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await reg.showNotification('Split Chamber: batch finished', opts); else new Notification('Split Chamber: batch finished', opts);
    } catch { /* notifications blocked or unsupported */ }
  }

  // ---- continue a batch that a reload, a closed tab or a crash interrupted
  async function offerResume() {
    const q = await S().queue('load');
    const box = $('st-resume');
    if (!q || !(q.count > q.done) || state.busy) { box.classList.add('hidden'); return; }
    const left = q.count - q.done;
    $('st-resume-text').textContent = `A batch was interrupted: ${q.done} of ${q.count} done, ${left} left (${q.pattern && q.pattern !== 'random' ? labelOf(q.pattern) : 'random patterns'}).`;
    $('st-resume-go').textContent = `▶ Continue (${left} left)`;
    box.classList.remove('hidden');
    $('st-resume-no').onclick = async () => { await S().queue('clear'); box.classList.add('hidden'); };
    $('st-resume-go').onclick = () => {
      box.classList.add('hidden'); askNotify(); state.tab = 'review';
      const { done, startedAt, owner, seeds, ...opts } = q;
      run(`Continuing: ${left} video${left > 1 ? 's' : ''}`, async () => {
        const res = await state.pipeline.runBatch({ ...opts, count: left, owner: 'ui', ...(seeds ? { seeds: seeds.slice(done) } : {}) });
        toast(`Batch finished: ${res.filter((r) => r.status === 'candidate').length} waiting for review, ${res.filter((r) => r.status === 'rejected').length} rejected by the checks.`, 9000);
      });
    };
  }

  function generatePanel(show) { $('st-gen').classList.toggle('hidden', !show); }

  function liveButton() {
    const on = !!state.current && state.busy;
    $('st-live').textContent = on ? '● Watch live' : 'Live play';
    $('st-watch').classList.toggle('hidden', !on);
  }
  function watch() { if (state.current && state.busy) { $('studio').classList.add('hidden'); onWatch(state.current, true); } }

  async function startBatch() {
    const count = Number($('st-count').value) || 1;
    const pattern = $('st-pattern').value, captions = $('st-captions').value;
    generatePanel(false);
    askNotify();
    $('st-resume').classList.add('hidden');
    state.tab = 'review';
    await run(`Generating ${count} video${count > 1 ? 's' : ''}`, async () => {
      const autoAcceptScore = $('st-auto').checked ? Number($('st-auto-score').value) : null;
      const controls = { gravity: $('st-gravity').value, target: $('st-target').value === 'max' ? 'max' : Number($('st-target').value), length: $('st-length').value, ending: $('st-ending').value };
      const seeds = window.__splitChamber && window.__splitChamber.testSeeds;   // e2e tests pin seeds so results are reproducible
      const res = await state.pipeline.runBatch({ count, pattern, captions, autoAcceptScore, controls, owner: 'ui', ...(seeds ? { seeds } : {}) });
      const ok = res.filter((r) => r.status === 'candidate').length, accd = res.filter((r) => r.status === 'accepted').length;
      const rej = res.filter((r) => r.status === 'rejected').length, fail = res.length - ok - accd - rej;
      toast(`Batch finished (${count} requested): ${ok} waiting for review${accd ? `, ${accd} auto-accepted` : ''}, ${rej} rejected by the checks${fail ? `, ${fail} failed` : ''}${res.length < count ? `, ${count - res.length} not made` : ''}.`, 9000);
    });
  }

  function keys(e) {
    if ($('studio').classList.contains('hidden')) return;
    if ($('st-player').open) { if (e.key === 'Escape') { $('st-video').pause(); } return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const list = itemsFor(state.tab), it = list[state.sel];
    if (e.key === 'ArrowRight') { state.sel = Math.min(list.length - 1, state.sel + 1); render(); }
    else if (e.key === 'ArrowLeft') { state.sel = Math.max(0, state.sel - 1); render(); }
    else if (e.key === 'Enter' && it) open(it);
    else if ((e.key === 'a' || e.key === 'A') && it && it.status === 'candidate' && !state.busy) doAccept(it);
    else if ((e.key === 'r' || e.key === 'R') && it && it.status === 'candidate' && !state.busy) doReject(it);
  }

  function fillPatternPickers() {
    const opts = (list) => list.map((s) => `<option value="${s.key}">${s.saved ? '★ ' : ''}${s.label}</option>`).join('');
    const sel = $('st-pattern'), keep = sel.value;
    sel.innerHTML = '<option value="random">Random pattern</option>' + opts(listedScenarios());
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
    $('st-filter-pattern').innerHTML = '<option value="">All patterns</option>' + opts(listedScenarios());
  }

  async function init() {
    state.info = await S().info();
    window.host.info().then((i) => { $('st-version').textContent = `v${i.version}`; }).catch(() => {});
    state.debug = state.info.debug || {};
    state.pipeline = new Pipeline({ onEvent, debug: state.debug });
    registerSaved(await S().patterns());
    fillPatternPickers();
    for (const id of ['st-filter-pattern', 'st-sort', 'st-filter-batch']) $(id).onchange = () => { state.sel = 0; render(); };
    $('st-search').oninput = () => { state.sel = 0; render(); };
    for (const t of ['review', 'accepted', 'rejected']) $(`st-tab-${t}`).onclick = () => { state.tab = t; state.sel = 0; render(); };
    $('st-generate').onclick = () => generatePanel($('st-gen').classList.contains('hidden'));
    $('st-start').onclick = startBatch;
    $('st-gen-cancel').onclick = () => generatePanel(false);
    $('st-cancel').onclick = () => state.pipeline.cancel();
    $('st-live').onclick = () => { if (state.current && state.busy) { watch(); return; } $('studio').classList.add('hidden'); onLivePlay(); };
    $('st-watch').onclick = watch;
    $('st-help').onclick = () => $('st-howto').showModal();
    $('st-howto-close').onclick = () => $('st-howto').close();
    $('st-player-close').onclick = () => { $('st-video').pause(); $('st-player').close(); };
    document.querySelectorAll('#st-counts button').forEach((b) => { b.onclick = () => { $('st-count').value = b.dataset.n; }; });
    window.addEventListener('keydown', keys);
    window.addEventListener('beforeunload', (e) => { if (state.busy && window.host.web) { e.preventDefault(); e.returnValue = ''; } });
    await offerResume();
    await refresh();
  }

  return { init, refresh, show() { $('studio').classList.remove('hidden'); refresh(); }, pipeline: () => state.pipeline, state };
}
