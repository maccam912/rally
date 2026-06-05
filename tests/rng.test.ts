import { describe, it, expect } from "vitest";
import { RNG } from "@shared/rng";

describe("RNG", () => {
  it("is deterministic for a given seed", () => {
    const a = new RNG(12345);
    const b = new RNG(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0,1)", () => {
    const r = new RNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge", () => {
    const a = new RNG(1);
    const b = new RNG(2);
    expect(a.next()).not.toEqual(b.next());
  });
});
