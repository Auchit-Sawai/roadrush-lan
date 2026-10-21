# RoadRush LAN

**Play it now (no install): https://auchit-sawai.github.io/roadrush-lan/**

Arcade low-poly motorcycle racing: punch rivals off their bikes (Q / E), dodge traffic, outrun the police, boost with Shift. Three difficulty levels. The hosted version is single-player; LAN multiplayer needs the desktop build below.

Low-poly arcade motorcycle racing for the browser. It includes a complete offline
single-player race, a Manifest V3 Chrome extension shell, and a small LAN server
for two to eight human riders on the same trusted network.

## Requirements

- Node.js 24 or newer (the server uses the built-in `node:sqlite` module)
- Chrome 110+ or Edge for the extension
- No internet connection is needed at runtime

## Quick start from source

```powershell
$env:NODE_OPTIONS='--use-system-ca'
npm install
npm test
npm run build
npm run server
```

Open `http://127.0.0.1:8787/play` for the LAN-enabled browser build. The server
prints the private network addresses friends can use. The database is created
at `server\data\roadrush.sqlite` on first use.

For extension development, load `dist` as an unpacked extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this project's `dist` folder.
4. Click the RoadRush LAN toolbar icon.

Vite development pages are available with `npm run dev`. Build the production
output with `npm run build`; `manifest.json` is placed at the root of `dist`.

## LAN multiplayer

1. The host runs `Start-LAN-Server.ps1` from the release's `LANServer` folder,
   or runs `npm run server` from this source checkout.
2. The host opens the local game page, creates a room, and shares the four-letter
   room code.
3. Every player loads the extension, opens LAN mode, enters the host address
   (`host-private-ip:8787`), joins the room, and readies up.
4. The host starts the race after everyone is ready.

If an extension page cannot open a direct LAN socket, use the launcher's
**Join LAN** button. It opens the host's normal `/play` page in a browser tab,
which is the compatibility fallback.

Allow Node.js through Windows Firewall for **Private networks** only when Windows
asks. Do not expose the server to the public internet or set up router port
forwarding. The server binds to `0.0.0.0` by default so it can accept LAN
connections; the release instructions explain how to stop it.

A finish is recorded only after the server has seen enough authoritative
progress. Finish order and times come from the server, not from a client's
claimed result. It is a trusted-LAN scoreboard, not an anti-cheat service.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server for extension pages |
| `npm run build` | Production extension output in `dist` |
| `npm run preview` | Serve `dist` at `http://127.0.0.1:4173` |
| `npm test` | Run all automated tests with `node:test` |
| `npm run server` | Start the source LAN server on port 8787 |
| `npm run build:server` | Build `server/server.bundle.mjs` |
| `npm run smoke` | Offline browser smoke test (expects preview on port 4173) |
| `npm run package:release` | Build and create `release/RoadRushLAN-Share.zip` |

`npm run smoke` expects the preview server to already be running. The LAN browser
test starts its own in-process server:

```powershell
node scripts\lan-smoke.mjs
```

## Project layout

```text
src/            game, UI and networking client
shared/         track geometry, race constants and protocol validation
server/src/     HTTP/WebSocket server, rooms, race authority, SQLite
tests/          node:test unit and integration tests
scripts/        build, browser smoke, LAN smoke and release packaging
extension/      Manifest V3 pages, manifest and icons
docs/           test report and release/server instructions
artifacts/      generated screenshots from smoke tests
```

## Verification status

- 45 automated tests pass, including WebSocket integration, unknown-room error
  handling, and a leaderboard restart test.
- The offline browser smoke test passes, including popup, menu, race, pause,
  results, camera, and live frame pacing checks.
- The two-browser LAN smoke test passes, including validation and persistence.
- Two physical PCs were not available, so the two-PC acceptance test was not
  performed.
- Branded Chrome/Edge builds in this environment ignore command-line extension
  loading. The production extension must be loaded manually from `dist` or from
  the release's `ChromeExtension` folder.

See `docs\TEST-REPORT.md` for the recorded checks and limitations.

## Safety and data

The server stores only nicknames, race metadata, positions and finish times in
SQLite. It does not collect accounts, passwords or personal information. To back
up the scoreboard, stop the server and copy `server\data\roadrush.sqlite` (plus
any `-wal` and `-shm` files) to a safe place. Restore it only while the server is
stopped. Never replace an existing database automatically during an upgrade.
