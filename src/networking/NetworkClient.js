import { CLIENT_MSG, PROTOCOL_VERSION } from '../../shared/protocol.js';

export function normalizeServerUrl(input) {
  let text = String(input ?? '').trim();
  if (!text) throw new Error('Enter the host address.');
  if (!/^[a-z]+:\/\//i.test(text)) text = `ws://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('That server address is not valid.');
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Use a ws:// or http:// server address.');
  }
  if (!url.port && url.protocol === 'ws:') url.port = '8787';
  return `${url.protocol}//${url.host}/ws`;
}

export function defaultServerAddress() {
  try {
    if (location.protocol.startsWith('http') && location.host) {
      return location.host;
    }
  } catch {
    // Extension pages have no http origin; use localhost.
  }
  return '127.0.0.1:8787';
}

export class NetworkClient {
  constructor(options = {}) {
    this.url = normalizeServerUrl(options.url ?? defaultServerAddress());
    this.name = options.name ?? 'Rider';
    this.color = options.color ?? '#e63946';
    this.token = options.token ?? null;
    this.ws = null;
    this.listeners = new Map();
    this.playerId = null;
    this.connected = false;
    this.serverVersion = null;
    this.lastError = null;
    this._connectPromise = null;
    this._resolveConnect = null;
    this._rejectConnect = null;
    this._connectTimer = null;
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => {
      const set = this.listeners.get(type);
      if (set) set.delete(handler);
    };
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (error) {
        console.error('Network listener failed', error);
      }
    }
  }

  connect(timeoutMs = 9000) {
    if (this.connected) return Promise.resolve(this.playerId);
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = new Promise((resolve, reject) => {
      this._resolveConnect = resolve;
      this._rejectConnect = reject;
      this._connectTimer = setTimeout(() => {
        this._failConnect(new Error('Timed out connecting. Check the host address and Windows firewall.'));
        try {
          this.ws?.close();
        } catch {
          // ignore
        }
      }, timeoutMs);
      this._openSocket();
    });
    return this._connectPromise;
  }

  _openSocket() {
    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this._failConnect(new Error('Could not open a WebSocket to that address.'));
      return;
    }
    this.ws = socket;

    socket.onopen = () => {
      this.send({
        type: CLIENT_MSG.HELLO,
        name: this.name,
        color: this.color,
        token: this.token ?? undefined,
      });
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 65536) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handleMessage(message);
    };

    socket.onerror = () => {
      this.lastError = 'Connection error.';
    };

    socket.onclose = (event) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.ws = null;
      const reason = event.reason || (event.code === 1006 ? 'Host unreachable or connection refused.' : `Connection closed (${event.code}).`);
      if (!wasConnected) {
        this._failConnect(new Error(reason));
      } else {
        this.emit('disconnected', { code: event.code, reason });
      }
      this._cleanupConnect();
    };
  }

  _failConnect(error) {
    if (this._rejectConnect) {
      this.lastError = error.message;
      this._rejectConnect(error);
    }
    this._cleanupConnect();
  }

  _cleanupConnect() {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
    this._resolveConnect = null;
    this._rejectConnect = null;
    this._connectPromise = null;
  }

  _handleMessage(message) {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
    if (message.type === 'welcome') {
      if (message.protocol !== PROTOCOL_VERSION) {
        this._failConnect(new Error('Server protocol does not match this game build.'));
        this.close();
        return;
      }
      this.playerId = message.playerId;
      this.token = message.token ?? this.token;
      this.serverVersion = message.serverVersion;
      this.connected = true;
      this.lastError = null;
      if (this._resolveConnect) {
        this._resolveConnect(this.playerId);
        this._cleanupConnect();
      }
      this.emit('welcome', message);
      return;
    }
    if (message.type === 'error' && !this.connected) {
      this._failConnect(new Error(message.message || 'Server rejected the connection.'));
      return;
    }
    this.emit(message.type, message);
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  createRoom(name, color) {
    return this.send({ type: CLIENT_MSG.CREATE_ROOM, name, color });
  }

  joinRoom(code, name, color) {
    return this.send({ type: CLIENT_MSG.JOIN_ROOM, code, name, color });
  }

  setReady(ready) {
    return this.send({ type: CLIENT_MSG.READY, ready });
  }

  startRace() {
    return this.send({ type: CLIENT_MSG.START_RACE });
  }

  leaveRoom() {
    return this.send({ type: CLIENT_MSG.LEAVE_ROOM });
  }

  requestLeaderboard() {
    return this.send({ type: CLIENT_MSG.LEADERBOARD });
  }

  sendState(state) {
    return this.send({
      type: CLIENT_MSG.STATE,
      progress: state.progress,
      lateral: state.lateral,
      speed: state.speed,
      lap: state.lap,
      finished: state.finished,
    });
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close(1000, 'client closing');
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.connected = false;
    this._cleanupConnect();
  }
}
