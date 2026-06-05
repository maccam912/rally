import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { RallyRoom } from "../src/server/RallyRoom";
import { MSG } from "@shared/protocol";

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot({
    initializeGameServer: (gs: any) => gs.define("rally", RallyRoom).filterBy(["code"]),
  } as any);
});
afterAll(async () => {
  await colyseus.shutdown();
});

describe("RallyRoom integration", () => {
  it("syncs players who join and tracks the host", async () => {
    const c1 = await colyseus.sdk.joinOrCreate("rally", { name: "Ann", code: "T1" });
    c1.onMessage("*", () => {});
    const room = colyseus.getRoomById(c1.roomId)!;
    await room.waitForNextPatch();
    expect(room.state.players.size).toBe(1);
    expect(room.state.hostId).toBe(c1.sessionId);

    const c2 = await colyseus.sdk.joinOrCreate("rally", { name: "Bob", code: "T1" });
    c2.onMessage("*", () => {});
    await room.waitForNextPatch();
    expect(room.state.players.size).toBe(2);
    expect(room.roomId).toBe(c1.roomId); // same code => same room

    await c1.leave();
    await c2.leave();
  });

  it("separates rooms by party code", async () => {
    const a = await colyseus.sdk.joinOrCreate("rally", { code: "ALPHA" });
    a.onMessage("*", () => {});
    const b = await colyseus.sdk.joinOrCreate("rally", { code: "BETA" });
    b.onMessage("*", () => {});
    expect(a.roomId).not.toBe(b.roomId);
    await a.leave();
    await b.leave();
  });

  it("starts a race on host command and integrates inputs", async () => {
    const host = await colyseus.sdk.joinOrCreate("rally", { name: "Host", code: "RACE" });
    host.onMessage("*", () => {});
    const room = colyseus.getRoomById(host.roomId)!;
    await room.waitForNextPatch();

    host.send(MSG.start);
    await room.waitForNextPatch();
    expect(["countdown", "racing"]).toContain(room.state.phase);

    // wait out the countdown
    const t0 = Date.now();
    while (room.state.phase !== "racing" && Date.now() - t0 < 6000) {
      await room.waitForNextPatch();
    }
    expect(room.state.phase).toBe("racing");

    const before = room.state.players.get(host.sessionId)!.x;
    // drive forward for a bit
    for (let i = 0; i < 40; i++) {
      host.send(MSG.input, { throttle: 1, steer: 0, handbrake: false });
      await room.waitForNextPatch();
    }
    const after = room.state.players.get(host.sessionId)!;
    const moved = Math.hypot(after.x - before, after.y);
    expect(moved).toBeGreaterThan(5);

    await host.leave();
  });
});
