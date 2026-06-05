import { RNG } from "./rng";
import { TRACK } from "./constants";
import { Surface, ROAD_SURFACES } from "./surfaces";

export interface Vec2 {
  x: number;
  y: number;
}

export interface TrackPoint {
  x: number;
  y: number;
  halfWidth: number;
  surface: Surface;
  /** cumulative centerline distance from the start (px) */
  dist: number;
  /** forward heading (rad) of the track at this point */
  angle: number;
}

export interface NearestInfo {
  /** index of the centerline point at the start of the closest segment */
  index: number;
  /** closest point on the centerline */
  px: number;
  py: number;
  /** perpendicular distance from the centerline (px, always >= 0) */
  lateral: number;
  /** cumulative distance along the loop at the closest point (px) */
  distAlong: number;
  /** forward track heading at the closest point (rad) */
  angle: number;
  surface: Surface;
  halfWidth: number;
}

export interface StartSlot {
  x: number;
  y: number;
  angle: number;
}

export interface Track {
  seed: number;
  points: TrackPoint[];
  /** total centerline loop length (px) */
  length: number;
  /** world bounds for renderer / camera */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Build a deterministic, smooth, closed-loop procedural rally track. */
export function generateTrack(seed: number): Track {
  const rng = new RNG(seed);
  const n = TRACK.controlPoints;

  // 1. Control points around a circle with jittered radius and angle.
  const ctrl: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const baseA = (i / n) * Math.PI * 2;
    const a = baseA + rng.range(-0.18, 0.18) * (Math.PI / n) * 2;
    const r = TRACK.radius * (1 + rng.range(-TRACK.radiusJitter, TRACK.radiusJitter));
    ctrl.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }

  // 2. Smooth into a closed Catmull-Rom spline.
  const raw: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < TRACK.samplesPerSegment; s++) {
      const t = s / TRACK.samplesPerSegment;
      raw.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }

  // 3. Per-point road width (jittered, then smoothed for continuity).
  const m = raw.length;
  const widthNoise: number[] = [];
  for (let i = 0; i < m; i++) {
    widthNoise.push(TRACK.roadHalfWidth + rng.range(-TRACK.widthJitter, TRACK.widthJitter));
  }
  const halfWidths: number[] = [];
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += widthNoise[(i + k + m) % m];
    halfWidths.push(sum / 7);
  }

  // 4. Surface zones: contiguous arcs of the loop, adjacent zones differ.
  const surfaceAt: Surface[] = new Array(m);
  const sections = TRACK.surfaceSections;
  const zoneSurfaces: Surface[] = [];
  let prev = Surface.Tarmac;
  for (let z = 0; z < sections; z++) {
    if (z === 0) {
      zoneSurfaces.push(Surface.Tarmac); // start zone is always grippy
      prev = Surface.Tarmac;
    } else {
      let s: Surface = prev;
      while (s === prev) s = ROAD_SURFACES[rng.int(0, ROAD_SURFACES.length - 1)];
      zoneSurfaces.push(s);
      prev = s;
    }
  }
  for (let i = 0; i < m; i++) {
    const zone = Math.min(sections - 1, Math.floor((i / m) * sections));
    surfaceAt[i] = zoneSurfaces[zone];
  }

  // 5. Cumulative distances + forward angles, assemble points.
  const points: TrackPoint[] = [];
  let dist = 0;
  for (let i = 0; i < m; i++) {
    const a = raw[i];
    const b = raw[(i + 1) % m];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    points.push({
      x: a.x,
      y: a.y,
      halfWidth: halfWidths[i],
      surface: surfaceAt[i],
      dist,
      angle,
    });
    dist += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const length = dist;

  // 6. World bounds.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    const pad = p.halfWidth + 320;
    minX = Math.min(minX, p.x - pad);
    minY = Math.min(minY, p.y - pad);
    maxX = Math.max(maxX, p.x + pad);
    maxY = Math.max(maxY, p.y + pad);
  }

  return { seed, points, length, minX, minY, maxX, maxY };
}

/** Find the closest point on the track centerline to (x, y). O(n) over
 * segments — fine for the centerline resolution we use. */
export function nearestOnTrack(track: Track, x: number, y: number): NearestInfo {
  const pts = track.points;
  const m = pts.length;
  let best = Infinity;
  let bestIdx = 0;
  let bestPx = pts[0].x;
  let bestPy = pts[0].y;
  let bestT = 0;

  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-6;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < best) {
      best = d2;
      bestIdx = i;
      bestPx = px;
      bestPy = py;
      bestT = t;
    }
  }

  const a = pts[bestIdx];
  const b = pts[(bestIdx + 1) % m];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y);
  const halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * bestT;
  return {
    index: bestIdx,
    px: bestPx,
    py: bestPy,
    lateral: Math.sqrt(best),
    distAlong: a.dist + segLen * bestT,
    angle: a.angle,
    surface: a.surface,
    halfWidth,
  };
}

/** Start grid: rows of cars centered on the start/finish line, staggered
 * backwards along the track so everyone has clear road ahead. Scales to any
 * number of players. */
export function startGrid(track: Track, count: number, cols = TRACK.startGridCols): StartSlot[] {
  const pts = track.points;
  const start = pts[0];
  const fwd = start.angle;
  const fx = Math.cos(fwd);
  const fy = Math.sin(fwd);
  const rx = -Math.sin(fwd); // lateral (right) direction
  const ry = Math.cos(fwd);

  const rowGap = 95;
  const colGap = 70;
  const slots: StartSlot[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const lane = col - (cols - 1) / 2;
    // start a touch behind the line, then back up per row
    const back = -90 - row * rowGap;
    const x = start.x + fx * back + rx * lane * colGap;
    const y = start.y + fy * back + ry * lane * colGap;
    slots.push({ x, y, angle: fwd });
  }
  return slots;
}
