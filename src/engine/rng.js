// Counter-based RNG: rand(seed, a, b, purpose) -> [0,1). Pure function of its inputs, so changing how many
// random numbers one ball uses never reshuffles any other ball's randomness (review finding phys M6).
function fmix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16; return h >>> 0;
}
export function hash32(seed, a, b, c) {
  let h = fmix((seed ^ 0x9e3779b9) >>> 0);
  h = fmix((h ^ Math.imul(a | 0, 0xcc9e2d51)) >>> 0);
  h = fmix((h ^ Math.imul(b | 0, 0x1b873593)) >>> 0);
  h = fmix((h ^ Math.imul(c | 0, 0xe6546b64)) >>> 0);
  return h;
}
export function rand(seed, a, b, c) { return hash32(seed, a, b, c) / 4294967296; }
