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
