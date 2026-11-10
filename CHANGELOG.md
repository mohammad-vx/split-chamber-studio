# Changelog

Each release has its own number (`major.minor.patch`): **minor** for new features or new pattern versions, **patch**
for fixes. The number appears in the window title, next to the Studio name, in the installer file names
(`SplitChamberStudio-<version>-setup.exe`) and in every video's `status.json` (`appVersion`).

## 3.7.1 — 2026-11-10 · Website on phones: the batch no longer hangs at "Checking audio & picture"
- On a phone the batch stopped for ever at "Checking audio & picture" (the time left kept growing). The picture check
  steps through the preview in a hidden video element and waited, with no time limit, for the browser to say a frame
  was ready; phone browsers load no frame for a video that is not in the page and has never played.
- The element now sits in the page (2 px, off screen) and is started once, muted; every wait has a limit (20 s to
  open, 6 s per step). A browser that still will not step through the video ends the check with what it measured
  instead of stopping the batch. Desktop app unchanged (it checks with FFmpeg).

## 3.7.0 — 2026-11-10 · Inventor v3: machines put together freely
- ✦ Invent is now invent@3. Instead of eight drawings whose numbers change, a machine is put together from
  independent choices: a layout (limbs on the hub, tools or small rotors on a ring around it, arms hinged on the rim
  striking a central anvil, two hubs side by side) × how many limbs × how each is driven (spinning, swinging,
  slamming, stepping, pumping) × an optional elbow × a tool × whether the tool spins × how the copies are phased ×
  optional rim teeth and a laser. invent@2's eight families remain as the "classic" layout.
- New shapes: star, gear, cross, anchor, scoop, hook, comb, fork, hammer, wedge, fan, block, stone, ball. The curved
  and toothed ones are several convex parts on one parent, so the engine is unchanged.
- Nothing is tuned by hand: the limb lengths are fitted so the machine passes the rim (or the anvil) one ball apart,
  the open space is measured, and the first ball is put where a part strikes first.
- The arena fills: the finale is aimed at 27 s instead of 33 s. Measured on 24 machines: 22 pass the checks and 22
  reach the full count (invent@2: 9 of 10 passed but only 1 of 10 reached the full count before time ran out).
- Novelty: invent@3 uses its own threshold (84 % instead of 66 %): most free machines sweep the whole disc, and at
  66 % twin hubs with hammers counted as the same machine as eight rim arms with blocks. Between 78 % and 84 % are
  siblings (the same layout with another tool or drive), which now count as different machines.
- The similarity search skips pairs that cannot match, so thousands of kept machines compare quickly.
- invent@2 and invent@1 still replay and stay in the filter; they are no longer offered in Generate.
- `node tools/invent3-tune.mjs [seeds] [1 = calibrate]` counts the different machines.

## 3.6.0 — 2026-11-10 · A ball count you choose (built, switched off in the panel)
- New setting `balls` (100–20,000): the arena is full at that count, because the ball is sized for it (10,000 balls
  ≈ 3 px radius). ✦ Invent builds the machine for the ball size, small balls split into more pieces (up to 8), and a
  chosen count aims its finale at 27 s. Measured: 500 balls 10/10 reached the count, 3,000 balls 7/10.
- **Not shown in Generate**: the owner found the balls too small, so the "Balls" field is hidden and "Stop at" stays.
  The setting still works from the command line (`--balls=3000`, `--length=long`); to bring the field back, remove the
  two `hidden` classes next to `st-balls` in `src/index.html`.
- Patterns tuned to one ball size (Melodic Rams, Crocodile Jaws, Fist Arm, Hammer & Bowl) keep their ball: for them
  the count only stops the video earlier. Without a count nothing changes; old videos reproduce as before.
- `node tools/balls-probe.mjs <pattern> <balls>` measures a count with the real checks.

## 3.5.0 — 2026-11-07 · Inventor v2: never the same machine twice
- ✦ Invent is now invent@2: five new machine families on mechanisms the engine already had: wave (a ring of pistons
  hammering the rim one after another), kaleidoscope (a random convex shape repeated 3–6 times, spinning, stepping or
  rocking), pendulum (double / triple, unequal periods), Geneva drive (lobes turning in steps with a dwell) and orbit
  (bodies on star-shaped epicycles, sometimes around pegs), plus v1's sweeper, press and blades.
- Never the same machine twice: every invention gets a signature of what it covers and what it looks like over its
  cycle (unchanged by turning or mirroring). An attempt at least 66 % like any machine you accepted, still have to
  review, or made earlier in the batch is redrawn (up to 30 attempts); the batch starts with the family you have least
  of. The novelty check compares signatures instead of names (v1 let "34° wide" and "35° wide" pass as different).
