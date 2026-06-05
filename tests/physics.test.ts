import { describe, it, expect } from "vitest";
import {
  stepCar,
  resolveCarCollision,
  resolveObstacleCollision,
  type CarBody,
  type CarInput,
} from "@shared/physics";
import { Surface } from "@shared/surfaces";

function fresh(): CarBody {
  return { x: 0, y: 0, angle: 0, vx: 0, vy: 0, slip: 0, spin: 0, yaw: 0 };
}
function input(p: Partial<CarInput> = {}): CarInput {
  return { throttle: 0, steer: 0, handbrake: false, ...p };
}

describe("stepCar", () => {
  it("accelerates forward under throttle", () => {
    const car = fresh();
    for (let i = 0; i < 60; i++) stepCar(car, input({ throttle: 1 }), Surface.Tarmac, 1 / 60);
    expect(car.x).toBeGreaterThan(50); // moved along +x (heading 0)
    expect(Math.abs(car.y)).toBeLessThan(1);
    expect(car.vx).toBeGreaterThan(100);
  });

  it("reaches a higher top speed on tarmac than on sand", () => {
    const tar = fresh();
    const sand = fresh();
    for (let i = 0; i < 240; i++) {
      stepCar(tar, input({ throttle: 1 }), Surface.Tarmac, 1 / 60);
      stepCar(sand, input({ throttle: 1 }), Surface.Sand, 1 / 60);
    }
    expect(Math.hypot(tar.vx, tar.vy)).toBeGreaterThan(Math.hypot(sand.vx, sand.vy));
  });

  it("drifts (builds lateral slip) on snow with handbrake + steer", () => {
    const car = fresh();
    // get up to speed first
    for (let i = 0; i < 120; i++) stepCar(car, input({ throttle: 1 }), Surface.Tarmac, 1 / 60);
    let maxSlip = 0;
    for (let i = 0; i < 60; i++) {
      stepCar(car, input({ throttle: 1, steer: 1, handbrake: true }), Surface.Snow, 1 / 60);
      maxSlip = Math.max(maxSlip, car.slip);
    }
    expect(maxSlip).toBeGreaterThan(50); // genuinely sliding sideways
  });

  it("grippy tarmac slides less than slippery snow for the same maneuver", () => {
    const run = (surface: Surface) => {
      const car = fresh();
      for (let i = 0; i < 120; i++) stepCar(car, input({ throttle: 1 }), Surface.Tarmac, 1 / 60);
      let maxSlip = 0;
      for (let i = 0; i < 60; i++) {
        stepCar(car, input({ throttle: 1, steer: 1 }), surface, 1 / 60);
        maxSlip = Math.max(maxSlip, car.slip);
      }
      return maxSlip;
    };
    expect(run(Surface.Snow)).toBeGreaterThan(run(Surface.Tarmac));
  });

  it("a stationary car with no input stays put", () => {
    const car = fresh();
    for (let i = 0; i < 60; i++) stepCar(car, input(), Surface.Tarmac, 1 / 60);
    expect(Math.hypot(car.vx, car.vy)).toBeLessThan(1);
  });
});

describe("resolveCarCollision", () => {
  it("returns 0 and does nothing when cars are far apart", () => {
    const a = fresh();
    const b = { ...fresh(), x: 1000 };
    expect(resolveCarCollision(a, b)).toBe(0);
    expect(a.x).toBe(0);
  });

  it("separates overlapping cars and exchanges momentum on a head-on bump", () => {
    const a: CarBody = { x: 0, y: 0, angle: 0, vx: 100, vy: 0, slip: 0, spin: 0, yaw: 0 };
    const b: CarBody = { x: 30, y: 0, angle: Math.PI, vx: -100, vy: 0, slip: 0, spin: 0, yaw: 0 };
    const intensity = resolveCarCollision(a, b);
    expect(intensity).toBeGreaterThan(0);
    // pushed apart
    expect(b.x - a.x).toBeGreaterThan(30);
    // a was moving right, should be slowed/reversed; b vice versa
    expect(a.vx).toBeLessThan(100);
    expect(b.vx).toBeGreaterThan(-100);
  });

  it("a glancing side hit imparts spin (PIT maneuver) that then decays", () => {
    // a is catching b from behind-left and clipping its side: offset on y so the
    // contact normal is angled, producing tangential scrape -> spin.
    const a: CarBody = { x: 0, y: 10, angle: 0, vx: 260, vy: 0, slip: 0, spin: 0, yaw: 0 };
    const b: CarBody = { x: 44, y: -10, angle: 0, vx: 80, vy: 0, slip: 0, spin: 0, yaw: 0 };
    resolveCarCollision(a, b);
    expect(Math.abs(b.spin)).toBeGreaterThan(0.5); // got spun
    // and the spin bleeds off over a second of stepping
    const before = Math.abs(b.spin);
    for (let i = 0; i < 60; i++) stepCar(b, input(), Surface.Tarmac, 1 / 60);
    expect(Math.abs(b.spin)).toBeLessThan(before);
  });
});

describe("resolveObstacleCollision", () => {
  it("does nothing when the car isn't touching the obstacle", () => {
    const car: CarBody = { x: 0, y: 0, angle: 0, vx: 300, vy: 0, slip: 0, spin: 0, yaw: 0 };
    expect(resolveObstacleCollision(car, 500, 0, 20)).toBe(0);
    expect(car.x).toBe(0);
    expect(car.vx).toBe(300);
  });

  it("stops/deflects a head-on hit and pushes the car clear", () => {
    // car at x=20 driving +x into an obstacle centred at x=50, r=14 (minDist=40)
    const car: CarBody = { x: 20, y: 0, angle: 0, vx: 300, vy: 0, slip: 0, spin: 0, yaw: 0 };
    const intensity = resolveObstacleCollision(car, 50, 0, 14);
    expect(intensity).toBeGreaterThan(0);
    // bounced back the other way (no longer driving into it)
    expect(car.vx).toBeLessThan(0);
    // and is no longer overlapping the obstacle
    expect(Math.hypot(car.x - 50, car.y - 0)).toBeGreaterThanOrEqual(40 - 1e-3);
  });

  it("a glancing hit scrubs speed and imparts spin", () => {
    // approach offset on y so the contact normal is angled -> tangential scrape
    const car: CarBody = { x: 0, y: 12, angle: 0, vx: 320, vy: 0, slip: 0, spin: 0, yaw: 0 };
    const speedBefore = Math.hypot(car.vx, car.vy);
    resolveObstacleCollision(car, 34, 0, 14); // minDist = 40, dist = ~36 -> overlap
    expect(Math.hypot(car.vx, car.vy)).toBeLessThan(speedBefore);
    expect(Math.abs(car.spin)).toBeGreaterThan(0);
  });
});
