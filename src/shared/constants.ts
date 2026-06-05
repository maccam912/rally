/** Tunable game constants shared by sim, server and client. World units are
 * pixels; time is seconds. */

// ---- Car physics (arcade drift model) -------------------------------------
export const CAR = {
  engineAccel: 600, // forward acceleration (px/s^2) — slower build, exits matter
  brakeAccel: 1000, // braking / reverse acceleration
  maxSpeed: 780, // top forward speed on tarmac (px/s)
  maxReverse: 210,
  dragForward: 0.4, // base rolling resistance (per second)
  maxTurnRate: 3.5, // rad/s of heading change at full steering authority
  turnFullSpeed: 120, // speed (px/s) at which steering reaches full authority
  yawResponse: 7, // 1/s — how fast yaw chases its target (lower = more momentum/lag)
  oversteer: 0.0045, // slide-induced yaw per (px/s) of lateral slip (spinout feedback)
  gripRef: 2.4, // grip value at which the oversteer multiplier is 1 (tarmac)
  maxOversteerMult: 3.0, // cap on how much low grip / handbrake amplifies oversteer
  handbrakeGrip: 0.12, // multiplies surface grip while handbraking (=> slide)
  handbrakeTurnBoost: 1.85, // extra rotation while handbraking (drift rotation)
  radius: 26, // collision circle radius (px)
  restitution: 0.4, // bounciness of car-to-car bumps
  bumpForce: 1.1, // impulse scale for car-to-car bumps
  bumpFriction: 0.85, // Coulomb friction coeff at car-to-car contact (spin)
  inertia: 70, // rotational inertia for collision spin (lower = spins easier)
  pitSpin: 0.5, // scale of collision-induced spin (PIT maneuver strength)
  spinDamp: 2.6, // per-second decay of collision spin
  length: 64, // sprite length for rendering scale reference
  // car-vs-scenery (trees/rocks/barriers/cones) — immovable circle obstacles
  obstacleRestitution: 0.35, // how much a head-on hit bounces back (vs. stops)
  obstacleFriction: 0.85, // tangential scrub when scraping along an obstacle
} as const;

// ---- Drift / effect thresholds --------------------------------------------
export const DRIFT = {
  /** lateral slip speed (px/s) above which the car is considered drifting */
  slipThreshold: 70,
  /** min forward speed to bother emitting skid marks / dust */
  minSpeed: 60,
} as const;

// ---- Reset rules (art-of-rally style) -------------------------------------
export const RESET = {
  /** how far past the road edge (px) before the off-road timer starts */
  offRoadMargin: 30,
  /** seconds off-road before a reset onto the road */
  offRoadDelay: 2.5,
  /** distance past edge (px) that triggers an immediate reset (way off) */
  hardOffRoadDist: 260,
  /** speed (px/s) below which a car counts as motionless */
  idleSpeed: 22,
  /** seconds motionless (while racing) before a reset */
  idleDelay: 4.0,
  /** frames of post-reset grace/flash */
  flashTime: 1.0,
} as const;

// ---- Track generation -----------------------------------------------------
export const TRACK = {
  controlPoints: 11, // base loop control points before smoothing
  radius: 1450, // average loop radius (px)
  radiusJitter: 0.4, // how lumpy the loop is (fraction of radius)
  samplesPerSegment: 14, // smoothing resolution of the catmull-rom spline
  roadHalfWidth: 120, // half the road width (px)
  widthJitter: 26, // per-point road width variation
  surfaceSections: 5, // number of distinct surface zones around the loop
  startGridCols: 4, // cars per row on the start grid
} as const;

// ---- Race rules -----------------------------------------------------------
export const RACE = {
  defaultLaps: 3,
  countdownSeconds: 3,
  finishLingerSeconds: 8, // time after first finisher before forcing results
} as const;

export const SIM_HZ = 60;
export const FIXED_DT = 1 / SIM_HZ;

/** Car colours available (matches copied Kenney car sprites). */
export const CAR_COLORS = ["red", "blue", "green", "yellow", "black"] as const;
export type CarColor = (typeof CAR_COLORS)[number];
