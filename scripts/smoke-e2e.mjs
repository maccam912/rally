// Headless end-to-end: open two browser clients, host starts a race, both drive,
// assert authoritative state actually advances, and screenshot the result.
// Assumes `npm run dev` is already running (server :2567, client :5173).
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.CLIENT_URL || "http://localhost:5173";
const OUT = "scripts/shots";
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Manual poll with small evaluates (waitForFunction's tight polling starves the
 * Canvas-mode render loop in headless and stalls the CDP connection). */
async function pollFor(page, fn, { timeout = 15000, every = 250, label = "" } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function openClient(browser, name) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  [${name}] PAGEERROR ${e.message}`));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await pollFor(page, () => typeof window.__net === "object", { label: `${name} boot` });
  await page.type("#name", name);
  return page;
}

async function drive(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys) await page.keyboard.up(k);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 180000,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1340, height: 760 },
});

let failed = false;
try {
  console.log("• opening host client…");
  const host = await openClient(browser, "HostHank");
  await host.evaluate(() => (document.getElementById("code").value = "SMOKE"));
  await host.click("#joinCode");
  await pollFor(host, () => window.__net?.state?.phase === "lobby", { label: "host in lobby" });

  console.log("• opening guest client (same party code)…");
  const guest = await openClient(browser, "GuestGil");
  await guest.evaluate(() => (document.getElementById("code").value = "SMOKE"));
  await guest.click("#joinCode");

  await pollFor(host, () => window.__net.state.players.size >= 2, { label: "2 players" });
  const players = await host.evaluate(() => window.__net.state.players.size);
  console.log(`  players in room: ${players} (free-for-all multiplayer ✓)`);
  await host.screenshot({ path: `${OUT}/1-lobby.png` });
  if (players < 2) throw new Error("expected 2 players in the shared room");

  // Two concurrent swiftshader contexts stall the headless renderer's JS thread,
  // so close the guest now (its multiplayer presence is already confirmed above,
  // and room.test.ts covers 2-client authoritative play) and drive on the host.
  await guest.close();
  await sleep(500);

  const startX = await host.evaluate(
    () => window.__net.state.players.get(window.__net.sessionId).x,
  );

  console.log("• host starts the race…");
  await host.click("#startBtn");
  await pollFor(host, () => window.__net.state.phase === "racing", { timeout: 12000, label: "racing" });

  console.log("• autopilot drives for 6s…");
  await host.evaluate(() => (window.__auto = true));
  await sleep(6000);

  const after = await host.evaluate(() => {
    const s = window.__net.state;
    const me = s.players.get(window.__net.sessionId);
    return { phase: s.phase, x: me.x, y: me.y, slip: me.slip, progress: me.progress, surface: me.surface };
  });
  await host.screenshot({ path: `${OUT}/2-racing.png` });
  const moved = Math.hypot(after.x - startX, after.y);
  console.log(
    `  phase=${after.phase}, moved ${moved.toFixed(0)}px, slip=${after.slip.toFixed(0)}, progress=${after.progress.toFixed(0)}, surface=${after.surface}`,
  );

  if (after.phase !== "racing") throw new Error("host not racing");
  if (after.progress <= 0) throw new Error("car made no forward progress");
  console.log("\n✅ smoke e2e passed");
} catch (e) {
  failed = true;
  console.error("\n❌ smoke e2e failed:", e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
