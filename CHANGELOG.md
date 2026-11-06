# Changelog

Each release has its own number (`major.minor.patch`): **minor** for new features or new pattern versions, **patch**
for fixes. The number appears in the window title, next to the Studio name, in the installer file names
(`SplitChamberStudio-<version>-setup.exe`) and in every video's `status.json` (`appVersion`).

## 3.0.1 — 2026-11-06
- Sound: hard strikes (Hammer & Bowl) reached −0.3 dBTP after AAC and were rejected. Audio v3 (the new machines and
  the inventor) limits samples to −2.5 dBFS and wins the loudness back in up to three passes; older audio unchanged.
  Measured on the two rejected seeds: −1.3 / −1.8 dBTP at −14.6 / −14.4 LUFS.
- Fist Arm swings wider: 8/12 seeds pass instead of 7/12.
- These @1 versions were updated before any of their videos was accepted in your library.

## 3.0.0 — 2026-11-06 · Phase 3: Machine Inventor
- **✦ Invent** in the pattern list: every seed builds a machine nobody wrote by hand (arms with or without elbows
  around the rim, a roofed hammer over a flat or V anvil, twin sector blades; random mechanism, rhythm, sizes,
  gravity, optional laser) and names it. The usual checks reject the failures; survivors reach review with an
  **Invented** badge and their name. An invented machine reproduces exactly from its config.
- "Random pattern" batches never pick the inventor.

## 2.5.0 — 2026-11-06 · Phase 2, station 3
- Three more machines: **Shears Fan** (3–5 blades on one pin above the arena open and shut over a cradle),
  **Fan Blades** (two sector blades swing out against the rim and back together), **Laser Spin** (a laser bar on a
  planetary carrier, pulled to the centre, past fixed pegs).
- Claw Machine is built but not offered yet: it still grows too slowly.

## 2.4.0 — 2026-11-06 · Phase 2, station 2
- Three new machines built on the part tree: **Crocodile Jaws** (a toothed upper jaw hinged on the rim snaps onto a
  fixed lower jaw), **Fist Arm** (two arms with elbows punch against the rim), **Hammer & Bowl** (a drop hammer from
  above the arena falls into a V bowl).

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
