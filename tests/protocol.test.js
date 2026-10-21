import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_MSG,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ROOM_CODE_REGEX,
  isValidColor,
  isValidRoomCode,
  parseRoomCode,
  sanitizeNickname,
  validateClientMessage,
} from '../shared/protocol.js';
import { RACE_CONFIG, RACE_DISTANCE } from '../shared/track.js';

test('protocol version and limits are explicit', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(MAX_MESSAGE_BYTES, 32768);
  assert.equal(RACE_CONFIG.maxPlayers, 8);
});

test('nicknames are trimmed, bounded and stripped of controls', () => {
  assert.equal(sanitizeNickname('  Ace\nRider  '), 'AceRider');
  assert.equal(sanitizeNickname('', 'Rider'), 'Rider');
  assert.equal(sanitizeNickname('x'.repeat(50)).length, 20);
});

test('room codes exclude ambiguous characters', () => {
  assert.ok(isValidRoomCode('ABCD'));
  assert.ok(isValidRoomCode('WXYZ'));
  assert.ok(!isValidRoomCode('ABCI'));
  assert.ok(!isValidRoomCode('ABC0'));
  assert.ok(!isValidRoomCode('ABC'));
  assert.equal(parseRoomCode(' abcd '), 'ABCD');
  assert.equal(ROOM_CODE_REGEX.source, '^[A-HJ-NP-Z2-9]{4}$');
});

test('colours accept only six-digit hex', () => {
  assert.ok(isValidColor('#a1B2c3'));
  assert.ok(!isValidColor('red'));
  assert.ok(!isValidColor('#fff'));
});

test('hello and room messages validate and normalise', () => {
  const hello = validateClientMessage({
    type: CLIENT_MSG.HELLO,
    name: '  Ace  ',
    color: '#E63946',
  });
  assert.ok(hello.ok);
  assert.equal(hello.value.name, 'Ace');
  assert.equal(hello.value.color, '#e63946');

  const badColor = validateClientMessage({ type: CLIENT_MSG.HELLO, color: 'blue' });
  assert.ok(!badColor.ok);

  const join = validateClientMessage({
    type: CLIENT_MSG.JOIN_ROOM,
    code: 'ABCD',
    name: 'Rider',
    color: '#4d96ff',
  });
  assert.ok(join.ok);
  assert.equal(join.value.code, 'ABCD');

  assert.ok(!validateClientMessage({ type: CLIENT_MSG.JOIN_ROOM, code: 'I0O1' }).ok);
});

test('state messages reject out-of-range or non-numeric values', () => {
  const valid = validateClientMessage({
    type: CLIENT_MSG.STATE,
    progress: 100,
    lateral: 2,
    speed: 50,
    lap: 1,
    finished: false,
  });
  assert.ok(valid.ok);

  const cases = [
    { progress: -1, lateral: 0, speed: 10, lap: 1, finished: false },
    { progress: 100, lateral: 99, speed: 10, lap: 1, finished: false },
    { progress: 100, lateral: 0, speed: 101, lap: 1, finished: false },
    { progress: 100, lateral: 0, speed: 10, lap: 5, finished: false },
    { progress: 100, lateral: 0, speed: 10, lap: 1, finished: 'yes' },
    { progress: RACE_DISTANCE + 800, lateral: 0, speed: 10, lap: 2, finished: true },
    { progress: Number.NaN, lateral: 0, speed: 10, lap: 1, finished: false },
  ];
  for (const state of cases) {
    assert.ok(!validateClientMessage({ type: CLIENT_MSG.STATE, ...state }).ok, JSON.stringify(state));
  }
});

test('unknown message types are rejected', () => {
  assert.ok(!validateClientMessage({ type: 'rm -rf' }).ok);
  assert.ok(!validateClientMessage(null).ok);
  assert.ok(!validateClientMessage([]).ok);
});
