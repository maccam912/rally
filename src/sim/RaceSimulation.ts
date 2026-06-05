import { GameState, CarSchema, type Phase } from "../shared/schema";
import {
  stepCar,
  resolveCarCollision,
  ZERO_INPUT,
  type CarInput,
} from "../shared/physics";
import {
  generateTrack,
  nearestOnTrack,
  startGrid,
  type Track,
} from "../shared/track";
import { Surface } from "../shared/surfaces";
import { CAR, RESET, RACE, CAR_COLORS } from "../shared/constants";
import { randomSeed } from "../shared/rng";
import type { InputPayload } from "../shared/protocol";

/** Per-player bookkeeping that doesn't need to be synced. */
interface Runtime {
  input: CarInput;
  offRoadTime: number;
  idleTime: number;
  lastDist: number;
  halfwayReached: boolean;
  joinOrder: number;
}

export interface CollisionEvent {
  x: number;
  y: number;
  intensity: number;
}

/**
 * Authoritative, engine-agnostic rally race. Holds a GameState (Colyseus
 * schema) and a Track, and advances everything via tick(dt). No Colyseus Room,
 * no Phaser — a whole race can be played in a unit test by calling tick in a
 * loop.
 */
export class RaceSimulation {
  readonly state: GameState;
  track: Track;
  private rt = new Map<string, Runtime>();
  private joinCounter = 0;
  /** transient per-tick collision events for the client (sound/particles) */
  collisions: CollisionEvent[] = [];

  constructor(state: GameState = new GameState(), seed?: number) {
    this.state = state;
    const s = seed ?? randomSeed();
    this.state.seed = s;
    this.track = generateTrack(s);
    this.state.trackLength = this.track.length;
    this.state.totalLaps = RACE.defaultLaps;
    this.state.phase = "lobby";
  }

  // ---- lobby / membership -------------------------------------------------

  addPlayer(id: string, name = "", color?: string): CarSchema {
    const car = new CarSchema();
    car.id = id;
    car.name = name || `Driver ${this.state.players.size + 1}`;
    car.color = color && (CAR_COLORS as readonly string[]).includes(color)
      ? color
      : CAR_COLORS[this.state.players.size % CAR_COLORS.length];
    this.state.players.set(id, car);
    this.rt.set(id, {
      input: { ...ZERO_INPUT },
      offRoadTime: 0,
      idleTime: 0,
      lastDist: 0,
      halfwayReached: false,
      joinOrder: this.joinCounter++,
    });
    if (!this.state.hostId) this.state.hostId = id;
    this.placeOnGrid();
    return car;
  }

  removePlayer(id: string): void {
    this.state.players.delete(id);
    this.rt.delete(id);
    if (this.state.hostId === id) {
      // hand host to the earliest remaining player
      let next = "";
      let best = Infinity;
      for (const [pid] of this.state.players) {
        const order = this.rt.get(pid)?.joinOrder ?? Infinity;
        if (order < best) {
          best = order;
          next = pid;
        }
      }
      this.state.hostId = next;
    }
  }

  setConnected(id: string, connected: boolean): void {
    const car = this.state.players.get(id);
    if (car) car.connected = connected;
  }

  setReady(id: string, ready: boolean): void {
    const car = this.state.players.get(id);
    if (car) car.ready = ready;
  }

  setName(id: string, name: string): void {
    const car = this.state.players.get(id);
    if (car && name.trim()) car.name = name.trim().slice(0, 16);
  }

  setColor(id: string, color: string): void {
    const car = this.state.players.get(id);
    if (car && (CAR_COLORS as readonly string[]).includes(color)) car.color = color;
  }

  setInput(id: string, p: InputPayload): void {
    const r = this.rt.get(id);
    if (!r) return;
    r.input.throttle = clamp(p.throttle ?? 0, -1, 1);
    r.input.steer = clamp(p.steer ?? 0, -1, 1);
    r.input.handbrake = !!p.handbrake;
  }

  isHost(id: string): boolean {
    return this.state.hostId === id;
  }

