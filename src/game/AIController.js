import { sampleAt } from '../../shared/track.js';

const LANES = [-4.2, -1.9, 1.9, 4.2];

export function createAI(options = {}) {
  return {
    id: options.id ?? 'ai',
    name: options.name ?? 'Rival',
    color: options.color ?? '#4d96ff',
    skill: options.skill ?? 0.5,
    preferredLane: options.lane ?? 0,
    laneTarget: options.lane ?? 0,
    thinkTimer: Math.random() * 0.25,
    state: options.state,
  };
}

function laneBlocked(ai, obstacles, rangeMin, rangeMax, margin = 2.3) {
  for (const obstacle of obstacles) {
    let delta = obstacle.progress - ai.state.progress;
    if (delta < rangeMin || delta > rangeMax) continue;
    if (Math.abs(obstacle.lateral - ai.state.lateral) < margin) return obstacle;
  }
  return null;
}

export function computeAIInput(ai, context, dt) {
  ai.thinkTimer -= dt;
  const { traffic, playerProgress, elapsed } = context;
  const aiState = ai.state;

  if (ai.thinkTimer <= 0) {
    ai.thinkTimer = 0.28 + Math.random() * 0.16;
    const obstacles = traffic.all;
    const ahead = laneBlocked(ai, obstacles, 8, 48, 2.6);
    let target = ai.preferredLane;

    if (ahead) {
      const leftLane = ahead.lateral > 0 ? -4.2 : 4.2;
      const centerLane = ahead.lateral > 0 ? -1.9 : 1.9;
      const leftClear = !laneBlocked(ai, obstacles, 4, 56, 2.6) || Math.abs(ahead.lateral - leftLane) > 3;
      target = leftClear ? leftLane : centerLane;
    }

    if (playerProgress != null) {
      const playerDelta = playerProgress - aiState.progress;
      if (Math.abs(playerDelta) < 30) {
        const playerObstacle = { progress: playerProgress, lateral: context.playerLateral };
        if (Math.abs(context.playerLateral - aiState.lateral) < 2.3) {
          target = context.playerLateral > 0 ? -2.4 : 2.4;
        }
        if (playerObstacle.progress > aiState.progress && laneBlocked(ai, [playerObstacle], 0, 18, 2.2)) {
          target = context.playerLateral > 0 ? -0.5 : 0.5;
        }
      }
    }

    ai.laneTarget = Math.max(-5.2, Math.min(5.2, target));
  }

  const diff = context.difficulty ?? { speed: 1, rubber: 1 };
  let targetSpeed = (50 + ai.skill * 13) * diff.speed;
  for (const look of [12, 38, 75]) {
    const sample = sampleAt(aiState.progress + look);
    targetSpeed = Math.min(targetSpeed, Math.max(24, sample.safeSpeed * 0.96));
  }
  if (playerProgress != null) {
    // Rubber band: rivals catch up when the player is far ahead, ease off when far behind.
    const gap = playerProgress - aiState.progress;
    if (gap > 60) targetSpeed += Math.min(12, (gap - 60) * 0.12) * diff.rubber;
    else if (gap < -90) targetSpeed -= Math.min(8, (-gap - 90) * 0.08) * diff.rubber;
  }

  const laneError = ai.laneTarget - aiState.lateral;
  let steer = Math.max(-1, Math.min(1, laneError * 0.55));
  if (aiState.speed < 6) steer *= 0.3;

  const brake = targetSpeed < aiState.speed - 3 ? 1 : 0;
  const throttle = brake ? 0 : targetSpeed > aiState.speed ? 1 : 0.15;

  return { throttle, brake, steer, boost: false, targetSpeed };
}

export { LANES };
