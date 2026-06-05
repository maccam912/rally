import { describe, it, expect } from "vitest";
import { generateObstacles } from "@shared/obstacles";
import { generateTrack } from "@shared/track";

describe("generateObstacles", () => {
  it("is deterministic for a seed (so server and client agree)", () => {
    const track = generateTrack(12345);
    const a = generateObstacles(track, 12345);
    const b = generateObstacles(track, 12345);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("produces solid scenery with positive collision radii", () => {
    const track = generateTrack(777);
    const obs = generateObstacles(track, 777);
    expect(obs.length).toBeGreaterThan(5);
    for (const o of obs) {
      expect(o.radius).toBeGreaterThan(0);
      expect(["tree", "rock", "tires", "barrier_white", "cone"]).toContain(o.type);
    }
  });

  it("keeps scenery off the racing line (clear of the start area)", () => {
    const track = generateTrack(42);
    const obs = generateObstacles(track, 42);
    // nothing should sit on top of the start/finish point
    const start = track.points[0];
    for (const o of obs) {
      expect(Math.hypot(o.x - start.x, o.y - start.y)).toBeGreaterThan(40);
    }
  });
});
