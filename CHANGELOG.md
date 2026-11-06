# Changelog

Each release has its own number (`major.minor.patch`): **minor** for new features or new pattern versions, **patch**
for fixes. The number appears in the window title, next to the Studio name, in the installer file names
(`SplitChamberStudio-<version>-setup.exe`) and in every video's `status.json` (`appVersion`).

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
