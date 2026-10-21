import { RACE_CONFIG, TRACK_LENGTH } from '../../shared/track.js';

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---';
  const totalMillis = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMillis / 60_000);
  const secs = Math.floor((totalMillis % 60_000) / 1000);
  const millis = totalMillis % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatOrdinal(position) {
  const suffix = position % 10 === 1 && position % 100 !== 11
    ? 'st'
    : position % 10 === 2 && position % 100 !== 12
      ? 'nd'
      : position % 10 === 3 && position % 100 !== 13
        ? 'rd'
        : 'th';
  return `${position}${suffix}`;
}

export class RaceManager {
  constructor(options = {}) {
    this.laps = options.laps ?? RACE_CONFIG.laps;
    this.trackLength = options.trackLength ?? TRACK_LENGTH;
    this.finishDistance = this.trackLength * this.laps;
    this.mode = options.mode ?? 'offline';
    this.reset();
  }

  reset() {
    this.phase = 'idle';
    this.countdown = 0;
    this.lastCountdownNumber = null;
    this.elapsed = 0;
    this.playerFinishTime = null;
    this.playerPlacement = null;
    this.results = null;
    this.events = [];
  }

  startCountdown(seconds = 3.6) {
    this.phase = 'countdown';
    this.countdown = seconds;
    this.elapsed = 0;
    this.lastCountdownNumber = null;
  }

  forceStart() {
    this.phase = 'racing';
    this.countdown = 0;
  }

  update(dt) {
    this.events.length = 0;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const number = Math.ceil(this.countdown);
      if (number !== this.lastCountdownNumber) {
        this.lastCountdownNumber = number;
        if (number > 0) this.events.push({ type: 'countdown', value: number });
      }
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.countdown = 0;
        this.elapsed = 0;
        this.events.push({ type: 'go' });
      }
    } else if (this.phase === 'racing') {
      this.elapsed += dt;
    }
    return this.events;
  }

  progressFraction(progress) {
    return Math.max(0, Math.min(1, progress / this.finishDistance));
  }

  lapNumber(progress) {
    return Math.min(this.laps, Math.floor(progress / this.trackLength) + 1);
  }

  recordLap(state) {
    const lapIndex = Math.floor(state.progress / this.trackLength);
    if (lapIndex > state.lastLapIndex) {
      const lapTime = this.elapsed - state.lapStartTime;
      state.lastLapIndex = lapIndex;
      state.lapStartTime = this.elapsed;
      if (lapTime > 0.5 && lapTime < 600) {
        state.lapTimes.push(lapTime);
        if (state.bestLap == null || lapTime < state.bestLap) state.bestLap = lapTime;
      }
      return lapTime;
    }
    return null;
  }

  standOfflineResults(player, aiRacers, playerFinishTime = player.state.finishTime) {
    this.playerFinishTime = playerFinishTime;
    const standings = [
      {
        id: 'player',
        name: player.name,
        color: player.color,
        progress: player.state.progress,
        finished: true,
        finishTime: playerFinishTime,
        status: 'completed',
        isPlayer: true,
        crashes: player.state.crashCount,
      },
      ...aiRacers.map((ai) => ({
        id: ai.id,
        name: ai.name,
        color: ai.color,
        progress: ai.state.progress,
        finished: ai.state.finished,
        finishTime: ai.state.finishTime,
        status: ai.state.finished ? 'completed' : 'racing',
        isPlayer: false,
        crashes: ai.state.crashCount,
      })),
    ];

    standings.sort((a, b) => {
      if (a.finished && b.finished) return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });

    const placement = standings.findIndex((entry) => entry.isPlayer) + 1;
    this.playerPlacement = placement;
    this.phase = 'finished';
    this.results = {
      mode: this.mode,
      placement,
      totalRacers: standings.length,
      totalTime: playerFinishTime,
      bestLap: player.state.bestLap,
      topSpeed: player.state.topSpeed,
      crashes: player.state.crashCount,
      takedowns: player.state.takedowns ?? 0,
      standings,
    };
    return this.results;
  }
}
