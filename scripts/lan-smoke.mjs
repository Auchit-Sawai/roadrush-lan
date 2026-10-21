import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';
import { GameServer } from '../server/src/GameServer.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const failures = [];
const browserErrors = [];
const serverLogs = [];
const check = (condition, label, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` (${detail})` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge was not found.');
  return found;
}

async function waitForFile(file, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(file)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

class CDP {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 });
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const handlers = this.events.get(message.method);
      if (handlers) for (const handler of handlers) handler(message.params);
    });
  }

  on(method, handler) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(handler);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(cdp, expression)) return;
    } catch {
      // page is navigating
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function capture(cdp, name) {
  await mkdir(ARTIFACTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(ARTIFACTS, name);
  await writeFile(file, Buffer.from(data, 'base64'));
  console.log(`  SHOT  ${file}`);
}

async function openTab(port, settings, url) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', (params) => {
    browserErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'exception');
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') browserErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  });
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry?.level === 'error') browserErrors.push(params.entry.text);
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('rr.settings.v1', ${JSON.stringify(JSON.stringify(settings))});`,
  });
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, 'document.documentElement.dataset.roadrushReady === "true"', 25000, 'game boot');
  return cdp;
}

function launchBrowser() {
  const profile = path.join(os.tmpdir(), `roadrush-lan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const child = spawn(findBrowser(), [
    '--headless=new',
    '--enable-unsafe-swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--mute-audio',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  return { child, profile };
}

async function browserPort(profile) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  await waitForFile(portFile, 15000, 'DevTools port');
  const [port] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
  return port;
}

