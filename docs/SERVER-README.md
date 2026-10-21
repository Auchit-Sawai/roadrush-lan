# RoadRush LAN Server

This folder is the multiplayer half of the RoadRush LAN release. It serves the
game page, accepts LAN WebSocket connections, validates race finishes, and keeps
the shared SQLite leaderboard. Single-player works without this server.

## Requirements

- Windows 10 or 11
- Node.js 24 LTS or newer: https://nodejs.org/
- A trusted private LAN shared by all riders

No administrator account, external service, account sign-in or internet access
is required after Node.js is installed.

## Start the server

1. Extract the whole ZIP first. Do not run files from inside the ZIP preview.
2. Open the `LANServer` folder.
3. Double-click `Start-LAN-Server.ps1`.
   - If double-clicking opens an editor, right-click the file and choose
     **Run with PowerShell**.
   - If Windows blocks the script, open PowerShell in this folder and run:
     `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-LAN-Server.ps1`
4. If Windows Firewall asks, allow Node.js on **Private networks** only.
5. Keep the server window open. It prints the local page and the addresses to
   share with riders.

The default port is 8787. To use another port:

```powershell
.\Start-LAN-Server.ps1 -Port 8788
```

To stop the server, press `Ctrl+C` in its window or close the window. Do not use
Task Manager unless the window is unresponsive.

## Host a race

1. On the host PC, open `http://127.0.0.1:8787/play`.
2. Choose LAN mode, enter a nickname, and create a room.
3. Give every rider the four-character room code.
4. Riders load the Chrome extension, open LAN mode, enter the host address shown
   in the server window (for example `192.168.1.23:8787`), and join the code.
5. Everyone selects Ready. The host starts the race.

Riders can also open the host's network game URL directly in a browser instead
of using the extension. The extension is still required for single-player.

## Firewall and network safety

- Allow Node.js only on Private networks. Do not disable Windows Firewall.
- Do not forward port 8787 on the router and do not expose it to the internet.
- Use this only on a trusted home or office LAN, not public Wi-Fi.
- The server has no accounts or passwords. Nicknames are not verified identity.
- The server is a trusted-LAN scoreboard, not a cheat-proof competitive service.

If riders cannot connect, check that all PCs are on the same network, that the
host address is the private IPv4 address printed by the server, and that Windows
Firewall allows Node.js on Private networks. A phone hotspot can work if all PCs
are connected to it.

## Leaderboard storage

The server creates a fresh database automatically at:

```text
LANServer\data\roadrush.sqlite
```

It contains nicknames, race times, positions and race metadata only. No account
or personal details are collected.

To back up the scoreboard:

1. Stop the server.
2. Copy `data\roadrush.sqlite` and, if present, `data\roadrush.sqlite-wal` and
   `data\roadrush.sqlite-shm` to a safe folder.
3. Restart the server.

To restore, stop the server, put those files back in `data`, then restart. Never
delete or replace an existing database during an upgrade without asking the
owner first.

## Troubleshooting

**"Node.js was not found" or "too old"**
Install Node.js 24 LTS or newer, then close and reopen the script.

**"Port 8787 is already in use"**
Close the other server, or start this one with `.\Start-LAN-Server.ps1 -Port 8788`.
Riders must then use port 8788 in the host address.

**Riders time out**
Confirm the host address, same LAN, and Private-network firewall permission.
Guest networks often block PC-to-PC traffic.

**The leaderboard is empty after moving PCs**
The database lives in `LANServer\data`; copy it with the server if you want to
keep scores. A new folder intentionally starts empty.

**The game page will not load**
Make sure `web\game.html` exists inside `LANServer` and start the server from the
`LANServer` folder. The included script does this automatically.