  // ---- race control -------------------------------------------------------

  /** Begin the countdown. Only the host may start; needs >= 1 player. */
  startRace(byId?: string): boolean {
    if (byId && byId !== this.state.hostId) return false;
    if (this.state.phase !== "lobby") return false;
    if (this.state.players.size < 1) return false;
    this.resetRaceState();
    this.state.phase = "countdown";
    this.state.countdown = RACE.countdownSeconds;
    return true;
  }

  /** Back to the lobby on a brand new track. Host only. */
  restart(byId?: string): boolean {
    if (byId && byId !== this.state.hostId) return false;
    const s = randomSeed();
    this.state.seed = s;
    this.track = generateTrack(s);
    this.state.trackLength = this.track.length;
    this.resetRaceState();
    this.state.phase = "lobby";
    return true;
  }

  private resetRaceState(): void {
    this.state.raceTime = 0;
    this.state.countdown = 0;
    this.state.finishTimer = 0;
    this.placeOnGrid();
    for (const [id, car] of this.state.players) {
      car.lap = 0;
      car.rank = 0;
      car.finished = false;
      car.finishTime = 0;
      car.progress = 0;
      car.bump = 0;
      car.resetFlash = 0;
      const r = this.rt.get(id)!;
      r.offRoadTime = 0;
      r.idleTime = 0;
      r.halfwayReached = false;
      const near = nearestOnTrack(this.track, car.x, car.y);
      r.lastDist = near.distAlong;
    }
  }

  /** Lay every car out on the start grid (ordered by join order). */
  private placeOnGrid(): void {
    const ids = [...this.state.players.keys()].sort(
      (a, b) => (this.rt.get(a)?.joinOrder ?? 0) - (this.rt.get(b)?.joinOrder ?? 0),
    );
    const slots = startGrid(this.track, ids.length);
    ids.forEach((id, i) => {
      const car = this.state.players.get(id)!;
      const slot = slots[i];
      car.x = slot.x;
      car.y = slot.y;
      car.angle = slot.angle;
      car.vx = 0;
      car.vy = 0;
      car.slip = 0;
    });
  }

  // ---- main loop ----------------------------------------------------------

  tick(dt: number): void {
    this.collisions.length = 0;
    switch (this.state.phase) {
      case "countdown":
        this.tickCountdown(dt);
        break;
      case "racing":
        this.tickRacing(dt);
        break;
      // lobby / finished: cars sit still
    }
    // decay transient feedback in any phase
    for (const [, car] of this.state.players) {
      if (car.bump > 0) car.bump = Math.max(0, car.bump - dt * 90);
      if (car.resetFlash > 0) car.resetFlash = Math.max(0, car.resetFlash - dt);
    }
  }

  private tickCountdown(dt: number): void {
    this.state.countdown -= dt;
    if (this.state.countdown <= 0) {
      this.state.countdown = 0;
      this.state.phase = "racing";
      this.state.raceTime = 0;
    }
  }

  private tickRacing(dt: number): void {
    this.state.raceTime += dt;

    // 1. integrate each car
    for (const [id, car] of this.state.players) {
      const r = this.rt.get(id)!;
      if (car.finished) {
        // coast to a stop after finishing
        car.vx *= Math.exp(-3 * dt);
        car.vy *= Math.exp(-3 * dt);
        car.x += car.vx * dt;
        car.y += car.vy * dt;
        continue;
      }

      const near = nearestOnTrack(this.track, car.x, car.y);
      const edgeDist = near.lateral - near.halfWidth;
      const onRoad = edgeDist <= 0;
      car.onRoad = onRoad;
      const surface: Surface = onRoad ? near.surface : Surface.Offroad;
      car.surface = surface;

      const input = car.connected ? r.input : ZERO_INPUT;
      stepCar(car, input, surface, dt);

      this.updateResetTimers(car, r, near, edgeDist, dt);
      this.updateProgress(car, r, dt);
    }

    // 2. car-to-car collisions (pairwise)
    this.resolveCollisions();

    // 3. ranking + finish detection
    this.updateRanking();
    this.checkFinish(dt);
  }

