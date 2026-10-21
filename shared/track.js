import { buildTrackSamples } from './trackMath.js';

export const TRACK_DEFINITION = Object.freeze({
  id: 'sunset-ridge',
  name: 'Sunset Ridge',
  controlPoints: [
    [0, 0.0, 300],
    [140, 1.5, 285],
    [250, 3.0, 235],
    [320, 4.0, 150],
    [340, 4.5, 40],
    [315, 3.0, -70],
    [250, 1.5, -160],
    [150, 0.0, -220],
    [40, -0.5, -240],
    [-70, 0.0, -225],
    [-170, 1.0, -180],
    [-250, 2.5, -105],
    [-295, 3.5, -10],
    [-285, 3.0, 90],
    [-235, 2.0, 180],
    [-150, 1.0, 250],
    [-60, 0.5, 292],
  ],
});

export const RACE_CONFIG = Object.freeze({
  laps: 2,
  maxPlayers: 8,
  roadHalfWidth: 7.0,
  playableHalfWidth: 6.25,
  checkpointCount: 40,
});

export const TRACK = Object.freeze(buildTrackSamples(TRACK_DEFINITION.controlPoints, 90));
export const TRACK_LENGTH = TRACK.length;
export const RACE_DISTANCE = TRACK_LENGTH * RACE_CONFIG.laps;
export const CHECKPOINT_SPACING = TRACK_LENGTH / RACE_CONFIG.checkpointCount;

export function wrapDistance(distance) {
  const length = TRACK_LENGTH;
  const wrapped = distance % length;
  return wrapped < 0 ? wrapped + length : wrapped;
}

export function sampleAt(distance) {
  const index = Math.floor(wrapDistance(distance) / TRACK.ds) % TRACK.count;
  return {
    index,
    point: TRACK.points[index],
    tangent: TRACK.tangents[index],
    right: TRACK.rights[index],
    curvature: TRACK.curvatures[index],
    turn: TRACK.turns[index],
    heading: Math.atan2(TRACK.tangents[index].x, TRACK.tangents[index].z),
    safeSpeed: Math.sqrt(22 / Math.max(TRACK.curvatures[index], 1e-4)),
  };
}

export function worldPositionAt(distance, lateral, target = { x: 0, y: 0, z: 0 }) {
  const s = sampleAt(distance);
  target.x = s.point.x + s.right.x * lateral;
  target.y = s.point.y;
  target.z = s.point.z + s.right.z * lateral;
  return target;
}

export function nearestTrackDistanceSq(x, z, stride = 1) {
  let best = Infinity;
  for (let i = 0; i < TRACK.count; i += stride) {
    const p = TRACK.points[i];
    const dx = p.x - x;
    const dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return best;
}
