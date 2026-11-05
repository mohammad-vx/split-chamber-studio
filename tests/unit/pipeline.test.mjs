import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkRun, checkAudio, checkVideo, checkQuality, curveDescriptor, findDuplicate, hamming, score, LIMITS } from '../../src/pipeline/checks.js';
import { runHeadless } from '../../src/sim/run.js';
import { getScenario } from '../../src/scenarios/index.js';
import { captionFor } from '../../src/render/captions.js';
import { makeMusicPlan } from '../../src/audio/music.js';

const require = createRequire(import.meta.url);
const { createLibrary, configId } = require('../../lib/library.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-unit-'));

test('library: atomic status, list, update, remove media keeps config', async () => {
  const lib = createLibrary(tmp(), { quotaBytes: 1e9 });
  await lib.writeStatus('a1', { id: 'a1', status: 'candidate', createdAt: '2026-01-01' });
  await lib.writeStatus('b2', { id: 'b2', status: 'accepted', createdAt: '2026-01-02' });
  fs.writeFileSync(path.join(lib.dir('a1'), 'preview.mp4'), 'x'.repeat(1000));
  fs.writeFileSync(path.join(lib.dir('a1'), 'config.json'), '{}');
  const list = await lib.list();
  assert.deepEqual(list.map((s) => s.id), ['b2', 'a1']);
  assert.ok(fs.existsSync(path.join(lib.root, 'library.json')));
  assert.equal((await lib.usage()).bytes > 1000, true);
  await lib.update('a1', { status: 'rejected' });
  await lib.removeMedia('a1');
  assert.deepEqual(fs.readdirSync(lib.dir('a1')).sort(), ['config.json', 'status.json']);
  assert.equal((await lib.readStatus('a1')).status, 'rejected');
});

test('library: lock is exclusive, stale locks are taken over', async () => {
  const root = tmp();
  const a = createLibrary(root), b = createLibrary(root);
  await a.lock('ui');
  fs.writeFileSync(path.join(root, 'studio.lock'), JSON.stringify({ pid: process.ppid, owner: 'other' })); // alive pid
  await assert.rejects(() => b.lock('cli'), /Another Split Chamber Studio instance/);
  fs.writeFileSync(path.join(root, 'studio.lock'), JSON.stringify({ pid: 999999, owner: 'crashed' }));    // dead pid
  await b.lock('cli');
  await b.unlock();
  assert.equal(fs.existsSync(path.join(root, 'studio.lock')), false);
});

test('library: recovery fails interrupted generations and deletes partial files', async () => {
  const lib = createLibrary(tmp());
  await lib.writeStatus('g1', { id: 'g1', status: 'generating' });
  await lib.writeStatus('m1', { id: 'm1', status: 'mastering' });
  fs.writeFileSync(path.join(lib.dir('g1'), 'preview.mp4.part.mp4'), 'p');
  fs.writeFileSync(path.join(lib.dir('m1'), 'master.mp4.wav.tmp'), 'w');
  const fixed = await lib.recover();
  assert.ok(fixed.length >= 4);
  assert.equal((await lib.readStatus('g1')).status, 'failed');
  assert.equal((await lib.readStatus('m1')).status, 'candidate');
  assert.deepEqual(fs.readdirSync(lib.dir('g1')), ['status.json']);
});

test('library: rejected log, seen seeds, config ids ignore caption/appVersion', async () => {
  const lib = createLibrary(tmp());
  await lib.appendRejected({ scenario: 'x@1', seed: 5 });
  await lib.writeStatus('s1', { id: 's1', scenario: 'x@1', seed: 9, status: 'accepted' });
  assert.deepEqual((await lib.seenSeeds('x@1')).sort(), [5, 9]);
  const c = getScenario('split-chamber@2').generate(3);
  assert.equal(configId(c), configId({ ...c, appVersion: '9', caption: { lang: 'en' } }));
  assert.notEqual(configId(c), configId(getScenario('split-chamber@2').generate(4)));
});

test('checks: a normal run passes, broken ones are rejected with reasons', () => {
  const cfg = getScenario('orbit-crusher@1').generate(201);
  const s = runHeadless(cfg);
  assert.deepEqual(checkRun(cfg, s), []);
  assert.ok(checkRun(cfg, { ...s, durationS: 70 }).some((r) => /duration/.test(r)));
  assert.ok(checkRun(cfg, { ...s, hookFrame: -1 }).some((r) => /hook/.test(r)));
  assert.ok(checkRun(cfg, { ...s, nonFinite: true }).some((r) => /unstable/.test(r)));
  assert.ok(checkRun(cfg, { ...s, capFrame: -1 }).some((r) => /climax/.test(r)));
  assert.deepEqual(checkAudio({ lufs: -14.5, truePeak: -1.4, longestSilence: 0 }), []);
  assert.equal(checkAudio({ lufs: -22, truePeak: 0.2, longestSilence: 2 }).length, 3);
  assert.deepEqual(checkVideo({ longestFreeze: 0, longestBlack: 0 }), []);
  assert.equal(checkVideo({ longestFreeze: 2.4, longestBlack: 1 }).length, 2);
  assert.deepEqual(checkQuality({ ssimMin: 0.97, ssimMean: 0.98, accurate: 5, checked: 5 }), []);
  assert.equal(checkQuality({ ssimMin: 0.9, ssimMean: 0.92, accurate: 4, checked: 5 }).length, 3);
});

test('dedup: identical descriptors are duplicates, different ones are not', () => {
  const s = runHeadless(getScenario('split-chamber@2').generate(31));
  const curve = curveDescriptor(s.timeline);
  const d1 = { curve, dhash: Array(8).fill('f0f0f0f0f0f0f0f0') };
  assert.equal(hamming('ff', 'f0'), 4);
  assert.equal(findDuplicate(d1, [{ id: 'x', descriptor: d1 }]).duplicate, true);
  const d2 = { curve: curve.map((v, i) => (i % 2 ? v * 0.6 : v)), dhash: Array(8).fill('0f0f0f0f0f0f0f0f') };
  assert.equal(findDuplicate(d2, [{ id: 'x', descriptor: d1 }]).duplicate, false);
  const sc = score(getScenario('split-chamber@2').generate(31), s, { lufs: -14 }, null);
  assert.ok(sc > 50 && sc <= 100);
  assert.ok(LIMITS.hookMaxS <= 3);
});

test('captions and music plans are deterministic per seed', () => {
  const c = getScenario('orbit-crusher@1').generate(77);
  assert.deepEqual(captionFor(c, 'ar'), captionFor(c, 'ar'));
  assert.match(captionFor(c, 'en').text, /\w/);
  assert.match(captionFor(c, 'ar').text, /[؀-ۿ]/);
  assert.equal(captionFor(c, 'none'), null);
  assert.ok(!/[٠-٩]/.test(captionFor(getScenario('split-chamber@2').generate(5), 'ar').text)); // Western digits (Q3)
  assert.deepEqual(makeMusicPlan(c), makeMusicPlan(c));
  assert.equal(makeMusicPlan(c).bpm, c.tempo.bpm);
});
