import { CAR } from "./constants";
import { Surface, SURFACE_PARAMS } from "./surfaces";

/** The mutable physical state a car needs. The Colyseus car schema implements
 * this interface, so the exact same step function runs in unit tests (on plain
 * objects) and on the authoritative server (on schema instances). */
export interface CarBody {
  x: number;
  y: number;
  angle: number; // heading, radians, 0 = +x
  vx: number;
  vy: number;
  /** lateral slip speed magnitude (px/s) — how sideways the car is sliding */
  slip: number;
  /** collision-induced angular velocity (rad/s) — spins the car on bumps/PITs,
   * separate from steering. Decays over time. */
  spin: number;
  /** steering yaw rate (rad/s). The heading carries this as angular momentum
   * instead of snapping to the steering input, and lateral slip feeds back into
   * it — that's what lets the car over-rotate and spin out. */
  yaw: number;
}

export interface CarInput {
  /** -1 (reverse/brake) .. +1 (full throttle) */
  throttle: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  handbrake: boolean;
}

export const ZERO_INPUT: CarInput = { throttle: 0, steer: 0, handbrake: false };

/** Advance one car by dt seconds under the arcade drift model.
 *
 * The model splits velocity into a forward and a lateral component relative to
 * the car's heading. Engine/brake act on the forward part; surface grip kills
 * the lateral part. Drift emerges because the heading rotates (steering) faster
 * than grip can realign the velocity — so the car keeps sliding sideways. Low
 * grip surfaces (snow/sand) and the handbrake make that slide bigger. */
export function stepCar(
  car: CarBody,
  input: CarInput,
  surface: Surface,
  dt: number,
): void {
  const sp = SURFACE_PARAMS[surface];

  // Basis at the CURRENT heading (used to both decompose and recompose, so the
  // velocity vector lags the heading change — that lag is the drift).
  const fwdX = Math.cos(car.angle);
  const fwdY = Math.sin(car.angle);
  const rightX = -Math.sin(car.angle);
  const rightY = Math.cos(car.angle);

  let vForward = car.vx * fwdX + car.vy * fwdY;
  let vLateral = car.vx * rightX + car.vy * rightY;

  // --- Engine / brake along forward axis ---
  const throttle = clamp(input.throttle, -1, 1);
  if (throttle >= 0) {
    vForward += throttle * CAR.engineAccel * dt;
  } else {
    // braking when moving forward, reverse accel when stopped/backing
    const accel = vForward > 0 ? CAR.brakeAccel : CAR.engineAccel * 0.6;
    vForward += throttle * accel * dt;
  }

  // rolling resistance (frame-rate independent decay)
  const drag = CAR.dragForward + sp.drag;
  vForward *= Math.exp(-drag * dt);

  // clamp speed by surface
  const maxF = CAR.maxSpeed * sp.speedMult;
  if (vForward > maxF) vForward = maxF;
  if (vForward < -CAR.maxReverse) vForward = -CAR.maxReverse;

  // --- Lateral grip (kills sideways slide) ---
  let grip = sp.grip;
  if (input.handbrake) grip *= CAR.handbrakeGrip;
  const retain = Math.exp(-grip * dt);
  const newLateral = vLateral * retain;

  // --- Steering & yaw dynamics ---
  // The heading does NOT snap to the steering input; it carries angular
  // momentum (yaw) that chases a target rate. On top of the driver's steering,
  // lateral slip applies a DEstabilizing torque: when the rear steps out the
  // nose is rotated further into the slide. That positive feedback is what makes
  // the car loose — it'll oversteer and spin unless caught with countersteer.
  const speed = Math.hypot(car.vx, car.vy);
  const authority = clamp(speed / CAR.turnFullSpeed, 0, 1);

  let steerYaw = clamp(input.steer, -1, 1) * CAR.maxTurnRate * authority;
  if (vForward < 0) steerYaw = -steerYaw; // steering inverts in reverse
  if (input.handbrake) steerYaw *= CAR.handbrakeTurnBoost;

  // slide-induced yaw. e.g. after turning right, momentum makes the car slide to
  // its own left (vLateral < 0), and -vLateral pushes the nose further right →
  // runaway rotation. Looser surfaces (and the handbrake, via reduced grip)
  // amplify it; it fades out as the car slows so a parked car can't spin.
  const looseness = clamp(CAR.gripRef / grip, 0, CAR.maxOversteerMult);
  const slipYaw = -vLateral * CAR.oversteer * looseness * authority;

  // yaw lags toward (steer + slip), giving the rotation real momentum
  const targetYaw = steerYaw + slipYaw;
  car.yaw += (targetYaw - car.yaw) * clamp(CAR.yawResponse * dt, 0, 1);
  car.angle += car.yaw * dt;

  // collision-induced spin (PIT maneuvers) layered on top of steering, decaying
  car.angle += car.spin * dt;
  car.spin *= Math.exp(-CAR.spinDamp * dt);

  // keep angle bounded
  if (car.angle > Math.PI) car.angle -= Math.PI * 2;
  else if (car.angle < -Math.PI) car.angle += Math.PI * 2;

  // --- Recompose velocity from the (pre-rotation) basis ---
  car.vx = fwdX * vForward + rightX * newLateral;
  car.vy = fwdY * vForward + rightY * newLateral;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.slip = Math.abs(newLateral);
}

