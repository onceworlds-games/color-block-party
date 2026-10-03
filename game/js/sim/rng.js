// Seeded randomness. Everything that depends on a race's seed goes through these, so every page (and the balance
// harness in Node) derives the same course, weather and wind from the same numbers.

/** A 32-bit hash of any number of integers (murmur3-style mixing). */
export function hash32(...ints) {
  let h = 0x9e3779b9 ^ ints.length;
  for (let i = 0; i < ints.length; i++) {
    let k = Math.imul(ints[i] | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A float in [0, 1) from integers, with no state: the same inputs always give the same number. */
export function hashf(...ints) {
  return hash32(...ints) / 4294967296;
}

/** A small, fast seeded generator (mulberry32). Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Helpers over a generator. */
export function rng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (list) => list[Math.floor(next() * list.length) % list.length],
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

/** Turns any value into a 32-bit seed (strings hash by character). */
export function seedOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return hash32(Math.floor(value), Math.floor((value % 1) * 1e6));
  const s = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
