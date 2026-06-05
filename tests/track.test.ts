import { describe, it, expect } from "vitest";
import { generateTrack, nearestOnTrack, startGrid } from "@shared/track";
import { Surface } from "@shared/surfaces";

describe("track generation", () => {
  it("is deterministic for a seed", () => {
    const a = generateTrack(42);
    const b = generateTrack(42);
    expect(a.points.length).toBe(b.points.length);
    expect(a.length).toBeCloseTo(b.length, 6);
    expect(a.points[10].x).toBeCloseTo(b.points[10].x, 6);
    expect(a.points[10].surface).toBe(b.points[10].surface);
  });

  it("different seeds give different tracks", () => {
    const a = generateTrack(1);
    const b = generateTrack(2);
    expect(a.points[5].x).not.toBeCloseTo(b.points[5].x, 1);
  });

  it("forms a closed loop with positive length", () => {
    const t = generateTrack(99);
    expect(t.length).toBeGreaterThan(1000);
    const first = t.points[0];
    const last = t.points[t.points.length - 1];
    // last point connects back near the first
    const gap = Math.hypot(first.x - last.x, first.y - last.y);
    expect(gap).toBeLessThan(400);
  });

  it("starts on a grippy tarmac zone", () => {
    const t = generateTrack(123);
    expect(t.points[0].surface).toBe(Surface.Tarmac);
  });

  it("includes more than one surface type", () => {
    const t = generateTrack(2024);
    const surfaces = new Set(t.points.map((p) => p.surface));
    expect(surfaces.size).toBeGreaterThan(1);
  });

  it("nearestOnTrack finds a centerline point with ~zero lateral", () => {
    const t = generateTrack(5);
    const p = t.points[20];
    const near = nearestOnTrack(t, p.x, p.y);
    expect(near.lateral).toBeLessThan(5);
    expect(near.distAlong).toBeGreaterThanOrEqual(0);
    expect(near.distAlong).toBeLessThanOrEqual(t.length + 1);
  });

  it("nearestOnTrack reports lateral distance off the centerline", () => {
    const t = generateTrack(5);
    const p = t.points[20];
    // step perpendicular to the track heading
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    const off = nearestOnTrack(t, p.x + nx * 100, p.y + ny * 100);
    expect(off.lateral).toBeGreaterThan(80);
    expect(off.lateral).toBeLessThan(120);
  });

  it("startGrid scales to any player count", () => {
    const t = generateTrack(7);
    expect(startGrid(t, 1).length).toBe(1);
    expect(startGrid(t, 50).length).toBe(50);
    const slots = startGrid(t, 8);
    // all slots near the start area and facing forward
    for (const s of slots) {
      expect(Math.abs(s.angle - t.points[0].angle)).toBeLessThan(0.001);
    }
  });
});
