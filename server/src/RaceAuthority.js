import { RACE_CONFIG, RACE_DISTANCE } from '../../shared/track.js';
import { SERVER_MSG, STATE_HZ } from '../../shared/protocol.js';

export const COUNTDOWN_MS = 4000;
export const MIN_FINISH_SECONDS = 35;
export const FINISH_GRACE_MS = 90_000;
export const MAX_RACE_MS = 15 * 60_000;

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
  };
}

export class RaceAuthority {
  constructor(room, options = {}) {
    this.room = room;
    this.trackId = options.trackId ?? 'sunset-ridge';
    this.broadcast = options.broadcast ?? (() => {});
    this.onResults = options.onResults ?? (() => {});
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => Date.now());
    this.startAt = 0;
    this.startedAt = 0;
    this.firstFinishAt = null;
    this.endedAt = null;
    this.finished = false;
    this.tickAccumulator = 0;
    this.tickInterval = 1 / STATE_HZ;
  }

  start() {
    const now = this.now();
    this.startAt = now + COUNTDOWN_MS;
    this.startedAt = now;
    this.finished = false;
    for (const player of this.room.players.values()) {
      player.race = {
        progress: 0,
        lateral: 0,
        speed: 0,
        finished: false,
        finishTime: null,
        finishPosition: null,
        connected: true,
      };
      player.ready = false;
    }
    this.broadcast({
      type: SERVER_MSG.RACE_STARTING,
      startAt: this.startAt,
      serverTime: now,
      trackId: this.trackId,
      laps: RACE_CONFIG.laps,
      players: [...this.room.players.values()].map(publicPlayer),
    });
  }

  handleState(player, state) {
    if (this.finished || !player.race) return false;
    const now = this.now();
    if (now < this.startAt - 1500) return false;
    const race = player.race;
    if (race.finished) return false;
    if (!Number.isFinite(state.progress) || state.progress < 0) return false;
    if (state.progress + 1.5 < race.progress) return false;
    race.progress = Math.max(race.progress, Math.min(RACE_DISTANCE + 50, state.progress));
    race.lateral = state.lateral;
    race.speed = state.speed;
    race.lastSeenAt = now;

    if (!state.finished) return true;
    if (now < this.startAt + MIN_FINISH_SECONDS * 1000) return false;
    if (race.progress < RACE_DISTANCE - 25) return false;

    race.finished = true;
    race.finishTime = (now - this.startAt) / 1000;
    race.finishPosition = [...this.room.players.values()]
      .filter((entry) => entry.race?.finished)
      .length;
    if (!this.firstFinishAt) this.firstFinishAt = now;
    this.broadcast({
      type: SERVER_MSG.PLAYER_FINISHED,
      playerId: player.id,
      finishTime: race.finishTime,
      position: race.finishPosition,
    });
    this.log(`finish ${player.name} ${race.finishTime.toFixed(2)}s P${race.finishPosition}`);
    if (this.everyoneDone()) this.finish('completed');
    return true;
  }

  markDisconnected(player) {
    if (!player.race) return;
    player.race.connected = false;
    if (!player.race.finished) player.race.dnfReason = 'disconnected';
    if (this.activePlayers().length === 0) this.finish('abandoned');
    else if (this.everyoneDone()) this.finish('completed');
  }

  activePlayers() {
    return [...this.room.players.values()].filter((player) => player.race?.connected);
  }

  everyoneDone() {
    const players = this.activePlayers();
    return players.length > 0 && players.every((player) => player.race.finished);
  }

  tick(dt) {
    if (this.finished) return;
    const now = this.now();
    if (now < this.startAt) return;
    this.tickAccumulator += dt;
    if (this.tickAccumulator < this.tickInterval) return;
    this.tickAccumulator = 0;
    this.broadcast({
      type: SERVER_MSG.RACE_STATE,
      serverTime: now,
      elapsed: Math.max(0, (now - this.startAt) / 1000),
      players: [...this.room.players.values()]
        .filter((player) => player.race)
        .map((player) => ({
          id: player.id,
          name: player.name,
          color: player.color,
          progress: player.race.progress,
          lateral: player.race.lateral,
          speed: player.race.speed,
          finished: player.race.finished,
        })),
    });

    if (this.firstFinishAt && now - this.firstFinishAt > FINISH_GRACE_MS) {
      this.finish('timeout');
    } else if (now - this.startAt > MAX_RACE_MS) {
      this.finish('timeout');
    } else if (this.everyoneDone()) {
      this.finish('completed');
    }
  }

  standings() {
    const players = [...this.room.players.values()].filter((player) => player.race);
    const finished = players
      .filter((player) => player.race.finished)
      .sort((a, b) => (a.race.finishTime ?? Infinity) - (b.race.finishTime ?? Infinity));
    const unfinished = players
      .filter((player) => !player.race.finished)
      .sort((a, b) => b.race.progress - a.race.progress);

    return [...finished, ...unfinished].map((player, index) => ({
      playerId: player.id,
      name: player.name,
      color: player.color,
      position: index + 1,
      finishTime: player.race.finished ? player.race.finishTime : null,
      status: player.race.finished
        ? 'completed'
        : player.race.connected ? 'dnf' : 'disconnected',
      progress: player.race.progress,
      isPlayer: false,
    }));
  }

  finish(reason = 'completed') {
    if (this.finished) return;
    this.finished = true;
    this.endedAt = this.now();
    const results = this.standings();
    this.log(`race ${this.room.code} finished (${reason}) with ${results.length} riders`);
    this.onResults(results, {
      reason,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    });
  }
}
