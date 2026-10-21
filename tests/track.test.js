import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RACE_CONFIG,
  RACE_DISTANCE,
  TRACK,
  TRACK_LENGTH,
  nearestTrackDistanceSq,
  sampleAt,
  worldPositionAt,
  wrapDistance,
} from '../shared/track.js';

test('track is a closed, dense, plausible circuit', () => {
  assert.ok(TRACK_LENGTH > 1500 && TRACK_LENGTH < 2200, `length ${TRACK_LENGTH}`);
  assert.ok(TRACK.count > 1000);
  const start = sampleAt(0);
  const end = sampleAt(TRACK_LENGTH - 0.001);
  const gap = Math.hypot(start.point.x - end.point.x, start.point.z - end.point.z);
  assert.ok(gap < 5, `gap ${gap}`);
  assert.equal(RACE_DISTANCE, TRACK_LENGTH * RACE_CONFIG.laps);
});

test('distance wraps in both directions', () => {
  assert.equal(wrapDistance(0), 0);
  assert.ok(Math.abs(wrapDistance(TRACK_LENGTH + 12.5) - 12.5) < 1e-6);
  assert.ok(Math.abs(wrapDistance(-12.5) - (TRACK_LENGTH - 12.5)) < 1e-6);
});

test('samples are finite with usable curvature and safe speed', () => {
  for (let distance = 0; distance < TRACK_LENGTH; distance += 17) {
    const sample = sampleAt(distance);
    assert.ok(Number.isFinite(sample.point.x));
    assert.ok(Number.isFinite(sample.point.y));
    assert.ok(Number.isFinite(sample.curvature) && sample.curvature >= 0);
    assert.ok(Number.isFinite(sample.safeSpeed) && sample.safeSpeed > 0);
  }
});

test('world position offsets to the right of the centreline', () => {
  const centre = worldPositionAt(300, 0);
  const right = worldPositionAt(300, 4);
  const sample = sampleAt(300);
  assert.ok(Math.abs(right.x - (centre.x + sample.right.x * 4)) < 1e-9);
  assert.ok(Math.abs(right.z - (centre.z + sample.right.z * 4)) < 1e-9);
});

test('nearest-track search finds points on the racing surface', () => {
  const centre = worldPositionAt(450, 0);
  const distanceSq = nearestTrackDistanceSq(centre.x, centre.z);
  assert.ok(distanceSq < 1, `distance squared ${distanceSq}`);
  assert.ok(nearestTrackDistanceSq(centre.x + 5000, centre.z) > 1000);
});
