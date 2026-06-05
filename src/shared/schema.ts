import { Schema, MapSchema, type } from "@colyseus/schema";
import type { CarBody } from "./physics";

export type Phase = "lobby" | "countdown" | "racing" | "finished";

/** One racer. Implements CarBody so the shared physics step mutates it
 * directly — no server<->sim copying. */
export class CarSchema extends Schema implements CarBody {
  @type("string") id = "";
  @type("string") name = "";
  @type("string") color = "red";
  @type("boolean") ready = false;
  @type("boolean") connected = true;

  // --- physical state (CarBody) ---
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") angle = 0;
  @type("float32") vx = 0;
  @type("float32") vy = 0;
  @type("float32") slip = 0;
  /** collision spin (rad/s) — integrated into `angle` server-side, so it doesn't
   * need to sync on its own. */
  spin = 0;
  /** steering yaw rate (rad/s) — integrated into `angle` server-side, internal
   * to the physics step, so it doesn't sync on its own. */
  yaw = 0;

  // --- surface / effect feedback ---
  @type("uint8") surface = 0; // Surface enum
  @type("boolean") onRoad = true;
  /** impact intensity from the most recent car-to-car bump (decays); the
   * client watches this rise to trigger sparks + impact sound. */
  @type("float32") bump = 0;
  /** seconds of reset flash remaining (>0 right after a respawn) */
  @type("float32") resetFlash = 0;

  // --- race progress ---
  @type("uint16") lap = 0;
  /** total cumulative distance traveled along the loop (px) — drives ranking */
  @type("float32") progress = 0;
  @type("uint16") rank = 0;
  @type("boolean") finished = false;
  @type("float32") finishTime = 0;
}

export class GameState extends Schema {
  @type("string") phase: Phase = "lobby";
  @type("string") hostId = "";
  @type("uint32") seed = 1;
  @type("float32") trackLength = 0;
  @type("uint8") totalLaps = 3;
  @type("float32") countdown = 0;
  @type("float32") raceTime = 0;
  /** seconds remaining before results are forced after the first finisher */
  @type("float32") finishTimer = 0;
  @type({ map: CarSchema }) players = new MapSchema<CarSchema>();
}
