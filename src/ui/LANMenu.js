import { NetworkClient, defaultServerAddress, normalizeServerUrl } from '../networking/NetworkClient.js';
import { formatTime } from '../game/RaceManager.js';
import { parseRoomCode, sanitizeNickname } from '../../shared/protocol.js';

function byId(id) {
  return document.getElementById(id);
}

export class LANMenu {
  constructor(options) {
    this.settings = options.settings;
    this.callbacks = options.callbacks ?? {};
    this.root = byId('lan-screen');
    this.serverInput = byId('lan-server');
    this.connectButton = byId('lan-connect');
    this.status = byId('lan-status');
    this.actions = byId('lan-actions');
    this.badge = byId('lan-net-badge');
    this.createButton = byId('lan-create');
    this.joinButton = byId('lan-join');
    this.codeInput = byId('lan-code');
    this.lobby = byId('lan-lobby');
    this.lobbyCode = byId('lobby-code');
    this.lobbyPlayers = byId('lobby-players');
    this.lobbyStatus = byId('lobby-status');
    this.readyButton = byId('lobby-ready');
    this.startButton = byId('lobby-start');
    this.leaveButton = byId('lobby-leave');
    this.leaderboard = byId('leaderboard-times');
    this.refreshButton = byId('refresh-leaderboard');
    this.session = null;
    this.room = null;
    this.token = null;
    this.busy = false;

    const serverParam = new URLSearchParams(location.search).get('server');
    if (serverParam) this.serverInput.value = serverParam;

    byId('lan-back').addEventListener('click', () => this.callbacks.onBack?.());
    this.connectButton.addEventListener('click', () => this.connect());
    this.createButton.addEventListener('click', () => this.createRoom());
    this.joinButton.addEventListener('click', () => this.joinRoom());
    this.readyButton.addEventListener('click', () => this.toggleReady());
    this.startButton.addEventListener('click', () => this.startRace());
    this.leaveButton.addEventListener('click', () => this.leaveRoom());
    this.refreshButton.addEventListener('click', () => this.session?.requestLeaderboard());

    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 4);
    });
    this.codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.joinRoom();
    });
    this.serverInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.connect();
    });
  }

  open() {
    this.root.classList.remove('hidden');
    if (!this.serverInput.value) this.serverInput.value = defaultServerAddress();
    if (this.session?.connected) {
      this.badge.textContent = 'CONNECTED';
      this.badge.className = 'net-badge online';
      this.actions.classList.remove('hidden');
      if (this.room) this.renderRoom(this.room);
    }
    this.refreshButton.disabled = !this.session?.connected;
  }

  hide() {
    this.root.classList.add('hidden');
  }

  shutdown() {
    try {
      this.session?.leaveRoom();
      this.session?.close();
    } catch {
      // ignore
    }
    this.session = null;
    this.room = null;
    this.token = null;
    this.root.classList.add('hidden');
    this.actions.classList.add('hidden');
    this.lobby.classList.add('hidden');
    this.setBadge('NOT CONNECTED', '');
    this.connectButton.disabled = false;
    this.connectButton.textContent = 'CONNECT';
    this.setStatus('Not connected.');
  }

  isVisible() {
    return !this.root.classList.contains('hidden');
  }

  setStatus(text, isError = false) {
    this.status.textContent = text;
    this.status.style.color = isError ? 'var(--red)' : 'var(--gold)';
  }

  setBadge(text, state = '') {
    this.badge.textContent = text;
    this.badge.className = `net-badge ${state}`.trim();
  }

  async connect() {
    if (this.busy) return;
    let url;
    try {
      url = normalizeServerUrl(this.serverInput.value || defaultServerAddress());
    } catch (error) {
      this.setStatus(error.message, true);
      return;
    }
    this.busy = true;
    this.connectButton.disabled = true;
    this.connectButton.textContent = 'CONNECTING…';
    this.setBadge('CONNECTING', '');
    this.setStatus(`Connecting to ${url} …`);
    this.session?.close();

    const session = new NetworkClient({
      url,
      name: sanitizeNickname(this.settings.nickname),
      color: this.settings.color,
      token: this.token,
    });
    this.session = session;
    this.bindSession(session);

    try {
      await session.connect();
      this.token = session.token;
      this.setBadge('CONNECTED', 'online');
      this.setStatus(`Connected as ${sanitizeNickname(this.settings.nickname)}. Create or join a room.`);
      this.actions.classList.remove('hidden');
      this.connectButton.textContent = 'CONNECTED';
      this.refreshButton.disabled = false;
      session.requestLeaderboard();
      if (this.callbacks.onConnected) this.callbacks.onConnected(session);
    } catch (error) {
      this.setBadge('ERROR', 'error');
      this.setStatus(error.message, true);
      this.connectButton.textContent = 'CONNECT';
      this.connectButton.disabled = false;
      this.actions.classList.add('hidden');
      this.session = null;
      this.callbacks.onToast?.(error.message);
    } finally {
      this.busy = false;
    }
  }

  bindSession(session) {
    session.on('welcome', (message) => {
      if (this.callbacks.onToast) this.callbacks.onToast(`Connected to LAN server ${message.serverVersion || ''}`.trim());
    });
    session.on('roomState', (message) => {
      this.busy = false;
      this.room = message.room ?? null;
      if (this.room) {
        this.renderRoom(this.room);
        this.setStatus(`Room ${this.room.code}. Share the code with your riders.`);
      } else {
        this.hideLobby();
        this.setStatus('Left the room.');
      }
    });
    session.on('raceStarting', (message) => {
      this.setStatus('Race starting…');
      this.callbacks.onRaceStart?.(session, message);
    });
    session.on('leaderboard', (message) => this.renderLeaderboard(message));
    session.on('error', (message) => {
      const text = message.message || 'Server rejected the request.';
      this.setStatus(text, true);
      this.callbacks.onToast?.(text);
      this.busy = false;
      this.connectButton.disabled = false;
    });
    session.on('disconnected', (message) => {
      this.setBadge('DISCONNECTED', 'error');
      this.setStatus(message.reason || 'Disconnected from the host.', true);
      this.actions.classList.add('hidden');
      this.hideLobby();
      this.room = null;
      this.connectButton.disabled = false;
      this.connectButton.textContent = 'RECONNECT';
      this.refreshButton.disabled = true;
      this.callbacks.onDisconnected?.(message);
    });
  }

  createRoom() {
    if (!this.session?.connected) return;
    this.busy = true;
    this.session.createRoom(sanitizeNickname(this.settings.nickname), this.settings.color);
    this.setStatus('Creating room…');
  }

  joinRoom() {
    if (!this.session?.connected) return;
    const code = parseRoomCode(this.codeInput.value);
    if (code.length !== 4) {
      this.setStatus('Enter the four-character room code.', true);
      return;
    }
    this.busy = true;
    this.session.joinRoom(code, sanitizeNickname(this.settings.nickname), this.settings.color);
    this.setStatus(`Joining room ${code}…`);
  }

  toggleReady() {
    if (!this.session?.connected || !this.room) return;
    const me = this.room.players.find((player) => player.id === this.session.playerId);
    if (!me) return;
    this.session.setReady(!me.ready);
  }

  startRace() {
    if (!this.session?.connected || !this.room) return;
    this.startButton.disabled = true;
    this.session.startRace();
    this.setStatus('Starting race…');
  }

  leaveRoom() {
    this.session?.leaveRoom();
    this.room = null;
    this.hideLobby();
  }

  hideLobby() {
    this.lobby.classList.add('hidden');
    this.actions.classList.remove('hidden');
    this.startButton.disabled = false;
  }

  renderRoom(room) {
    const me = room.players.find((player) => player.id === this.session?.playerId);
    const isHost = this.session?.playerId === room.hostId;
    const allReady = room.players.length > 0 && room.players.every((player) => player.ready);
    this.lobby.classList.remove('hidden');
    this.actions.classList.add('hidden');
    this.lobbyCode.textContent = room.code;
    this.lobbyPlayers.replaceChildren();
    room.players.forEach((player) => {
      const item = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'rider-dot';
      dot.style.background = player.color;
      const name = document.createElement('span');
      name.textContent = player.name + (player.id === this.session?.playerId ? ' (you)' : '');
      item.append(dot, name);
      if (player.id === room.hostId) {
        const host = document.createElement('span');
        host.className = 'host-tag';
        host.textContent = 'HOST';
        item.append(host);
      }
      const ready = document.createElement('span');
      ready.className = `ready-tag ${player.ready ? 'ready' : ''}`;
      ready.textContent = player.ready ? 'READY' : 'WAITING';
      item.append(ready);
      this.lobbyPlayers.append(item);
    });

    this.readyButton.textContent = me?.ready ? 'NOT READY' : 'READY';
    this.readyButton.className = me?.ready ? 'secondary' : 'primary';
    this.startButton.classList.toggle('hidden', !isHost);
    this.startButton.disabled = !allReady || room.status !== 'lobby';
    this.startButton.title = allReady ? '' : 'All riders must be ready.';
    this.lobbyStatus.textContent = `${room.players.length}/8 riders · ${
      room.status === 'racing' ? 'race in progress' : allReady ? 'all ready' : 'waiting for ready'
    }`;
    if (this.callbacks.onRoomChange) this.callbacks.onRoomChange(room);
  }

  renderLeaderboard(message) {
    this.leaderboard.replaceChildren();
    const fastest = Array.isArray(message.fastest) ? message.fastest : [];
    const wins = Array.isArray(message.wins) ? message.wins : [];
    if (fastest.length === 0 && wins.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No completed LAN races yet. Finish a race to seed the board.';
      this.leaderboard.append(empty);
      return;
    }

    if (fastest.length) {
      const label = document.createElement('p');
      label.className = 'eyebrow';
      label.textContent = 'FASTEST COMPLETED TIMES';
      this.leaderboard.append(label);
      fastest.slice(0, 6).forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = String(index + 1).padStart(2, '0');
        const name = document.createElement('span');
        name.textContent = entry.name;
        const time = document.createElement('strong');
        time.textContent = formatTime(entry.finishTime);
        row.append(rank, name, time);
        this.leaderboard.append(row);
      });
    }

    if (wins.length) {
      const label = document.createElement('p');
      label.className = 'eyebrow';
      label.style.marginTop = '12px';
      label.textContent = 'ALL-TIME WINS';
      this.leaderboard.append(label);
      wins.slice(0, 4).forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = '★';
        const name = document.createElement('span');
        name.textContent = entry.name;
        const count = document.createElement('strong');
        count.textContent = `${entry.wins}W`;
        row.append(rank, name, count);
        this.leaderboard.append(row);
      });
    }
  }
}
