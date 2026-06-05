import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { RaceScene } from "./scenes/RaceScene";
import { net } from "./net";
import { CAR_COLORS } from "../shared/constants";
import type { GameState } from "../shared/schema";

const COLOR_HEX: Record<string, string> = {
  red: "#d63a3a",
  blue: "#3a76d6",
  green: "#41a85a",
  yellow: "#e3c133",
  black: "#3a3f4a",
};

// ---- Phaser ----------------------------------------------------------------
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#14161c",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, RaceScene],
});

// ---- DOM refs --------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $("menu");
const lobby = $("lobby");
const results = $("results");
const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const colorsEl = $("colors");
const menuErr = $("menuErr");
const playerList = $("playerList");
const startBtn = $<HTMLButtonElement>("startBtn");
const lobbyHint = $("lobbyHint");
const lobbyCode = $("lobbyCode");
const standings = $("standings");
const newRaceBtn = $<HTMLButtonElement>("newRaceBtn");
const resultsHint = $("resultsHint");

let selectedColor = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
let joined = false;

// restore name / prefill code from URL
nameInput.value = localStorage.getItem("rally_name") ?? "";
const urlCode = new URLSearchParams(location.search).get("code");
if (urlCode) codeInput.value = urlCode.toUpperCase();

// color swatches
for (const c of CAR_COLORS) {
  const b = document.createElement("button");
  b.className = "swatch" + (c === selectedColor ? " sel" : "");
  b.style.background = COLOR_HEX[c];
  b.title = c;
  b.onclick = () => {
    selectedColor = c;
    [...colorsEl.children].forEach((el, i) =>
      el.classList.toggle("sel", CAR_COLORS[i] === c),
    );
    if (joined) net.setColor(c);
  };
  colorsEl.appendChild(b);
}

function randCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

async function join(code: string): Promise<void> {
  const name = (nameInput.value.trim() || "Driver").slice(0, 16);
  localStorage.setItem("rally_name", name);
  menuErr.textContent = "";
  try {
    const room = await net.join({ name, code, color: selectedColor });
    joined = true;
    const url = new URL(location.href);
    if (code) url.searchParams.set("code", code);
    else url.searchParams.delete("code");
    history.replaceState({}, "", url);
    room.onStateChange((state) => render(state));
    room.onLeave(() => {
      joined = false;
      show("menu");
      menuErr.textContent = "Disconnected from the race.";
    });
    render(room.state);
  } catch (e) {
    menuErr.textContent = "Could not join: " + (e instanceof Error ? e.message : String(e));
  }
}

$("quickplay").onclick = () => join("");
$("joinCode").onclick = () => {
  const c = codeInput.value.trim().toUpperCase();
  if (!c) {
    menuErr.textContent = "Enter a party code, or use Quick Play.";
    return;
  }
  join(c);
};
$("createPrivate").onclick = () => join(randCode());
$("copyLink").onclick = () => {
  navigator.clipboard?.writeText(location.href);
  const btn = $("copyLink");
  btn.textContent = "COPIED!";
  setTimeout(() => (btn.textContent = "COPY LINK"), 1200);
};
startBtn.onclick = () => net.startRace();
newRaceBtn.onclick = () => net.restart();

// ---- overlay rendering -----------------------------------------------------
function show(which: "menu" | "lobby" | "results" | "none"): void {
  menu.classList.toggle("hidden", which !== "menu");
  lobby.classList.toggle("hidden", which !== "lobby");
  results.classList.toggle("hidden", which !== "results");
}

let lastPhase = "";
function render(state: GameState): void {
  if (!joined || !state.players) return;
  const phase = state.phase;

  if (phase === "lobby") {
    show("lobby");
    lobbyCode.textContent = new URLSearchParams(location.search).get("code") || "QUICK PLAY";
    renderPlayerList(state);
  } else if (phase === "finished") {
    show("results");
    renderStandings(state);
  } else {
    show("none"); // countdown / racing -> Phaser HUD only
  }
  lastPhase = phase;
}

function renderPlayerList(state: GameState): void {
  const host = state.hostId;
  const isHost = host === net.sessionId;
  playerList.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = COLOR_HEX[p.color] ?? "#888";
    const nm = document.createElement("span");
    nm.textContent = p.name + (p.id === net.sessionId ? " (you)" : "");
    li.appendChild(dot);
    li.appendChild(nm);
    if (p.id === host) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "HOST";
      li.appendChild(b);
    }
    playerList.appendChild(li);
  });
  startBtn.style.display = isHost ? "block" : "none";
  lobbyHint.style.display = isHost ? "none" : "block";
}

function renderStandings(state: GameState): void {
  const isHost = state.hostId === net.sessionId;
  const ranked = [...state.players.values()].sort((a, b) => a.rank - b.rank);
  standings.innerHTML = "";
  for (const p of ranked) {
    const li = document.createElement("li");
    const pos = document.createElement("span");
    pos.className = "pos";
    pos.textContent = `${p.rank}`;
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = COLOR_HEX[p.color] ?? "#888";
    const nm = document.createElement("span");
    nm.textContent = p.name + (p.id === net.sessionId ? " (you)" : "");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = p.finished ? fmt(p.finishTime) : "DNF";
    li.append(pos, dot, nm, t);
    standings.appendChild(li);
  }
  newRaceBtn.style.display = isHost ? "block" : "none";
  resultsHint.style.display = isHost ? "none" : "block";
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${sec}`;
}

// expose for the headless smoke test
if (import.meta.env.DEV) (window as any).__net = net;
