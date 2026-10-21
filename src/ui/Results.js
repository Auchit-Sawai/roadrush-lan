import { formatOrdinal, formatTime } from '../game/RaceManager.js';

function byId(id) {
  return document.getElementById(id);
}

export class Results {
  constructor(callbacks = {}) {
    this.root = byId('results-screen');
    this.eyebrow = byId('results-eyebrow');
    this.title = byId('results-title');
    this.badge = byId('results-badge');
    this.subtitle = byId('results-subtitle');
    this.time = byId('results-time');
    this.lap = byId('results-lap');
    this.speed = byId('results-speed');
    this.crashes = byId('results-crashes');
    this.takedowns = byId('results-takedowns');
    this.standings = byId('results-standings');
    this.note = byId('results-note');
    this.restartButton = byId('results-restart');
    this.menuButton = byId('results-menu');
    this.lanButton = byId('results-lan');
    this.callbacks = callbacks;
    this.restartButton.addEventListener('click', () => this.callbacks.onRestart?.());
    this.menuButton.addEventListener('click', () => this.callbacks.onMenu?.());
    this.lanButton.addEventListener('click', () => this.callbacks.onLAN?.());
  }

  show(data, options = {}) {
    const placement = data.placement;
    this.eyebrow.textContent = options.waiting
      ? 'FINISH LINE · AWAITING SERVER'
      : options.lan
        ? 'LAN RACE COMPLETE'
        : 'RACE COMPLETE';
    this.title.textContent = placement ? `${formatOrdinal(placement)} Place` : 'Race Finished';
    this.badge.textContent = placement ? String(placement) : '—';
    this.subtitle.textContent = `Sunset Ridge · ${options.lan ? 'LAN race' : 'Two laps'} · ${data.totalRacers ?? 0} riders`;
    this.time.textContent = data.totalTime ? formatTime(data.totalTime) : '--:--.---';
    this.lap.textContent = data.bestLap ? formatTime(data.bestLap) : '--:--.---';
    this.speed.textContent = data.topSpeed ? `${Math.round(data.topSpeed * 3.6)} km/h` : '—';
    this.crashes.textContent = String(data.crashes ?? 0);
    this.takedowns.textContent = String(data.takedowns ?? 0);

    const standings = data.standings ?? [];
    this.standings.replaceChildren();
    for (const entry of standings) {
      const row = document.createElement('tr');
      if (entry.isPlayer) row.classList.add('is-player');

      const pos = document.createElement('td');
      pos.textContent = entry.position ? String(entry.position) : '—';
      const rider = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = 'rider-dot';
      dot.style.background = entry.color || '#93a4b6';
      rider.append(dot, document.createTextNode(entry.name || 'Rider'));
      const time = document.createElement('td');
      if (entry.status === 'dnf') time.textContent = 'DNF';
      else if (Number.isFinite(entry.finishTime)) time.textContent = formatTime(entry.finishTime);
      else if (entry.status === 'racing') time.textContent = 'RACING';
      else time.textContent = '—';

      row.append(pos, rider, time);
      this.standings.append(row);
    }

    this.note.textContent = options.note || '';
    this.restartButton.classList.toggle('hidden', Boolean(options.lan));
    this.lanButton.classList.toggle('hidden', !options.lan);
    this.menuButton.classList.toggle('hidden', Boolean(options.lan));
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }
}
