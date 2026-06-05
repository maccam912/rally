/** Seeded, deterministic RNG (mulberry32). Same seed => identical stream on
 * client and server, which lets both build the exact same procedural track. */
export class RNG {
  private s: number;
  constructor(seed: number) {
    // force to uint32 and avoid a 0 state
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  /** float in [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Make a fresh random 31-bit seed (for creating a new track). */
export function randomSeed(): number {
  return (Math.random() * 0x7fffffff) >>> 0;
}
