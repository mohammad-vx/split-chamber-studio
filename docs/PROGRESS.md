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

## Step 8 — Phase 1 of docs/PLAN-NEXT.md: one engine, one rule, owner controls (2026-11-06)

- **Why parts looked transparent:** orbit-crusher@1 and split-chamber@2 (swarm engines) never collided balls with
  their blades/presses; a "cut" split by probability and otherwise nudged the ball, so it seemed to pass through.
  Measuring balls deep inside parts also exposed walls@2 (walls close into each other: 100 % of balls inside at the
  worst moment) and kaleidoscope@2 (triangles overlap: 5–11 %).
- **All listed patterns now run on the machine engine with the contact rule:** split-chamber@3 (four solid presses,
  pull to the centre), orbit-crusher@2 (two blades turning in opposite directions, pull to the centre),
  rotary-sweeper@3 (arms + static wedges), walls@3 (stop one ball apart), jaws@2, rams@2, and the new
  **laser-cross@1** (a see-through laser `beam` part that always splits what it touches). kaleidoscope is unlisted:
  no gap was both safe (no overlap) and productive; it returns redesigned in phase 2. Older versions stay registered.
- **Engine additions** (all opt-in by config, all older goldens unchanged): `gravityMode: 'center'`, `beam` parts,
  `flood` ending (rim dissolves, balls pushed out and kept inside the frame), `checkSolid` measure → `passMax`;
  run check *No ball passes through a solid part* (≤ 3.5 %, orbit ≤ 6 % because two crossing blades overlap for an
  instant).
- **Controls** (`src/scenarios/controls.js`, Generate panel, stored in each config): gravity, stop-at count,
  length (medium/long = smaller balls + slower machine, extra slowing for fast growers), ending.
- **Validation, default controls, seeds 300–311:** jaws 12/12, rams 12/12, orbit 12/12, rotary 11/12, laser 10/12,
  walls 10/12, split 9/12. Medium length spot-checks: jaws 5/5; long length is the least reliable (≈ 60 %).

## Step 9 — Phase 2 station 1: engine modules and the part tree (2026-11-06)

- `src/engine/machines.js` is now the `MachineSim` loop only; the rest lives in `src/engine/machine/`:
  `kinematics.js` (poses, part tree, morphing shapes, polygon edges), `mechanisms.js` (closed-form mechanisms),
  `collide.js` (ball ↔ part / arena), `pinch.js` (the split rule), `ending.js` (forces, finale, gold wave, break),
  `measure.js` (balls inside solid parts). Same arithmetic in the same order: 39/39 goldens and the gate pass.
- Part tree: `parent: k` puts a part in part k's frame (parents first, checked by `validateTree`). The renderer and
  the sim use the same `partPose(p, t, parts)`.
- `tools/snap.mjs` dumps balls and parts at chosen times (for a quick look while tuning a machine).
- The batch-summary e2e test pins seeds through `window.__splitChamber.testSeeds` and counts the same buckets as
  the panel (it was flaky with random seeds).

## Step 10 — Phase 2 station 2: Crocodile Jaws, Fist Arm, Hammer & Bowl (2026-11-06)

- Lesson from tuning: with the contact rule a split needs a ball between a moving part and a *solid* surface, so a
  machine grows only as fast as the length of its pinch lines. Designs that worked: a moving surface that runs
  parallel to a fixed one, one ball apart (hammer head over a V bowl, upper jaw over a lower jaw), or a head whose
  path is concentric with the rim (fist). Flat tops trap balls (they ride the hammer): roofs must slope.
- Validation, default controls, seeds 300–311: croc-jaws 11/12, hammer-bowl 11/12, fist-arm 7/12.

## Step 11 — Phase 2 station 3: Shears Fan, Fan Blades, Laser Spin (2026-11-06)

- Shears Fan: blades start 260 px from the pin (a narrow wedge near the pin split everything inside it at once);
  a cradle concentric with the pin keeps every tip one ball from it. Fan Blades: hinged at the centre so the arcs run
  along the rim. Laser Spin: pulled to the centre, where the planetary laser passes.
- Validation, default controls, seeds 300–311: laser-spin 12/12, shears-fan 10/12, fan-blades 10/12.
- Claw Machine (registered, unlisted): a claw with two fingers pinches too little per grab (≤ 17 % of the target).

## Step 12 — Phase 3 v1: Machine Inventor (2026-11-06)

- `src/scenarios/inventor.js`, pattern `invent@1`: the seed picks a family (sweeper / press / blades), its geometry
  (always with its pinch surface one ball away), a mechanism (quick return, slam, cam, scissor, swing, turning),
  rhythm, gravity and an optional laser, and writes `config.invented = { name, family }`. Status label
  `Invented · <name>`, badge on the card. `randomScenarios()` excludes it from random batches.
- Validation, default controls, seeds 1–12: 5/12 pass the automatic checks (plan estimate: a quarter to a half).
  Typical failures: blades that stall after the first split, and elbow sweepers with a laser that fill in < 30 s.
- Not done yet (PLAN-NEXT §3.2–3.4): geometric pre-check, novelty fingerprint against accepted machines,
  "save as pattern" / variations, learning from accepts and rejects.

## Step 13 — fixes and the inventor's pre-check, novelty and saved machines (2026-11-06)

- Audio v3 (`src/audio/synth.js`, `loudness.js`): sample ceiling −2.5 dBFS and up to 3 normalize-and-limit passes;
  older configs keep −1.5 dBFS and one pass (their audio is unchanged).
- Inventor pre-check (`precheck` in `src/scenarios/inventor.js`): 12 s of simulation; survivors of the first test
  had 18 … 13 % of the target at 12 s. Up to 6 attempts per seed (`config.invented.attempt`), the seed's family kept
  for the first 4. Blade ranges narrowed to the tuned Fan Blades values (wider ones stalled).
- Novelty: `explainNovelty` compares `family: name` with accepted inventions.
- Saved machines: `src/scenarios/saved.js` (`deriveMachine`, `savedModule`, `orphanModule`), registered from the
  library's `patterns.json` (`library:patterns` IPC). A deleted pattern's videos still replay (orphan module).

## Step 14 — every video visible; inventor calibration (2026-11-07)

- Owner feedback: 12 of 20 invented videos rejected, the rejected ones had no picture, and the accepted ones were
  mostly presses. Analysis of that batch: 7 too slow (climax < 50 %), 3 too fast (< 30 s), 1 balls in metal
  (blades + laser), 1 already-accepted structure.
- `src/pipeline/snapshot.js`: a rejected-at-simulation video gets `thumb.jpg` drawn from the sim. Studio: ▶ Play on a
  video without a file replays its config live ("▶ REPLAY"); ✓ Accept anyway calls `accept()` (metrics + config
  are kept for every reject).
- `calibrate()` in `src/scenarios/inventor.js`: growth at 12/24 s → finale estimate → rhythm scale, two rounds,
  target 33 s (growth slows near the end, so the estimate runs optimistic). `generateInWorker` runs heavy
  generators off the UI thread. `inventOpts(i)`: family rotation and the accepted-structure avoid list.
- Validation (default controls): seeds 1–12 → 11/12, 100–111 → 11/12; family-rotated 500–517 → 17/18.
