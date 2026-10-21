import { RACE_CONFIG, RACE_DISTANCE } from './track.js';

export const PROTOCOL_VERSION = 1;
export const SERVER_VERSION = '0.1.0';
export const MAX_MESSAGE_BYTES = 32768;
export const STATE_HZ = 12;
export const MAX_SPEED = 100;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_REGEX = /^[A-HJ-NP-Z2-9]{4}$/;

export const CLIENT_MSG = Object.freeze({
  HELLO: 'hello',
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  READY: 'ready',
  START_RACE: 'startRace',
  LEAVE_ROOM: 'leaveRoom',
  STATE: 'state',
  LEADERBOARD: 'leaderboard',
  PING: 'ping',
});

export const SERVER_MSG = Object.freeze({
  WELCOME: 'welcome',
  ROOM_STATE: 'roomState',
  RACE_STARTING: 'raceStarting',
  RACE_STATE: 'raceState',
  PLAYER_FINISHED: 'playerFinished',
  RACE_RESULTS: 'raceResults',
  LEADERBOARD: 'leaderboard',
  ERROR: 'error',
  PONG: 'pong',
  DISCONNECTED: 'disconnected',
});

export function sanitizeNickname(value, fallback = 'Rider') {
  const cleaned = String(value ?? '')
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  return cleaned || fallback;
}

export function isValidColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function isValidRoomCode(value) {
  return typeof value === 'string' && ROOM_CODE_REGEX.test(value);
}

export function isValidToken(value) {
  return value == null || (typeof value === 'string' && value.length > 0 && value.length <= 80);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fail(error) {
  return { ok: false, error };
}

export function validateClientMessage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Message must be an object.');
  if (typeof raw.type !== 'string') return fail('Message type is required.');

  switch (raw.type) {
    case CLIENT_MSG.HELLO: {
      if (raw.token != null && !isValidToken(raw.token)) return fail('Invalid reconnect token.');
      if (!isValidColor(raw.color)) return fail('Invalid bike colour.');
      return {
        ok: true,
        value: {
          type: raw.type,
          name: sanitizeNickname(raw.name),
          color: raw.color.toLowerCase(),
          token: raw.token ?? null,
        },
      };
    }
    case CLIENT_MSG.CREATE_ROOM: {
      if (raw.color != null && !isValidColor(raw.color)) return fail('Invalid bike colour.');
      return {
        ok: true,
        value: {
          type: raw.type,
          name: raw.name == null ? null : sanitizeNickname(raw.name),
          color: raw.color ? raw.color.toLowerCase() : null,
        },
      };
    }
    case CLIENT_MSG.JOIN_ROOM: {
      if (!isValidRoomCode(raw.code)) return fail('Room code must be four characters (no I, O, 0 or 1).');
      if (raw.color != null && !isValidColor(raw.color)) return fail('Invalid bike colour.');
      return {
        ok: true,
        value: {
          type: raw.type,
          code: raw.code,
          name: raw.name == null ? null : sanitizeNickname(raw.name),
          color: raw.color ? raw.color.toLowerCase() : null,
        },
      };
    }
    case CLIENT_MSG.READY: {
      if (typeof raw.ready !== 'boolean') return fail('Ready flag must be boolean.');
      return { ok: true, value: { type: raw.type, ready: raw.ready } };
    }
    case CLIENT_MSG.STATE: {
      if (!isFiniteNumber(raw.progress) || raw.progress < 0 || raw.progress > RACE_DISTANCE + 700) {
        return fail('Invalid race progress.');
      }
      if (!isFiniteNumber(raw.lateral) || raw.lateral < -12 || raw.lateral > 12) return fail('Invalid lateral position.');
      if (!isFiniteNumber(raw.speed) || raw.speed < 0 || raw.speed > MAX_SPEED) return fail('Invalid speed.');
      if (!Number.isInteger(raw.lap) || raw.lap < 0 || raw.lap > RACE_CONFIG.laps) return fail('Invalid lap.');
      if (typeof raw.finished !== 'boolean') return fail('Finished flag must be boolean.');
      return {
        ok: true,
        value: {
          type: raw.type,
          progress: raw.progress,
          lateral: raw.lateral,
          speed: raw.speed,
          lap: raw.lap,
          finished: raw.finished,
        },
      };
    }
    case CLIENT_MSG.START_RACE:
    case CLIENT_MSG.LEAVE_ROOM:
    case CLIENT_MSG.LEADERBOARD:
    case CLIENT_MSG.PING:
      return { ok: true, value: { type: raw.type } };
    default:
      return fail(`Unknown message type: ${raw.type.slice(0, 24)}`);
  }
}

export function parseRoomCode(value) {
  return String(value ?? '').trim().toUpperCase();
}
