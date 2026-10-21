import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LeaderboardRepository } from '../server/src/LeaderboardRepository.js';

function tempDb(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'roadrush-db-'));
  return path.join(dir, 'test.sqlite');
}

const meta = (overrides = {}) => ({
  trackId: 'sunset-ridge',
  createdAt: 1_700_000_000_000,
  startedAt: 1_700_000_010_000,
  endedAt: 1_700_000_090_000,
  status: 'completed',
  ...overrides,
});

const result = (overrides = {}) => ({
  name: 'Ace',
  position: 1,
  finishTime: 80,
  status: 'completed',
  bestLap: 39,
  ...overrides,
});

test('records a race and exposes fastest, wins and recent tables', (t) => {
  const repo = new LeaderboardRepository(tempDb(t));
  t.after(() => repo.close());

  repo.recordRace(meta(), [
    result(),
    result({ name: 'Rex', position: 2, finishTime: 82.5, bestLap: 40 }),
  ]);
  repo.recordRace(meta({ endedAt: 1_700_000_180_000 }), [
    result({ name: 'Rex', finishTime: 79, bestLap: 38.5 }),
    result({ name: 'Ace', position: 2, finishTime: 81, bestLap: 39.5 }),
  ]);

  const board = repo.leaderboard(10);
  assert.equal(board.fastest.length, 2);
  assert.equal(board.fastest[0].name, 'Rex');
  assert.equal(board.fastest[0].finishTime, 79);
  assert.equal(board.fastest[1].name, 'Ace');
  assert.equal(board.fastest[1].finishTime, 80);

  assert.equal(board.wins.length, 2);
  assert.equal(board.wins[0].wins, 1);

  assert.equal(board.recent.length, 2);
  assert.equal(board.recent[0].playerCount, 2);
  assert.equal(board.recent[0].trackId, 'sunset-ridge');
});

test('unfinished results stay out of the fastest table', (t) => {
  const repo = new LeaderboardRepository(tempDb(t));
  t.after(() => repo.close());

  repo.recordRace(meta(), [
    result(),
    result({ name: 'Ghost', position: 2, finishTime: null, status: 'racing' }),
  ]);

  const board = repo.leaderboard(10);
  assert.deepEqual(board.fastest.map((row) => row.name), ['Ace']);
  assert.equal(board.wins.length, 1);
  assert.equal(board.recent[0].playerCount, 2);
});

test('leaderboard survives reopening the database', (t) => {
  const file = tempDb(t);
  const first = new LeaderboardRepository(file);
  first.recordRace(meta(), [result()]);
  first.close();

  const second = new LeaderboardRepository(file);
  t.after(() => second.close());
  assert.equal(second.leaderboard(10).fastest[0].name, 'Ace');
});

test('a failed insert rolls back instead of leaving a partial race', (t) => {
  const repo = new LeaderboardRepository(tempDb(t));
  t.after(() => repo.close());
  assert.throws(() => repo.recordRace(meta(), undefined));
  assert.equal(repo.leaderboard(10).recent.length, 0);
});

test('limit is clamped to a safe range', (t) => {
  const repo = new LeaderboardRepository(tempDb(t));
  t.after(() => repo.close());
  repo.recordRace(meta(), [result()]);
  assert.equal(repo.leaderboard(0).fastest.length, 1);
  assert.equal(repo.leaderboard(9999).recent.length, 1);
});
