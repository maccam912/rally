import { describe, it, expect, beforeAll } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderTrackPng } from "../src/sim/render";
import { isOmlxAvailable, askVision } from "../src/sim/omlx";

// Gated visual QA. Runs only when the local oMLX server is reachable, so the
// main `npm test` suite never depends on it. Run with: npm run test:visual
let available = false;
beforeAll(async () => {
  available = await isOmlxAvailable();
  if (!available) console.warn("oMLX not reachable — skipping visual tests");
  mkdirSync("scripts/shots", { recursive: true });
});

describe("oMLX visual QA", () => {
  it("a rendered track reads as a top-down race track", async () => {
    if (!available) return;
    const png = renderTrackPng(20240601, { cars: 6 });
    writeFileSync("scripts/shots/omlx-track.png", png);
    const v = await askVision(
      png,
      "This is a 2D top-down image. Does it show a winding road or race track " +
        "running through a green grassy area (as opposed to a blank field)?",
    );
    expect(v.looksValid, v.reason).toBe(true);
  });

  it("negative control: a blank green image is NOT a track", async () => {
    if (!available) return;
    const c = createCanvas(900, 900);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#2f8f4f";
    ctx.fillRect(0, 0, 900, 900);
    const v = await askVision(
      c.toBuffer("image/png"),
      "Does this image show a looping race track / road with cars?",
    );
    expect(v.looksValid, v.reason).toBe(false);
  });
});
