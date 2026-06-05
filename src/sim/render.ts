import { createCanvas } from "@napi-rs/canvas";
import { generateTrack, startGrid, type Track } from "../shared/track";
import { Surface } from "../shared/surfaces";

/** Surface fill colours for the headless renderer (match the in-game look). */
const SURFACE_FILL: Record<number, string> = {
  [Surface.Tarmac]: "#717c80",
  [Surface.Gravel]: "#b07d40",
  [Surface.Sand]: "#e6d6a8",
  [Surface.Snow]: "#eef3fb",
  [Surface.Offroad]: "#2f8f4f",
};

const CAR_FILL = ["#d63a3a", "#3a76d6", "#41a85a", "#e3c133", "#2b2f38"];

export interface RenderOptions {
  width?: number;
  height?: number;
  cars?: number;
}

/** Render a top-down view of a procedural track (and a start grid of cars) to a
 * PNG buffer. Used by the gated oMLX "does it look right?" test. Deliberately
 * draws no text so the vision model can't cheat. */
export function renderTrackPng(seed: number, opts: RenderOptions = {}): Buffer {
  const W = opts.width ?? 900;
  const H = opts.height ?? 900;
  const track = generateTrack(seed);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // fit world bounds into the image
  const worldW = track.maxX - track.minX;
  const worldH = track.maxY - track.minY;
  const scale = Math.min(W / worldW, H / worldH) * 0.96;
  const offX = (W - worldW * scale) / 2 - track.minX * scale;
  const offY = (H - worldH * scale) / 2 - track.minY * scale;
  const tx = (x: number) => x * scale + offX;
  const ty = (y: number) => y * scale + offY;

  // grass
  ctx.fillStyle = SURFACE_FILL[Surface.Offroad];
  ctx.fillRect(0, 0, W, H);

  // road: stroke contiguous runs of the same surface as fat round-capped lines
  const pts = track.points;
  const m = pts.length;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    ctx.strokeStyle = SURFACE_FILL[a.surface];
    ctx.lineWidth = a.halfWidth * 2 * scale;
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(a.y));
    ctx.lineTo(tx(b.x), ty(b.y));
    ctx.stroke();
  }

  // start/finish checker
  drawStartLine(ctx, track, tx, ty, scale);

  // cars on the grid
  const cars = opts.cars ?? 5;
  const slots = startGrid(track, cars);
  slots.forEach((s, i) => {
    drawCar(ctx, tx(s.x), ty(s.y), s.angle, 46 * scale, CAR_FILL[i % CAR_FILL.length]);
  });

  return canvas.toBuffer("image/png");
}

function drawStartLine(
  ctx: any,
  track: Track,
  tx: (x: number) => number,
  ty: (y: number) => number,
  scale: number,
): void {
  const p = track.points[0];
  const hw = p.halfWidth;
  const px = -Math.sin(p.angle);
  const py = Math.cos(p.angle);
  const cell = 14;
  const n = Math.ceil((hw * 2) / cell);
  for (let i = 0; i < n; i++) {
    const t = -hw + i * cell + cell / 2;
    ctx.fillStyle = i % 2 === 0 ? "#111" : "#f4f4f4";
    const cx = p.x + px * t;
    const cy = p.y + py * t;
    ctx.save();
    ctx.translate(tx(cx), ty(cy));
    ctx.rotate(p.angle);
    const s = cell * scale;
    ctx.fillRect(-s, -s / 2, s * 2, s);
    ctx.restore();
  }
}

function drawCar(
  ctx: any,
  x: number,
  y: number,
  angle: number,
  size: number,
  fill: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = fill;
  ctx.strokeStyle = "#000";
  ctx.lineWidth = Math.max(1, size * 0.08);
  const w = size;
  const h = size * 0.5;
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  // windshield hint
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillRect(w * 0.1, -h * 0.35, w * 0.18, h * 0.7);
  ctx.restore();
}
