# Baseline v1 (captured from commit `v1-frozen`)

Reference results the refactor must reproduce exactly.

| File | What it is |
|---|---|
| `sim.json` | Seeds 1, 7, 1234, 4242, 99999: frame count, cap frame, whole-run hash and a hash per frame |
| `render/truth/*.png` | 12 frames of seed 1234 rendered by the export renderer at 1080x1920 (bit-identical across two independent runs on this machine) |
| `render/results.json` | Benchmark record of the reference export (MediaBunny hardware, 32 Mbps) |
| `render/ffprobe.json` | Full ffprobe report of the reference export |
| `render/bench_mb-hw.mp4` | Reference export. **Not committed** (89 MB); kept on disk, SHA-256 in `SHA256SUMS` |
| `SHA256SUMS` | Checksums of all of the above |

Verify the simulation:

    node tools/baseline.mjs verify baseline/v1/sim.json

Pixel-exact render comparison holds on this machine and GPU driver; another GPU or driver may differ slightly.
