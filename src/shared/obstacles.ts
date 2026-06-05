import { RNG } from "./rng";
import type { Track } from "./track";

/** A solid piece of scenery. Deterministic from the track seed, so the server
 * (collision) and every client (rendering) generate the exact same set — they
 * line up without syncing anything but the seed. */
export interface Obstacle {
  x: number;
  y: number;
  /** collision circle radius (px) */
  radius: number;
  /** texture key for the client sprite */
  type: string;
  /** render scale */
  scale: number;
  /** render rotation (rad) */
  rot: number;
  /** render depth */
  depth: number;
}

/** Collision radius per type. Kept a bit tighter than the sprite (e.g. a tree's
 * trunk, not its canopy) so near-misses feel fair. */
const COLLIDE_RADIUS: Record<string, (scale: number) => number> = {
  tree: (s) => 20 * s,
  rock: (s) => 30 * s,
  tires: () => 18,
  barrier_white: () => 26,
  cone: () => 11,
};

/** Build the solid scenery for a track. Mirrors the old client-only decoration
 * placement, but now shared so collisions are authoritative. */
export function generateObstacles(track: Track, seed: number): Obstacle[] {
  const rng = new RNG((seed ^ 0x9e37) >>> 0);
  const pts = track.points;
  const m = pts.length;
  const out: Obstacle[] = [];

  const add = (x: number, y: number, type: string, scale: number, depth: number): void => {
    out.push({
      x,
      y,
      type,
      scale,
      rot: rng.range(0, Math.PI * 2),
      depth,
      radius: COLLIDE_RADIUS[type](scale),
    });
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

    if (corner) {
      // outside of the turn: tyre stacks / barriers (rally feel)
      const outSide = dA > 0 ? -1 : 1;
      const px = -Math.sin(p.angle) * outSide;
      const py = Math.cos(p.angle) * outSide;
      const off = p.halfWidth + 26;
      const key = rng.next() < 0.5 ? "tires" : "barrier_white";
      add(p.x + px * off, p.y + py * off, key, 0.55, 3);

      // sometimes a cone just off the inside edge marking the apex
      if (rng.next() < 0.5) {
        const inOff = p.halfWidth + 10;
        add(p.x - px * inOff, p.y - py * inOff, "cone", 0.5, 3);
      }
      continue;
    }

    // scatter trees & rocks clear of the road on straights
    if (rng.next() > 0.6) continue;
    const side = rng.next() < 0.5 ? 1 : -1;
    const px = -Math.sin(p.angle) * side;
    const py = Math.cos(p.angle) * side;
    const off = p.halfWidth + rng.range(70, 240);
    const r = rng.next();
    if (r < 0.6) add(p.x + px * off, p.y + py * off, "tree", rng.range(0.6, 0.95), 7);
    else add(p.x + px * off, p.y + py * off, "rock", rng.range(0.45, 0.75), 2);
  }
  return out;
}
