/** Tiny client-only settings bag, persisted to localStorage. The pause menu
 * (DOM) writes to it; the RaceScene reads it each frame to apply music volume.
 * Keeping it here decouples the DOM overlay from the Phaser scene. */
export interface Settings {
  /** 0..1 music volume */
  musicVolume: number;
  musicMuted: boolean;
  /** local-only pause (multiplayer keeps simulating); suppresses our input */
  paused: boolean;
}

const KEY = "rally_settings";

const defaults: Settings = { musicVolume: 0.5, musicMuted: false, paused: false };

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      musicVolume: typeof raw.musicVolume === "number" ? raw.musicVolume : defaults.musicVolume,
      musicMuted: !!raw.musicMuted,
      paused: false, // never restore paused across reloads
    };
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = load();

/** Effective music gain (0 when muted). */
export function musicGain(): number {
  return settings.musicMuted ? 0 : settings.musicVolume;
}

export function saveSettings(): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ musicVolume: settings.musicVolume, musicMuted: settings.musicMuted }),
    );
  } catch {
    /* ignore */
  }
}
