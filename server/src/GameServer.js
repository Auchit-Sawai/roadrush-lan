import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  SERVER_MSG,
  SERVER_VERSION,
  validateClientMessage,
} from '../../shared/protocol.js';
import { LeaderboardRepository } from './LeaderboardRepository.js';
import { RoomManager } from './RoomManager.js';
import { createStaticHandler } from './staticServer.js';

const HELLO_TIMEOUT_MS = 12_000;
const MESSAGE_BURST = 120;
const MESSAGE_WINDOW_MS = 1000;
const MIN_STATE_GAP_MS = 30;
const HEARTBEAT_MS = 30_000;

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

export class GameServer {
  constructor(options = {}) {
    this.log = options.log ?? ((message) => console.log(message));
    this.webRoot = options.webRoot;
    this.repo = new LeaderboardRepository(options.dbPath ?? ':memory:');
    this.rooms = new RoomManager({ leaderboard: this.repo, log: this.log });
    this.staticHandler = createStaticHandler(this.webRoot);
    this.sessions = new Set();
    this.startedAt = Date.now();
    this.closing = false;

    this.httpServer = createServer((request, response) => {
      this.handleHttp(request, response).catch((error) => {
        this.log(`http error: ${error.message}`);
        if (!response.headersSent) json(response, 500, { error: 'Internal server error' });
        else response.end();
      });
    });

    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
    this.httpServer.on('upgrade', (request, socket, head) => {
      let pathname;
      try {
        pathname = new URL(request.url, 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    this.heartbeat = setInterval(() => {
      for (const session of this.sessions) {
        if (session.ws.isAlive === false) {
          session.ws.terminate();
          continue;
        }
        session.ws.isAlive = false;
        try {
          session.ws.ping();
        } catch {
          // The close event cleans up.
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  async handleHttp(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/health') {
      json(response, 200, {
        ok: true,
        serverVersion: SERVER_VERSION,
        protocol: PROTOCOL_VERSION,
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        ...this.rooms.stats(),
      });
      return;
    }
    if (url.pathname === '/api/leaderboard') {
      const limit = Number(url.searchParams.get('limit') ?? 10);
      json(response, 200, {
        trackId: url.searchParams.get('track') ?? 'sunset-ridge',
        ...this.repo.leaderboard(limit),
      });
      return;
    }
    await this.staticHandler(request, response);
  }

  handleConnection(ws) {
    const session = {
      id: `c_${randomUUID()}`,
      token: randomBytes(24).toString('base64url'),
      name: 'Rider',
      color: '#e63946',
      roomCode: null,
      ready: false,
      helloed: false,
      messageTimes: [],
      lastStateAt: 0,
      ws,
      send: (message) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(message));
      },
    };
    this.sessions.add(session);
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const helloTimeout = setTimeout(() => {
      if (!session.helloed) ws.close(1008, 'hello required');
    }, HELLO_TIMEOUT_MS);
    helloTimeout.unref?.();

    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        ws.close(1003, 'text messages only');
        return;
      }
      const size = Buffer.byteLength(raw);
      if (size > MAX_MESSAGE_BYTES) {
        ws.close(1009, 'message too large');
        return;
      }
      const now = Date.now();
      session.messageTimes = session.messageTimes.filter((stamp) => now - stamp < MESSAGE_WINDOW_MS);
      session.messageTimes.push(now);
      if (session.messageTimes.length > MESSAGE_BURST) {
        ws.close(1008, 'message rate exceeded');
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        session.send({ type: SERVER_MSG.ERROR, code: 'bad_json', message: 'Message must be valid JSON.' });
        return;
      }
      const checked = validateClientMessage(parsed);
      if (!checked.ok) {
        session.send({ type: SERVER_MSG.ERROR, code: 'invalid_message', message: checked.error });
        return;
      }
      const message = checked.value;

      if (!session.helloed) {
        if (message.type !== 'hello') {
          ws.close(1008, 'hello required');
          return;
        }
        session.helloed = true;
        session.name = message.name;
        session.color = message.color;
        session.send({
          type: SERVER_MSG.WELCOME,
          playerId: session.id,
          token: session.token,
          protocol: PROTOCOL_VERSION,
          serverVersion: SERVER_VERSION,
          serverTime: now,
        });
        this.log(`connection ${session.id} hello as ${session.name}`);
        return;
      }

      if (message.type === 'state') {
        if (now - session.lastStateAt < MIN_STATE_GAP_MS) return;
        session.lastStateAt = now;
        this.rooms.handleState(session, message);
        return;
      }
      if (message.type === 'ping') {
        session.send({ type: SERVER_MSG.PONG, serverTime: now });
        return;
      }
      this.rooms.handleMessage(session, message);
    });

    ws.on('close', () => {
      clearTimeout(helloTimeout);
      this.sessions.delete(session);
      if (!this.closing) this.rooms.disconnect(session);
    });
    ws.on('error', () => {
      // The close handler performs cleanup.
    });
  }

  listen(port = 8787, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        this.httpServer.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.httpServer.off('error', onError);
        this.rooms.start();
        resolve(this.httpServer.address());
      };
      this.httpServer.once('error', onError);
      this.httpServer.once('listening', onListening);
      this.httpServer.listen(port, host);
    });
  }

  close() {
    this.closing = true;
    clearInterval(this.heartbeat);
    this.rooms.stop();
    for (const session of this.sessions) {
      try {
        session.ws.terminate();
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
    this.wss.close();
    return new Promise((resolve) => {
      this.httpServer.close(() => {
        this.repo.close();
        resolve();
      });
      setTimeout(() => {
        this.repo.close();
        resolve();
      }, 1500).unref?.();
    });
  }
}
