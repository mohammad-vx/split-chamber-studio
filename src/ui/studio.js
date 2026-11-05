// Studio home screen (owner decision D9): review queue, accepted library, batch generation, reproduce,
// new variation, other-language masters. Keyboard: ←/→ select · Enter play · A accept · R reject · Esc close.
import { listedScenarios } from '../scenarios/index.js';
import { Pipeline } from '../pipeline/pipeline.js';

const $ = (id) => document.getElementById(id);
const S = () => window.host.studio;
const fmtGB = (b) => (b / 1e9).toFixed(2);
const REASONS = ['boring', 'too similar', 'glitch', 'audio', 'other'];

export function createStudio({ onLivePlay, toast }) {
  const state = { tab: 'review', items: [], sel: 0, busy: false, pipeline: null, info: null, reasons: new Set(), debug: {} };

  function itemsFor(tab) {
    const want = tab === 'review' ? ['candidate', 'mastering'] : tab === 'accepted' ? ['accepted'] : ['rejected', 'failed'];
    const list = state.items.filter((x) => want.includes(x.status));
    if (tab === 'review') list.sort((a, b) => (b.score || 0) - (a.score || 0));
    return list;
  }

  async function refresh() {
    state.items = await S().list();
    const u = await S().usage();
    $('st-quota').textContent = `${fmtGB(u.bytes)} / ${fmtGB(u.quotaBytes)} GB · about ${Math.max(0, Math.floor(u.freeBytes / (50e6 / 8 * 40)))} more 40 s masters fit`;
    $('st-quota-bar').style.width = `${Math.min(100, u.bytes / u.quotaBytes * 100).toFixed(1)}%`;
    for (const t of ['review', 'accepted', 'rejected']) $(`st-tab-${t}`).querySelector('b').textContent = itemsFor(t).length;
    render();
  }

  function card(it, i) {
    const el = document.createElement('div');
    el.className = `card${i === state.sel ? ' sel' : ''}`;
    el.tabIndex = 0;
    const thumb = it.thumb ? `<img src="lib://library/videos/${it.id}/${it.thumb}" alt="">` : `<div class="noimg">${it.status}</div>`;
    const reasons = (it.reasons || []).slice(0, 2).map((r) => `<li>${r}</li>`).join('');
    el.innerHTML = `${thumb}<div class="meta"><strong>${it.label || it.scenario}</strong>
      <span>seed ${it.seed}${it.durationS ? ` · ${it.durationS.toFixed(1)} s` : ''}${it.score != null ? ` · score ${it.score}` : ''}</span>
      ${it.caption ? `<span class="cap">${it.caption.lang.toUpperCase()}: ${it.caption.text}</span>` : ''}
      ${reasons ? `<ul class="why">${reasons}</ul>` : ''}${it.lastError ? `<ul class="why"><li>${it.lastError.split('\n')[0]}</li></ul>` : ''}</div>`;
    el.onclick = () => { state.sel = i; render(); };
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
    if (!it) return;
    const btn = (label, fn, cls = '') => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.disabled = state.busy; b.onclick = fn; box.appendChild(b); };
    btn('▶ Play', () => open(it));
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
      btn('📁 Open folder', () => window.host.show(null));
    }
    if (it.status === 'accepted' || it.status === 'candidate' || it.status === 'rejected') {
      btn('✦ New variation', () => run('Generating a variation', () => state.pipeline.variation(it.id)));
    }
  }

  function open(it) {
    const file = it.status === 'accepted' && it.masters && it.masters.default ? it.masters.default.file : it.preview ? it.preview.file : null;
    if (!file) return;
    const v = $('st-video');
    v.src = `lib://library/videos/${it.id}/${file}`;
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
    finally { state.busy = false; jobBar(null); await refresh(); }
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
      const sub = p && p.stage === 'video' ? ` · ${p.frame}/${p.total} · ${p.fps.toFixed(0)} fps` : p && p.stage === 'verify' ? ' · verifying' : '';
      $('st-job-stage').textContent = `${STAGES[ev.stage] || ev.stage}${sub}`;
      if (p && p.stage === 'video') jobBar($('st-job-label').textContent, p);
    } else if (ev.type === 'batch') {
      $('st-job-label').textContent = `Video ${ev.index + 1} of ${ev.total} · ${ev.scenario} · seed ${ev.seed}`;
    } else if (ev.type === 'item') {
      refresh();
    } else if (ev.type === 'paused') toast(ev.reason, 8000);
    else if (ev.type === 'stopped') toast(ev.reason, 9000);
  }

  function generatePanel(show) { $('st-gen').classList.toggle('hidden', !show); }

  async function startBatch() {
    const count = Number($('st-count').value) || 1;
    const pattern = $('st-pattern').value, captions = $('st-captions').value;
    generatePanel(false);
    state.tab = 'review';
    await run(`Generating ${count} video${count > 1 ? 's' : ''}`, async () => {
      const res = await state.pipeline.runBatch({ count, pattern, captions, owner: 'ui' });
      const ok = res.filter((r) => r.status === 'candidate').length;
      toast(`Batch finished: ${ok} candidate${ok === 1 ? '' : 's'} ready for review, ${res.length - ok} rejected or failed.`, 6000);
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

  async function init() {
    state.info = await S().info();
    state.debug = state.info.debug || {};
    state.pipeline = new Pipeline({ onEvent, debug: state.debug });
    const sel = $('st-pattern');
    sel.innerHTML = '<option value="random">Random pattern</option>' + listedScenarios().map((s) => `<option value="${s.key}">${s.label}</option>`).join('');
    for (const t of ['review', 'accepted', 'rejected']) $(`st-tab-${t}`).onclick = () => { state.tab = t; state.sel = 0; render(); };
    $('st-generate').onclick = () => generatePanel($('st-gen').classList.contains('hidden'));
    $('st-start').onclick = startBatch;
    $('st-gen-cancel').onclick = () => generatePanel(false);
    $('st-cancel').onclick = () => state.pipeline.cancel();
    $('st-live').onclick = () => { $('studio').classList.add('hidden'); onLivePlay(); };
    $('st-player-close').onclick = () => { $('st-video').pause(); $('st-player').close(); };
    document.querySelectorAll('#st-counts button').forEach((b) => { b.onclick = () => { $('st-count').value = b.dataset.n; }; });
    window.addEventListener('keydown', keys);
    const q = await S().queue('load');
    if (q && q.count > q.done) toast(`A batch was interrupted (${q.done} of ${q.count} done). Press Generate to start a new one.`, 8000);
    await refresh();
  }

  return { init, refresh, show() { $('studio').classList.remove('hidden'); refresh(); }, pipeline: () => state.pipeline, state };
}
