import { sanitizeNickname } from '../../shared/protocol.js';

export const SETTINGS_KEY = 'rr.settings.v1';
export const RECORDS_KEY = 'rr.records.v1';
export { sanitizeNickname };

export const RESOLUTIONS = Object.freeze([
  { id: '1280x720', width: 1280, height: 720, label: '1280 x 720' },
  { id: '1600x900', width: 1600, height: 900, label: '1600 x 900' },
  { id: '1920x1080', width: 1920, height: 1080, label: '1920 x 1080' },
]);

export const BIKE_COLORS = Object.freeze([
  '#e63946',
  '#f4a261',
  '#4d96ff',
  '#59c26b',
  '#c77dff',
  '#f1f1f1',
]);

export const DEFAULT_SETTINGS = Object.freeze({
  nickname: 'Rider',
  color: '#e63946',
  resolution: '1280x720',
  graphics: 'performance',
  difficulty: 'pro',
  audio: true,
  fullscreen: false,
});

export function validateSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const resolution = RESOLUTIONS.some((entry) => entry.id === source.resolution)
    ? source.resolution
    : DEFAULT_SETTINGS.resolution;
  return {
    nickname: sanitizeNickname(source.nickname, DEFAULT_SETTINGS.nickname),
    color: /^#[0-9a-fA-F]{6}$/.test(source.color ?? '') ? source.color.toLowerCase() : DEFAULT_SETTINGS.color,
    resolution,
    graphics: source.graphics === 'quality' ? 'quality' : 'performance',
    difficulty: ['rookie', 'pro', 'legend'].includes(source.difficulty) ? source.difficulty : DEFAULT_SETTINGS.difficulty,
    audio: source.audio !== false,
    fullscreen: source.fullscreen === true,
  };
}

export async function loadSettings(store) {
  try {
    const raw = await store.get(SETTINGS_KEY, null);
    return validateSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(store, settings) {
  try {
    await store.set(SETTINGS_KEY, validateSettings(settings));
    return true;
  } catch {
    return false;
  }
}

export function resolutionHeight(id) {
  const entry = RESOLUTIONS.find((item) => item.id === id);
  return entry ? entry.height : 720;
}

export function emptyRecords() {
  return {};
}

export function validateRecords(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const records = {};
  for (const [trackId, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const bestTime = Number(entry.bestTime);
    const bestLap = Number(entry.bestLap);
    const topSpeed = Number(entry.topSpeed);
    records[trackId] = {
      bestTime: Number.isFinite(bestTime) && bestTime > 0 ? bestTime : null,
      bestLap: Number.isFinite(bestLap) && bestLap > 0 ? bestLap : null,
      topSpeed: Number.isFinite(topSpeed) && topSpeed > 0 ? topSpeed : null,
      races: Number.isInteger(entry.races) && entry.races >= 0 ? entry.races : 0,
      wins: Number.isInteger(entry.wins) && entry.wins >= 0 ? entry.wins : 0,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    };
  }
  return records;
}

export async function loadRecords(store) {
  try {
    return validateRecords(await store.get(RECORDS_KEY, {}));
  } catch {
    return {};
  }
}

export function recordRaceResult(records, trackId, results) {
  const next = { ...(records || {}) };
  const current = next[trackId] || {
    bestTime: null,
    bestLap: null,
    topSpeed: null,
    races: 0,
    wins: 0,
    updatedAt: null,
  };
  const time = results.totalTime;
  const lap = results.bestLap;
  const speed = results.topSpeed;
  next[trackId] = {
    bestTime: Number.isFinite(time) && (current.bestTime == null || time < current.bestTime) ? time : current.bestTime,
    bestLap: Number.isFinite(lap) && (current.bestLap == null || lap < current.bestLap) ? lap : current.bestLap,
    topSpeed: Number.isFinite(speed) && (current.topSpeed == null || speed > current.topSpeed) ? speed : current.topSpeed,
    races: current.races + 1,
    wins: current.wins + (results.placement === 1 ? 1 : 0),
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export async function saveRecords(store, records) {
  try {
    await store.set(RECORDS_KEY, validateRecords(records));
    return true;
  } catch {
    return false;
  }
}
