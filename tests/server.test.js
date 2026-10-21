import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { GameServer } from '../server/src/GameServer.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queue.push(message);
    }
  });
  const waitFor = (predicate, timeoutMs = 3000) => {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const at = waiters.indexOf(waiter);
        if (at >= 0) waiters.splice(at, 1);
        reject(new Error(`timed out waiting for message; queued: ${JSON.stringify(queue)}`));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };
  return {
    ws,
    waitFor,
    async open() {
      if (ws.readyState === WebSocket.OPEN) return;
      await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
    },
    send(message) {
      ws.send(JSON.stringify(message));
    },
    close() {
      ws.close();
    },
  };
}

async function startServer(t) {
  const webRoot = mkdtempSync(path.join(tmpdir(), 'roadrush-web-'));
  writeFileSync(path.join(webRoot, 'game.html'), '<!doctype html><title>RoadRush Test</title>');
  const server = new GameServer({
    webRoot,
    dbPath: ':memory:',
    log: () => {},
  });
  const address = await server.listen(0, '127.0.0.1');
  t.after(async () => {
    await server.close();
  });
  return { server, base: `http://127.0.0.1:${address.port}`, wsBase: `ws://127.0.0.1:${address.port}/ws` };
}

test('serves health, leaderboard and the game page over HTTP', async (t) => {
  const { base } = await startServer(t);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.protocol, 1);
  assert.equal(body.rooms, 0);

  const board = await fetch(`${base}/api/leaderboard?limit=5`);
  assert.equal(board.status, 200);
  assert.deepEqual((await board.json()).fastest, []);

  const page = await fetch(`${base}/play`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /RoadRush Test/);

  const missing = await fetch(`${base}/api/health/../etc/passwd`);
  assert.equal(missing.status, 404);
});

test('rejects a socket that does not say hello first', async (t) => {
  const { wsBase } = await startServer(t);
  const client = connect(wsBase);
  await client.open();
  const closed = new Promise((resolve) => client.ws.once('close', (code) => resolve(code)));
  client.send({ type: 'createRoom' });
  assert.equal(await closed, 1008);
});

test('two clients can create, join, ready up and start a race', async (t) => {
  const { wsBase } = await startServer(t);
  const host = connect(wsBase);
  const guest = connect(wsBase);
  await Promise.all([host.open(), guest.open()]);

  host.send({ type: 'hello', name: 'Host', color: '#e63946' });
  guest.send({ type: 'hello', name: 'Guest', color: '#4d96ff' });
  const hostWelcome = await host.waitFor((message) => message.type === 'welcome');
  const guestWelcome = await guest.waitFor((message) => message.type === 'welcome');
  assert.notEqual(hostWelcome.playerId, guestWelcome.playerId);

  host.send({ type: 'createRoom' });
  const created = await host.waitFor((message) => message.type === 'roomState' && message.room);
  const code = created.room.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(created.room.hostId, hostWelcome.playerId);

  guest.send({ type: 'joinRoom', code });
  const joined = await host.waitFor(
    (message) => message.type === 'roomState' && message.room?.players.length === 2,
  );
  assert.equal(joined.room.players[1].name, 'Guest');

  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  await host.waitFor(
    (message) => message.type === 'roomState' && message.room.players.every((player) => player.ready),
  );

  host.send({ type: 'startRace' });
  const starting = await guest.waitFor((message) => message.type === 'raceStarting');
  assert.ok(starting.startAt > Date.now() - 1000);
  assert.equal(starting.players.length, 2);
  assert.equal(starting.laps, 2);

  host.close();
  guest.close();
  await wait(50);
});

test('leaderboard survives a server restart with a file database', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'roadrush-restart-'));
  const webRoot = path.join(dir, 'web');
  mkdirSync(webRoot);
  writeFileSync(path.join(webRoot, 'game.html'), '<!doctype html><title>RoadRush Test</title>');
  const dbPath = path.join(dir, 'data', 'roadrush.sqlite');
  let first = null;
  let second = null;
  try {
    first = new GameServer({ webRoot, dbPath, log: () => {} });
    await first.listen(0, '127.0.0.1');
    first.repo.recordRace({
      trackId: 'sunset-ridge',
      status: 'completed',
    }, [{
      name: 'RestartAce',
      position: 1,
      finishTime: 41.25,
      status: 'completed',
    }]);
    await first.close();
    first = null;

    second = new GameServer({ webRoot, dbPath, log: () => {} });
    const address = await second.listen(0, '127.0.0.1');
    const board = await (await fetch(`http://127.0.0.1:${address.port}/api/leaderboard`)).json();
    assert.equal(board.fastest[0].name, 'RestartAce');
    assert.equal(board.fastest[0].finishTime, 41.25);
    assert.equal(board.recent.length, 1);
  } finally {
    if (first) await first.close();
    if (second) await second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a client can leave and the room reports the departure', async (t) => {
  const { wsBase } = await startServer(t);
  const host = connect(wsBase);
  const guest = connect(wsBase);
  await Promise.all([host.open(), guest.open()]);
  host.send({ type: 'hello', name: 'Host', color: '#e63946' });
  guest.send({ type: 'hello', name: 'Guest', color: '#4d96ff' });
  await host.waitFor((message) => message.type === 'welcome');
  await guest.waitFor((message) => message.type === 'welcome');

  host.send({ type: 'createRoom' });
  const created = await host.waitFor((message) => message.type === 'roomState' && message.room);
  guest.send({ type: 'joinRoom', code: created.room.code });
  await host.waitFor(
    (message) => message.type === 'roomState' && message.room?.players.length === 2,
  );

  guest.send({ type: 'leaveRoom' });
  const after = await host.waitFor(
    (message) => message.type === 'roomState' && message.room?.players.length === 1,
  );
  assert.equal(after.room.players[0].name, 'Host');

  host.close();
  guest.close();
  await wait(50);
});
