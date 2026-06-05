import { Client, Room } from "colyseus.js";
import type { GameState } from "../shared/schema";
import { MSG, type InputPayload, type JoinOptions } from "../shared/protocol";

const endpoint = import.meta.env.DEV
  ? "http://localhost:2567"
  : `${location.protocol}//${location.host}`;

/** Thin client-side wrapper around the Colyseus room. */
class Net {
  client = new Client(endpoint);
  room?: Room<GameState>;

  get state(): GameState | undefined {
    return this.room?.state;
  }
  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  async join(opts: JoinOptions): Promise<Room<GameState>> {
    this.room = await this.client.joinOrCreate<GameState>("rally", opts);
    // swallow any unhandled broadcasts so Colyseus doesn't warn
    this.room.onMessage("*", () => {});
    return this.room;
  }

  isHost(): boolean {
    return !!this.room && this.room.state.hostId === this.room.sessionId;
  }

  sendInput(p: InputPayload): void {
    this.room?.send(MSG.input, p);
  }
  setName(name: string): void {
    this.room?.send(MSG.setName, name);
  }
  setColor(color: string): void {
    this.room?.send(MSG.setColor, color);
  }
  startRace(): void {
    this.room?.send(MSG.start);
  }
  restart(): void {
    this.room?.send(MSG.restart);
  }
}

export const net = new Net();
