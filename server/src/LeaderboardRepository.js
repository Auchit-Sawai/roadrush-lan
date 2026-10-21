import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL COLLATE NOCASE UNIQUE,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS races (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    status TEXT NOT NULL,
    player_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS race_results (
    race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id),
    position INTEGER NOT NULL,
    finish_time REAL,
    completion_status TEXT NOT NULL,
    best_lap REAL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY (race_id, player_id)
  );

  CREATE INDEX IF NOT EXISTS idx_results_finish
    ON race_results (completion_status, finish_time);
  CREATE INDEX IF NOT EXISTS idx_results_player
    ON race_results (player_id);
  CREATE INDEX IF NOT EXISTS idx_races_track
    ON races (track_id, ended_at DESC);
`;

export class LeaderboardRepository {
  constructor(filePath = ':memory:') {
    this.filePath = filePath;
    if (filePath !== ':memory:') {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 4000;');
    this.db.exec(SCHEMA);
    this.statements = {
      playerByName: this.db.prepare('SELECT id FROM players WHERE nickname = ? COLLATE NOCASE'),
      insertPlayer: this.db.prepare(
        'INSERT INTO players (id, nickname, first_seen, last_seen) VALUES (?, ?, ?, ?)',
      ),
      updatePlayer: this.db.prepare('UPDATE players SET nickname = ?, last_seen = ? WHERE id = ?'),
      insertRace: this.db.prepare(
        `INSERT INTO races (id, track_id, created_at, started_at, ended_at, status, player_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertResult: this.db.prepare(
        `INSERT OR REPLACE INTO race_results
           (race_id, player_id, position, finish_time, completion_status, best_lap, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      fastest: this.db.prepare(
        `SELECT p.nickname AS name, MIN(rr.finish_time) AS finishTime
           FROM race_results rr
           JOIN players p ON p.id = rr.player_id
          WHERE rr.completion_status = 'completed' AND rr.finish_time IS NOT NULL
          GROUP BY p.id
          ORDER BY finishTime ASC, p.nickname ASC
          LIMIT ?`,
      ),
      wins: this.db.prepare(
        `SELECT p.nickname AS name, COUNT(*) AS wins
           FROM race_results rr
           JOIN players p ON p.id = rr.player_id
          WHERE rr.position = 1 AND rr.completion_status = 'completed'
          GROUP BY p.id
          ORDER BY wins DESC, p.nickname ASC
          LIMIT ?`,
      ),
      recent: this.db.prepare(
        `SELECT id, track_id AS trackId, started_at AS startedAt, ended_at AS endedAt,
                status, player_count AS playerCount
           FROM races ORDER BY ended_at DESC LIMIT ?`,
      ),
    };
  }

  resolvePlayer(nickname, now) {
    const existing = this.statements.playerByName.get(nickname);
    if (existing) {
      this.statements.updatePlayer.run(nickname, now, existing.id);
      return existing.id;
    }
    const id = `p_${randomUUID()}`;
    this.statements.insertPlayer.run(id, nickname, now, now);
    return id;
  }

  recordRace(meta, results) {
    const now = Date.now();
    const raceId = `r_${randomUUID()}`;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.statements.insertRace.run(
        raceId,
        meta.trackId,
        meta.createdAt ?? now,
        meta.startedAt ?? now,
        meta.endedAt ?? now,
        meta.status ?? 'completed',
        results.length,
      );
      for (const result of results) {
        const playerId = this.resolvePlayer(result.name, now);
        this.statements.insertResult.run(
          raceId,
          playerId,
          result.position,
          Number.isFinite(result.finishTime) ? result.finishTime : null,
          result.status,
          Number.isFinite(result.bestLap) ? result.bestLap : null,
          now,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return raceId;
  }

  leaderboard(limit = 10) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    return {
      fastest: this.statements.fastest.all(safeLimit),
      wins: this.statements.wins.all(Math.min(safeLimit, 10)),
      recent: this.statements.recent.all(Math.min(safeLimit, 10)),
    };
  }

  close() {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}
