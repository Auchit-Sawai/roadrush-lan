import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { GameServer } from './GameServer.js';
import { networkAddresses } from './staticServer.js';
import { SERVER_VERSION } from '../../shared/protocol.js';

const here = import.meta.dirname;
const sourceLayout = path.basename(here) === 'src';
const serverRoot = sourceLayout ? path.dirname(here) : here;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  return fallback;
}

const port = Number(argValue('--port', process.env.RR_PORT ?? 8787));
const host = argValue('--host', process.env.RR_HOST ?? '0.0.0.0');
const releaseWebRoot = path.join(serverRoot, 'web');
const devWebRoot = path.resolve(serverRoot, '..', 'dist');
const defaultWebRoot = existsSync(path.join(releaseWebRoot, 'game.html'))
  ? releaseWebRoot
  : devWebRoot;
const webRoot = argValue('--web', process.env.RR_WEB_ROOT ?? defaultWebRoot);
const dataDir = argValue('--data', process.env.RR_DATA_DIR ?? path.join(serverRoot, 'data'));

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}
if (!existsSync(path.join(webRoot, 'game.html'))) {
  console.error(`Game build not found at ${webRoot}. Run "npm run build" before starting the server.`);
  process.exit(1);
}

const server = new GameServer({
  webRoot,
  dbPath: path.join(dataDir, 'roadrush.sqlite'),
});

try {
  await server.listen(port, host);
} catch (error) {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Close the other server or start with --port 8788.`);
  } else if (error.code === 'EACCES') {
    console.error(`Windows refused port ${port}. Try a higher port such as 8787.`);
  } else {
    console.error(error.message);
  }
  await server.close();
  process.exit(1);
}

const addresses = networkAddresses(port);
console.log('');
console.log(`  ROADRUSH LAN SERVER  v${SERVER_VERSION}`);
console.log('  --------------------------------------------');
console.log(`  Local game page : http://127.0.0.1:${port}/play`);
for (const address of addresses) console.log(`  Network game    : ${address}`);
if (addresses.length === 0) {
  console.log('  Network game    : no private IPv4 address found');
}
console.log(`  Leaderboard API : http://127.0.0.1:${port}/api/leaderboard`);
console.log(`  Database        : ${path.join(dataDir, 'roadrush.sqlite')}`);
console.log('');
console.log('  Share one of the Network game addresses with the other riders.');
console.log('  Keep this window open. Press Ctrl+C to stop.');
console.log('');

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nStopping server (${signal})…`);
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
