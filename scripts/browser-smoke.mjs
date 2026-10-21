import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import WebSocket from 'ws';

const BASE_URL = process.env.RR_SMOKE_URL || 'http://127.0.0.1:4173';
const ROOT = path.resolve(import.meta.dirname, '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const failures = [];
const consoleErrors = [];
const check = (condition, label, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` (${detail})` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBrowser() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge was not found in the standard install locations.');
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

function launchBrowser() {
  const profile = path.join(os.tmpdir(), `roadrush-smoke-${Date.now()}`);
  const browser = findBrowser();
  const args = [
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
  ];
  const child = spawn(browser, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  return { child, profile };
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
    const text = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Evaluation failed';
    throw new Error(text);
  }
  return result.result.value;
}

async function pressKey(cdp, type, key, code, keyCode) {
  await cdp.send('Input.dispatchKeyEvent', {
    type,
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
}

async function waitForReady(cdp, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ready = await evaluate(cdp, 'document.documentElement.dataset.roadrushReady === "true"');
      if (ready) return;
    } catch {
      // page is navigating
    }
    await sleep(150);
  }
  throw new Error('Game page never signalled readiness.');
}

async function capture(cdp, name) {
  await mkdir(ARTIFACTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(ARTIFACTS, name);
  await writeFile(file, Buffer.from(data, 'base64'));
  console.log(`  SHOT  ${file}`);
}

async function main() {
  const { child, profile } = launchBrowser();
  let cdp;
  let persistedColor = 'e63946';
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await waitForFile(portFile, 15000, 'DevTools port');
    const [port] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });

    cdp.on('Runtime.exceptionThrown', (params) => {
      const description = params.exceptionDetails?.exception?.description
        || params.exceptionDetails?.text
        || 'Unknown exception';
      consoleErrors.push(description);
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error') {
        const text = params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
        consoleErrors.push(text);
      }
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry?.level === 'error') consoleErrors.push(params.entry.text);
    });

    console.log('\n[1] Launcher page');
    let response = await cdp.send('Page.navigate', { url: `${BASE_URL}/launcher.html` });
    if (response.errorText) throw new Error(`Launcher navigation failed: ${response.errorText}`);
    await sleep(1500);
    check((await evaluate(cdp, 'document.title')).includes('RoadRush'), 'launcher title loads');
    check(await evaluate(cdp, '!!document.getElementById("play-now")'), 'quick race button exists');
    check((await evaluate(cdp, 'document.querySelectorAll(".swatch").length')) === 6, 'six bike colours render');
    check((await evaluate(cdp, '!!document.getElementById("join-lan")')), 'LAN join control renders');

    console.log('\n[1b] Toolbar popup');
    response = await cdp.send('Page.navigate', { url: `${BASE_URL}/popup.html` });
    if (response.errorText) throw new Error(`Popup navigation failed: ${response.errorText}`);
    await sleep(1200);
    check((await evaluate(cdp, 'document.getElementById("rider").textContent')).length > 0, 'popup shows the rider name');
    check((await evaluate(cdp, 'document.querySelectorAll("button").length')) >= 3, 'popup actions render');
    await capture(cdp, 'smoke-popup.png');

    console.log('\n[1c] Settings persistence');
    response = await cdp.send('Page.navigate', { url: `${BASE_URL}/launcher.html` });
    if (response.errorText) throw new Error('Launcher reload failed: ' + response.errorText);
    await sleep(1000);
    await evaluate(cdp, `(() => {
      const input = document.getElementById('nickname');
      input.value = 'PersistSmoke';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelectorAll('.swatch')[2].click();
    })()`);
    await sleep(900);
    response = await cdp.send('Page.navigate', { url: `${BASE_URL}/launcher.html` });
    if (response.errorText) throw new Error('Launcher reload failed: ' + response.errorText);
    await sleep(1200);
    check((await evaluate(cdp, 'document.getElementById("nickname").value')) === 'PersistSmoke', 'nickname survives reload');
    const selectedSwatch = await evaluate(cdp, 'document.querySelector(".swatch.selected")?.title || ""');
    check(selectedSwatch.length === 7, 'bike colour survives reload', selectedSwatch);
    persistedColor = selectedSwatch.replace('#', '').toLowerCase();

    console.log('\n[2] Game menu');
    response = await cdp.send('Page.navigate', { url: `${BASE_URL}/game.html?manual=1` });
    if (response.errorText) throw new Error(`Game navigation failed: ${response.errorText}`);
    await waitForReady(cdp);
    await sleep(500);
    let state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.state())'));
    check(state.menuVisible === true, 'menu is visible on load');
    check(state.sceneChildren > 8, '3D scene built', `children=${state.sceneChildren}`);
    check(state.aiCount === 0, 'no AI racers before race');
    await capture(cdp, 'smoke-menu.png');

    console.log('\n[3] Offline race start and physics');
    await evaluate(cdp, '__roadrush.startOffline()');
    await sleep(100);
    await evaluate(cdp, '__roadrush.forceStart()');
    await evaluate(cdp, '__roadrush.input(null)');
    await pressKey(cdp, 'keyDown', 'w', 'KeyW', 87);
    await pressKey(cdp, 'keyDown', 'd', 'KeyD', 68);
    state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.step(0.8))'));
    check(state.screenLateral > 0.25, 'D key steers right on screen',
      `screen lateral=${state.screenLateral.toFixed(2)}`);
    await pressKey(cdp, 'keyUp', 'd', 'KeyD', 68);
    const rightSteer = state.screenLateral;
    await pressKey(cdp, 'keyDown', 'a', 'KeyA', 65);
    state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.step(1.0))'));
    check(state.screenLateral < rightSteer - 0.25, 'A key steers left on screen',
      `${rightSteer.toFixed(2)} -> ${state.screenLateral.toFixed(2)}`);
    await pressKey(cdp, 'keyUp', 'a', 'KeyA', 65);
    await pressKey(cdp, 'keyUp', 'w', 'KeyW', 87);
    await evaluate(cdp, '__roadrush.input({ throttle: 1, steer: 0, boost: false })');
    state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.step(6))'));
    while (state.speed < 30 && state.crashes > 0) {
      const beforeRecovery = state.speed;
      state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.step(2))'));
      console.log(`  INFO  recovered from traffic contact (${beforeRecovery.toFixed(1)} -> ${state.speed.toFixed(1)} m/s)`);
    }
    check(state.mode === 'offline', 'race runs in offline mode');
    check(state.phase === 'racing', 'race phase is racing', `phase=${state.phase}`);
    check(state.aiCount === 5, 'five AI rivals active', `ai=${state.aiCount}`);
    check(state.speed > 25, 'throttle produces speed', `speed=${state.speed.toFixed(1)}`);
    check(state.progress > 30, 'bike advances along the track', `progress=${state.progress.toFixed(1)}`);
    check(state.hudSpeed && state.hudSpeed !== '0', 'HUD speed updates', `hud=${state.hudSpeed}`);
    check(state.trafficCount > 0, 'traffic is active', `traffic=${state.trafficCount}`);
    check(state.playerVisible === true, 'player bike is visible');
    check(state.hasLabel === true, 'player has a YOU marker');
    check(state.playerColor === persistedColor, 'player bike uses the selected colour', `${state.playerColor} vs ${persistedColor}`);
    console.log(`  INFO  draw=${state.drawCalls} tris=${state.triangles} fps=${state.fps} size=${state.drawSize.join('x')}`);
    const cameraGap = Math.hypot(
      state.cameraPosition[0] - state.bikePosition[0],
      state.cameraPosition[1] - state.bikePosition[1],
      state.cameraPosition[2] - state.bikePosition[2],
    );
    check(cameraGap > 5 && cameraGap < 16, 'camera stays behind the player', `gap=${cameraGap.toFixed(2)}m`);
    await capture(cdp, 'smoke-race-clean.png');
    await evaluate(cdp, '__roadrush.input({ throttle: 0.55, steer: 0, boost: false })');
    await evaluate(cdp, '__roadrush.step(2)');
    await capture(cdp, 'smoke-race.png');

    console.log('\n[4] Pause and finish flow');
    await evaluate(cdp, '__roadrush.pause()');
    state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.state())'));
    check(state.paused === true, 'pause freezes the race');
    await evaluate(cdp, '__roadrush.resume()');
    await evaluate(cdp, '__roadrush.finishNow()');
    await sleep(300);
    state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.state())'));
    check(state.resultsVisible === true, 'results screen opens after finish');
    const resultRows = await evaluate(cdp, 'document.querySelectorAll("#results-standings tr").length');
    check(resultRows >= 6, 'results list riders', `rows=${resultRows}`);
    const totalTime = await evaluate(cdp, 'document.getElementById("results-time").textContent');
    check(/^\d{2}:\d{2}\.\d{3}$/.test(totalTime), 'results show a total time', totalTime);
    const statusText = await evaluate(cdp, 'document.getElementById("results-standings").textContent');
    check(statusText.includes('RACING'), 'unfinished rivals show race status');
    await capture(cdp, 'smoke-results.png');
    await sleep(500);
    response = await cdp.send('Page.navigate', { url: `${BASE_URL}/launcher.html` });
    if (response.errorText) throw new Error('Launcher navigation after race failed: ' + response.errorText);
    await sleep(1000);
    const bestTime = await evaluate(cdp, 'document.getElementById("best-time").textContent');
    check(/^\d{2}:\d{2}\.\d{3}$/.test(bestTime), 'local best persists after race', bestTime);

    console.log('\n[5] Real-time frame pacing');
    response = await cdp.send('Page.navigate', { url: `${BASE_URL}/game.html?autostart=1` });
    if (response.errorText) throw new Error(`Live race navigation failed: ${response.errorText}`);
    await waitForReady(cdp);
    await evaluate(cdp, '__roadrush.input({ throttle: 1, steer: 0, boost: false })');
    await sleep(9000);
    state = JSON.parse(await evaluate(cdp, 'JSON.stringify(__roadrush.state())'));
    console.log(`  INFO  live fps=${state.fps} draw=${state.drawCalls} size=${state.drawSize.join('x')} speed=${state.speedKph.toFixed(0)}kph`);
    check(state.speed > 5, 'live loop advances the race', `speed=${state.speed.toFixed(1)}`);
    check(state.fps >= 24, 'live loop renders at 24 FPS or better', `fps=${state.fps}`);
    await capture(cdp, 'smoke-live.png');

    check(consoleErrors.length === 0, 'no runtime console errors', consoleErrors.slice(0, 3).join(' | '));
  } finally {
    try { cdp?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(600);
    try { await rm(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log('\nSummary');
  if (failures.length) {
    console.log(`  ${failures.length} check(s) failed:`);
    for (const failure of failures) console.log(`   - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('  All browser smoke checks passed.');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
