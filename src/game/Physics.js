import { RACE_CONFIG } from '../../shared/track.js';

export const BIKE = Object.freeze({
  maxSpeed: 72,
  boostSpeed: 86,
  accel: 26,
  brake: 34,
  drag: 0.0021,
  rolling: 1.1,
  engineBrake: 3.0,
  steerBase: 2.8,
  steerSpeedFactor: 0.055,
  maxLateralSpeed: 6.8,
  maxLatAccel: 22,
  barrierHalfWidth: RACE_CONFIG.playableHalfWidth,
  crashDuration: 1.65,
  recoverSpeed: 12,
  invulnDuration: 2.0,
  boostDrain: 32,
  boostRecharge: 14,
  bumpCooldown: 0.65,
});

export function createRacerState(options = {}) {
  return {
    progress: options.progress ?? 0,
    speed: options.speed ?? 0,
    lateral: options.lateral ?? 0,
    lean: 0,
    steerValue: 0,
    boost: 100,
    boosting: false,
    crashTimer: 0,
    invuln: options.invuln ?? 0,
    bumpCooldown: 0,
    crashCount: 0,
    finished: false,
    finishTime: null,
    topSpeed: 0,
    lastLapIndex: 0,
    lapStartTime: 0,
    lapTimes: [],
    bestLap: null,
    health: 100,
    takedowns: 0,
    punchCooldown: 0,
    punchAnim: 0,
    punchSide: 1,
    hitFlash: 0,
    sinceHit: 99,
  };
}

export function triggerCrash(state) {
  if (state.crashTimer > 0) return false;
  state.crashTimer = BIKE.crashDuration;
  state.speed = 0;
  state.crashCount += 1;
  state.lean = 0;
  return true;
}

export function steerRateForSpeed(speed) {
  return Math.min(BIKE.maxLateralSpeed, BIKE.steerBase + speed * BIKE.steerSpeedFactor);
}

export function stepRacer(state, input, dt, trackSample) {
  const events = { barrier: false, impactSpeed: 0, boosting: false };

  state.invuln = Math.max(0, state.invuln - dt);
  state.bumpCooldown = Math.max(0, state.bumpCooldown - dt);
  state.punchCooldown = Math.max(0, state.punchCooldown - dt);
  state.punchAnim = Math.max(0, state.punchAnim - dt * 4.2);
  state.hitFlash = Math.max(0, state.hitFlash - dt * 4);
  state.sinceHit += dt;
  if (state.sinceHit > 5 && state.health < 100) state.health = Math.min(100, state.health + 5 * dt);

  if (state.crashTimer > 0) {
    state.crashTimer = Math.max(0, state.crashTimer - dt);
    state.speed = 0;
    state.boosting = false;
    state.boost = Math.min(100, state.boost + BIKE.boostRecharge * dt);
    if (state.crashTimer === 0) {
      state.speed = BIKE.recoverSpeed;
      state.invuln = BIKE.invulnDuration;
    }
    return events;
  }

  if (state.finished) {
    state.speed = Math.max(0, state.speed - BIKE.brake * dt);
    state.progress += state.speed * dt;
    return events;
  }

  const throttle = Math.max(0, Math.min(1, input.throttle || 0));
  const brake = Math.max(0, Math.min(1, input.brake || 0));
  const steerTarget = Math.max(-1, Math.min(1, input.steer || 0));
  const wantBoost = Boolean(input.boost) && state.boost > 0 && state.speed > 4;

  state.boosting = wantBoost;
  if (wantBoost) {
    state.boost = Math.max(0, state.boost - BIKE.boostDrain * dt);
  } else {
    state.boost = Math.min(100, state.boost + BIKE.boostRecharge * dt);
  }
  events.boosting = wantBoost;

  const maxSpeed = wantBoost ? BIKE.boostSpeed : BIKE.maxSpeed;
  let acceleration = 0;
  if (throttle > 0) {
    const headroom = Math.max(0.08, 1 - (state.speed / maxSpeed) * 0.6);
    acceleration += BIKE.accel * headroom * throttle;
    if (wantBoost) acceleration += 13;
  }
  if (brake > 0) {
    acceleration -= BIKE.brake * brake;
  } else if (throttle === 0 && state.speed > 0) {
    acceleration -= BIKE.engineBrake;
  }

  const drag = BIKE.drag * state.speed * state.speed;
  acceleration -= drag + (state.speed > 0.2 ? BIKE.rolling : 0);

  state.speed = Math.max(0, Math.min(maxSpeed, state.speed + acceleration * dt));
  state.topSpeed = Math.max(state.topSpeed, state.speed);

  const steerAlpha = 1 - Math.exp(-12 * dt);
  state.steerValue += (steerTarget - state.steerValue) * steerAlpha;

  const speedFactor = Math.min(1, state.speed / 15);
  let lateralVelocity = state.steerValue * steerRateForSpeed(state.speed) * speedFactor;

  const safeSpeed = trackSample.safeSpeed;
  if (safeSpeed > 0 && state.speed > safeSpeed) {
    const excess = state.speed * state.speed * trackSample.curvature - BIKE.maxLatAccel;
    const drift = Math.max(0, excess) * 0.055;
    lateralVelocity += -trackSample.turn * drift;
    state.speed = Math.max(0, state.speed - Math.max(0, excess) * 0.14 * dt);
  }

  state.lateral += lateralVelocity * dt;

  const leanTarget = -state.steerValue * 0.55 * Math.min(1, state.speed / 24);
  state.lean += (leanTarget - state.lean) * (1 - Math.exp(-9 * dt));

  if (Math.abs(state.lateral) > BIKE.barrierHalfWidth) {
    state.lateral = Math.sign(state.lateral) * BIKE.barrierHalfWidth;
    events.barrier = true;
    events.impactSpeed = state.speed;
    state.speed *= 0.62;
    state.lean *= -0.35;
  }

  state.progress += state.speed * dt;
  return events;
}

export function bumpRacer(state, car, side) {
  if (state.bumpCooldown > 0 || state.invuln > 0) return false;
  state.bumpCooldown = BIKE.bumpCooldown;
  state.speed = Math.min(state.speed, Math.max(6, car.speed * 0.75));
  state.lateral += side * 0.8;
  state.lateral = Math.max(-BIKE.barrierHalfWidth, Math.min(BIKE.barrierHalfWidth, state.lateral));
  return true;
}
