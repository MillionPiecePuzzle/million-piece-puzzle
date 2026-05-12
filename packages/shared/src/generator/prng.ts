/**
 * Deterministic PRNG and seed derivation.
 *
 * xmur3 hashes a string into a 32-bit integer seed; mulberry32 turns that seed
 * into a stream of uniform doubles in [0, 1). subseed derives a child 32-bit
 * seed from a parent seed and integer keys, used to give each puzzle edge its
 * own independent stream.
 */

export function xmur3(s: string): () => number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  return xmur3(s)();
}

export function subseed(base: number, ...keys: number[]): number {
  let h = base >>> 0;
  for (const k of keys) {
    h = Math.imul(h ^ (k >>> 0), 2654435761) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
  }
  return h;
}