/** Resolve an elastic-ish bump between two equal-mass car circles. Returns the
 * impact intensity (>= 0; 0 if they weren't actually colliding) so callers can
 * trigger sound/particles. Mutates both bodies. */
export function resolveCarCollision(a: CarBody, b: CarBody): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  const minDist = CAR.radius * 2;
  if (dist >= minDist) return 0;
  if (dist < 1e-4) {
    // perfectly overlapping — shove apart deterministically
    dist = 1e-4;
  }
  const nx = dx / dist;
  const ny = dy / dist;

  // positional separation (split evenly)
  const overlap = minDist - dist;
  const sep = overlap / 2;
  a.x -= nx * sep;
  a.y -= ny * sep;
  b.x += nx * sep;
  b.y += ny * sep;

  // relative velocity along the normal
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const velAlongN = rvx * nx + rvy * ny;
  if (velAlongN > 0) return 0; // already separating

  const impulse = (-(1 + CAR.restitution) * velAlongN) / 2; // equal mass
  const jx = impulse * nx * CAR.bumpForce;
  const jy = impulse * ny * CAR.bumpForce;
  a.vx -= jx;
  a.vy -= jy;
  b.vx += jx;
  b.vy += jy;

  // --- Tangential friction at the contact → spin (PIT maneuvers) ---
  // A glancing / off-line hit scrapes the cars past each other; that contact
  // friction acts at the rim (lever arm = radius), so it whips the rammed car
  // around. Coulomb-limited by the normal impulse.
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty; // tangential relative speed
  const maxFric = CAR.bumpFriction * Math.abs(impulse);
  const jt = clamp(-vt / 2, -maxFric, maxFric);
  a.vx -= jt * tx;
  a.vy -= jt * ty;
  b.vx += jt * tx;
  b.vy += jt * ty;
  const spinKick = ((CAR.radius * jt) / CAR.inertia) * CAR.pitSpin;
  a.spin -= spinKick;
  b.spin -= spinKick;

  return Math.abs(velAlongN);
}

/** Resolve a car hitting a static, immovable circular obstacle (tree, rock,
 * barrier, cone, tyre stack). The car is pushed out and its normal velocity
 * reflected (so a head-on hit mostly stops it, a glancing one deflects + spins
 * it). Returns the impact intensity (>= 0; 0 if not touching / separating) for
 * sound + particle feedback. Mutates the car only. */
export function resolveObstacleCollision(
  car: CarBody,
  ox: number,
  oy: number,
  oradius: number,
): number {
  const dx = car.x - ox;
  const dy = car.y - oy;
  let dist = Math.hypot(dx, dy);
  const minDist = CAR.radius + oradius;
  if (dist >= minDist) return 0;

  let nx: number;
  let ny: number;
  if (dist < 1e-4) {
    // dead-centre overlap — shove back the way the car came in
    const sp = Math.hypot(car.vx, car.vy);
    if (sp > 1e-3) {
      nx = -car.vx / sp;
      ny = -car.vy / sp;
    } else {
      nx = 1;
      ny = 0;
    }
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }

  // push fully clear of the obstacle (it never moves)
  car.x = ox + nx * minDist;
  car.y = oy + ny * minDist;

  // normal velocity (negative = driving into the obstacle)
  const velAlongN = car.vx * nx + car.vy * ny;
  if (velAlongN >= 0) return 0; // resting against / leaving it

  // reflect the normal component → bounce back / stop
  const jn = -(1 + CAR.obstacleRestitution) * velAlongN; // > 0
  car.vx += jn * nx;
  car.vy += jn * ny;

  // tangential (Coulomb) friction scrubs sideways speed and whips the car round
  const tx = -ny;
  const ty = nx;
  const vt = car.vx * tx + car.vy * ty;
  const maxFric = CAR.obstacleFriction * jn;
  const jt = clamp(-vt, -maxFric, maxFric);
  car.vx += jt * tx;
  car.vy += jt * ty;
  car.spin -= ((CAR.radius * jt) / CAR.inertia) * CAR.pitSpin;

  return Math.abs(velAlongN);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
