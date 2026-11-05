# Split Chamber Studio — Architecture & Design

Status: **r2 — revised after independent review; all owner questions answered (§11). Awaiting approval to start step 1. No implementation has started.**
Baseline: commit `v1-frozen` (`9c9b2a0`) + step-0 baseline (`0f58065`, `baseline/v1/`).
Review: three fresh-context reviewers (architecture; physics & determinism; performance & QA). Their findings and how each was resolved are in §13.

Goal: turn Split Chamber into a **ball-simulation video factory**. The owner picks a pattern (or "random") and presses Generate. The system produces deterministic, reproducible 1080×1920 / 60 fps videos with synchronized sound. The owner reviews them and accepts or rejects.

---

## 1. Owner decisions

| # | Decision |
|---|---|
| D1 | **Balls only** for now. Variety comes from behaviours, mechanisms, arenas, forces and interactions. |
| D2 | **One engine, two modes.** *Swarm*: no ball–ball collisions, up to 10k balls (v1 engine). *Packed*: collisions, optional gravity, about 1.5–3k balls. |
| D3 | **Steps:** 0 baseline (done) → 1 refactor with identical output → 2 Orbit Crusher → 3 minimal Generate→Check→Export pipeline + simple home screen → 4 Packed mode → 5 mechanism library → 6 dashboard expansion + automatic selection. |
| D4 | Every video is reproducible from seed + config + versions. The refactor is gated by `baseline/v1`. |
| D5 | **Duration:** default 30–60 s, set per scenario (see Q5 for Split Chamber). Long multi-act mode (≤3 min) comes later. |
| D6 | **Audio:** synchronized SFX + procedural music locked to the mechanism's beat grid. Hybrid with imported stems later. |
| D7 | Keep the current Split Chamber look. New parts use the same metal style. Do not copy reference creators' details. |
| D8 | **Review queue:** automatic rejection, then human accept/reject. Hybrid later. |
| D9 | **Home screen in step 3:** pending/accepted lists; Reproduce; New variation; New video ▾ (pattern/random); Open folder. |
| D10 | **Library:** `D:\Split Chamber Studio\`, 12 GB quota. Previews for candidates. 50 Mbps master for accepted videos only. Rejected videos keep only their seed. |
| D11 | **Captions:** EN / AR / none, chosen per batch. Captions are a render-time layer. |
| D12 | **graphify** for code navigation (`graphify-out/`, not committed). |

## 2. Current system (v1) and reuse

| Area | Files | Plan |
|---|---|---|
| Simulation | `src/sim/sim.js`, `src/sim/config.js` | Keep the v1 code as the **legacy Swarm path**, untouched in behaviour. Split `config.js` into true globals (`W, H, FPS`) and *Split Chamber defaults*. |
| Frame format | `src/sim/session.js` | Freeze today's encoding as `canonicalFrameV1` (hash basis for the legacy gate). New `FrameV2` is separate and versioned (§4.7). |
| Sim worker | `src/sim/sim.worker.js` | Becomes `runScenario(config, mode)`, with credit-based flow control instead of free-running `setTimeout`. |
| Renderer | `src/render/*.js` | Keep the rule "every layer is a pure function of (run data, frame)", and keep the WebGL2 ball layer. Layers receive the config via constructor (no global constants). Each layer declares `lookbackFrames`. |
| Audio | `src/audio/synth.js` | Keep the event→sound design. Input becomes the `Timeline` only (§5.2). Add a music sequencer, normalization and a limiter. |
| Export | `src/export/*`, `main.js` | Keep the proven exporter. Add: expected-format verification, `mkdir dirname(finalPath)`, a video-stream bitrate check, a quality gate, streamed WAV, transferred buffers. |
| UI | `src/ui/app.js`, `index.html` | Home screen (step 3). Play/Replay remain as preview. |
| Tests/tools | `tests/*`, `tools/baseline.mjs`, `tools/compare.mjs`, `--bench` | Keep. The gates are extended (§9). |

**v1 issues found (fix or document):**
- **B1:** `export:begin` does not create the output directory. It fails when a bench `--bench-out` folder does not exist.
- **B2:** the Intel hardware encoder can silently produce ~8.5 Mbps when 80 Mbps is requested, and verification still passes.
- **T1:** v1 draws pistons at t = f/60, but sim frame f ends at t = (f+1)/60. That puts plates up to ~40 px out of place at peak speed. Kept in the legacy renderer for pixel parity. New scenarios use the convention in §4.6.
- **D1:** `docs/BENCHMARK.md` is referenced in `src/export/exporter.js` and the README but does not exist. It is created in step 1.

## 3. Concepts

- **Scenario module:** versioned code (`id@version`).
- **ScenarioConfig:** JSON generated from a seed. Together with the engine/runtime versions it fully determines the output.
- **Run:** executing a config. It produces a **Timeline** and **metrics**, and optionally frames.
- **Candidate:** a run that passed automatic checks, with a preview, awaiting review.
- **Accepted video:** a candidate plus a verified master and its sidecar files.

### 3.1 Scenario module API (required before step 1 code)
```js
export default {
  id: 'split-chamber', version: 1, mode: 'swarm' | 'packed',
  schema,                                   // JSON schema of ScenarioConfig for this scenario
  generate(seed, opts) -> ScenarioConfig,   // pure, deterministic
  createSim(config) -> Sim,                 // { step() -> frameIndex, done, state }
  layers(config) -> Layer[],                // render layers, each { lookbackFrames, draw(ctx, view, f) }
  music(config) -> MusicPlan,               // tempo, meter, instruments
  checks(config) -> CheckSpec,              // per-scenario bounds (duration, density, ...)
}
```

### 3.2 ScenarioConfig (minimum fields)
```json
{
  "scenario": "split-chamber@1", "seed": 1234, "mode": "swarm",
  "duration": { "minS": 20, "maxS": 30 },
  "tempo": { "bpm": 100, "beatsPerBar": 4 },
  "arena": { "shape": "circle", "r": 460, "cx": 540, "cy": 1000, "breakable": [] },
  "parts": [ ... ], "balls": { "r": 6.5, "max": 10000, "split": 3 },
  "forces": { "gravity": [0, 0], "attractor": null },
  "ending": { "type": "cap-gold" },
  "palette": "default", "caption": { "lang": "none", "template": null },
  "versions": { "engine": 1, "renderer": 1, "audio": 1, "frame": 1, "runtime": "electron@45.x" }
}
```

## 4. Engine

### 4.1 World
- **Balls:** Float64 SoA arrays, plus a stable `id` (Uint32) and per-ball radius in Packed mode.
- **Arena:** circle, regular polygon or rectangle, with optionally breakable segments. Polygons handle both vertex and segment contacts.
- **Kinematic parts:** convex polygon, capsule or circle, each with an analytic `pose(t)` and an analytic velocity. Pose primitives: rotate, slide, swing, keyframed path, and hinged compositions. Parts push balls; balls never push parts.
- **Forces:** gravity (constant or rotating), central attractor, drag, speed relaxation.

### 4.2 Swarm (legacy path)
v1 code path, bit-exact for `split-chamber@1`: same floating-point order, the single mulberry32 stream, 4 substeps. **Not generalized.** Other Swarm scenarios (Orbit Crusher) use the new Swarm path with the rules in §4.5–4.6.

### 4.3 Packed
- **Grid:** uniform hash grid, cell = 2·rmax, rebuilt every substep.
- **Solver:** small-step position-based dynamics.
  - 8–16 substeps × 1–2 iterations, with **substeps × iterations ≤ 16** at 3k balls.
  - Sweep direction alternates every iteration (keeps Kaleidoscope symmetric).
  - Separate velocity pass: restitution applies only when approach speed > 2·g·h. Plus position-level friction and light damping.
- **Anti-tunneling:**
  - The generator enforces `maxPartSurfaceSpeed × h ≤ 0.5 × min(rBall, partHalfThickness)`. If needed it raises the substep count **per config**, not per frame.
  - Ball–part contacts are resolved on the side the ball was on in the previous substep (in the part's local frame).
  - |v| is clamped after each contact.
- **Spawn/despawn:** applied at the end of each substep, in index order, followed by a grid rebuild. Children of a split either get radius r/√k (area preserved) or grow in over T frames. Balls outside the frame plus a margin are despawned with a deterministic swap-remove (ids stay stable).
- **Energy gate:** a cap on per-ball kinetic energy (parts inject energy by design).
- **No multithreaded solving** and no SharedArrayBuffer.

### 4.4 Pinch rule (new engines)
A ball is pinched when **at least one contact is with a kinematic part** and either:
- the relative normal velocity of two opposing contact surfaces (normal dot < −0.5) toward each other exceeds `vPinch`, **or**
- the remaining overlap after the solve exceeds ε for N consecutive substeps.

Ball–ball contacts only *transmit* pinch; a ball in a pile is not pinched by its neighbours alone.

Required unit cases:
- parked arm with a resting ball → no pinch
- fast hit → pinch
- slow squeeze → pinch
- deep pile → only the balls touching the part pinch

### 4.5 Randomness
New engines use a **counter-based RNG**: `rand(seed, substepIndex, ballId, purpose)`. Small solver changes then do not reshuffle the whole video. Legacy keeps the v1 stream.

### 4.6 Time convention (new scenarios)
The state of frame f is the state at t = (f+1)/FPS. Every layer draws parts at that same t. The v1 offset (T1) stays only in the legacy layers.

### 4.7 Frame formats
- `canonicalFrameV1`: frozen v1 bytes, used only for legacy hashing and v1 sessions.
- `FrameV2`:
  - header `{n, flags, crushed, splitCount}`
  - per ball `x, y` (uint16 at 1/32 px; despawn guarantees in-range), `id` (Uint32), radius (Uint8, quantized), colour, age
  - part poses (Float32: x, y, angle per part)
  - splits (x, y, colour)
  - a version byte

### 4.8 Endings
- `cap-gold`
- `rim-break`: remove arena segments, enable gravity, despawn balls that leave
- `explode`: radial impulse, arena fades
- `fill`: stop at packing fraction Σπr² / arena area ≥ target

Each scenario's arc decides when the ending starts: when the cap is reached, or when the time budget runs out.

## 5. Data contracts between stages

### 5.1 RunSummary (written by every Simulate)
`{ frameCount, capFrame, outroFrame, endFrame, durationS, hookFrame, perFrameStateHash[], metrics }`

- `perFrameStateHash` is a 32-bit FNV hash of the frame encoding (`canonicalFrameV1` for legacy, `FrameV2` otherwise). Cost is < 0.1 ms/frame. It is stored in `metrics.json` and compared on every later re-simulation (preview, master, reproduce). **Pixel and encoder output are never compared this way.**

### 5.2 Timeline (the only input to audio, counter and captions)
- Per frame: `{ n, flags, crushed, splitCount }` plus discrete events `{type, frame, x, y, colour, intensity}`.
- Versioned, and stored with the run as `timeline.bin` (small).
- Audio reads only the Timeline and `MusicPlan`. The Timeline extracted during any re-simulation must equal the stored one (hash compare).

### 5.3 Lookback
Each layer declares `lookbackFrames`. In v1 these are rings 20, impacts 12, counter 8. During streaming export the renderer keeps a ring buffer of `max(lookbackFrames) + 1` decoded frames. Layers that need older history must use the Timeline.

## 6. Rendering, audio, captions
- **Visual identity:** unchanged. The generic metal part renderer pre-renders a sprite per part shape.
- **Captions:** EN or AR. Canvas `direction='rtl'` with an Arabic-capable system font, verified on the target machine. Shown for about 3 s, then shrink/fade.
- **Music:** beat grid from `tempo`; mechanism periods are musical durations. The same scheduler drives the live AudioContext and the export OfflineAudioContext. Long renders are scheduled in 5 s slices with `suspend()`.
- **Mastering:** deterministic gain normalization, then a true-peak limiter on the float buffer, then AAC 192k.

## 7. Production pipeline

### 7.1 Stages and checks
| Stage | Work | Automatic gates (reject with a reason) |
|---|---|---|
| 1 Generate | `generate(seed)`; id = hash(config without `appVersion`) | Skip if seed+scenario@version was already seen |
| 2 Simulate (headless) | RunSummary + Timeline. Packed: frames cached to a temp file, deleted after master/reject | No NaN or escapes (outside the despawn rules); KE cap; duration within the scenario's `duration` bounds; hook ≤ 2 s; ending reached |
| 3 Audio | Render the soundtrack from the Timeline; normalize; limit | Integrated loudness between −17 and −13 LUFS; true peak ≤ −1 dBTP; no silence > 1.5 s below −50 dBFS; soundtrack hash stored |
| 4 Preview | 540×960 **@60 fps, ~4 Mbps**, with audio; state hashes compared to stage 2 | Ball-pixel coverage ≥ 5 % after the hook; luma variance > threshold; ffmpeg `freezedetect` (no freeze > 1 s) and `blackdetect`; verified with expected `{w, h, fps, frames}` |
| 5 Duplicates | Descriptor: count curve resampled to 32 points + perceptual hashes of 8 preview frames | Reject if within distance thresholds of any accepted video |
| 6 Review (human) | One-key accept/reject plus reject-reason tags | — |
| 7 Master | 1080×1920@60, 50 Mbps, existing exporter, state hashes compared | Expected-format ffprobe; **video-stream** bitrate ≥ 0.6 × requested for rate-controlled encoders; quality gate on 6 truth frames (SSIM ≥ 0.985, PSNR ≥ 40 dB, frame accuracy 6/6; logic from `tools/compare.mjs`); loudness re-check on the MP4 |

### 7.2 Processes
- **Main process:** the *single writer* for the library, quota and job queue.
  - Each video has a `videos/<id>/status.json`, written via tmp + rename.
  - `library.json` is a cache, rebuilt from the status files on startup.
  - The IPC surface is fixed: `library:*`, `job:*` (plus the existing `export:*`).
- **Renderer process:** runs the pipeline (it needs WebGL2, OffscreenCanvas, WebCodecs and OfflineAudioContext). The CLI `--generate` uses a hidden window.
- **Concurrency:** a lock file. CLI and UI cannot run batches at the same time; the second instance refuses with a message.
- **Streaming export:** the sim worker runs ahead of the renderer through a bounded queue of about 120 frames (≈5 MB at 10k balls). Credits replace strict lockstep.

### 7.3 Resilience
- **Batch resume:** skips completed ids. Orphaned temp files inside `videos/<id>/` are cleaned up on startup.
- **Power:** `powerSaveBlocker` is active during batches. The queue pauses on battery (configurable).
- **Monitoring:** fps logged per stage. An item is flagged if its fps drops below 60 % of the benchmark (thermal throttling).

### 7.4 Storage
- **Per item:**
  - preview: ~4 Mbps, ≈ 30 MB/min
  - master: 50 Mbps, ≈ 375 MB/min, so the 12 GB quota holds **≈ 32 one-minute masters** or ≈ 65 thirty-second ones
- **Quota accounting:** counts masters, previews and temp files. The UI shows "masters left".
- **Free-space precheck:** 2.2 × requested bitrate × duration, plus the WAV.
- **Rejected videos:** `rejected.jsonl` stores seed + scenario@version + reason tags, with rotation.
- **WAV:** written in streamed chunks; audio channel buffers are transferred, not cloned.

### 7.5 Reproducibility & versions
- **Stamps:** `engine`, `scenario@version`, `frame`, `renderer`, `audio`, `runtime` (Electron/V8). `appVersion` is recorded but is **not** part of the id.
- **Freezing:** a scenario version is frozen once any of its videos is accepted. **Any engine change must pass the golden hashes of every frozen scenario.** Otherwise the engine is versioned or forked.
- **GPU:** rendering is bit-exact on the same machine and driver (verified 12/12 frames). It is not guaranteed across GPUs.

## 8. Scenario roadmap (balls only)
| Family | Mode | Refs | Step |
|---|---|---|---|
| Linear presses | Swarm/Packed | Split Chamber, sliding walls | 1, 5 |
| Central force | Swarm | Orbit Crusher | 2 |
| Rotary sweeper + wedges | Packed ± gravity | 04, 07, 08, 09, 14, image | 4 |
| Scissors / jaws | Packed | 12, figure-8, crescent+gear | 5 |
| Symmetric contraction | Swarm/Packed | 11 | 5 |
| Pendulum / rams | Packed + gravity | 05, rams image | 5 |
| Gantry / claw | Packed | 10 | 5 |
| Breaking box | ending `rim-break` | box image, 05/06/11 | 4 |

## 9. Gates and tests

1. **Legacy gate.** Must pass after every change.
   - `canonicalFrameV1` hashes for the 5 baseline seeds.
   - Plus **raw Float64 state + RNG state hashes**, captured from the `v1-frozen` code *before* step-1 changes.
   - Run in **both Node and an Electron worker**.
   - Plus pixel-exact truth PNGs on the target machine.
2. **Golden gate.** The above, for every frozen scenario@version.
3. **Unit tests.**
   - Collision invariants: max overlap after solve < ε, containment, symmetry for symmetric configs.
   - The pinch cases in §4.4.
   - Anti-tunneling at the maximum allowed part speed.
   - Despawn/id stability.
   - Timeline equality on re-simulation.
   - Soundtrack determinism (hash).
4. **Pipeline e2e.**
   - Pinned seeds known to pass.
   - Generate 2 → accept 1 → verified master → Reproduce gives equal state hashes.
5. **Failure injection.**
   - Tiny quota / disk full.
   - Renderer killed mid-master.
   - Forced low bitrate, which must trigger the fallback.
   - Kill during a library write, which must recover on restart.
6. **Performance.**
   - `docs/BENCHMARK.md`, measured after a 5-minute warm-up (sustained clocks), with p50/p95.
   - Targets:
     - candidate (sim + audio + preview) ≤ 75 s per 60 s video
     - master ≤ 2.5× realtime with the hardware encoder
     - Packed sim p95 ≤ 16 ms/frame at 3k balls, or document the offline slowdown
     - renderer peak memory < 1.5 GB

## 10. Risks
| Risk | Mitigation |
|---|---|
| Refactor changes Split Chamber | Untouched legacy path; raw-state + canonical hashes; Node + Electron gates |
| Packed too slow on i3 | Benchmark at the start of step 4; substep×iteration cap; offline tolerance; per-config ball cap |
| Tunneling / jitter / pile explosions | Speed constraint + side memory; small-step solver; child sizing; end-of-substep spawns |
| Pinch false positives/negatives | Closing-contact rule + unit cases |
| Re-simulation divergence | Per-frame state hashes + Timeline hash; abort with a report |
| Electron/V8 upgrade changes Math results | Runtime stamped; golden re-verification on upgrade; deterministic polynomial sin/cos for new engines if needed |
| Sameness | Arena/gravity/ending/palette variety; descriptor-based duplicate rejection |
| Cheap-sounding music | Curated instruments, scale rules, loudness mastering; hybrid later |
| Storage | Masters only on accept; full quota accounting; reproducible deletion |
| Thermal/sleep | Power blocker, battery pause, fps monitoring, resume |

## 11. Owner answers (resolved)
- **Q1 Captions:** generated automatically from per-scenario templates in EN and AR, based on the run's real rules and events. The owner can add or edit lines later.
- **Q2 End card:** keep the "Split Chamber" name and logo. It is a setting, so it can be switched to a channel name later.
- **Q3 Digits:** Western digits (10,000), even with Arabic captions. Arabic-Indic digits are an optional setting.
- **Q5 Split Chamber duration:** `split-chamber@1` stays as is (~24 s, reproducible). A new `split-chamber@2` gets a 30–40 s arc and the T1 timing fix; the factory uses @2.
- **Q6 Battery:** the batch queue pauses on battery power by default and resumes on AC. This can be disabled in settings.

## 12. Step acceptance criteria
1. **Refactor:**
   - Legacy gate extended (raw state, Electron) and passing.
   - `config.js` split; config injected into renderer, synth and ball layer.
   - B1 fixed.
   - `docs/BENCHMARK.md` written.
   - All existing unit and e2e tests pass.
   - **No generic parts/layers yet** (scope kept small).
2. **Orbit Crusher:**
   - Implements the §3.1 API with the new Swarm path, the §4.5 RNG and the §4.6 time convention.
   - Own golden hashes.
   - Legacy gate still passes.
3. **Pipeline:**
   - `--generate=3` with pinned seeds produces candidates through stages 1–5 (§7.1) with recorded reasons.
   - Home screen: one-key accept → verified master (B2 + quality gate).
   - Reproduce gives equal state hashes.
   - Lock file, status files and resume work.
   - Failure-injection tests pass.
4. **Packed mode:**
   - Benchmark recorded.
   - Unit tests for §4.3–4.4.
   - One scenario (rotary sweeper) with `rim-break`.
5. **Mechanism library:** ≥ 4 more families from §8.
6. **Dashboard expansion and automatic scoring/selection.**

## 13. Review findings → resolutions
| Finding (reviewer) | Resolution |
|---|---|
| Fixed 30–60 s gate rejects Split Chamber (~24 s) (arch B1) | Per-scenario `duration` bounds (§3.2); Q5 |
| Extending the frame format breaks the baseline (arch B2) | Frozen `canonicalFrameV1` + separate `FrameV2` (§4.7) |
| Re-simulation incompatible with audio/meta/lookback (arch B3, phys B1, perf B2) | RunSummary + Timeline contracts; declared lookback; audio from the Timeline only (§5) |
| Divergence check compares the wrong thing (perf B1) | Per-frame state hashes, never encoder bytes (§5.1) |
| Fast parts tunnel (phys B2) | Speed constraint, adaptive substeps, side memory, v clamp (§4.3) |
| Pinch wrong in both directions (phys B3) | Closing-contact rule + unit cases (§4.4) |
| Split overlap explodes piles (phys M1) | Child sizing / grow-in; end-of-substep spawns (§4.3) |
| Stacking jitter, asymmetric solve order (phys M2) | Small-step PBD, alternating sweeps, separate restitution, KE cap (§4.3) |
| Format can't represent endings (phys M3) | Despawn, ids, radius in `FrameV2` (§4.7) |
| Parts drawn one frame early (phys M4) | Time convention §4.6; legacy keeps T1 |
| Weak gate; runtime unpinned (phys M5, arch M4) | Raw-state + RNG hashes; Node + Electron gates; runtime stamp (§9, §7.5) |
| Shared RNG fragility (phys M6) | Counter-based RNG for new engines (§4.5) |
| Config constants imported everywhere (arch M1) | Step-1 task: split config, inject into layers (§2, §12) |
| Version stamps incomplete; id includes appVersion (arch M2) | Full stamps; id excludes appVersion; all-goldens rule (§7.5) |
| Process boundaries unspecified (arch M3) | Main = single writer; renderer runs pipeline; lock file; IPC surface (§7.2) |
| Interface never written (arch M5) | §3.1–3.2 |
| Perf numbers inconsistent; BENCHMARK.md missing (perf M1) | Re-benchmark sustained, p50/p95, numeric targets (§9) |
| Packed budget unverified (perf M2) | Substep×iteration cap; run-ahead queue; temp frame cache (§4.3, §7.2) |
| Bitrate check weak; fallback slow (perf M3) | Video-stream bitrate + SSIM/PSNR quality gate (§7.1) |
| No visual/duplicate checks (perf M4) | Coverage, variance, freeze/black detect; descriptor dedup (§7.1) |
| No crash/resume design (perf M5) | status.json + rebuild, resume, power blocker, fps monitoring (§7.2–7.3) |
| Storage/memory math missing (perf M6) | §7.4 numbers; precheck 2.2×; streamed WAV; transfer; audio slices |
| Verifier hard-codes the master format (perf M7) | Expected-format verification (§7.1) |
| Minors: preview fps, review UX, measurable acceptance, test gaps, rejected-log design, step-1 scope, flow control, no MT solve, Float64, fill definition, polygon vertices | Preview @60; one-key review + tags; pinned seeds; failure-injection/determinism/memory tests; seed-based rejected log; step 1 trimmed; credit-based worker; §4.1/4.3/4.8 |
