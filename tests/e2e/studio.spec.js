// Studio pipeline tests: UI generate → review → accept (verified master) → reproduce → reject,
// plus failure injection (quota, ignored bitrate) and crash recovery.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const FFPROBE = require('ffprobe-static').path;
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `sc-${name}-`));
const statuses = (lib) => (fs.existsSync(path.join(lib, 'videos')) ? fs.readdirSync(path.join(lib, 'videos')) : [])
  .map((id) => { try { return JSON.parse(fs.readFileSync(path.join(lib, 'videos', id, 'status.json'), 'utf8')); } catch { return null; } }).filter(Boolean);

function cli(lib, extra) {
  const r = spawnSync(ELECTRON, ['.', '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`, ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('STUDIO_RESULT '));
  return { code: r.status, result: line ? JSON.parse(line.slice('STUDIO_RESULT '.length)) : null, out: r.stdout };
}

test.describe.configure({ mode: 'serial' });

test('UI: generate, review, accept with verified master, reproduce, reject', async () => {
  const lib = tmp('ui');
  const app = await electron.launch({ args: [ROOT, '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`], cwd: ROOT });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#studio:not(.hidden)');

  await page.click('#st-generate');
  await page.selectOption('#st-pattern', 'split-chamber@3');
  await page.fill('#st-count', '2');
  await page.selectOption('#st-captions', 'en');
  await page.click('#st-start');
  await expect(page.locator('#st-job')).toBeHidden({ timeout: 10 * 60 * 1000 });
  const after = statuses(lib);
  expect(after.length).toBe(2);
  const cands = after.filter((s) => s.status === 'candidate');
  expect(cands.length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#st-tab-review b')).toHaveText(String(cands.length));

  // accept the selected (highest score) candidate with the keyboard
  await page.locator('#st-grid .card').first().click();
  await page.keyboard.press('a');
  await expect(page.locator('#st-tab-accepted b')).toHaveText('1', { timeout: 10 * 60 * 1000 });
  const acc = statuses(lib).find((s) => s.status === 'accepted');
  const master = path.join(lib, 'videos', acc.id, acc.masters.default.file);
  const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,nb_read_frames', '-of', 'json', master]));
  const v = probe.streams.find((x) => x.codec_type === 'video');
  expect([v.width, v.height, v.avg_frame_rate]).toEqual([1080, 1920, '60/1']);
  expect(Number(v.nb_read_frames)).toBe(acc.frameCount);
  expect(probe.streams.some((x) => x.codec_type === 'audio')).toBe(true);
  expect(acc.masters.default.quality.accuracy).toMatch(/^(\d+)\/\1$/);
  expect(fs.existsSync(path.join(lib, 'videos', acc.id, '_truth'))).toBe(false);

  // reproduce: identical frames
  await page.click('#st-tab-accepted');
  await page.locator('#st-grid .card').first().click();
  await page.click('#st-actions button:has-text("Reproduce")');
  await expect(page.locator('#toast')).toContainText('Identical', { timeout: 5 * 60 * 1000 });

  // reject the remaining candidate (if any) with a reason tag
  if (cands.length > 1) {
    await page.click('#st-tab-review');
    await page.locator('#st-grid .card').first().click();
    await page.click('#st-actions .tags span:has-text("boring")');
    await page.keyboard.press('r');
    await expect(page.locator('#st-tab-rejected b')).toHaveText(String(after.length - cands.length + 1), { timeout: 60000 });
    const rej = statuses(lib).find((s) => s.status === 'rejected' && s.rejectedAt === 'review');
    expect(rej.reasons).toContain('boring');
    expect(fs.readdirSync(path.join(lib, 'videos', rej.id)).sort()).toEqual(['config.json', 'metrics.json', 'status.json']);
    expect(fs.readFileSync(path.join(lib, 'rejected.jsonl'), 'utf8')).toContain(rej.id);
  }
  expect(errors).toEqual([]);
  await app.close();
});

test('UI: batch summary, live view of the running video, and per-video explanation', async () => {
  const lib = tmp('batch');
  const app = await electron.launch({ args: [ROOT, '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`], cwd: ROOT });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#studio:not(.hidden)');

  await page.click('#st-help');
  await expect(page.locator('#st-howto')).toBeVisible();
  await page.click('#st-howto-close');

  await page.click('#st-generate');
  await page.selectOption('#st-pattern', 'jaws@2');
  await page.fill('#st-count', '2');
  await page.evaluate(() => { window.__splitChamber.testSeeds = [301, 302]; });   // fixed seeds: same outcome every run
  await page.click('#st-start');
  // while the batch runs: the header button watches the video being made right now
  await expect(page.locator('#st-live')).toHaveText('● Watch live', { timeout: 60000 });
  await expect(page.locator('#st-batch')).toContainText('Running batch');
  await page.click('#st-live');
  await expect(page.locator('#hud-live')).toContainText('LIVE · video 1 of 2');
  await page.waitForFunction(() => window.__splitChamber.state.shown > 60, null, { timeout: 30000 });
  expect(await page.evaluate(() => window.__splitChamber.state.session.meta.scenario)).toBe('jaws@2');
  await page.keyboard.press('Escape');            // pause
  await page.click('#btn-menu1');                 // leaves the live view: back to the Studio
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#st-job')).toBeHidden({ timeout: 10 * 60 * 1000 });

  const all = statuses(lib);
  expect(all.length).toBe(2);
  expect(new Set(all.map((s) => s.batch && s.batch.id)).size).toBe(1);
  expect(all.every((s) => Array.isArray(s.checks) && s.checks.length >= 6)).toBe(true);
  expect(all.map((s) => s.seed).sort()).toEqual([301, 302]);
  // the same buckets the panel uses: review = candidate or mastering, auto-rejected = rejected by the checks
  const review = all.filter((s) => s.status === 'candidate' || s.status === 'mastering').length;
  const rejected = all.filter((s) => s.status === 'rejected' && s.rejectedAt !== 'review').length;
  await expect(page.locator('#st-batch')).toContainText('Last batch');
  await expect(page.locator('#st-batch .chip.review b')).toHaveText(String(review));
  await expect(page.locator('#st-batch .chip.bad b').first()).toHaveText(String(rejected));
  await expect(page.locator('#st-live')).toHaveText('Live play');

  // the selected video explains every check and its score
  await page.click(review ? '#st-tab-review' : '#st-tab-rejected');
  await page.locator('#st-grid .card').first().click();
  await expect(page.locator('#st-actions .st-why')).toContainText('Why');
  await expect(page.locator('#st-actions .st-why')).toContainText('Hook (first split)');
  if (review) await expect(page.locator('#st-actions .st-why')).toContainText('Score');
  expect(errors).toEqual([]);
  await app.close();
});

test('UI: an invented machine gets its badge and can be saved as a pattern', async () => {
  const lib = tmp('invent');
  const app = await electron.launch({ args: [ROOT, '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`], cwd: ROOT });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#studio:not(.hidden)');
  await page.click('#st-generate');
  await page.selectOption('#st-pattern', 'invent@3');
  await page.fill('#st-count', '1');
  await page.evaluate(() => { window.__splitChamber.testSeeds = [6]; });
  await page.click('#st-start');
  await expect(page.locator('#st-job')).toBeHidden({ timeout: 10 * 60 * 1000 });
  const st = statuses(lib)[0];
  expect(st.invented && st.invented.name).toBeTruthy();
  expect(st.label).toContain('Invented');
  expect(st.checks.some((c) => c.name.startsWith('A machine you'))).toBe(st.status !== 'rejected' || st.rejectedAt === 'analyse');
  await page.click(st.status === 'candidate' ? '#st-tab-review' : '#st-tab-rejected');
  await expect(page.locator('#st-grid .card .badge-invented').first()).toBeVisible();
  if (st.status === 'candidate') {
    await page.locator('#st-grid .card').first().click();
    await page.fill('#st-save-name', 'Test Arm');
    await page.click('#st-save-btn');
    await expect(page.locator('#st-pattern option[value="mine-test-arm@1"]')).toHaveCount(1);
    const saved = JSON.parse(fs.readFileSync(path.join(lib, 'patterns.json'), 'utf8'));
    expect(saved.map((p) => p.key)).toContain('mine-test-arm@1');
  }
  expect(errors).toEqual([]);
  await app.close();
});

test('UI: the Balls field makes the arena full at the count asked', async () => {
  const lib = tmp('balls');
  const app = await electron.launch({ args: [ROOT, '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`], cwd: ROOT });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#studio:not(.hidden)');
  await page.click('#st-generate');
  // the count is built into invent@2 only, which is no longer in the list
  await page.evaluate(() => { document.getElementById('st-pattern').add(new Option('✦ Invent (v2)', 'invent@2')); });
  await page.selectOption('#st-pattern', 'invent@2');
  await page.fill('#st-count', '1');
  // the field is switched off in the panel for now: show it the way turning it back on would
  await page.evaluate(() => { for (const id of ['st-balls-label', 'st-ballsets']) document.getElementById(id).classList.remove('hidden'); });
  await page.click('#st-ballsets button[data-n="3000"]');
  await expect(page.locator('#st-balls')).toHaveValue('3000');
  await page.evaluate(() => { window.__splitChamber.testSeeds = [6]; });
  await page.click('#st-start');
  await expect(page.locator('#st-job')).toBeHidden({ timeout: 12 * 60 * 1000 });
  const st = statuses(lib)[0];
  expect(st.controls.balls).toBe(3000);
  const cfg = JSON.parse(fs.readFileSync(path.join(lib, 'videos', st.id, 'config.json'), 'utf8'));
  expect(cfg.machine.maxBalls).toBe(3000);
  expect(cfg.machine.ballR).toBeLessThan(7);
  if (st.capN) expect(st.capN).toBeLessThanOrEqual(3000);   // the finale starts at the count, or earlier if time runs out
  expect(errors).toEqual([]);
  await app.close();
});

test('UI: a rejected video keeps a picture, replays live and can be accepted anyway', async () => {
  const lib = tmp('rejected');
  const app = await electron.launch({ args: [ROOT, '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`], cwd: ROOT });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#studio:not(.hidden)');
  await page.click('#st-generate');
  await page.selectOption('#st-pattern', 'shears-fan@1');
  await page.fill('#st-count', '1');
  await page.evaluate(() => { window.__splitChamber.testSeeds = [210700]; });   // rejected in the simulation stage
  await page.click('#st-start');
  await expect(page.locator('#st-job')).toBeHidden({ timeout: 5 * 60 * 1000 });
  const st = statuses(lib)[0];
  expect(st.status).toBe('rejected');
  expect(st.rejectedAt).toBe('simulate');
  expect(st.thumb).toBe('thumb.jpg');
  expect(fs.statSync(path.join(lib, 'videos', st.id, 'thumb.jpg')).size).toBeGreaterThan(2000);
  await page.click('#st-tab-rejected');
  await page.waitForFunction(() => { const i = document.querySelector('#st-grid .card img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await page.locator('#st-grid .card').first().click();
  await expect(page.locator('#st-actions button', { hasText: 'Accept anyway' })).toBeVisible();
  await page.locator('#st-actions button', { hasText: 'Play' }).first().click();
  await expect(page.locator('#hud-live')).toContainText('REPLAY');
  await page.waitForFunction(() => window.__splitChamber.state.shown > 30, null, { timeout: 30000 });
  expect(errors).toEqual([]);
  await app.close();
});

test('CLI: tiny quota stops the batch with a clear message and no partial files', () => {
  const lib = tmp('quota');
  const r = cli(lib, ['--generate=2', '--pattern=split-chamber@2', '--seeds=11,12', '--quota-mb=1']);
  expect(r.result).not.toBeNull();
  expect(r.result.results[0].error).toMatch(/quota/i);
  for (const s of statuses(lib)) expect(s.status).not.toBe('generating');
  const leftovers = [];
  for (const id of fs.readdirSync(path.join(lib, 'videos'))) for (const f of fs.readdirSync(path.join(lib, 'videos', id))) if (/part|tmp/.test(f)) leftovers.push(f);
  expect(leftovers).toEqual([]);
  expect(fs.existsSync(path.join(lib, 'studio.lock'))).toBe(false);
});

test('CLI: encoders that miss a forced bitrate floor are rejected; constant-quality x264 takes over', () => {
  const lib = tmp('bitrate');
  const r = cli(lib, ['--generate=1', '--pattern=split-chamber@2', '--seeds=21', '--accept-all', '--min-bitrate-ratio=50']);
  expect(r.result).not.toBeNull();
  const st = statuses(lib)[0];
  // every rate-controlled engine fails the (deliberately impossible) floor and is recorded …
  const rateControlled = st.attempts.filter((a) => a.engine !== 'ff-x264');
  expect(rateControlled.length).toBeGreaterThan(0);
  for (const a of rateControlled) expect(a.error || '').toMatch(/bitrate/i);
  // … and the CRF x264 fallback (no bitrate target) still has to pass the SSIM quality gate
  expect(st.status).toBe('accepted');
  expect(st.masters.default.engine).toMatch(/x264/);
  const [ok, of] = st.masters.default.quality.accuracy.split('/').map(Number);
  expect(of).toBeGreaterThan(0);
  expect(ok).toBe(of);
});

test('Recovery: interrupted work and a stale lock are cleaned up on start', async () => {
  const lib = tmp('recover');
  const d = path.join(lib, 'videos', 'deadbeef0001');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ id: 'deadbeef0001', status: 'generating', scenario: 'split-chamber@2', seed: 5, createdAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(d, 'preview.mp4.part.mp4'), 'partial');
  fs.writeFileSync(path.join(d, 'status.json.123.tmp'), 'half-written');
  fs.writeFileSync(path.join(lib, 'studio.lock'), JSON.stringify({ pid: 999999, owner: 'crashed' }));
  const app = await electron.launch({ args: [ROOT, '--mute', `--library=${lib}`, `--out-dir=${path.join(lib, 'out')}`], cwd: ROOT });
  const page = await app.firstWindow();
  await page.waitForSelector('#studio:not(.hidden)');
  await page.click('#st-tab-rejected');
  await expect(page.locator('#st-grid .card')).toHaveCount(1);
  const st = statuses(lib)[0];
  expect(st.status).toBe('failed');
  expect(st.reasons).toContain('interrupted');
  expect(fs.readdirSync(d).sort()).toEqual(['status.json']);
  // the stale lock (dead pid) does not block a new batch
  const ok = await page.evaluate(async () => { await window.host.studio.lock('test'); await window.host.studio.unlock(); return true; });
  expect(ok).toBe(true);
  await app.close();
});
