import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceManager, formatOrdinal, formatTime } from '../src/game/RaceManager.js';
import { createRacerState } from '../src/game/Physics.js';

test('times and ordinals format for the results table', () => {
  assert.equal(formatTime(0), '00:00.000');
  assert.equal(formatTime(65.123), '01:05.123');
  assert.equal(formatTime(3599.999), '59:59.999');
  assert.equal(formatTime(NaN), '--:--.---');
  assert.equal(formatOrdinal(1), '1st');
  assert.equal(formatOrdinal(2), '2nd');
  assert.equal(formatOrdinal(3), '3rd');
  assert.equal(formatOrdinal(11), '11th');
  assert.equal(formatOrdinal(22), '22nd');
});

test('lap crossing records lap times and the best lap', () => {
  const race = new RaceManager({ trackLength: 1000, laps: 2 });
  const state = createRacerState();
  race.elapsed = 10;
  state.progress = 999;
  race.recordLap(state);
  assert.equal(state.lapTimes.length, 0);

  race.elapsed = 40;
  state.progress = 1001;
  race.recordLap(state);
  assert.deepEqual(state.lapTimes, [40]);
  assert.equal(state.bestLap, 40);

  race.elapsed = 100;
  state.progress = 2001;
  race.recordLap(state);
  assert.deepEqual(state.lapTimes, [40, 60]);
  assert.equal(state.bestLap, 40);
});

test('offline results include total time and preserve unfinished rivals', () => {
  const race = new RaceManager({ trackLength: 1000, laps: 2, mode: 'offline' });
  const player = {
    name: 'Ace',
    color: '#e63946',
    state: createRacerState({ progress: 2000 }),
  };
  player.state.bestLap = 39.5;
  player.state.topSpeed = 71;
  player.state.crashCount = 1;
  const rivals = [
    {
      id: 'ai-1',
      name: 'Rex',
      color: '#4d96ff',
      state: { progress: 1990, finished: false, finishTime: null, crashCount: 0 },
    },
    {
      id: 'ai-2',
      name: 'Mika',
      color: '#ffd166',
      state: { progress: 2100, finished: true, finishTime: 88.2, crashCount: 2 },
    },
  ];

  const results = race.standOfflineResults(player, rivals, 80.5);
  assert.equal(results.totalTime, 80.5);
  assert.equal(results.placement, 1);
  assert.equal(results.totalRacers, 3);
  assert.equal(results.standings[0].isPlayer, true);
  assert.equal(results.standings[0].finishTime, 80.5);
  assert.equal(results.standings[1].name, 'Mika');
  assert.equal(results.standings[1].status, 'completed');
  assert.equal(results.standings[2].status, 'racing');
  assert.equal(race.phase, 'finished');
});

test('countdown ends with a start event and racing phase', () => {
  const race = new RaceManager();
  race.startCountdown(1);
  const events = [];
  for (let i = 0; i < 90; i += 1) {
    race.update(1 / 60);
    events.push(...race.events);
  }
  assert.ok(events.some((event) => event.type === 'go'));
  assert.equal(race.phase, 'racing');
});
