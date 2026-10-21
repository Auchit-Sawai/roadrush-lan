import { formatTime } from '../game/RaceManager.js';

function byId(id) {
  return document.getElementById(id);
}

export class HUD {
  constructor() {
    this.root = byId('hud');
    this.position = byId('hud-position');
    this.lap = byId('hud-lap');
    this.time = byId('hud-time');
    this.speed = byId('hud-speed');
    this.progress = byId('hud-progress');
    this.boost = byId('hud-boost');
    this.best = byId('hud-best');
    this.lapTime = byId('hud-lap-time');
    this.battles = byId('hud-battles');
    this.countdown = byId('countdown');
    this.crash = byId('crash-banner');
    this.healthFill = byId('hud-health');
    this.damage = byId('damage-flash');
    this.announcer = byId('announcer');
    this.announceTimer = null;
    this.cache = {};
    this.rivalsText = 'RIVALS';
    this.countdownTimer = null;
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  reset() {
    this.cache = {};
    this.countdown.classList.add('hidden');
    this.crash.classList.add('hidden');
    this.setCountdown(null);
    this.setCrash(false);
    this.announcer.className = 'announcer';
    this.healthFill.style.width = '100%';
    this.healthFill.classList.remove('low');
  }

  setRivals(text) {
    this.rivalsText = text;
    this.battles.textContent = text;
  }

  setCountdown(value, mode = 'count') {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (value == null) {
      this.countdown.classList.add('hidden');
      return;
    }
    this.countdown.textContent = value;
    this.countdown.classList.remove('hidden');
    this.countdown.classList.toggle('go', mode === 'go');
    this.countdown.style.animation = 'none';
    void this.countdown.offsetWidth;
    this.countdown.style.animation = '';
    if (mode === 'go') {
      this.countdownTimer = setTimeout(() => {
        this.countdown.classList.add('hidden');
      }, 850);
    }
  }

  setHealth(value) {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    if (this.cache.health === pct) return;
    this.cache.health = pct;
    this.healthFill.style.width = pct + '%';
    this.healthFill.classList.toggle('low', pct < 35);
  }

  flashDamage() {
    this.damage.classList.remove('hit');
    void this.damage.offsetWidth;
    this.damage.classList.add('hit');
  }

  announce(text, size = 'small') {
    this.announcer.textContent = text;
    this.announcer.className = 'announcer ' + size;
    void this.announcer.offsetWidth;
    this.announcer.classList.add('show');
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => this.announcer.classList.remove('show'), size === 'big' ? 1700 : 800);
  }

  setCrash(visible) {
    this.crash.classList.toggle('hidden', !visible);
  }

  update(data) {
    const values = {
      position: `${data.position} / ${data.total}`,
      lap: `${data.lap} / ${data.laps}`,
      time: formatTime(data.elapsed),
      speed: String(Math.round(data.speedKph)),
      best: data.bestLap ? formatTime(data.bestLap) : '--:--.---',
      lapTime: `LAP ${formatTime(data.lapTime)}`,
      progress: `${(data.progress * 100).toFixed(1)}%`,
      boost: `${Math.round(data.boost)}%`,
      battles: `${this.rivalsText} · ${Math.round(data.fps ?? 0)} FPS`,
    };
    if (this.cache.position !== values.position) this.position.textContent = values.position;
    if (this.cache.lap !== values.lap) this.lap.textContent = values.lap;
    if (this.cache.time !== values.time) this.time.textContent = values.time;
    if (this.cache.speed !== values.speed) this.speed.textContent = values.speed;
    if (this.cache.best !== values.best) this.best.textContent = values.best;
    if (this.cache.lapTime !== values.lapTime) this.lapTime.textContent = values.lapTime;
    if (this.cache.progress !== values.progress) this.progress.style.width = values.progress;
    if (this.cache.boost !== values.boost) this.boost.style.width = values.boost;
    if (this.cache.battles !== values.battles) this.battles.textContent = values.battles;
    this.cache = values;
  }
}