async function main() {
  const externalBase = process.env.RR_LAN_URL?.trim();
  if (!externalBase && !existsSync(path.join(DIST, 'game.html'))) {
    throw new Error('Run npm run build first.');
  }

  let server = null;
  let base;
  if (externalBase) {
    base = externalBase.replace(/\/$/, '');
    console.log(`Using external LAN server at ${base}`);
  } else {
    server = new GameServer({
      webRoot: DIST,
      dbPath: ':memory:',
      log: (message) => serverLogs.push(message),
    });
    const address = await server.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${address.port}`;
    console.log(`LAN server on ${base}`);
  }

  const hostBrowser = launchBrowser();
  const guestBrowser = launchBrowser();

  let host;
  let guest;
  try {
    const [hostPort, guestPort] = await Promise.all([
      browserPort(hostBrowser.profile),
      browserPort(guestBrowser.profile),
    ]);
    const serverAddress = new URL(base).host;
    const lanUrl = `${base}/play?lan=1&server=${encodeURIComponent(serverAddress)}`;

    console.log('\n[1] Two clients connect to the LAN lobby');
    host = await openTab(hostPort, { nickname: 'SmokeHost', color: '#e63946', audio: false }, lanUrl);
    guest = await openTab(guestPort, { nickname: 'SmokeGuest', color: '#4d96ff', audio: false }, lanUrl);
    await waitFor(host, '!document.getElementById("lan-actions").classList.contains("hidden")', 12000, 'host connection');
    await waitFor(guest, '!document.getElementById("lan-actions").classList.contains("hidden")', 12000, 'guest connection');
    check((await evaluate(host, 'document.getElementById("lan-net-badge").textContent')).includes('CONNECTED'), 'host is connected');
    check((await evaluate(guest, 'document.getElementById("lan-net-badge").textContent')).includes('CONNECTED'), 'guest is connected');

    console.log('\n[2] Create and join a room through the UI');
    await evaluate(host, 'document.getElementById("lan-create").click()');
    await waitFor(host, '/^[A-HJ-NP-Z2-9]{4}$/.test(document.getElementById("lobby-code").textContent.trim())', 5000, 'room code');
    const code = (await evaluate(host, 'document.getElementById("lobby-code").textContent.trim()')).toUpperCase();
    check(/^[A-HJ-NP-Z2-9]{4}$/.test(code), 'room code is valid', code);
    check((await evaluate(host, 'document.querySelectorAll("#lobby-players li").length')) === 1, 'host appears alone first');

    await evaluate(guest, `(() => {
      const input = document.getElementById('lan-code');
      input.value = ${JSON.stringify(code)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('lan-join').click();
    })()`);
    await waitFor(host, 'document.querySelectorAll("#lobby-players li").length === 2', 5000, 'guest join');
    const lobbyText = await evaluate(host, 'document.getElementById("lan-lobby").textContent');
    check(lobbyText.includes('SmokeHost') && lobbyText.includes('SmokeGuest'), 'both nicknames show in the lobby');
    check(lobbyText.includes('HOST'), 'host tag renders');
    await capture(host, 'lan-lobby.png');

    console.log('\n[3] Ready up and start');
    await evaluate(host, 'document.getElementById("lobby-ready").click()');
    await evaluate(guest, 'document.getElementById("lobby-ready").click()');
    await waitFor(host, '!document.getElementById("lobby-start").disabled', 5000, 'start enabled');
    await evaluate(host, 'document.getElementById("lobby-start").click()');
    await waitFor(host, '__roadrush.state().mode === "lan"', 8000, 'host race start');
    await waitFor(guest, '__roadrush.state().mode === "lan"', 8000, 'guest race start');
    check((await evaluate(host, 'JSON.stringify(__roadrush.state())')).includes('"mode":"lan"'), 'host entered LAN mode');
    check((await evaluate(host, '__roadrush.state().remoteCount')) === 1, 'host renders the guest bike');
    check((await evaluate(guest, '__roadrush.state().remoteCount')) === 1, 'guest renders the host bike');
    await evaluate(host, '__roadrush.input({ throttle: 1, steer: 0, boost: false })');
    await evaluate(guest, '__roadrush.input({ throttle: 1, steer: 0, boost: false })');
    try {
      await waitFor(host, '__roadrush.state().phase === "racing"', 8000, 'host green light');
      await waitFor(guest, '__roadrush.state().phase === "racing"', 8000, 'guest green light');
    } catch (error) {
      console.log(`  INFO  host=${await evaluate(host, 'JSON.stringify(__roadrush.state())')}`);
      console.log(`  INFO  guest=${await evaluate(guest, 'JSON.stringify(__roadrush.state())')}`);
      console.log(`  INFO  server=${JSON.stringify(serverLogs.slice(-12))}`);
      throw error;
    }
    await sleep(2000);
    await capture(host, 'lan-race.png');

    console.log('\n[4] Finish at the server minimum and wait for validation');
    await waitFor(host, '__roadrush.state().elapsed >= 34.5', 45000, 'early-finish retry window');
    const hostTime = await evaluate(host, '__roadrush.state().elapsed');
    await evaluate(host, '__roadrush.finishNow()');
    await evaluate(guest, '__roadrush.finishNow()');
    await waitFor(host, '__roadrush.state().resultsVisible === true', 10000, 'host results');
    await waitFor(guest, '__roadrush.state().resultsVisible === true', 10000, 'guest results');
    try {
      await waitFor(host, 'document.getElementById("results-note").textContent.includes("Validated")', 10000, 'validated results');
    } catch (error) {
      console.log(`  INFO  host=${await evaluate(host, 'JSON.stringify(__roadrush.state())')}`);
      console.log(`  INFO  guest=${await evaluate(guest, 'JSON.stringify(__roadrush.state())')}`);
      console.log(`  INFO  server=${JSON.stringify(serverLogs.slice(-20))}`);
      throw error;
    }
    const rows = await evaluate(host, 'document.querySelectorAll("#results-standings tr").length');
    check(rows === 2, 'results show both riders', `rows=${rows}`);
    const resultsText = await evaluate(host, 'document.getElementById("results-standings").textContent');
    check(resultsText.includes('SmokeHost') && resultsText.includes('SmokeGuest'), 'results show both nicknames');
    check(!resultsText.includes('RACING'), 'validated results have no unfinished rows');
    const hostTotal = await evaluate(host, 'document.getElementById("results-time").textContent');
    check(/^\d{2}:\d{2}\.\d{3}$/.test(hostTotal), 'host sees a total time', hostTotal);
    console.log(`  INFO  elapsed at finish=${hostTime.toFixed(1)}s total=${hostTotal}`);
    await capture(host, 'lan-results.png');

    const board = await (await fetch(`${base}/api/leaderboard`)).json();
    check(board.fastest.length === 2, 'leaderboard recorded both riders', `rows=${board.fastest.length}`);
    check(board.fastest.some((row) => row.name === 'SmokeHost'), 'leaderboard contains host');
    check(board.fastest.every((row) => Number(row.finishTime) >= 35), 'server rejected implausible finish times');
    check(board.recent.length === 1, 'leaderboard recorded one race');

    const health = await (await fetch(`${base}/api/health`)).json();
    check(health.rooms === 1 && health.racing === 0, 'room returned to the lobby after results');
    if (server) {
      check(serverLogs.every((line) => !/http error|database write failed/i.test(line)), 'server reported no errors');
    } else {
      console.log('  INFO  external server logs are not captured by this test');
    }

    check(browserErrors.length === 0, 'no browser runtime errors', browserErrors.slice(0, 3).join(' | '));
  } finally {
    try { host?.close(); } catch { /* ignore */ }
    try { guest?.close(); } catch { /* ignore */ }
    try { hostBrowser.child.kill(); } catch { /* ignore */ }
    try { guestBrowser.child.kill(); } catch { /* ignore */ }
    if (server) {
      try { await server.close(); } catch { /* ignore */ }
    }
    await sleep(600);
    try { await rm(hostBrowser.profile, { recursive: true, force: true }); } catch { /* ignore */ }
    try { await rm(guestBrowser.profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log('\nSummary');
  if (failures.length) {
    console.log(`  ${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`   - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('  All LAN browser checks passed.');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
