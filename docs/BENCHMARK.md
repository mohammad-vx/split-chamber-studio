# Benchmarks (Intel Core i3-1115G4, Intel UHD Graphics, Windows 11, Electron 45)

All numbers were measured on the target laptop. The pipeline numbers were taken after hours of continuous load (sustained / thermally saturated clocks), so they are the conservative case.

## Production pipeline (`--generate=4 --accept-all`, seeds 11–14, English captions)

| Scenario | Video | Candidate total | of which simulation | of which preview | Master render | Master video bitrate | Master SSIM (mean) |
|---|---|---|---|---|---|---|---|
| split-chamber@2 | 36.0 s | 28.9 s | 3.1 s | 16.0 s | 53.6 s | 36.2 Mbps | 0.976 |
| rotary-sweeper@1 | 34.1 s | 28.4 s | 3.6 s | 15.6 s | 47.2 s | 31.5 Mbps | 0.985 |
| rotary-sweeper@1 | 34.0 s | 27.2 s | 3.4 s | 14.4 s | 44.4 s | 27.7 Mbps | 0.985 |
| rams@1 | 37.5 s | 36.6 s | 4.4 s | 17.8 s | 52.3 s | 32.7 Mbps | 0.980 |

- **4 accepted videos in 410 s**, which is **≈ 100 s per finished video** (candidate + master + quality gate + loudness check). That works out to ≈ 35 finished videos per hour, or ≈ 120 candidates per hour when you only generate previews for review.
- Every master used MediaBunny hardware (WebCodecs/Intel), passed ffprobe (1080×1920, 60/1, exact frame count, AAC), and passed the quality gate with frame accuracy 6/6.
- Packaged app (`dist/win-unpacked`): one rams@1 video generated and accepted in **122 s**, with SSIM mean 0.980 at −14.6 LUFS.

## Simulation cost (headless, per frame)

| Engine / scenario | ms per frame | Notes |
|---|---|---|
| split-chamber@1/@2 (legacy swarm, 10k balls) | 1.2 (Node) · ≈ 3 (worker incl. encoding) | |
| orbit-crusher@1 (10k balls) | 0.2–0.5 | deterministic maths only |
| rotary-sweeper@1 (packed, ≈ 1,500 colliding balls, 12 substeps) | 0.6–1.7 | |
| jaws / rams / kaleidoscope / walls (machine engine, ≈ 1,200–2,200 balls) | 1.5–3.0 | |

All engines run far faster than real time, so the simulation is never the bottleneck. Encoding and quality checks are.

## Rendering (script time per frame, 1080×1920)

| Ball layer | p50 | p95 |
|---|---|---|
| WebGL2 point sprites (used) | 0.5 ms | ≈ 9 ms |
| Canvas 2D `drawImage` (rejected) | 18 ms | 250 ms |

The live preview (Play) runs at 47–58 fps on the Intel UHD; it skips display frames rather than slowing the simulation. Exports always contain every frame.

## Encoders (dense split-chamber scene, compared with a lossless reference; `tools/compare.mjs`)

| Encoder | Requested | Actual | PSNR | SSIM | Render time (25 s video) |
|---|---|---|---|---|---|
| MediaBunny HW | 32 Mbps | 28 Mbps | 40.5 dB | 0.988 | 57 s |
| MediaBunny SW | 32 Mbps | 24 Mbps | 39.3 dB | 0.985 | 92 s |
| FFmpeg QSV | 32 Mbps | 28 Mbps | 41.3 dB | 0.990 | 131 s |
| FFmpeg x264 (CRF 16) | — | 27 Mbps | 43.8 dB | 0.993 | 163 s |
| **MediaBunny HW** | **50 Mbps** | **42 Mbps** | **43.5 dB** | **0.993** | **48 s** ← masters |
| MediaBunny SW | 50 Mbps | 36 Mbps | 42.5 dB | 0.991 | 54 s |
| MediaBunny HW | 80 Mbps | **8.5 Mbps** | 33.4 dB | 0.961 | 47 s ← encoder ignored the rate |
| MediaBunny SW | 80 Mbps | 55 Mbps | 45.9 dB | 0.994 | 64 s |

**Conclusions:**
- Masters are rendered at 50 Mbps with MediaBunny hardware, which gives x264-level quality about 3× faster.
- A bitrate ratio is not a reliable health check: VBR encoders undershoot legitimately on simple scenes, at 10–20 of 50 Mbps with SSIM 0.99. The SSIM quality gate against rendered truth frames is what catches real degradation, such as the 80 Mbps case.

## Storage

- Preview: 540×960 at 60 fps, 4 Mbps → ≈ 18–20 MB per video.
- Master: 50 Mbps target, 28–42 Mbps actual → ≈ 120–200 MB per 35 s video.
- Quota: 12 GiB holds ≈ 60–90 masters, plus previews. A rejected video keeps only `config.json` / `metrics.json` / `status.json` (a few KB).

## Thermal note

During development, one export took 5× longer than usual (282 s instead of ≈ 50 s) while the laptop was hot. Batches still complete under these conditions, because nothing depends on real time. The Studio holds a power-save blocker during batches and pauses on battery.
