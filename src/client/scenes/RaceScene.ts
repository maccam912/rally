import Phaser from "phaser";
import { net } from "../net";
import { EngineAudio } from "../audio";
import { generateTrack, nearestOnTrack, type Track } from "../../shared/track";
import { RNG } from "../../shared/rng";
import { Surface } from "../../shared/surfaces";
import { CAR, DRIFT } from "../../shared/constants";
import type { CarSchema } from "../../shared/schema";

const KMH = 0.4; // px/s -> displayed km/h

const ROAD_TEX: Record<number, string> = {
  [Surface.Tarmac]: "road_asphalt",
  [Surface.Gravel]: "road_dirt",
  [Surface.Sand]: "road_sand",
  [Surface.Snow]: "road_snow",
  [Surface.Offroad]: "land_grass",
};
// tint applied when baking each surface (the Kenney asphalt is a pale grey, so
// darken it; others keep their natural colour).
const ROAD_TINT: Record<number, number> = {
  [Surface.Tarmac]: 0x6b7178,
  [Surface.Gravel]: 0xffffff,
  [Surface.Sand]: 0xffffff,
  [Surface.Snow]: 0xffffff,
  [Surface.Offroad]: 0xffffff,
};
const DUST_COLOR: Record<number, number> = {
  [Surface.Tarmac]: 0x4a4a4a,
  [Surface.Gravel]: 0x7a5a32,
  [Surface.Sand]: 0xcdb06a,
  [Surface.Snow]: 0xffffff,
  [Surface.Offroad]: 0x4f7a35,
};

interface CarView {
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  prevBump: number;
  prevReset: number;
  spawned: boolean;
}

export class RaceScene extends Phaser.Scene {
  private track?: Track;
  private seed = -1;

  private cars = new Map<string, CarView>();
  private skids: Phaser.GameObjects.Image[] = [];
  private skidIdx = 0;
  private dust!: Record<number, Phaser.GameObjects.Particles.ParticleEmitter>;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  private engine?: EngineAudio;
  private music?: Phaser.Sound.BaseSound;
  private musicKey = "";

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastSent = 0;
  private lastPayload = "";

  // HUD
  private hud!: Phaser.GameObjects.Container;
  private lapText!: Phaser.GameObjects.Text;
  private posText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private surfText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Text;
  private bigText!: Phaser.GameObjects.Text;
  private prevCountInt = -1;

  constructor() {
    super("race");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#2d5a2d");

    // particle emitters
    this.dust = {} as Record<number, Phaser.GameObjects.Particles.ParticleEmitter>;
    for (const s of [Surface.Tarmac, Surface.Gravel, Surface.Sand, Surface.Snow, Surface.Offroad]) {
      const e = this.add.particles(0, 0, "smoke", {
        lifespan: 520,
        speed: { min: 6, max: 42 },
        scale: { start: 0.05, end: 0.22 },
        alpha: { start: 0.5, end: 0 },
        rotate: { min: 0, max: 360 },
        tint: DUST_COLOR[s],
        frequency: -1,
      });
      e.setDepth(4);
      this.dust[s] = e;
    }
    this.sparks = this.add.particles(0, 0, "spark", {
      lifespan: 400,
      speed: { min: 60, max: 220 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: "ADD",
      frequency: -1,
    });
    this.sparks.setDepth(6);

    // skid mark pool
    for (let i = 0; i < 360; i++) {
      const img = this.add.image(-9999, -9999, "skidmark").setVisible(false);
      img.setDepth(1).setTint(0x111111).setAlpha(0.5).setScale(0.45);
      this.skids.push(img);
    }

    // input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,M") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.keyboard!.on("keydown-M", () => this.engine?.setMuted(!this.engine.isMuted()));

    this.buildHud();

    // audio engine shares Phaser's WebAudio context
    const ctx = (this.sound as unknown as { context?: AudioContext }).context;
    if (ctx) this.engine = new EngineAudio(ctx);

    this.scale.on("resize", () => this.layoutHud());
  }

  // ---- world building -----------------------------------------------------

  /** road is baked at this fraction of world resolution then upscaled, to keep
   * the render texture small enough for any GPU / headless canvas. */
  private static readonly RES = 0.5;

  private rebuildWorld(seed: number): void {
    const RES = RaceScene.RES;
    this.seed = seed;
    this.track = generateTrack(seed);
    const t = this.track;
    const w = t.maxX - t.minX;
    const h = t.maxY - t.minY;

    // wipe previous world layers (keep cars/particles/hud)
    this.children.list
      .filter((o) => (o as any).__world)
      .forEach((o) => o.destroy());

    // grass ground
    const ground = this.add.tileSprite(t.minX, t.minY, w, h, "land_grass").setOrigin(0);
    ground.setDepth(-10);
    (ground as any).__world = true;

    // bake the road into a downscaled render texture (uses the real surface
    // textures), displayed upscaled to cover the world.
    const rt = this.add
      .renderTexture(t.minX, t.minY, Math.ceil(w * RES), Math.ceil(h * RES))
      .setOrigin(0);
    rt.setScale(1 / RES);
    rt.setDepth(0);
    (rt as any).__world = true;
    const pts = t.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) + 10;
      const ts = this.make.tileSprite(
        {
          x: 0,
          y: 0,
          width: (segLen) * RES,
          height: (a.halfWidth * 2 + 8) * RES,
          key: ROAD_TEX[a.surface],
        },
        false,
      );
      ts.setOrigin(0.5);
      ts.setTileScale(RES, RES);
      ts.rotation = a.angle;
      rt.draw(ts, (a.x - t.minX) * RES, (a.y - t.minY) * RES, 1, ROAD_TINT[a.surface]);
      ts.destroy();
    }
    this.bakeStartLine(rt, RES);

