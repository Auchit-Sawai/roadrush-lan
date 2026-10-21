import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIKE,
  bumpRacer,
  createRacerState,
  steerRateForSpeed,
  stepRacer,
  triggerCrash,
} from '../src/game/Physics.js';
import { sampleAt } from '../shared/track.js';

const straightSample = { curvature: 0, safeSpeed: 999, turn: 0 };
const noInput = { throttle: 0, brake: 0, steer: 0, boost: false };

function simulate(state, input, seconds, sample = straightSample) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) stepRacer(state, input, dt, sample);
  return state;
}

test('throttle accelerates smoothly and stays finite', () => {
  const state = createRacerState();
  simulate(state, { ...noInput, throttle: 1 }, 3);
  assert.ok(state.speed > 25, `speed ${state.speed}`);
  assert.ok(state.speed <= BIKE.maxSpeed);
  assert.ok(state.progress > 0);
  assert.ok(Number.isFinite(state.lateral));
  assert.ok(Number.isFinite(state.lean));
  assert.ok(state.topSpeed >= state.speed);
});

test('braking slows the bike and releasing throttle coasts down', () => {
  const state = createRacerState();
  simulate(state, { ...noInput, throttle: 1 }, 4);
  const fast = state.speed;
  simulate(state, { ...noInput, brake: 1 }, 1);
  assert.ok(state.speed < fast * 0.5, `${state.speed} vs ${fast}`);
  const braking = state.speed;
  simulate(state, noInput, 2);
  assert.ok(state.speed < braking);
});

test('steering moves laterally and leans the rider', () => {
  const state = createRacerState();
  simulate(state, { ...noInput, throttle: 1, steer: 1 }, 1.5);
  assert.ok(state.lateral > 0.5, `lateral ${state.lateral}`);
  assert.ok(state.lean < -0.05, `lean ${state.lean}`);
  assert.ok(steerRateForSpeed(0) === BIKE.steerBase);
  assert.ok(steerRateForSpeed(100) === BIKE.maxLateralSpeed);
});

test('barriers clamp lateral position and cost speed', () => {
  const state = createRacerState();
  simulate(state, { ...noInput, throttle: 1 }, 2);
  simulate(state, { ...noInput, throttle: 1, steer: 1 }, 6);
  assert.equal(state.lateral, BIKE.barrierHalfWidth);
});

test('crash freezes, then recovers with temporary invulnerability', () => {
  const state = createRacerState();
  state.speed = 50;
  assert.equal(triggerCrash(state), true);
  assert.equal(triggerCrash(state), false);
  assert.equal(state.crashCount, 1);
  stepRacer(state, noInput, 1 / 60, straightSample);
  assert.equal(state.speed, 0);
  simulate(state, noInput, BIKE.crashDuration + 0.1);
  assert.ok(state.speed > 0);
  assert.ok(state.invuln > 0);
});

test('finished racers coast to a stop and keep their finish state', () => {
  const state = createRacerState({ progress: 100, speed: 40 });
  state.finished = true;
  state.finishTime = 50;
  simulate(state, { ...noInput, throttle: 1 }, 5);
  assert.equal(state.finished, true);
  assert.equal(state.finishTime, 50);
  assert.ok(state.speed < 1);
});

test('bumping slows the bike once per cooldown', () => {
  const state = createRacerState();
  state.speed = 60;
  assert.equal(bumpRacer(state, { speed: 40 }, 1), true);
  assert.ok(state.speed <= 30);
  assert.ok(state.lateral > 0);
  assert.equal(bumpRacer(state, { speed: 40 }, -1), false);
});

test('a full-lap simulation on the real track remains stable', () => {
  const state = createRacerState({ invuln: 999 });
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 90; i += 1) {
    const sample = sampleAt(state.progress);
    stepRacer(state, { ...noInput, throttle: 1, steer: Math.sin(i / 240) * 0.35 }, dt, sample);
    assert.ok(Number.isFinite(state.progress) && Number.isFinite(state.speed));
  }
  assert.ok(state.progress > 1000, `progress ${state.progress}`);
});
