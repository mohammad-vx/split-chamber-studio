# Implementation progress log

Autonomous implementation of docs/ARCHITECTURE.md (owner approved, owner away). Newest entries last.

## Step 1 — refactor with identical output
- 1a: `src/sim/gate.js` gate core (canonical + raw Float64 state + RNG draw hashes). Raw/RNG captured from the
  untouched v1 engine.
- Finding: Node v24 and Electron 45 produce **different last-bit Float64 state** (raw mismatch from frame 17–308),
  while canonical (1/32 px quantized) frame hashes stay identical for all 5 seeds. Cause: V8 Math.* differences.
  Resolution: Electron (production runtime) is the reference for `baseline/v1/sim-raw.json`; Node keeps
  `sim-raw.node.json`. `npm run gate` runs both. New engines should avoid Math.sin/cos/pow in the sim hot path
  (deterministic polynomial approximations) so Node and Electron agree.
- 1c: `src/core/constants.js` (W/H/FPS) split from split-chamber@1 defaults; scenario registry
  (`src/scenarios/`), renderer factory, configurable WebGL2 ball layer, sim worker runs any scenario config,
  B1 fixed (export:begin creates the output dir). Gates: Node + Electron baseline, pixel gate (12/12 frames
  byte-identical, `npm run gate:pixels`), unit 10/10, e2e 10/10.

## Step 2 — Orbit Crusher + split-chamber@2
- Legacy sim takes optional params (defaults = v1 constants; baseline still bit-exact).
- split-chamber@2: cap ~25.7 s (crush 0.10/0.55/1600), finale 5.5 s, outro 3.5 s → 34–38 s; pistons drawn at
  (f+1)/FPS (T1 fix).
- orbit-crusher@1: new engine `src/engine/orbit.js` — gravity well + rotating blades (1–3), blade cuts split
  balls; deterministic math only (`dmath.js`: dsin/dcos/dexp/dlog), counter RNG (`rng.js`).
- Finding: fixed split probabilities give huge seed variance with exponential growth (7.6 s … never).
  Added a **pacing controller**: split chance = f(count vs target curve maxBalls^(t/capTime)); caps land within
  ~1 s of the planned time for all seeds. This will be reused by later engines.
- Orbit raw state is bit-identical in Node and Electron (rawPortable). Goldens in `baseline/goldens/`.

## Step 3 — pipeline, library, music, captions, home screen (in progress)
- `src/sim/run.js`: headless RunSummary + Timeline + per-frame state hashes; export worker re-simulates in
  lockstep and aborts on any hash mismatch (no full frame storage; 48-frame lookback ring).
- Audio v2: tempo-locked procedural music (`src/audio/music.js`), JS EBU R128 loudness + look-ahead limiter
  (`src/audio/loudness.js`); ffmpeg ebur128 on the encoded file is the authoritative check.
