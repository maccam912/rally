/** Client -> server message names and payloads. */
export const MSG = {
  input: "input",
  ready: "ready",
  setName: "setName",
  setColor: "setColor",
  start: "start", // host only
  restart: "restart", // host only -> back to lobby with a new track
} as const;

export interface InputPayload {
  /** -1..1 */
  throttle: number;
  /** -1..1 */
  steer: number;
  handbrake: boolean;
  /** monotonically increasing client tick for ordering (optional) */
  seq?: number;
}

export interface JoinOptions {
  name?: string;
  code?: string;
  color?: string;
}
