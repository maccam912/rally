import { Room, type Client } from "@colyseus/core";
import { GameState } from "../shared/schema";
import { RaceSimulation } from "../sim/RaceSimulation";
import { MSG, type InputPayload, type JoinOptions } from "../shared/protocol";
import { SIM_HZ } from "../shared/constants";

/** Thin networking shell. All rules live in RaceSimulation. */
export class RallyRoom extends Room<GameState> {
  maxClients = 256; // free-for-all: effectively no cap
  private sim!: RaceSimulation;

  onCreate(options: JoinOptions): void {
    const state = new GameState();
    this.setState(state);
    this.sim = new RaceSimulation(state);

    // smoother sync for fast-moving cars (default is 20Hz)
    this.setPatchRate(1000 / 30);
    this.setSimulationInterval((dtMs) => this.sim.tick(dtMs / 1000), 1000 / SIM_HZ);

    this.onMessage(MSG.input, (client, p: InputPayload) =>
      this.sim.setInput(client.sessionId, p),
    );
    this.onMessage(MSG.ready, (client, ready: boolean) =>
      this.sim.setReady(client.sessionId, !!ready),
    );
    this.onMessage(MSG.setName, (client, name: string) =>
      this.sim.setName(client.sessionId, String(name ?? "")),
    );
    this.onMessage(MSG.setColor, (client, color: string) =>
      this.sim.setColor(client.sessionId, String(color ?? "")),
    );
    this.onMessage(MSG.start, (client) => this.sim.startRace(client.sessionId));
    this.onMessage(MSG.restart, (client) => this.sim.restart(client.sessionId));
  }

  onJoin(client: Client, options: JoinOptions): void {
    this.sim.addPlayer(client.sessionId, options?.name, options?.color);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    this.sim.setConnected(client.sessionId, false);
    if (consented) {
      this.sim.removePlayer(client.sessionId);
      return;
    }
    try {
      await this.allowReconnection(client, 20);
      this.sim.setConnected(client.sessionId, true);
    } catch {
      this.sim.removePlayer(client.sessionId);
    }
  }
}
