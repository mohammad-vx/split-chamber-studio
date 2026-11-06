# Split Chamber Studio



https://github.com/user-attachments/assets/40776ce7-33b2-4495-8a53-636f7ce657af



### What's new in 3.2 (40 s, with sound)

[![What's new in Split Chamber Studio 3.2](docs/media/promo-3.2-poster.jpg)](docs/media/promo-3.2.mp4)

Six new machines built from parts mounted on parts · **✦ Invent**: machines the app designs by itself, now tuned so
9 in 10 pass the checks · every rejected video keeps a picture, replays live and can be accepted anyway ·
**★ Save as pattern** for the inventions you love.

A desktop tool that **generates satisfying ball-simulation videos automatically**. You choose a pattern, how many videos you want and the caption language, then press **Generate**. Every video is:

- simulated deterministically, so it can be reproduced exactly from its seed;
- checked automatically (length, a hook in the first seconds, stability, emptiness, loudness, frozen picture, duplicates);
- rendered as a small preview for you to review.

Videos you accept are rendered as a verified **1080×1920 · 60 fps** master with synchronized sound effects and music.

**Live play** opens the game (any of the 7 patterns, sessions, manual export). While a batch is running the same button becomes **● Watch live** and shows the video being made right now.

Press **How it works** in the Studio for the whole flow; select any video to see every check it went through (✓/✗, measured value, limit) and how its score was calculated. After every batch the **Last batch** panel shows how many videos were requested, how many wait for review, how many were rejected and why.

---

## Start it

- **Portable:** `dist\SplitChamberStudio-2.0.0-portable.exe`. Nothing to install.
- **Installer:** `dist\SplitChamberStudio-2.0.0-setup.exe`.
- **From the project folder:** double-click `Start Split Chamber.bat`. This needs `npm install` to have been run once.

## Making videos

1. Press **+ Generate**.
2. Choose a **pattern** (or *Random*), the **number of videos** (1, 5, 10, 20, 50 or any number) and the **text** (English, Arabic or none).
3. Press **Start**. The bar shows the current video, the stage (simulate, soundtrack, preview, checks) and progress. **Stop** ends the batch.
4. Candidates appear under **Waiting for review**, sorted by score. Videos that fail a check are rejected automatically, with the reason shown under **Rejected**.
5. Select a candidate:
   - **▶ Play** (or Enter) watches the preview.
   - **✓ Accept** (or A) renders the full master and verifies it.
   - **✗ Reject** (or R): tick a reason first (boring, too similar, glitch, audio, other).
6. Accepted videos:
   - **Reproduce** re-runs the simulation and proves every frame is identical (it re-renders the master if you deleted it).
   - **Export EN / AR / no-text version** renders the same video with another caption, without re-simulating.
   - **New variation** generates the same pattern with a new seed.
   - **Delete master** frees space; the video stays reproducible.

**Auto-accept score ≥ N** (in the Generate panel, off by default) accepts high-scoring candidates without review. That's the "hybrid" mode for when you trust the score.

### Patterns

| Pattern | What happens |
|---|---|
| **Split Chamber** | Four solid presses close in pairs; balls are pulled to the centre and every squeezed ball splits |
| **Orbit Crusher** | Balls are pulled to the centre; two blades turn in opposite directions and cut like scissors |
| **Rotary Sweeper** | Rotating arms sweep the balls against fixed wedges |
| **Scissor Jaws** | V-shaped jaws on a hub open, close and turn |
| **Melodic Rams** | Two pendulum rams with hammer heads; every swing is a little faster |
| **Press Walls** | Two walls slide in and squeeze everything between them (they stop one ball apart) |
| **Laser Cross** | A rotating laser splits everything it touches; the balls pile up on fixed wedges |
| **Crocodile Jaws** | A toothed jaw hinged on the rim opens slowly and snaps onto a fixed lower jaw |
| **Fist Arm** | Two arms with elbows swing against each other and punch against the rim |
| **Hammer & Bowl** | A drop hammer from above lifts slowly and falls into a V bowl |
| **Shears Fan** | 3–5 blades on one pin above the arena open and shut over a cradle |
| **Fan Blades** | Two sector blades swing out against the rim and back together |
| **Laser Spin** | A laser bar on a planetary carrier spins through balls pulled to the centre |
| **✦ Invent** | A new machine for every seed, named automatically; the checks keep only the ones that work. ★ Save as pattern keeps one you like |

**One rule for every pattern:** all parts are solid, so balls collide with them and never pass through. A ball squeezed between a moving part and a wall or another part **always** splits; nothing is left to chance. The only thing balls pass through is the glowing laser, and it splits whatever it touches. Every video is checked for balls inside solid parts.

**Your controls** (Generate panel):

| Control | Options |
|---|---|
| Gravity | Auto (each machine has its own) · On · Off (floating) · Toward the centre |
| Stop at | Full arena · 300 · 500 · 1,000 · 1,500 balls; the finale starts exactly there |
| Length | Short 30–50 s · Medium 45–65 s · Long 60–95 s (longer videos use more, smaller balls) |
| Ending | Auto · Rim breaks · Gold wave · Flood the screen |

Each card shows where the finale started ("finale at 1,000 balls · 31.2 s") and the controls used.

### Where things are

| What | Where |
|---|---|
| Library (default, change in settings) | `D:\Split Chamber Studio\` — one folder per video in `videos\<id>\` |
| Per video | `config.json` (everything needed to reproduce), `metrics.json`, `status.json`, `thumb.jpg`, `preview.mp4`, `master.mp4` (accepted only) |
| Quota | 12 GB (about 50 forty-second masters); the bar at the top shows usage |
| Live-play exports (old mode) | `%USERPROFILE%\Videos\Split Chamber\` |
| Log | `%APPDATA%\Split Chamber Studio\logs\main.log` |

### What is checked automatically

| Stage | Checks |
|---|---|
| Simulation | Stable (no invalid numbers), reaches its climax, length within the pattern's range, first split within 3 s, scene not empty |
| Preview (encoded file) | Loudness −17…−13 LUFS, true peak ≤ −1 dBTP, no silence over 1.5 s, no frozen or black picture over 1 s, not too similar to an accepted video (growth curve + perceptual frame hashes) |
| Master | Exact resolution, 60/1 fps, exact frame count (every frame decoded), duration, audio; SSIM ≥ 0.94 (min) / 0.96 (mean) against frames rendered directly by the engine; frame accuracy N/N; loudness re-checked. Every re-simulation must reproduce the per-frame state hashes of the original run. |

If an encoder fails a check, the next one is tried: MediaBunny hardware → FFmpeg GPU → MediaBunny software → x264.

## Command line

Headless batch: no window, no sound, prints a JSON result line.

```bash
node_modules\electron\dist\electron.exe . --generate=5 --pattern=random --captions=ar
```

Options: `--pattern=<key>` (`split-chamber@2`, `orbit-crusher@1`, `rotary-sweeper@2`, `jaws@2`, `rams@2`, `kaleidoscope@2`, `walls@2`; the older `@1` versions still reproduce), `--seeds=1,2,3`, `--accept-all`, `--library=<folder>`, `--quota-mb=<n>`, `--mute`.

## For developers

```bash
npm install
```

```bash
npm test
```

```bash
npm run gate
```

```bash
npm run gate:pixels
```

```bash
npm run test:e2e
```

```bash
npm run dist
```

- `npm test`: 41 unit tests.
- `npm run gate`: determinism gates (Node + Electron, all scenario goldens).
- `npm run gate:pixels`: byte-exact render check on this machine.
- `npm run test:e2e`: 17 Playwright tests on the real app (muted).
- `npm run dist`: portable exe + installer.

Tools: `tools/scenario-check.mjs <key>` (validates seeds against the run checks), `tools/benchmark-pipeline` notes in `docs/BENCHMARK.md`, `tools/compare.mjs` (encoder quality), `tools/pixelgate.mjs`, `tools/goldens.mjs`, `tools/baseline.mjs`.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Implementation log and findings: [docs/PROGRESS.md](docs/PROGRESS.md). Measurements: [docs/BENCHMARK.md](docs/BENCHMARK.md).

### Dependencies

`electron` 45, `mediabunny` (WebCodecs MP4), `ffmpeg-static` (FFmpeg 6.1: fallback encoders, remux, analysis), `ffprobe-static` (verification); dev: `electron-builder`, `@playwright/test`. No network services.

## Known limitations

- **Windows x64 only.** Pixel-exact reproduction is guaranteed on the same machine and GPU driver. The simulation itself is bit-exact across Node and Electron for all new engines; the legacy Split Chamber@1 engine is exact only within Electron.
- **Sound is checked by measurement, not by ear.** Procedural music quality is subjective; your review is the judge.
- **Packed scenarios hold about 1,200–2,200 balls**, Swarm scenarios 10,000.
- **Some seeds are rejected automatically right after simulating** (≈ 3 s each): Rotary Sweeper about 1 in 3 (climax too small or too fast), the other patterns rarely.
- **The long multi-act mode (up to 3 min) and the claw/gantry mechanism are not built yet.**
- **The app is not code-signed**, so SmartScreen may ask once ("More info → Run anyway").
