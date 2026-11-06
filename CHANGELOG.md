# Changelog

Each release has its own number (`major.minor.patch`): **minor** for new features or new pattern versions, **patch**
for fixes. The number appears in the window title, next to the Studio name, in the installer file names
(`SplitChamberStudio-<version>-setup.exe`) and in every video's `status.json` (`appVersion`).

## 2.3.0 — 2026-11-06 · Phase 2, station 1
- Machine engine split into modules (`src/engine/machine/`: kinematics, mechanisms, collide, pinch, ending, measure);
  every older video still reproduces byte for byte (all 39 goldens + the gate).
- Part tree: a part can be mounted on another part (`parent`), so an elbow arm, a trolley on a rail or a claw on a
  cable are chains of simple motions.
- Closed-form mechanisms (`mech`): quick return, slam (drop hammer), cam, scissor, ratchet, Lissajous, rose, planet.
  Parts can change shape over time (`morph`) and be drawn outside the arena (`outside`).
- Tests: part tree, mechanisms, morph; the batch-summary end-to-end test now uses fixed seeds.
- Fix: two library writes at the same moment could fail (`library.json` temp file renamed twice); every write
  now has its own temp file and retries a briefly locked target.

## 2.2.1 — 2026-11-06
- Previews and thumbnails are read straight from disk (seekable); a missing file is a clear 404 in the log.
- Only one copy of the app can run; opening it again brings the existing window forward.
- Closing the window stops everything: running exports and every ffmpeg / analysis process are killed.
- Version shown in the window title and the Studio header.

## 2.2.0 — 2026-11-06 · Phase 1
- One engine and one rule for every pattern: solid parts collide, a squeezed ball always splits, only the laser is
  see-through. New versions: split-chamber@3, orbit-crusher@2, rotary-sweeper@3, walls@3, new laser-cross@1.
- Check: no ball passes through a solid part. Kaleidoscope hidden until redesigned.
- Generate panel: gravity, stop-at count, length, ending (incl. flood the screen).

## 2.1.0 — 2026-11-06
- Pinch between a moving and a fixed part always splits (@2 packed/machine patterns).
- Last-batch summary, per-video check explanations and score breakdown, "How it works", Watch live.
- Live play: all patterns; Exit returns to the Studio.

## 2.0.0 — 2026-11-05
- Split Chamber Studio: automatic generation, checks, review queue, verified masters, 7 patterns.