  private updateResetTimers(
    car: CarSchema,
    r: Runtime,
    near: ReturnType<typeof nearestOnTrack>,
    edgeDist: number,
    dt: number,
  ): void {
    if (car.resetFlash > 0) {
      // grace period right after a reset — don't immediately re-trigger
      r.offRoadTime = 0;
      r.idleTime = 0;
      return;
    }

    // way off the road -> immediate reset
    if (edgeDist > RESET.hardOffRoadDist) {
      this.respawn(car, r, near);
      return;
    }
    // lingering off the road -> timed reset
    if (edgeDist > RESET.offRoadMargin) {
      r.offRoadTime += dt;
      if (r.offRoadTime > RESET.offRoadDelay) {
        this.respawn(car, r, near);
        return;
      }
    } else {
      r.offRoadTime = 0;
    }

    // motionless too long -> reset (un-stick stranded players)
    const speed = Math.hypot(car.vx, car.vy);
    if (speed < RESET.idleSpeed) {
      r.idleTime += dt;
      if (r.idleTime > RESET.idleDelay) {
        this.respawn(car, r, near);
      }
    } else {
      r.idleTime = 0;
    }
  }

  /** Drop the car back onto the middle of the road, facing forward. */
  private respawn(
    car: CarSchema,
    r: Runtime,
    near: ReturnType<typeof nearestOnTrack>,
  ): void {
    car.x = near.px;
    car.y = near.py;
    car.angle = near.angle;
    car.vx = 0;
    car.vy = 0;
    car.slip = 0;
    car.onRoad = true;
    car.surface = near.surface;
    car.resetFlash = RESET.flashTime;
    r.offRoadTime = 0;
    r.idleTime = 0;
  }

  private updateProgress(car: CarSchema, r: Runtime, dt: number): void {
    const near = nearestOnTrack(this.track, car.x, car.y);
    const L = this.track.length;
    const d = near.distAlong;

    // mark halfway so a lap only counts after going (most of the way) around
    if (d > L * 0.4 && d < L * 0.6) r.halfwayReached = true;

    // forward wrap across the start line
    if (r.lastDist > L * 0.7 && d < L * 0.3) {
      if (r.halfwayReached) {
        car.lap += 1;
        r.halfwayReached = false;
      }
    } else if (r.lastDist < L * 0.3 && d > L * 0.7) {
      // crossed the line backwards — undo a lap (anti-cheese)
      if (car.lap > 0) car.lap -= 1;
    }
    r.lastDist = d;
    car.progress = car.lap * L + d;
  }

  private resolveCollisions(): void {
    const cars = [...this.state.players.values()];
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        // cheap broad-phase
        if (Math.abs(a.x - b.x) > CAR.radius * 2) continue;
        if (Math.abs(a.y - b.y) > CAR.radius * 2) continue;
        const intensity = resolveCarCollision(a, b);
        if (intensity > 30) {
          a.bump = Math.max(a.bump, intensity);
          b.bump = Math.max(b.bump, intensity);
          this.collisions.push({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            intensity,
          });
        }
      }
    }
  }

  private updateRanking(): void {
    const cars = [...this.state.players.values()];
    cars.sort((a, b) => {
      // finished cars rank by finish time, then by progress
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    cars.forEach((car, i) => (car.rank = i + 1));
  }

  private checkFinish(dt: number): void {
    let anyFinished = false;
    let allFinished = this.state.players.size > 0;
    for (const [, car] of this.state.players) {
      if (!car.finished && car.lap >= this.state.totalLaps) {
        car.finished = true;
        car.finishTime = this.state.raceTime;
      }
      if (car.finished) anyFinished = true;
      else allFinished = false;
    }

    if (allFinished) {
      this.state.phase = "finished";
      return;
    }
    if (anyFinished) {
      if (this.state.finishTimer <= 0) this.state.finishTimer = RACE.finishLingerSeconds;
      this.state.finishTimer -= dt;
      if (this.state.finishTimer <= 0) this.state.phase = "finished";
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