- invent@1 still replays its videos but is no longer offered; ✦ Invent is the default pattern in Generate.
- Orbit machines no longer buzz: their beat accent fired on every frame (the path had no period); a test now keeps
  every family to accents on the beat.
- docs/NO-REPEAT-PLAN.md: the plan (arenas, timed stories and more families come next).

## 3.4.0 — 2026-11-07 · Continue, time left, notification
- Continue an interrupted batch: if the page was reloaded or closed (or the app crashed) mid-batch, the Studio shows
  "A batch was interrupted: 3 of 10 done" with ▶ Continue (same pattern, settings and remaining seeds) or Dismiss.
  Finished videos were always kept; now the rest of the batch is too.
- Time left: the job bar shows "about 6 min left", from the average time of the batch's finished videos (the first
  video estimates from its preview progress); the tab title shows progress, e.g. "(3/10) Split Chamber Studio".
- Website: a browser notification when a batch ends (permission asked once, on Generate; tapping it brings the tab
  back). A note in the job bar says to keep the page open, the screen stays on during a batch (taken again when you
  come back to the page), and leaving the page mid-batch asks first.
- Fix: the job bar showed "video" instead of "Rendering preview · frame/total" (export progress overwrote the stage).
- Website: the service worker revalidates the app's files, so an update never mixes old and new modules.

## 3.3.1 — 2026-11-07 · Phone layout
- The Studio fits a phone: one scrolling page, two videos per row, full-width buttons sized for touch, and the
  action column becomes a sheet that slides up when you tap a video (✕ closes it).
- Tap the picture to pause during live play (Restart and Main menu are on the pause panel); the keyboard hints are
  hidden on small screens. Desktop layout unchanged.
- Website build: the stylesheet link carries a content hash, so phones pick up layout changes without a stale copy.
- README: one video instead of two. The 3.2 promo is the only one, and its poster plays it from the website (a
  repo file opened GitHub's file page instead of playing).

## 3.3.0 — 2026-11-07 · The Studio as a website
- Runs in the browser with no install: https://mohammad-vx.github.io/split-chamber-studio/ (Chrome or Edge on a
  computer recommended). The same renderer code as the desktop app; `node tools/build-web.mjs` builds the static
  site into `dist-web/`.
- The library lives in the browser (IndexedDB), served to thumbnails and players by a service worker; finished
  videos have ⬇ Download buttons instead of "Open folder".
- The checks ffmpeg makes on the desktop are measured in the page: loudness (the app's BS.1770 meter), true peak,
  silences, frozen/black picture, frame hashes for duplicates, thumbnails, and the master quality gate (SSIM and
  frame accuracy against truth frames). Measured on Crocodile Jaws seed 300: −14.5 LUFS, master SSIM 0.993, 6/6.
- Export in the browser uses WebCodecs only (no FFmpeg engines); without an AAC encoder it falls back to Opus.

## 3.2.0 — 2026-11-07 · Every video visible, inventor tuned
- Rejected videos keep a picture (drawn from the simulation, no encode), ▶ Play replays them live from their
  settings, and ✓ Accept anyway makes the verified master of a rejected video.
- Inventor speed calibration: each invented machine is simulated for 24 s and its rhythm scaled (0.6–2.2×) so the
  finale lands near 33 s. Inventor pass rate: 42 % (3.0) → 62 % (3.1) → 92 % (24 seeds); 17/18 with the three
  families rotated (6/6 press, 6/6 blades, 5/6 arms).
- Batches of ✦ Invent rotate arms / press / blades; structures you already accepted are skipped up front.
- Fixes: the blade family had its two hinges swapped (it never pinched); lasers now go with arms only (with
  blades they pushed balls into the metal); the first ball waits in the first arm's path (hook ≤ 3 s).
- The inventor builds its machines in a worker (no UI freeze while it calibrates). Wider "Save as pattern" field.

## 3.1.1 — 2026-11-06
- Fix: thumbnails and previews could stay blank in the installed app (the library file handler was registered only
  after the startup recovery pass). It is now registered first, and a failing recovery is logged instead of
  blocking the library.

## 3.1.0 — 2026-11-06 · Inventor: pre-check, novelty, saved machines
- Pre-check: every invented machine is simulated for 12 s first; a machine that stalls or runs away is replaced by
  another variant of the same seed (up to 6, same family first). Pass rate 42 % → 62 % (24 seeds), with all three
  families represented.
- Novelty: an invention with the same structure as one you already accepted is rejected ("A machine you have not
  accepted yet").
- ★ Save as pattern: keep an invented machine under a name (stored in the library's `patterns.json`); it appears in
  the pattern list and every new video of it is a variation (rhythm and swing ±12 %, shapes unchanged).
- ✦ New variation on an invented video now keeps the machine instead of inventing a new one.

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
