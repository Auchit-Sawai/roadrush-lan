# RoadRush LAN - test report

Date: 2026-10-21
Environment: Windows, Node.js 26.4.0, npm, Google Chrome (headless),
PowerShell 5.1. Tests ran inside the isolated RoadRushLAN project folder.

## Automated tests

Command:

```powershell
npm test
```

Result: **45 passed, 0 failed** (about 1.2 seconds).

Coverage includes:

- Track geometry: closed/dense circuit, distance wrapping, finite samples,
  curvature, safe speed, and world-position offsets.
- Protocol validation: nicknames, colours, hello/room/state schemas, numeric
  ranges, unknown types, and message normalisation.
- Physics and race logic: countdown, lap crossing, finish times, results,
  formatting and offline standings.
- Race authority: early/short finish rejection, ordered valid finishes,
  disconnect handling, finish grace timeout, and monotonic progress.
- Rooms: room codes, duplicate names, eight-rider limit, ninth-rider rejection,
  host-only start, ready checks, host migration, room cleanup, unknown room code
  errors, and state ignored outside a race.
- Server integration: HTTP health/leaderboard/game page, hello enforcement,
  two WebSocket clients creating/joining/readying/starting, leaving a room, and
  **leaderboard persistence across a full server restart with a file database**.
- Leaderboard: fastest/wins/recent tables, DNF exclusion, transaction rollback,
  and safe limit clamping.

## Production builds

Commands:

```powershell
npm run build
npm run build:server
```

Result: both pass. Vite builds 33 modules and emits `dist` with manifest at the
root. The main game chunk is 611.53 kB minified (156.91 kB gzip); Vite prints a
chunk-size warning only. The server bundle is written to
`server/server.bundle.mjs`.

## Offline browser smoke

Command:

```powershell
$env:RR_SMOKE_URL='http://127.0.0.1:4173'
node scripts\browser-smoke.mjs
```

Result: **all checks passed, no runtime console errors.**

Verified:

- Launcher loads; six colours and LAN control render.
- Toolbar popup page renders the rider, local best, and three actions.
- Nickname and bike colour survive a launcher reload.
- The local best time survives a launcher reload after an offline race.
- Game menu and 3D scene load with no AI before the race.
- Offline race starts; five AI rivals, traffic, throttle, HUD and steering work.
- Player bike is visible, has the YOU marker, and uses the persisted colour.
- Camera stays behind the player (distance check).
- Pause freezes the race; finish opens results; riders and times render.
- Live loop runs at 60 FPS at 1152x720 in headless Chrome with about 45-48 draw
  calls, above the 24 FPS acceptance floor.
- Screenshots were written under `artifacts/`.

Caveat: headless Chrome uses software rendering here. The 60 FPS figure is not a
guarantee for every real GPU, browser extension surface, or fullscreen display.

## LAN browser smoke

Commands:

```powershell
node scripts\lan-smoke.mjs
$env:RR_LAN_URL='http://127.0.0.1:<fresh-port>'
node scripts\lan-smoke.mjs
```

Result: **all checks passed** in both modes: an in-process server built from
source, and the extracted release's `server/server.bundle.mjs` with a fresh
database.

The test launches **two separate headless Chrome processes**, one host and one
guest. It uses the real launcher/game pages over HTTP and the real WebSocket
protocol. Verified:

- Both clients connect and see CONNECTED.
- Host creates a valid four-letter room; guest joins; both names and HOST tag
  render.
- Both ready up; host starts; both enter LAN mode with one remote bike each.
- Both finish. The local finish was deliberately triggered at 34.5s, before the
  server's 35s minimum, to exercise the client retry path. The server recorded a
  validated 35.27s finish, proving that early client estimates are retried and
  implausible times are not accepted.
- Results show both riders with no RACING rows and a validated total time.
- The shared leaderboard records both riders and exactly one race.
- The room returns to the lobby after results.
- No browser runtime errors in the external packaged-server run. Server error
  logs were checked in the in-process run.

This is a same-computer, two-browser-process test, not a two-PC test.

## Release package

Command:

```powershell
npm run package:release
```

Artifact:

```text
release/RoadRushLAN-Share.zip
Size: 407,639 bytes (398.1 KiB)
SHA-256: EDD22B00C4A5D4A0A6741ACB85EEF0F3AA5D4A0C73F25628CBB3E62F484DA7B3
```

Checks performed by the packaging script:

- Rebuilds the extension and server bundle from source.
- Copies only allowlisted extension output and server/release files.
- Rejects a staging folder it did not create.
- Creates forward-slash ZIP entries inside a clean root.
- Verifies `ChromeExtension/manifest.json` is directly at the expected path.
- Verifies the popup and all manifest icons exist.
- Verifies `LANServer/Start-LAN-Server.ps1`, `LANServer/web/game.html`, server
  bundle and README files.
- Rejects `node_modules`, tests, source folders, SQLite files, logs and `.env`
  files in the ZIP.
- Extracts the actual ZIP to a fresh folder and starts the extracted server on a
  temporary port.
- Confirms `/api/health`, `/play` HTML and an empty fresh `/api/leaderboard`.
- Runs the offline browser smoke against the extracted release's own web build
  and server; all checks pass.
- Runs the two-client LAN browser smoke against the extracted release's server;
  all checks pass.

`Start-LAN-Server.ps1` was separately started from an extracted ZIP folder. It
reported Node.js detection correctly, served the game, and used a fresh empty
database.

## Not tested / manual steps

These were **not performed** and must not be reported as passing:

1. **Loading the unpacked extension in branded Chrome/Edge.** The installed
   branded browsers log `--load-extension is not allowed` and ignore
   command-line extension loading. A human must open `chrome://extensions`,
   enable Developer mode, load the extracted `ChromeExtension` folder, click the
   toolbar icon, and complete an offline race. The HTTP smoke covers page code
   and the storage fallback, but not actual `chrome.storage`/`chrome.tabs`
   behaviour.
2. **Two physical PCs on a real LAN.** The two-client test uses two browser
   processes on one computer. A real two-PC test should confirm host IP entry,
   Windows Firewall Private-network permission, remote movement, finish and
   leaderboard.
3. **Real fullscreen and toolbar-button gestures.** These need a real user
   gesture in the installed extension.
4. **A representative hardware performance run.** Headless software rendering
   is not a substitute for a real GPU test at the user's chosen resolution.
5. **Internet-offline enforcement.** The game makes no external requests and the
   offline race needs no server, but the network adapter was not disabled during
   the test.
6. **Extended reconnect/resume during a race.** Disconnects are handled by
   marking the rider and finalising when appropriate; there is no full mid-race
   state-resume feature.
7. **Ninth-player over a real WebSocket integration test.** The eight-player cap
   and ninth rejection are covered by the room-manager unit test.

## Security and scope notes

- The server is intended for a trusted private LAN only. Do not expose it to the
  internet or forward its port.
- Nicknames are not verified identities. Results are server-validated, but this
  is not an authenticated anti-cheat service.
- The release database is created empty on first start. Existing user databases
  must not be replaced automatically.
- The leaderboard stores only nicknames, race metadata, positions and times.
