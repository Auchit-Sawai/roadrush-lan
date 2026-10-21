import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/src/RoomManager.js';

function makeSession(id, name) {
  return {
    id,
    name,
    color: '#e63946',
    roomCode: null,
    ready: false,
    messages: [],
    send(message) { this.messages.push(message); },
  };
}

function setup() {
  const manager = new RoomManager({
    leaderboard: { leaderboard: () => ({ fastest: [], wins: [], recent: [] }) },
    log: () => {},
  });
  return manager;
}

function createRoom(manager, host) {
  manager.handleMessage(host, { type: 'createRoom', name: host.name, color: host.color });
  return host.messages.findLast((message) => message.type === 'roomState').room;
}

test('creates a room and rejects duplicate or overflowing riders', () => {
  const manager = setup();
  const host = makeSession('s0', 'Host');
  const room = createRoom(manager, host);
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(room.hostId, host.id);

  const duplicate = makeSession('s1', 'host');
  manager.handleMessage(duplicate, { type: 'joinRoom', code: room.code });
  assert.equal(duplicate.roomCode, null);
  assert.ok(duplicate.messages.some((message) => message.code === 'request_rejected'));

  for (let index = 1; index < 8; index += 1) {
    const session = makeSession(`s${index + 1}`, `Rider ${index + 1}`);
    manager.handleMessage(session, { type: 'joinRoom', code: room.code });
    assert.equal(session.roomCode, room.code);
  }
  const overflow = makeSession('s9', 'Rider 9');
  manager.handleMessage(overflow, { type: 'joinRoom', code: room.code });
  assert.equal(overflow.roomCode, null);
  assert.ok(overflow.messages.some((message) => message.code === 'room_full'));
  assert.equal(manager.stats().players, 8);
});

test('an unknown room code returns a clear error', () => {
  const manager = setup();
  const guest = makeSession('s1', 'Guest');
  manager.handleMessage(guest, { type: 'joinRoom', code: 'ZZZZ' });
  assert.equal(guest.roomCode, null);
  assert.ok(guest.messages.some(
    (message) => message.type === 'error' && /not found/i.test(message.message),
  ));
});

test('only the host can start, and only when everyone is ready', () => {
  const manager = setup();
  const host = makeSession('s0', 'Host');
  const guest = makeSession('s1', 'Guest');
  const room = createRoom(manager, host);
  manager.handleMessage(guest, { type: 'joinRoom', code: room.code });

  manager.handleMessage(guest, { type: 'startRace' });
  assert.ok(guest.messages.some((message) => /host/i.test(message.message)));

  manager.handleMessage(host, { type: 'startRace' });
  assert.ok(host.messages.some((message) => /ready/i.test(message.message)));

  manager.handleMessage(host, { type: 'ready', ready: true });
  manager.handleMessage(guest, { type: 'ready', ready: true });
  manager.handleMessage(host, { type: 'startRace' });
  assert.equal(manager.rooms.get(room.code).status, 'racing');
  assert.ok(host.messages.some((message) => message.type === 'raceStarting'));
  assert.ok(guest.messages.some((message) => message.type === 'raceStarting'));

  manager.handleMessage(guest, { type: 'ready', ready: false });
  assert.ok(guest.messages.some((message) => /lobby/i.test(message.message)));
});

test('leaving the lobby closes an empty room or migrates the host', () => {
  const manager = setup();
  const host = makeSession('s0', 'Host');
  const guest = makeSession('s1', 'Guest');
  const room = createRoom(manager, host);
  manager.handleMessage(guest, { type: 'joinRoom', code: room.code });

  manager.handleMessage(host, { type: 'leaveRoom' });
  assert.equal(manager.rooms.get(room.code).hostId, guest.id);
  assert.equal(host.roomCode, null);

  manager.handleMessage(guest, { type: 'leaveRoom' });
  assert.equal(manager.rooms.has(room.code), false);
});

test('state messages are ignored outside a running race', () => {
  const manager = setup();
  const host = makeSession('s0', 'Host');
  const room = createRoom(manager, host);
  manager.handleMessage(host, {
    type: 'state',
    progress: 100,
    lateral: 0,
    speed: 40,
    lap: 1,
    finished: false,
  });
  assert.equal(manager.rooms.get(room.code).race, null);
});
