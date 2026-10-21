import { randomInt } from 'node:crypto';
import {
  CLIENT_MSG,
  ROOM_CODE_ALPHABET,
  SERVER_MSG,
  sanitizeNickname,
} from '../../shared/protocol.js';
import { RACE_CONFIG } from '../../shared/track.js';
import { RaceAuthority } from './RaceAuthority.js';

const MAX_ROOMS = 40;
const TICK_MS = 50;

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      ready: Boolean(player.ready),
    })),
  };
}

export class RoomManager {
  constructor(options = {}) {
    this.leaderboard = options.leaderboard;
    this.log = options.log ?? ((message) => console.log(message));
    this.rooms = new Map();
    this.timer = null;
    this.lastTick = Date.now();
  }

  start() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(1, (now - this.lastTick) / 1000);
      this.lastTick = now;
      for (const room of this.rooms.values()) {
        if (room.status === 'racing' && room.race) room.race.tick(dt);
      }
    }, TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stats() {
    return {
      rooms: this.rooms.size,
      racing: [...this.rooms.values()].filter((room) => room.status === 'racing').length,
      players: [...this.rooms.values()].reduce((sum, room) => sum + room.players.size, 0),
    };
  }

  generateCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let index = 0; index < 4; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('No room codes are available right now. Try again in a moment.');
  }

  send(session, message) {
    try {
      session.send(message);
    } catch {
      // The socket closed between the broadcast and the write.
    }
  }

  fail(session, message, code = 'request_rejected') {
    this.send(session, { type: SERVER_MSG.ERROR, code, message });
  }

  broadcast(room, message, exceptSession = null) {
    for (const player of room.players.values()) {
      if (!player.session || player.session === exceptSession) continue;
      this.send(player.session, message);
    }
  }

  broadcastRoom(room) {
    this.broadcast(room, { type: SERVER_MSG.ROOM_STATE, room: publicRoom(room) });
  }

  createRoom(session, message) {
    if (session.roomCode) {
      this.fail(session, 'Leave your current room before creating another.');
      return;
    }
    if (this.rooms.size >= MAX_ROOMS) {
      this.fail(session, 'The server is hosting too many rooms right now.');
      return;
    }
    const code = this.generateCode();
    const room = {
      code,
      hostId: session.id,
      status: 'lobby',
      createdAt: Date.now(),
      race: null,
      players: new Map(),
    };
    this.rooms.set(code, room);
    this.addPlayer(room, session, message);
    this.log(`room ${code} created by ${session.name}`);
  }

  joinRoom(session, message) {
    if (session.roomCode) {
      this.fail(session, 'Leave your current room before joining another.');
      return;
    }
    const room = this.rooms.get(message.code);
    if (!room) {
      this.fail(session, 'That room code was not found on this server.');
      return;
    }
    if (room.status !== 'lobby') {
      this.fail(session, 'That race is already in progress. Wait for the lobby to reopen.');
      return;
    }
    if (room.players.size >= RACE_CONFIG.maxPlayers) {
      this.fail(session, 'That room is full (8 riders maximum).', 'room_full');
      return;
    }
    const duplicate = [...room.players.values()].find(
      (player) => player.name.toLowerCase() === session.name.toLowerCase(),
    );
    if (duplicate) {
      this.fail(session, 'Another rider in that room already uses that nickname.');
      return;
    }
    this.addPlayer(room, session, message);
  }

  addPlayer(room, session, message) {
    session.name = sanitizeNickname(message.name ?? session.name);
    session.color = message.color ?? session.color;
    session.roomCode = room.code;
    session.ready = false;
    room.players.set(session.id, {
      id: session.id,
      name: session.name,
      color: session.color,
      ready: false,
      session,
      race: null,
    });
    this.broadcastRoom(room);
    this.send(session, {
      type: SERVER_MSG.LEADERBOARD,
      ...this.leaderboard.leaderboard(8),
    });
    this.log(`${session.name} joined ${room.code} (${room.players.size}/${RACE_CONFIG.maxPlayers})`);
  }

  setReady(session, ready) {
    const room = this.requireRoom(session);
    if (!room) return;
    if (room.status !== 'lobby') {
      this.fail(session, 'Ready status can only change in the lobby.');
      return;
    }
    const player = room.players.get(session.id);
    if (!player) return;
    player.ready = ready;
    session.ready = ready;
    this.broadcastRoom(room);
  }

  startRace(session) {
    const room = this.requireRoom(session);
    if (!room) return;
    if (room.status !== 'lobby') {
      this.fail(session, 'A race is already running in this room.');
      return;
    }
    if (room.hostId !== session.id) {
      this.fail(session, 'Only the host can start the race.');
      return;
    }
    if (room.players.size < 2) {
      this.fail(session, 'At least two riders are required for a LAN race.');
      return;
    }
    const notReady = [...room.players.values()].filter((player) => !player.ready);
    if (notReady.length > 0) {
      this.fail(session, 'Every rider must be ready before the race can start.');
      return;
    }

    room.status = 'racing';
    room.race = new RaceAuthority(room, {
      log: this.log,
      broadcast: (message) => this.broadcast(room, message),
      onResults: (results, meta) => this.handleResults(room, results, meta),
    });
    this.broadcastRoom(room);
    room.race.start();
    this.log(`race started in ${room.code} with ${room.players.size} riders`);
  }

  handleResults(room, results, meta) {
    const status = results.some((result) => result.status === 'completed')
      ? 'completed'
      : 'abandoned';
    let raceId = null;
    try {
      raceId = this.leaderboard.recordRace({
        trackId: 'sunset-ridge',
        createdAt: room.createdAt,
        startedAt: meta.startedAt,
        endedAt: meta.endedAt,
        status,
      }, results);
    } catch (error) {
      this.log(`database write failed: ${error.message}`);
    }

    const payload = results.map((result) => ({
      playerId: result.playerId,
      name: result.name,
      color: result.color,
      position: result.position,
      finishTime: result.finishTime,
      status: result.status,
    }));
    this.broadcast(room, {
      type: SERVER_MSG.RACE_RESULTS,
      raceId,
      reason: meta.reason,
      results: payload,
    });
    this.broadcast(room, {
      type: SERVER_MSG.LEADERBOARD,
      ...this.leaderboard.leaderboard(8),
    });

    for (const [id, player] of [...room.players.entries()]) {
      if (!player.race?.connected) room.players.delete(id);
      else {
        player.ready = false;
        player.session.ready = false;
        player.race = null;
      }
    }
    room.race = null;
    room.status = 'lobby';
    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (!room.players.has(room.hostId)) {
      room.hostId = room.players.keys().next().value;
      this.log(`room ${room.code} host migrated to ${room.players.get(room.hostId).name}`);
    }
    this.broadcastRoom(room);
  }

  requestLeaderboard(session) {
    this.send(session, {
      type: SERVER_MSG.LEADERBOARD,
      ...this.leaderboard.leaderboard(8),
    });
  }

  handleState(session, state) {
    const room = this.requireRoom(session);
    if (!room) return;
    if (room.status !== 'racing' || !room.race) return;
    const player = room.players.get(session.id);
    if (!player) return;
    room.race.handleState(player, state);
  }

  leaveRoom(session) {
    const room = this.rooms.get(session.roomCode);
    session.roomCode = null;
    session.ready = false;
    if (!room) {
      this.send(session, { type: SERVER_MSG.ROOM_STATE, room: null });
      return;
    }
    const player = room.players.get(session.id);
    if (room.status === 'racing' && player) {
      player.session = null;
      room.race?.markDisconnected(player);
      this.send(session, { type: SERVER_MSG.ROOM_STATE, room: null });
      this.broadcastRoom(room);
      return;
    }
    room.players.delete(session.id);
    this.send(session, { type: SERVER_MSG.ROOM_STATE, room: null });
    this.afterRemoval(room);
  }

  disconnect(session) {
    const room = this.rooms.get(session.roomCode);
    session.roomCode = null;
    if (!room) return;
    const player = room.players.get(session.id);
    if (!player) return;
    if (room.status === 'racing') {
      player.session = null;
      room.race?.markDisconnected(player);
      this.broadcastRoom(room);
      return;
    }
    room.players.delete(session.id);
    this.afterRemoval(room);
  }

  afterRemoval(room) {
    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      this.log(`room ${room.code} closed`);
      return;
    }
    if (room.hostId && !room.players.has(room.hostId)) {
      room.hostId = room.players.keys().next().value;
      this.log(`room ${room.code} host migrated to ${room.players.get(room.hostId).name}`);
    }
    this.broadcastRoom(room);
  }

  requireRoom(session) {
    if (!session.roomCode) {
      this.fail(session, 'Join or create a room first.');
      return null;
    }
    const room = this.rooms.get(session.roomCode);
    if (!room) {
      session.roomCode = null;
      this.fail(session, 'That room is no longer available.');
      return null;
    }
    return room;
  }

  handleMessage(session, message) {
    switch (message.type) {
      case CLIENT_MSG.CREATE_ROOM:
        this.createRoom(session, message);
        break;
      case CLIENT_MSG.JOIN_ROOM:
        this.joinRoom(session, message);
        break;
      case CLIENT_MSG.READY:
        this.setReady(session, message.ready);
        break;
      case CLIENT_MSG.START_RACE:
        this.startRace(session);
        break;
      case CLIENT_MSG.STATE:
        this.handleState(session, message);
        break;
      case CLIENT_MSG.LEADERBOARD:
        this.requestLeaderboard(session);
        break;
      case CLIENT_MSG.LEAVE_ROOM:
        this.leaveRoom(session);
        break;
      default:
        break;
    }
  }
}
