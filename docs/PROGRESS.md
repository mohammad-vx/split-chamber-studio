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