    this.placeDecorations();

    this.cameras.main.setBounds(t.minX, t.minY, w, h);
  }

  private bakeStartLine(rt: Phaser.GameObjects.RenderTexture, RES: number): void {
    const t = this.track!;
    const p = t.points[0];
    const g = this.make.graphics({}, false);
    const hw = p.halfWidth * RES;
    const cell = 16 * RES;
    const cols = 2;
    const rows = Math.ceil((hw * 2) / cell);
    for (let cx = 0; cx < cols; cx++) {
      for (let ry = 0; ry < rows; ry++) {
        const black = (cx + ry) % 2 === 0;
        g.fillStyle(black ? 0x111111 : 0xf4f4f4, 1);
        const x = -cols * cell * 0.5 + cx * cell;
        const y = -hw + ry * cell;
        g.fillRect(x, y, cell, cell);
      }
    }
    g.rotation = p.angle;
    rt.draw(g, (p.x - t.minX) * RES, (p.y - t.minY) * RES);
    g.destroy();
  }

  private placeDecorations(): void {
    const t = this.track!;
    const rng = new RNG((this.seed ^ 0x9e37) >>> 0);
    const pts = t.points;
    const m = pts.length;

    const place = (x: number, y: number, key: string, scale: number, depth: number) => {
      const obj = this.add.image(x, y, key).setScale(scale);
      obj.setRotation(rng.range(0, Math.PI * 2));
      obj.setDepth(depth);
      (obj as any).__world = true;
    };

    for (let i = 4; i < m; i += 4) {
      const p = pts[i];
      // curvature: how much the heading turns across this point
      const before = pts[(i - 3 + m) % m].angle;
      const after = pts[(i + 3) % m].angle;
      let dA = after - before;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      const corner = Math.abs(dA) > 0.35;

      // line the OUTSIDE of sharp corners with tyre stacks / barriers (rally feel)
      if (corner) {
        const outSide = dA > 0 ? -1 : 1; // outside of the turn
        const px = -Math.sin(p.angle) * outSide;
        const py = Math.cos(p.angle) * outSide;
        const off = p.halfWidth + 26;
        const key = rng.next() < 0.5 ? "tires" : "barrier_white";
        place(p.x + px * off, p.y + py * off, key, 0.55, 3);
        continue;
      }

      // scatter trees & rocks well clear of the road on straights
      if (rng.next() > 0.6) continue;
      const side = rng.next() < 0.5 ? 1 : -1;
      const px = -Math.sin(p.angle) * side;
      const py = Math.cos(p.angle) * side;
      const off = p.halfWidth + rng.range(70, 240);
      const r = rng.next();
      if (r < 0.6) place(p.x + px * off, p.y + py * off, "tree", rng.range(0.6, 0.95), 7);
      else place(p.x + px * off, p.y + py * off, "rock", rng.range(0.45, 0.75), 2);
    }
  }

  // ---- per-frame ----------------------------------------------------------

  update(time: number, deltaMs: number): void {
    const state = net.state;
    if (!state || !state.players) return; // nested schema may not be decoded yet
    if (state.seed !== this.seed) this.rebuildWorld(state.seed);

    this.updateMusic(state.phase);
    this.tryStartEngine();

    const dt = Math.min(deltaMs, 50) / 1000;
    const racing = state.phase === "racing";

    if (racing) this.sendInput(time);

    // reconcile cars
    const seen = new Set<string>();
    state.players.forEach((car, id) => {
      seen.add(id);
      this.updateCar(id, car, time, dt, racing);
    });
    for (const [id, view] of this.cars) {
      if (!seen.has(id)) {
        view.sprite.destroy();
        view.label.destroy();
        this.cars.delete(id);
      }
    }

    this.followLocal();
    this.updateLocalAudio(state);
    this.updateHud(state, time);
  }

  private updateCar(
    id: string,
    car: CarSchema,
    time: number,
    dt: number,
    racing: boolean,
  ): void {
    let view = this.cars.get(id);
    if (!view) {
      const sprite = this.add.sprite(car.x, car.y, `car_${car.color}`);
      sprite.setScale(0.62).setDepth(5);
      sprite.setOrigin(0.5);
      const label = this.add
        .text(car.x, car.y, car.name, {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1.6)
        .setDepth(8);
      view = { sprite, label, prevBump: 0, prevReset: 0, spawned: false };
      this.cars.set(id, view);
    }
    const isLocal = id === net.sessionId;

    // smooth toward server state
    const k = view.spawned ? (isLocal ? 0.5 : 0.32) : 1;
    view.sprite.x = Phaser.Math.Linear(view.sprite.x, car.x, k);
    view.sprite.y = Phaser.Math.Linear(view.sprite.y, car.y, k);
    const targetRot = car.angle + Math.PI / 2;
    view.sprite.rotation = Phaser.Math.Angle.RotateTo(
      view.sprite.rotation,
      targetRot,
      view.spawned ? 0.4 : Math.PI * 2,
    );
    view.spawned = true;
    view.label.setPosition(view.sprite.x, view.sprite.y);

    // reset flash blink
    if (car.resetFlash > 0) {
      view.sprite.setAlpha(0.35 + 0.55 * Math.abs(Math.sin(time * 0.02)));
    } else {
      view.sprite.setAlpha(1);
    }
    if (car.resetFlash > view.prevReset + 0.01 && view.prevReset <= 0.01) {
      // just respawned
      this.dust[Surface.Offroad].emitParticleAt(view.sprite.x, view.sprite.y, 10);
      if (isLocal) this.cameras.main.flash(180, 200, 220, 255);
    }
    view.prevReset = car.resetFlash;

    const speed = Math.hypot(car.vx, car.vy);
    const drifting = car.slip > DRIFT.slipThreshold && speed > DRIFT.minSpeed;
    const offroad = !car.onRoad && speed > DRIFT.minSpeed;

    if (racing) {
      // rear axle world position
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      const rearX = view.sprite.x - fx * 18;
      const rearY = view.sprite.y - fy * 18;

      if (drifting && car.onRoad) {
        this.dropSkid(view.sprite.x, view.sprite.y, view.sprite.rotation);
        this.dust[car.surface].emitParticleAt(rearX, rearY, 2);
      } else if (offroad) {
        this.dust[Surface.Offroad].emitParticleAt(rearX, rearY, 2);
      } else if (
        speed > 120 &&
        (car.surface === Surface.Gravel ||
          car.surface === Surface.Sand ||
          car.surface === Surface.Snow)
      ) {
        if (Math.random() < 0.4) this.dust[car.surface].emitParticleAt(rearX, rearY, 1);
      }

      // collision feedback
      if (car.bump > view.prevBump + 6 && car.bump > 40) {
        this.sparks.emitParticleAt(view.sprite.x, view.sprite.y, 8);
        if (isLocal) {
          const vol = Phaser.Math.Clamp(car.bump / 280, 0.2, 1);
          this.sound.play(car.bump > 180 ? "sfx_impact2" : "sfx_impact1", { volume: vol });
          this.cameras.main.shake(140, Math.min(0.012, car.bump * 0.00004));
        }
      }
    }
    view.prevBump = car.bump;
  }

  private dropSkid(x: number, y: number, rot: number): void {
    const fx = Math.cos(rot - Math.PI / 2);
    const fy = Math.sin(rot - Math.PI / 2);
    const px = -Math.sin(rot - Math.PI / 2);
    const py = Math.cos(rot - Math.PI / 2);
    for (const sign of [-1, 1]) {
      const img = this.skids[this.skidIdx];
      this.skidIdx = (this.skidIdx + 1) % this.skids.length;
      img.setPosition(x - fx * 16 + px * sign * 11, y - fy * 16 + py * sign * 11);
      img.rotation = rot;
      img.setVisible(true);
    }
  }

  private followingId = "";
  private followLocal(): void {
    const view = this.cars.get(net.sessionId);
    const cam = this.cameras.main;
    if (view) {
      if (this.followingId !== net.sessionId) {
        cam.startFollow(view.sprite, true, 0.12, 0.12);
        this.followingId = net.sessionId;
      }
      const sp = net.state?.players.get(net.sessionId);
      const speed = sp ? Math.hypot(sp.vx, sp.vy) : 0;
      const targetZoom = Phaser.Math.Linear(1.15, 0.92, Phaser.Math.Clamp(speed / CAR.maxSpeed, 0, 1));
      cam.setZoom(Phaser.Math.Linear(cam.zoom, targetZoom, 0.04));
    } else if (this.track) {
      cam.centerOn(this.track.points[0].x, this.track.points[0].y);
    }
  }

  // ---- audio --------------------------------------------------------------

  private tryStartEngine(): void {
    const ctx = (this.sound as unknown as { context?: AudioContext }).context;
    if (this.engine && ctx && ctx.state === "running") this.engine.start();
  }

  private updateLocalAudio(state: NonNullable<typeof net.state>): void {
    if (!this.engine) return;
    const car = state.players.get(net.sessionId);
    if (!car || state.phase !== "racing") {
      this.engine.setEngine(0, 0);
      this.engine.setSkid(0);
      return;
    }
    const speed = Math.hypot(car.vx, car.vy);
    this.engine.setEngine(speed / CAR.maxSpeed, this.localThrottle);
    this.engine.setSkid(Phaser.Math.Clamp(car.slip / 240, 0, 1));
  }

  private updateMusic(phase: string): void {
    const want = phase === "lobby" ? "music_lobby" : "music_race";
    if (this.musicKey === want) return;
    if (this.sound.locked) return;
    this.music?.stop();
    try {
      this.music = this.sound.add(want, { loop: true, volume: 0.32 });
      this.music.play();
      this.musicKey = want;
    } catch {
      /* not unlocked yet */
    }
  }

  // ---- input --------------------------------------------------------------

  private localThrottle = 0;

  private sendInput(time: number): void {
    let throttle = 0;
    let steer = 0;
    if (this.cursors.up.isDown || this.keys.W.isDown) throttle += 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) throttle -= 1;
    if (this.cursors.left.isDown || this.keys.A.isDown) steer -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) steer += 1;
    let handbrake = this.cursors.space.isDown || this.keys.SPACE.isDown;

    // DEV-only path-following autopilot (used by verification scripts)
    if (import.meta.env.DEV && (window as unknown as { __auto?: boolean }).__auto) {
      const ai = this.autopilot();
      if (ai) ({ throttle, steer, handbrake } = ai);
    }
    this.localThrottle = throttle;

    const payload = `${throttle}|${steer}|${handbrake ? 1 : 0}`;
    if (payload !== this.lastPayload || time - this.lastSent > 120) {
      net.sendInput({ throttle, steer, handbrake });
      this.lastPayload = payload;
      this.lastSent = time;
    }
  }

  /** Aim ~280px ahead on the centerline and steer toward it. */
  private autopilot(): { throttle: number; steer: number; handbrake: boolean } | null {
    const t = this.track;
    const car = net.state?.players.get(net.sessionId);
    if (!t || !car) return null;
    const m = t.points.length;
    const near = nearestOnTrack(t, car.x, car.y);
    let look = near.index;
    let acc = 0;
    while (acc < 280) {
      const a = t.points[look % m];
      const b = t.points[(look + 1) % m];
      acc += Math.hypot(b.x - a.x, b.y - a.y);
      look++;
    }
    const target = t.points[look % m];
    const desired = Math.atan2(target.y - car.y, target.x - car.x);
    let err = desired - car.angle;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const steer = Phaser.Math.Clamp(err * 2.4, -1, 1);
    const speed = Math.hypot(car.vx, car.vy);
    const throttle = Math.abs(err) > 0.6 && speed > 280 ? 0.2 : 1;
    return { throttle, steer, handbrake: false };
  }

  // ---- HUD ----------------------------------------------------------------

  private buildHud(): void {
    const mk = (size: number, color = "#ffffff") =>
      this.add
        .text(0, 0, "", {
          fontFamily: "monospace",
          fontSize: `${size}px`,
          color,
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setScrollFactor(0)
        .setDepth(100);

    this.lapText = mk(26);
    this.posText = mk(26, "#ffe066");
    this.speedText = mk(34);
    this.surfText = mk(20);
    this.timeText = mk(20, "#9ad8ff");
    this.board = mk(15).setLineSpacing(2);

    this.bigText = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "120px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(120)
      .setVisible(false);

    this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(100);
    this.layoutHud();
  }

  private layoutHud(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.lapText.setPosition(20, 16);
    this.posText.setPosition(20, 48);
    this.speedText.setPosition(20, h - 56);
    this.surfText.setPosition(20, h - 84);
    this.timeText.setPosition(w / 2 - 60, 16);
    this.board.setPosition(w - 230, 16);
    this.bigText.setPosition(w / 2, h / 2);
  }

  private updateHud(state: NonNullable<typeof net.state>, time: number): void {
    const inRace = state.phase === "racing" || state.phase === "countdown";
    const show = inRace || state.phase === "finished";
    this.lapText.setVisible(show);
    this.posText.setVisible(show);
    this.speedText.setVisible(show);
    this.surfText.setVisible(show);
    this.timeText.setVisible(show);
    this.board.setVisible(show);

    const me = state.players.get(net.sessionId);
    if (me) {
      const lap = Math.min(me.lap + 1, state.totalLaps);
      this.lapText.setText(me.finished ? "FINISHED" : `LAP ${lap}/${state.totalLaps}`);
      this.posText.setText(`P${me.rank}/${state.players.size}`);
      const speed = Math.hypot(me.vx, me.vy);
      this.speedText.setText(`${Math.round(speed * KMH)} km/h`);
      const labels = ["TARMAC", "GRAVEL", "SAND", "SNOW", "OFF-ROAD"];
      const colors = ["#bbbbbb", "#c08a4a", "#e3c878", "#eaf3ff", "#7ad36a"];
      this.surfText.setText(labels[me.surface] ?? "");
      this.surfText.setColor(colors[me.surface] ?? "#ffffff");
    }
    this.timeText.setText(fmtTime(state.raceTime));

    // leaderboard
    const ranked = [...state.players.values()].sort((a, b) => a.rank - b.rank).slice(0, 8);
    this.board.setText(
      ranked
        .map((c) => {
          const tag = c.id === net.sessionId ? ">" : " ";
          const nm = c.name.slice(0, 8).padEnd(8);
          const status = c.finished ? "FIN" : `L${Math.min(c.lap + 1, state.totalLaps)}`;
          return `${tag}${c.rank}. ${nm} ${status}`;
        })
        .join("\n"),
    );

    // countdown / GO banner
    if (state.phase === "countdown") {
      const n = Math.ceil(state.countdown);
      this.bigText.setVisible(true).setText(String(n));
      if (n !== this.prevCountInt) {
        this.bigText.setScale(1.6);
        this.tweens.add({ targets: this.bigText, scale: 1, duration: 350, ease: "Back.out" });
        if (!this.sound.locked) this.sound.play("sfx_beep", { volume: 0.5 });
        this.prevCountInt = n;
      }
    } else if (state.phase === "racing") {
      // brief GO! flash on the first racing frame after a countdown
      if (this.prevCountInt > 0) {
        this.bigText.setVisible(true).setText("GO!").setColor("#7dff7d").setScale(1.6);
        this.tweens.add({
          targets: this.bigText,
          scale: 1,
          alpha: 0,
          duration: 800,
          ease: "Cubic.out",
          onComplete: () => this.bigText.setVisible(false).setAlpha(1).setColor("#ffffff"),
        });
        this.prevCountInt = 0;
      }
    } else {
      this.bigText.setVisible(false);
      this.prevCountInt = -1;
    }
  }
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}
