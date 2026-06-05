import Phaser from "phaser";
import { CAR_COLORS } from "../../shared/constants";

/** Loads every asset, generates the procedural snow tile, then hands off to the
 * RaceScene (which waits for a network connection before rendering). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  preload(): void {
    const loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Loading…", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    this.load.on("complete", () => loading.destroy());

    // cars
    for (const c of CAR_COLORS) this.load.image(`car_${c}`, `cars/car_${c}.png`);

    // surface / ground tiles
    this.load.image("road_asphalt", "tiles/road_asphalt.png");
    this.load.image("road_dirt", "tiles/road_dirt.png");
    this.load.image("road_sand", "tiles/road_sand.png");
    this.load.image("land_grass", "tiles/land_grass.png");
    this.load.image("land_dirt", "tiles/land_dirt.png");
    this.load.image("land_sand", "tiles/land_sand.png");

    // objects
    this.load.image("skidmark", "objects/skidmark.png");
    this.load.image("cone", "objects/cone.png");
    this.load.image("barrier_red", "objects/barrier_red.png");
    this.load.image("barrier_white", "objects/barrier_white.png");
    this.load.image("tires", "objects/tires.png");
    this.load.image("tree", "objects/tree.png");
    this.load.image("rock", "objects/rock.png");
    this.load.image("arrow", "objects/arrow.png");

    // particles
    this.load.image("smoke", "particles/smoke.png");

    // audio
    this.load.audio("sfx_impact1", ["audio/sfx/impact1.ogg"]);
    this.load.audio("sfx_impact2", ["audio/sfx/impact2.ogg"]);
    this.load.audio("sfx_click", ["audio/sfx/click.ogg"]);
    this.load.audio("sfx_confirm", ["audio/sfx/confirm.ogg"]);
    this.load.audio("sfx_beep", ["audio/sfx/beep.ogg"]);
    this.load.audio("music_lobby", ["audio/music/lobby.ogg"]);
    // race music pool — one is picked at random per race (see RaceScene)
    this.load.audio("music_race", ["audio/music/race.ogg"]);
    this.load.audio("music_race_time", ["audio/music/race_time_driving.ogg"]);
    this.load.audio("music_race_alpha", ["audio/music/race_alpha_dance.ogg"]);
    this.load.audio("music_race_cadet", ["audio/music/race_space_cadet.ogg"]);
    this.load.audio("music_race_mission", ["audio/music/race_mission_plausible.ogg"]);
    this.load.audio("music_race_descent", ["audio/music/race_infinite_descent.ogg"]);
    this.load.audio("music_race_drums", ["audio/music/race_drumming_sticks.ogg"]);
  }

  create(): void {
    this.makeSnowTexture();
    this.makeSparkTexture();
    this.scene.start("race");
  }

  /** No snow tile ships in the Racing Pack, so paint one: near-white with a
   * faint blue tint and speckles for grain. */
  private makeSnowTexture(): void {
    const size = 128;
    const tex = this.textures.createCanvas("road_snow", size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = "#eef3fb";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const s = Math.random() * 1.6;
      const shade = Math.random() < 0.5 ? 255 : 205;
      ctx.fillStyle = `rgba(${shade},${shade},${Math.min(255, shade + 12)},0.5)`;
      ctx.fillRect(x, y, s, s);
    }
    tex.refresh();
  }

  /** A small soft white dot used for collision sparks. */
  private makeSparkTexture(): void {
    const size = 16;
    const tex = this.textures.createCanvas("spark", size, size);
    if (!tex) return;
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, "rgba(255,255,210,1)");
    g.addColorStop(0.4, "rgba(255,210,120,0.9)");
    g.addColorStop(1, "rgba(255,160,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    tex.refresh();
  }
}
