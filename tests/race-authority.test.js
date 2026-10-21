import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTDOWN_MS,
  FINISH_GRACE_MS,
  RaceAuthority,
} from '../server/src/RaceAuthority.js';
import { RACE_DISTANCE } from '../shared/track.js';

function makeRoom() {
  const players = new Map();
  for (const id of ['a', 'b']) {
    players.set(id, {
      id,
      name: id.toUpperCase(),
      color: id === 'a' ? '#e63946' : '#4d96ff',
      race: null,
    });
  }
  return { code: 'TEST', players };
}

function setup() {
  let clock = 1_000;
  const messages = [];
  let results = null;
  let resultsMeta = null;
  const room = makeRoom();
  const race = new RaceAuthority(room, {
    now: () => clock,
    broadcast: (message) => messages.push(message),
    onResults: (standings, meta) => {
      results = standings;
      resultsMeta = meta;
    },
    log: () => {},
  });
  return {
    room,
    race,
    messages,
    advance(ms) { clock += ms; },
    get clock() { return clock; },
    get results() { return results; },
    get resultsMeta() { return resultsMeta; },
  };
}

const state = (overrides = {}) => ({
  progress: 0,
  lateral: 0,
  speed: 0,
  finished: false,
  ...overrides,
});

test('countdown gives a start time in the future', () => {
  const ctx = setup();
  ctx.race.start();
  assert.equal(ctx.race.startAt, 1_000 + COUNTDOWN_MS);
  const startMessage = ctx.messages.find((message) => message.type === 'raceStarting');
  assert.ok(startMessage);
  assert.equal(startMessage.players.length, 2);
  assert.equal(ctx.room.players.get('a').race.progress, 0);
});

test('states before the race are ignored and progress is monotonic', () => {
  const ctx = setup();
  ctx.race.start();
  ctx.advance(1_000);
  assert.equal(ctx.race.handleState(ctx.room.players.get('a'), state({ progress: 10 })), false);
  ctx.advance(COUNTDOWN_MS);
  assert.equal(ctx.race.handleState(ctx.room.players.get('a'), state({ progress: 100 })), true);
  assert.equal(ctx.race.handleState(ctx.room.players.get('a'), state({ progress: 40 })), false);
  assert.equal(ctx.room.players.get('a').race.progress, 100);
});

test('finishing too early or short is rejected', () => {
  const ctx = setup();
  ctx.race.start();
  ctx.advance(COUNTDOWN_MS + 10_000);
  assert.equal(
    ctx.race.handleState(ctx.room.players.get('a'), state({ progress: RACE_DISTANCE, finished: true })),
    false,
  );
  ctx.advance(30_000);
  assert.equal(
    ctx.race.handleState(ctx.room.players.get('a'), state({ progress: RACE_DISTANCE - 100, finished: true })),
    false,
  );
});

test('two valid finishes produce ordered results and persistable metadata', () => {
  const ctx = setup();
  ctx.race.start();
  ctx.advance(COUNTDOWN_MS + 1_000);
  ctx.race.handleState(ctx.room.players.get('a'), state({ progress: RACE_DISTANCE - 10 }));
  ctx.race.handleState(ctx.room.players.get('b'), state({ progress: RACE_DISTANCE - 20 }));

  ctx.advance(39_000);
  assert.equal(
    ctx.race.handleState(ctx.room.players.get('a'), state({ progress: RACE_DISTANCE, finished: true })),
    true,
  );
  assert.equal(ctx.room.players.get('a').race.finishTime, 40);
  assert.equal(ctx.results, null);

  ctx.advance(2_000);
  assert.equal(
    ctx.race.handleState(ctx.room.players.get('b'), state({ progress: RACE_DISTANCE, finished: true })),
    true,
  );
  assert.equal(ctx.room.players.get('b').race.finishTime, 42);
  assert.ok(ctx.results);
  assert.deepEqual(ctx.results.map((row) => row.name), ['A', 'B']);
  assert.deepEqual(ctx.results.map((row) => row.status), ['completed', 'completed']);
  assert.equal(ctx.resultsMeta.reason, 'completed');
  assert.ok(ctx.messages.some((message) => message.type === 'playerFinished'));
});

test('a disconnected rider is marked and can end an abandoned race', () => {
  const ctx = setup();
  ctx.race.start();
  ctx.advance(COUNTDOWN_MS + 1_000);
  ctx.race.handleState(ctx.room.players.get('a'), state({ progress: 500 }));
  ctx.race.markDisconnected(ctx.room.players.get('a'));
  assert.equal(ctx.room.players.get('a').race.connected, false);
  assert.equal(ctx.results, null);
  ctx.race.markDisconnected(ctx.room.players.get('b'));
  assert.ok(ctx.results);
  assert.equal(ctx.resultsMeta.reason, 'abandoned');
  assert.equal(ctx.results[0].status, 'disconnected');
});

test('finish grace ends the race for riders who never arrive', () => {
  const ctx = setup();
  ctx.race.start();
  ctx.advance(COUNTDOWN_MS + 40_000);
  ctx.race.handleState(ctx.room.players.get('a'), state({ progress: RACE_DISTANCE, finished: true }));
  assert.ok(ctx.room.players.get('a').race.finished);
  ctx.advance(FINISH_GRACE_MS + 1_000);
  ctx.race.tick(0.1);
  assert.equal(ctx.race.finished, true);
  assert.equal(ctx.resultsMeta.reason, 'timeout');
  assert.equal(ctx.results.find((row) => row.name === 'B').status, 'dnf');
});