- Captions EN/AR (`src/render/captions.js`), render-time layer, Western digits.
- Main process: `lib/library.js` (atomic status.json, lock file, recovery, quota, rejected log, queue),
  `lib/media.js` (ebur128/silence, freeze/black detect, dHash, thumbnails, SSIM/PSNR quality gate),
  `lib/studio-ipc.js` (IPC surface, lib:// protocol, power blocker, battery state, CLI).
- Pipeline (`src/pipeline/`): generate → headless → checks → audio → 540x960@60 preview → analysis → dedup →
  candidate; accept → 50 Mbps master per engine with quality gate + video-stream bitrate check.
- Findings from the first CLI runs (fixed): scenarios on audio v1 had silence/low loudness (now audio v2);
  orbit balls could escape beyond the blades (blades now reach the rim); co-rotating orbits and blade
  "bounces" turned balls into riders that were never cut (now always counter-rotating, bounce is radial);
  first-cut hook guaranteed; split-chamber@2 first ball starts slow so the first press catches it.
  Validation: 0/60 orbit seeds and 0/40 split@2 seeds fail the run checks (hook limit 3.0 s).
- Finding: the planned "video bitrate ≥ 60 % of requested" check (review B2) rejected healthy masters — VBR
  encoders produce 10–20 Mbps of 50 on simple scenes at SSIM 0.99, forcing a slow x264 fallback. The ratio is
  now informational (default 0, injectable with --min-bitrate-ratio for tests); the SSIM quality gate against
  rendered truth frames is the real protection (it catches the 80 Mbps → 8.5 Mbps case: SSIM ≈ 0.92 < 0.94).
- Quality gate now decodes once (all N-1/N/N+1 frames in one ffmpeg pass) instead of 18 decodes.
- e2e: 14 tests (10 live-play + 4 studio). Studio UI flow (generate → review → keyboard accept → verified
  master → reproduce identical → reject with tag), quota stop, forced-bitrate fallback to CRF x264, crash
  recovery: all pass. `--mute` silences live playback (owner request); all headless modes are muted.
- Orbit: blade "bounce" kept speed loss → swarm collapsed onto the hub (median radius 71 px = hub surface);
  now outward-biased radial deflection without speed loss → median 184–276 px.

## Step 4 — Packed engine + rotary-sweeper@1
- `src/engine/packed.js`: equal-radius colliding balls (uniform grid, PBD, 12 substeps × 1 iteration,
  alternating sweep), gravity after the hook, rotating capsule arms with side memory, static convex wedges,
  hub, breakable rim. Pinch = closing arm + (opposing wall | pinned neighbour | compressed pile ≥ 18 % overlap),
  sustained 2 substeps. Newborns separate softly. Despawn by swap-remove; counter shows the peak.
- `rotary-sweeper@1`: 1–3 arms, 3–6 wedges, gravity 70 % of seeds, ~1,400–1,550 balls (r 8.5), rim-break ending.
  40/40 seeds pass the run checks (30.4–37.9 s, hook ≤ 1.53 s); ~0.6–1.7 ms/frame; raw state portable
  Node == Electron. Findings fixed on the way: rim only held balls within 2r (escapes), wedge outer edge could
  push balls out, 8 substeps left 12 % deep overlaps under gravity (12 substeps: 1.8 %), coverage check used the
  wrong ball radius for packed scenes (now per-scenario threshold).

## Step 5 — mechanism library (generic machine engine)
- `src/engine/machines.js` (Packed v2): generic scripted parts (capsule / circle / convex polygon) with pose
  primitives (rotate, oscillate, slide, swing with escalation, radial contraction); packed.js untouched so
  rotary-sweeper@1 stays bit-exact. Pinch also recognises two opposing *closing* parts (walls, jaws); hook rule:
  the first ball splits as soon as a moving part strikes it.
- New scenarios: jaws@1 (Scissor Jaws), rams@1 (Melodic Rams, escalating swings), kaleidoscope@1
  (Kaleidoscope Press), walls@1 (Press Walls). Generic `MachineRenderer` (parts clipped to the chamber,
  breakable rim, peak counter). EN/AR caption templates for every family.
- Validation: 63/64 seeds pass the run checks (the one failure is a genuine stall the checker rejects);
  gold-ending videos get a longer finale; pmin 0.005 for these engines; per-scenario emptiness threshold.
- Unit tests 36/36; goldens for all 7 scenario versions, raw state portable Node == Electron for all new engines.

## Step 6 — dashboard expansion, packaging, documentation
- Studio: pattern filter, sort (score / newest / longest), seed search, statistics line (acceptance rate,
  average generation time), optional auto-accept above a score (hybrid mode), delete master (reproducible).
- Packaging: `dist/SplitChamberStudio-2.0.0-portable.exe` and `-setup.exe`; the packaged app generated and
  accepted a rams@1 video in 122 s (bundled ffmpeg/ffprobe/MediaBunny all working from the package).
- Sustained benchmark: 4/4 videos accepted in 410 s (≈ 100 s per finished video). `docs/BENCHMARK.md`.

## Step 7 — owner feedback after first use (2026-11-06)

Feedback: (1) a ball squeezed between a moving part and a fixed one must split, not wait to be hit by other
balls; (2) explain how a video is accepted or rejected; (3) Live play should show what the factory is making
now; (4) after a batch, show clearly how many went to review and how many were rejected, and why.

- **Contact pinch rule (`pinchRule: 'contact'`, engines `packed.js` and `machines.js`).** Measured on the
  owner's last video (rotary-sweeper@1 seed 230982): 700 splits vs 9,305 pinches that did *not* split (93 %),
  because the split was decided by the pacing probability, and most splits came from the "arm ploughing a
  compressed pile" rule. In v2 a ball squeezed between a moving part and an opposing surface splits on the
  first substep, always; a push through a pile only ejects. @1 behaviour is untouched (gate: all @1 goldens OK).
- **New versions** `rotary-sweeper@2`, `jaws@2`, `rams@2`, `kaleidoscope@2`, `walls@2` (`src/scenarios/contact-v2.js`):
  v1 layout from the same seed + deterministic changes. Without the probability, growth is shaped by the
  mechanism: jaws split into 2; rams cycles 1.2× slower; kaleidoscope cycle fixed at ≈ 4.5 s with gravity;
  rotary arms at ≈ 2.2 rad/s (whole beats) with 12 px balls. The finale starts when the arena is full or at
  40 s; length 30–50 s; new check *climax size ≥ 50 %*. @1 versions stay registered (reproducible) but unlisted.
- **Validation (`tools/scenario-check.mjs`, seeds 200–223):** jaws 24/24, rams 24/24, kaleidoscope 24/24,
  walls 24/24, rotary 15/24 (4 climax too small, 5 too short). Rejections cost ≈ 3 s (right after simulating).
- **Explanations.** Every check is now an explanation row (`explainRun/Audio/Video/Duplicate` in `checks.js`;
  rejection reasons unchanged), stored per video with the score breakdown (`scoreParts`). The side panel shows
  ✓/✗, the measured value and the limit. A "How it works" dialog describes the whole flow.
- **Batch summary.** Each video records `batch {id, index, total, pattern}`; the "Last batch" panel shows
  requested / waiting for review / accepted / rejected by checks (grouped reasons) / rejected by you / failed /
  not made, with a "Last batch only" filter.
- **Watch live.** While a batch runs, the header button becomes "● Watch live": the same config is simulated
  again in real time and drawn (deterministic → the same frames being rendered); it follows the batch to the
  next video. Without a batch, Live play opens the game with all 7 patterns.
