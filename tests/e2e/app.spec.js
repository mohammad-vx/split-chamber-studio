// Full-application tests: Play, auto session save, Export + independent ffprobe check, Replay,
// pause/resume, restart, play without keeping a session, opening a saved session, export cancel.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FFPROBE = require('ffprobe-static').path;
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'splitchamber-e2e-'));
const SESSIONS = path.join(OUT, 'Sessions');

let app, page;
const consoleErrors = [];

function probe(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,duration', '-of', 'json', file]);
  const s = JSON.parse(out).streams;
  return { v: s.find((x) => x.codec_type === 'video'), a: s.find((x) => x.codec_type === 'audio') };
}
const mp4s = () => fs.readdirSync(OUT).filter((f) => f.endsWith('.mp4'));
const leftovers = () => fs.readdirSync(OUT).filter((f) => /\.part|\.tmp/.test(f));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await electron.launch({ args: [ROOT, `--out-dir=${OUT}`], cwd: ROOT });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.waitForSelector('#menu:not(.hidden)');
});

test.afterAll(async () => { if (app) await app.close(); });

async function playToEnd(seed, keep = true) {
  if (!(await page.isVisible('#opt-seed'))) await page.click('details summary');
  await page.fill('#opt-seed', String(seed));
  const checked = await page.isChecked('#opt-keep');
  if (checked !== keep) await page.click('label.toggle');
  await page.click('#btn-play');
  await page.waitForSelector('#end:not(.hidden)', { timeout: 120000 });
}

test('menu renders with the GPU ball layer and no errors', async () => {
  await expect(page.locator('#menu h1')).toHaveText('Split Chamber');
  expect(await page.evaluate(() => window.__splitChamber.renderer())).toBe('webgl2');
  expect(consoleErrors).toEqual([]);
});

test('Play runs to the 10,000 finale and auto-saves the session', async () => {
  const t0 = Date.now();
  await playToEnd(1234, true);
  const wall = (Date.now() - t0) / 1000;
  const st = await page.evaluate(() => ({ ...window.__splitChamber.stats, frames: window.__splitChamber.state.session.frames.length, cap: window.__splitChamber.state.session.meta.capFrame }));
  const previewFps = st.drawn / ((st.lastAt - st.startedAt) / 1000);
  console.log(`play: wall ${wall.toFixed(1)} s, frames ${st.frames}, drawn ${st.drawn}, preview ${previewFps.toFixed(1)} fps, holds ${st.holds}, skipped ${st.skipped}, worst gap ${st.worstGap.toFixed(1)} ms`);
  expect(st.cap).toBeGreaterThan(0);
  expect(previewFps).toBeGreaterThan(40);
  await expect(page.locator('#end-session')).toContainText('Session saved', { timeout: 20000 });
  expect(fs.readdirSync(SESSIONS).filter((f) => f.endsWith('.scsession')).length).toBe(1);
});

test('Export produces a verified 1080x1920 60 fps MP4 with audio', async () => {
  await page.click('#btn-export');
  await expect(page.locator('#ex-title')).toHaveText('Video ready', { timeout: 300000 });
  const file = (await page.textContent('#ex-path')).trim();
  expect(fs.existsSync(file)).toBe(true);
  const frames = await page.evaluate(() => window.__splitChamber.state.session.frames.length);
  const { v, a } = probe(file);
  expect(v.codec_name).toBe('h264');
  expect([v.width, v.height]).toEqual([1080, 1920]);
  expect(v.avg_frame_rate).toBe('60/1');
  expect(Number(v.nb_read_frames)).toBe(frames);
  expect(Math.abs(Number(v.duration) - frames / 60)).toBeLessThan(1 / 60);
  expect(a && a.codec_name).toBe('aac');
  expect(Math.abs(Number(a.duration) - frames / 60)).toBeLessThan(0.05);
  expect(leftovers()).toEqual([]);
  console.log('export:', (await page.locator('#ex-summary').innerText()).replace(/\n/g, ' | '));
  await page.click('#btn-ex-done');
});

test('Replay, pause and resume work from session data', async () => {
  await page.click('#btn-replay');
  await page.waitForTimeout(3000);
  await page.keyboard.press('Space');
  await expect(page.locator('#paused')).toBeVisible();
  const f1 = await page.evaluate(() => window.__splitChamber.state.shown);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__splitChamber.state.shown)).toBe(f1);
  await page.click('#btn-resume');
  await page.waitForSelector('#end:not(.hidden)', { timeout: 120000 });
});

test('A second export of the same session gets a new file name', async () => {
  const before = mp4s();
  await page.click('#btn-export');
  await expect(page.locator('#ex-title')).toHaveText('Video ready', { timeout: 300000 });
  const after = mp4s();
  expect(after.length).toBe(before.length + 1);
  await page.click('#btn-ex-done');
});

test('Cancelling an export leaves no partial files', async () => {
  const before = mp4s();
  await page.click('#btn-export');
  await expect(page.locator('#ex-stats')).toContainText('Frame', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.click('#btn-ex-cancel');
  await expect(page.locator('#ex-title')).toHaveText('Export cancelled', { timeout: 30000 });
  await page.waitForTimeout(1000);
  expect(mp4s()).toEqual(before);
  expect(leftovers()).toEqual([]);
  await page.click('#btn-ex-done');
});

test('Restart mid-run starts a new simulation without errors', async () => {
  await page.click('#btn-again');
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(2500);
  const shown = await page.evaluate(() => window.__splitChamber.state.shown);
  expect(shown).toBeGreaterThan(30);
  expect(shown).toBeLessThan(400);
  await page.keyboard.press('Escape');
  await expect(page.locator('#paused')).toBeVisible();
  await page.click('#btn-menu1');
  await expect(page.locator('#menu')).toBeVisible();
});

test('Play without keeping a session: no export, no session file', async () => {
  const sessionsBefore = fs.readdirSync(SESSIONS).length;
  await playToEnd(777, false);
  await expect(page.locator('#btn-export')).toBeHidden();
  expect(fs.readdirSync(SESSIONS).length).toBe(sessionsBefore);
  await page.click('#btn-menu2');
  await page.click('label.toggle'); // turn keeping back on
});

test('A saved session can be reopened and exported without re-simulating', async () => {
  const file = path.join(SESSIONS, fs.readdirSync(SESSIONS).find((f) => f.endsWith('.scsession')));
  await page.evaluate((f) => window.__splitChamber.openSession(f), file);
  await expect(page.locator('#end-title')).toHaveText('Session loaded');
  const before = mp4s();
  await page.click('#btn-export');
  await expect(page.locator('#ex-title')).toHaveText('Video ready', { timeout: 300000 });
  expect(mp4s().length).toBe(before.length + 1);
  await page.click('#btn-ex-done');
});

test('no console errors during the whole run', async () => {
  expect(consoleErrors).toEqual([]);
});
