# Split Chamber: technical notes

## Architecture

```
 ┌──────────────────────────── renderer process (UI thread) ─────────────────────────────┐
 │  ui/app.js  ── Play/Replay clock (rAF) ── Renderer(2D canvas + WebGL2 ball layer)     │
 │      │                                    Synth(live AudioContext)                    │
 │      │ frames (transferable ArrayBuffers)                                            │
 │  ┌───┴────────────────┐            ┌──────────────────────────────────────────────┐   │
 │  │ sim.worker.js      │            │ export.worker.js (OffscreenCanvas 1080x1920) │   │
 │  │ Simulation(seed)   │            │ Renderer ─► MediaBunny/WebCodecs  ─► bytes   │   │
 │  │ 60 fps × 4 substeps│            │          └► getImageData (FFmpeg) ─► RGBA    │   │
 │  └────────────────────┘            └──────────────────────────────────────────────┘   │
 │  export/exporter.js: OfflineAudioContext soundtrack, worker driver, IPC relay       │
 └────────────────────────────────────────┬──────────────────────────────────────────────┘
                                          │ contextBridge (preload.js), invoke-only
 ┌────────────────────────────────────────┴──────────────────────────────────────────────┐
 │ main.js: session files (gzip), export .part files (positioned writes), WAV, ffmpeg    │
 │ child process (stdin raw RGBA), lossless remux (+faststart), ffprobe verification,    │
 │ disk-space check, unique names, crash cleanup, log                                    │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

Simulation, rendering, audio and encoding are separate modules, connected only through the **session**: an array of per-frame snapshots plus a small meta object.

* **Simulation** (`src/sim/sim.js`): pure JS, no DOM. A seeded `mulberry32` PRNG, fixed timestep (1/60 s, 4 substeps) and a fixed iteration order make it deterministic. The same seed gives bit-identical frames; this is checked by FNV-1a hashes in the unit tests and the benchmark. It runs in a worker and finishes the whole ~25 s run in about 7 s of background CPU, so Play never waits for it.
* **Session format** (`src/sim/session.js`): each frame is a standalone `ArrayBuffer` of `[count, splits, flags, crushed]` + `x,y` as uint16 at 1/32 px + colour byte + age byte + split events. That is about 60 KB at 10,000 balls, and about 30 MB per session after gzip. The file is `SCHS` magic, version, JSON meta, offset table, frames.
* **Renderer** (`src/render/renderer.js`): `draw(session, f)` is a **pure function of the frame index**. Effects that span time (split rings, press-impact flashes, counter bump, gold wave, outro) look back into earlier frames instead of keeping state. That is why the live preview, the replay and the offline export show the same picture. Balls are drawn by a WebGL2 point-sprite layer (`balls-gl.js`) that uploads the session arrays unchanged. Everything else uses Canvas 2D with pre-rendered sprites (background, rim, housings, plates, rods). It works on `HTMLCanvasElement` and `OffscreenCanvas` in a worker.
* **Audio** (`src/audio/synth.js`): procedural Web Audio (press thump + clank + click, split pops with crackle for big bursts, finale chime, outro swell). Live play triggers each frame's events as that frame is shown. Export schedules every event at exactly `f / 60` s on an `OfflineAudioContext`, so the audio is sample-accurate to the video.
* **Export** (`src/export/*`): the export worker renders frame `f`, hands it to the encoder, and waits for it before drawing frame `f+1`. Time is always `f / 60`, never the clock, so frames cannot be dropped and the duration is exactly `frames / 60`.

## Simulation model (from the reference video)

| Observed in reference | Implementation |
|---|---|
| Circular arena, four presses at N/E/S/W | `ARENA` r = 460 px; plates 264 × 30 px; retracted face at 362 px |
| Opposite presses slam together at the centre; pairs alternate | `pistonExtension()`: 1.2 s cycle per pair, 0.6 s apart; ease-in slam 0.30 s, hold 0.05 s, retract 0.34 s |
| One ball at start; caught ball → 3 new balls of a new colour with a ring flash | `split()`: parent + 2 children, generation colour from a 10-colour palette, ring event recorded |
| Count: 1, 3, 5, 11, 45, 129, 299, 553, 751, 1,259 … 10,000 at ≈16.5 s | Fission probability `0.2 + 0.8 / (1 + n/1600)`, tuned by grid search against the reference readings (`tools/tune.mjs`) |
| Plates sweep lanes; swarm forms X-shaped flows | Front-face plate contact (inelastic, restitution 0.35) + sideways squeeze-out proportional to closing speed, ramped in with crowding |
| No ball-ball collisions (balls overlap when dense) | None simulated |
| At 10,000: counter turns gold, gold wave spreads, then end card | `capFrame` → gold wave at 1,150 px/s, 4.5 s gold hold, 3.5 s outro with our own logo |

**Assumptions** (not visible in the video): the audio design; the exact fission rule (the reference looks probabilistic, since not every caught ball splits); and the random heading drift that keeps the swarm from settling into bands. The channel branding on the reference's end card was deliberately not copied: the logo, name and tagline are original.

## Play vs Export

* **Play:** the sim worker streams frames. The UI clock shows frame `floor(elapsed × 60)`. If the simulation were ever behind, the clock would hold (never skip ahead of the data); measured stalls in tests: 0. If the display can't keep up, the preview skips frames, but the session still holds every frame. With "Keep session" off, frames older than 40 are released and the run can't be exported.
* **Export:** soundtrack first (offline), then the export worker. Bytes from MediaBunny are written at their file offsets by the main process into `name.mp4.part.mp4`. After `finalize()`, ffmpeg remuxes losslessly (`-c copy -movflags +faststart`; adds the AAC track if WebCodecs could not encode AAC), ffprobe verifies, and only then is the file renamed to `name.mp4`. On failure or cancel, every temporary file is removed. The FFmpeg engine pipes raw RGBA frames to `ffmpeg` stdin with back-pressure (at most 2 frames in flight).

## Verification (every export)

`ffprobe -count_frames` (which decodes every frame) must report: `h264`, `1080x1920`, `r_frame_rate = avg_frame_rate = 60/1`, `nb_read_frames == session frames`, video duration within half a frame, `yuv420p`, an `aac` stream whose duration is within 50 ms of the video. Otherwise the export is rejected.

## Tests

* `npm test`: 10 unit tests: bit-identical determinism, seeds diverge, exact 10,000 cap, even increments, all balls inside the arena, session round-trip, corrupt/truncated files rejected, presses never overlap, probability bounds, reference pacing.
* `npm run test:e2e`: 10 Playwright tests on the real app (see the README).
* `--bench` + `tools/compare.mjs`: encoder speed, SSIM/PSNR against a lossless reference and against ground-truth PNGs rendered straight from the session, and frame accuracy (decoded frame *N* must match truth frame *N* better than *N±1*).

## Security

`contextIsolation`, `sandbox`, no `nodeIntegration`, a fixed IPC surface (`preload.js`), and a custom `app://` protocol that serves only files inside the app folder (path-traversal checked), with a strict CSP. No network access.
