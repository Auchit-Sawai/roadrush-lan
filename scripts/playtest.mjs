// Headless play-test of the GitHub Pages build (./site): drives a race, punches, summons the police,
// and saves screenshots to artifacts/. Usage: npm run build:pages && node scripts/playtest.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'site');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x').pathname;
  const file = path.join(SITE, url === '/' ? 'index.html' : url);
  if (!file.startsWith(SITE) || !existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = path.join(os.tmpdir(), `rr-play-${Date.now()}`);
const browser = BROWSERS.find(existsSync);
const child = spawn(browser, [
  '--headless=new', '--enable-unsafe-swiftshader', '--no-first-run', '--disable-extensions', '--mute-audio',
  '--hide-scrollbars', '--window-size=1600,1000', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

async function cleanup() {
  try { child.kill(); } catch {}
  server.close();
}

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(150);
  const [port] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((r) => ws.once('open', r));
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const key = async (k, code, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
  const shot = async (name) => { await mkdir(ARTIFACTS, { recursive: true }); const { data } = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(ARTIFACTS, name), Buffer.from(data, 'base64')); console.log(`  SHOT  ${name}`); };
  await send('Runtime.enable');
  await send('Page.enable');

  console.log('Menu');
  await send('Page.navigate', { url: `${base}/?manual=1` });
  for (let i = 0; i < 100; i++) { if (await ev('document.documentElement.dataset.roadrushReady === "true"').catch(() => false)) break; await sleep(150); }
  check(await ev('Boolean(window.__roadrush?.ready)'), 'game boots from the static site');
  check(await ev('document.getElementById("open-lan").classList.contains("hidden") === false'), 'LAN button visible on localhost (hidden only on github.io)');
  check(await ev('document.getElementById("difficulty").value') === 'pro', 'difficulty selector defaults to Pro');
  await shot('v2-menu.png');

  console.log('Race');
  await ev('window.__roadrush.startOffline()');
  await ev('window.__roadrush.forceStart()');
  let state = await ev('window.__roadrush.state()');
  check(state.running && state.aiCount === 5, 'race starts with 5 rivals', JSON.stringify({ ai: state.aiCount }));

  const drive = async (seconds, steerFn) => {
    for (let t = 0; t < seconds; t += 0.25) {
      const s = await ev('window.__roadrush.state()');
      const brake = s.speed > 62 ? 1 : 0;
      await ev(`window.__roadrush.input(${JSON.stringify({ throttle: brake ? 0 : 1, brake, steer: steerFn(s), boost: s.boost > 60 })})`);
      await ev('window.__roadrush.step(0.25)');
    }
  };
  const centre = (s) => Math.max(-1, Math.min(1, -s.lateral * 0.4));
  await drive(6, centre);
  await shot('v2-race-start.png');

  console.log('Combat');
  // Sit beside a rival: scan for one in reach by nudging left/right and punching.
  let totalHits = 0;
  for (let i = 0; i < 40; i++) {
    await key('q', 'KeyQ', 81);
    await ev('window.__roadrush.step(0.1)');
    await key('e', 'KeyE', 69);
    await ev('window.__roadrush.step(0.5)');
    await drive(0.5, (s) => (i % 8 < 4 ? 0.5 : -0.5));
  }
  state = await ev('window.__roadrush.state()');
  console.log(`  info  health=${Math.round(state.health)} takedowns=${state.takedowns} crashes=${state.crashes} lap=${state.lap}/${state.laps}`);
  await shot('v2-punch.png');

  console.log('Police');
  await ev('window.__roadrush.input(null)');
  let sawCops = false;
  for (let i = 0; i < 40 && !sawCops; i++) {
    await drive(2, centre);
    state = await ev('window.__roadrush.state()');
    sawCops = state.copCount > 0;
  }
  check(sawCops, 'police join the chase', `cops=${state.copCount} progress=${Math.round(state.progress)} elapsed=${state.elapsed.toFixed(1)}`);
  await drive(2.5, centre);
  await shot('v2-cops.png');

  console.log('Finish');
  await ev('window.__roadrush.finishNow()');
  await sleep(300);
  state = await ev('window.__roadrush.state()');
  check(state.resultsVisible, 'results screen appears after the finish');
  check(await ev('document.getElementById("results-takedowns").textContent') !== '', 'takedowns shown on results');
  await shot('v2-results.png');

  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
  ws.close();
} catch (error) {
  failures += 1;
  console.log('  FAIL  playtest crashed:', error.message);
} finally {
  await cleanup();
}
console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
