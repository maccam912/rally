import { describe, it, expect } from "vitest";
import { RaceSimulation } from "../src/sim/RaceSimulation";
import { nearestOnTrack } from "@shared/track";
import { CarSchema } from "@shared/schema";

const DT = 1 / 60;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Simple path-following AI: aim ~320px ahead on the centerline, steer toward
 * it, ease off the throttle in sharp corners. Good enough to complete laps. */
function drive(sim: RaceSimulation, car: CarSchema): void {
  const t = sim.track;
  const m = t.points.length;
  const near = nearestOnTrack(t, car.x, car.y);
  let look = near.index;
  let acc = 0;
  while (acc < 320) {
    const a = t.points[look % m];
    const b = t.points[(look + 1) % m];
    acc += Math.hypot(b.x - a.x, b.y - a.y);
    look++;
  }
  const target = t.points[look % m];
  const desired = Math.atan2(target.y - car.y, target.x - car.x);
  let err = desired - car.angle;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const steer = clamp(err * 2.5, -1, 1);
  const speed = Math.hypot(car.vx, car.vy);
  const throttle = Math.abs(err) > 0.6 && speed > 300 ? 0.25 : 1;
  sim.setInput(car.id, { throttle, steer, handbrake: false });
}

function driveAll(sim: RaceSimulation): void {
  for (const [, car] of sim.state.players) if (!car.finished) drive(sim, car);
}

describe("RaceSimulation — membership", () => {
  it("adds players, assigns a host and distinct colors", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a", "Ann");
    sim.addPlayer("b", "Bob");
    expect(sim.state.players.size).toBe(2);
    expect(sim.state.hostId).toBe("a");
    expect(sim.isHost("a")).toBe(true);
    expect(sim.state.players.get("a")!.color).not.toBe(
      sim.state.players.get("b")!.color,
    );
  });

  it("reassigns host when the host leaves", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a");
    sim.addPlayer("b");
    sim.removePlayer("a");
    expect(sim.state.hostId).toBe("b");
  });

  it("places cars on a grid behind the start line", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a");
    sim.addPlayer("b");
    sim.addPlayer("c");
    for (const [, car] of sim.state.players) {
      const near = nearestOnTrack(sim.track, car.x, car.y);
      expect(near.lateral).toBeLessThan(sim.track.points[0].halfWidth + 50);
    }
  });
});

describe("RaceSimulation — race control", () => {
  it("only the host can start, and start requires a player", () => {
    const sim = new RaceSimulation(undefined, 1);
    expect(sim.startRace("nobody")).toBe(false);
    sim.addPlayer("a");
    sim.addPlayer("b");
    expect(sim.startRace("b")).toBe(false); // not host
    expect(sim.startRace("a")).toBe(true);
    expect(sim.state.phase).toBe("countdown");
  });

  it("counts down then transitions to racing", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a");
    sim.startRace("a");
    for (let i = 0; i < 60 * 4; i++) sim.tick(DT);
    expect(sim.state.phase).toBe("racing");
  });
});

describe("RaceSimulation — full race playthrough", () => {
  it("AI drivers complete all laps and the race finishes", () => {
    const sim = new RaceSimulation(undefined, 1337);
    sim.addPlayer("a", "Ann");
    sim.addPlayer("b", "Bob");
    sim.addPlayer("c", "Cara");
    sim.startRace("a");

    let ticks = 0;
    const maxTicks = 60 * 300; // 300 sim-seconds budget
    while (sim.state.phase !== "finished" && ticks < maxTicks) {
      if (sim.state.phase === "racing") driveAll(sim);
      sim.tick(DT);
      ticks++;
    }

    expect(sim.state.phase).toBe("finished");
    // everyone completed the configured number of laps
    for (const [, car] of sim.state.players) {
      expect(car.lap).toBeGreaterThanOrEqual(sim.state.totalLaps);
      expect(car.finished).toBe(true);
      expect(car.finishTime).toBeGreaterThan(0);
    }
    // ranks are a permutation of 1..N
    const ranks = [...sim.state.players.values()].map((c) => c.rank).sort();
    expect(ranks).toEqual([1, 2, 3]);
  });

  it("a single player can race solo", () => {
    const sim = new RaceSimulation(undefined, 7);
    sim.addPlayer("solo");
    sim.startRace("solo");
    let ticks = 0;
    while (sim.state.phase !== "finished" && ticks < 60 * 300) {
      if (sim.state.phase === "racing") driveAll(sim);
      sim.tick(DT);
      ticks++;
    }
    expect(sim.state.phase).toBe("finished");
    expect(sim.state.players.get("solo")!.finished).toBe(true);
  });
});

describe("RaceSimulation — reset rules", () => {
  it("respawns a car that drives way off the road", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a");
    sim.startRace("a");
    for (let i = 0; i < 60 * 4; i++) sim.tick(DT); // into racing
    const car = sim.state.players.get("a")!;
    // teleport far off the track
    car.x += 5000;
    car.y += 5000;
    sim.tick(DT); // hard off-road -> immediate respawn
    expect(car.resetFlash).toBeGreaterThan(0);
    const near = nearestOnTrack(sim.track, car.x, car.y);
    expect(near.lateral).toBeLessThan(5); // back on the centerline
  });

  it("respawns a car left motionless for too long", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a");
    sim.startRace("a");
    for (let i = 0; i < 60 * 4; i++) sim.tick(DT);
    const car = sim.state.players.get("a")!;
    car.vx = 0;
    car.vy = 0;
    // sit still (no input) past the idle delay
    let flashed = false;
    for (let i = 0; i < 60 * 6; i++) {
      car.vx = 0;
      car.vy = 0;
      sim.setInput("a", { throttle: 0, steer: 0, handbrake: false });
      sim.tick(DT);
      if (car.resetFlash > 0) {
        flashed = true;
        break;
      }
    }
    expect(flashed).toBe(true);
  });

  it("records a bump when two cars collide", () => {
    const sim = new RaceSimulation(undefined, 1);
    sim.addPlayer("a");
    sim.addPlayer("b");
    sim.startRace("a");
    for (let i = 0; i < 60 * 4; i++) sim.tick(DT);
    const a = sim.state.players.get("a")!;
    const b = sim.state.players.get("b")!;
    // place them overlapping ON the road (centered on a track point), closing fast
    const p = sim.track.points[12];
    a.x = p.x;
    a.y = p.y;
    a.vx = 200;
    a.vy = 0;
    b.x = p.x + 30;
    b.y = p.y;
    b.vx = -200;
    b.vy = 0;
    sim.tick(DT);
    expect(a.bump).toBeGreaterThan(0);
    expect(sim.collisions.length).toBeGreaterThan(0);
  });
});
