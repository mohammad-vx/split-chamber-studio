# Split Chamber

One ball sits in a round chamber with four steel presses. Each time a pair of presses slams shut, any ball caught between them splits into three. The count climbs from 1 to 10,000 in about 16 seconds. Then the whole swarm turns gold and an end card fades in.

The app has two separate modes:

| | What happens | Cost |
|---|---|---|
| **Play** | The simulation runs live, with sound. | No recording or encoding. |
| **Export** | After a run, a high-quality video is rendered offline, one frame at a time, from the saved session data. | Takes about 45 s for a 25 s video on an Intel i3 laptop. The game stays responsive meanwhile. |

Every finished run is saved as a small **session file**. You can replay or export it at any time, even after closing the app, and the simulation never runs again.

---

## Start it

**Option A: portable app (recommended).** Run `dist\SplitChamber-1.0.0-portable.exe`. Nothing to install.

**Option B: installer.** Run `dist\SplitChamber-1.0.0-setup.exe`. It adds a Start-menu entry.

**Option C: from the project folder.** Double-click **`Start Split Chamber.bat`**. This needs `npm install` to have been run once.

## Controls

| Key / button | Action |
|---|---|
| **Play** / Space (in the menu) | Start a new run (random seed) |
| Space | Pause / resume |
| R | Restart with a new seed |
| Esc | Pause; press again for the main menu |
| F | Full screen |
| E (end screen) | Export video |

## Making a video

1. In the menu, leave **"Keep session so I can export a video"** switched on (the default).
2. Press **Play** and watch the run. Nothing is recorded or encoded while you watch.
3. When the end screen appears, the session is already saved. Press **Export video**.
4. A progress bar shows frames, encoder speed and time left. When it finishes, the app checks the file with `ffprobe` and only then shows **"✓ Saved and verified"** with the file location. **Show in folder** opens it.

You can also replay first (**Replay**), export the same run again (each export gets a new file name), or open an older run with **Open session…**.

With the switch **off**, nothing is kept in memory and there is nothing to export: the cheapest way to just watch.

### Where files go

| What | Where |
|---|---|
| Videos | `%USERPROFILE%\Videos\Split Chamber\SplitChamber_2026-11-05_18-42-07_seed123456.mp4` |
| Sessions | `%USERPROFILE%\Videos\Split Chamber\Sessions\*.scsession` (about 30 MB each) |
| Log | `%APPDATA%\Split Chamber\logs\main.log` |

Files are never overwritten: a clash gets `_2`, `_3`, and so on. An export is written to a temporary `.part` file and renamed only after it passes verification. Leftover partial files from a crash are cleaned up the next time the app starts. Your session is unaffected, so you can simply export again.

### Video format

* 1080 × 1920 (9:16 vertical), exactly 60 fps, constant frame rate
* H.264 High, yuv420p, BT.709 limited range, `+faststart` (ready for Instagram, TikTok, YouTube Shorts)
* AAC 48 kHz stereo audio, generated from the same session data, so it is sample-accurate to the picture
* 32 Mbps by default; **Advanced → Quality** offers 24 or 45 Mbps

After every export the app runs `ffprobe` and checks codec, resolution, both frame-rate fields, exact frame count (every frame is decoded), video duration, pixel format and that the audio duration matches. If any check fails, the file is discarded and the error is shown.

### Encoder choice

**Advanced → Video encoder** defaults to **Automatic**, which tries these in order:

1. **MediaBunny · WebCodecs hardware**: fastest, high quality
2. **FFmpeg · GPU encoder** (Intel QSV / NVIDIA NVENC / AMD AMF / Media Foundation, whichever works)
3. **MediaBunny · WebCodecs software**
4. **FFmpeg · x264** (software, always available)

The first one that works is used. The order comes from measurements on this machine; see [docs/BENCHMARK.md](docs/BENCHMARK.md).

**Advanced → Seed** replays a specific run. The same seed always gives the identical run.

---

## For developers

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run dist
```

`npm test` runs the unit tests (determinism, session format, physics invariants). `npm run test:e2e` runs the Playwright tests, which drive the real app: play, export, replay, cancel, restart and reopening a session. `npm run dist` builds the portable `.exe` and installer into `dist\`.

Encoder benchmark (writes `results.json`, the MP4s and ground-truth PNGs to the folder you pass):

```bash
node_modules\electron\dist\electron.exe . --bench --seed=1234 --bench-out=C:\temp\bench --out-dir=C:\temp\bench\out
```

```bash
node tools/compare.mjs C:\temp\bench
```

Other tools: `node tools/simstats.mjs 1 2 3` prints the count-versus-time curve against the reference. `node tools/tune.mjs '[[...]]'` grid-searches the fission constants. `node tools/density.mjs` prints a text density map of the swarm.

See [docs/TECHNICAL.md](docs/TECHNICAL.md) for the architecture.

### Dependencies

| Package | Why |
|---|---|
| `electron` 45 | Desktop shell; bundles Chromium (WebGL2, WebCodecs, Web Audio) |
| `mediabunny` | MP4 muxing + WebCodecs encoding for the primary export path |
| `ffmpeg-static` (FFmpeg 6.1) | Fallback encoders, lossless remux to `+faststart`, audio mux |
| `ffprobe-static` | Post-export verification |
| `electron-builder` (dev) | Portable `.exe` + NSIS installer |
| `@playwright/test` (dev) | End-to-end tests of the real app |

No OBS, no screen capture, no network access, no external services.

### Agent skills used

Two skills are installed **project-locally** in `.claude/skills/`. They are copied verbatim from the reviewed versions, contain no scripts, and nothing was installed globally:

* `export-video`: from `olivierestevez/oli-skills` (frame-by-frame export with MediaBunny)
* `electron-builder`: from `pedronauck/skills` (Windows packaging)

Already-installed skills that were reused: `playwright-best-practices` (end-to-end tests) and `systematic-debugging`. `pixijs-performance` was kept as a backup and **not installed**. Canvas 2D profiling did show the ball layer was too slow, but a small WebGL2 point renderer (`src/render/balls-gl.js`) solved it without PixiJS.

## Known limitations

* **Windows x64 only** (that is what was built and tested).
* **Preview smoothness depends on the GPU.** On the Intel UHD test laptop the live preview ran at 47–58 fps. When the screen can't keep up, the preview skips a frame rather than slowing the simulation. **Exports are unaffected** and always contain every frame at exactly 60 fps.
* **The FFmpeg export paths are slower** (5–13 fps here), because every frame must be read back from the GPU. They exist as fallbacks.
* The portable `.exe` unpacks itself on every launch, so it starts a few seconds slower than the installed version.
* The app is not code-signed, so Windows SmartScreen may ask for confirmation the first time ("More info → Run anyway").
* Sessions store the recorded ball positions, not just the seed, so an old session replays exactly even if the physics changes in a later version. Re-simulating a seed in a different version can give a different run.
