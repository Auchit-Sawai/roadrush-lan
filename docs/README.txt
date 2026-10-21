ROADRUSH LAN - FRIEND RELEASE
=============================

Contents
--------
ChromeExtension\   Chrome/Edge extension. Single-player works immediately.
LANServer\         Multiplayer server for one trusted LAN.
README.txt         This file.

WHAT YOU NEED
-------------
- Chrome 110+ or Edge.
- Single-player: nothing else. No Node.js, no server, no internet.
- Multiplayer host: Node.js 24 LTS or newer from https://nodejs.org/
- All riders on the same trusted network.

STEP 1 - INSTALL THE EXTENSION (EVERY PLAYER)
---------------------------------------------
1. Extract this ZIP to a normal folder. Do not run it from inside the ZIP.
2. Open Chrome and go to: chrome://extensions
   (In Edge: edge://extensions)
3. Turn on Developer mode.
4. Click "Load unpacked".
5. Select the ChromeExtension folder - the one that contains manifest.json.
   Do NOT select the outer folder or LANServer.
6. The RoadRush LAN icon appears in the toolbar. Pin it if you like.

If the extension shows an error, make sure manifest.json is directly inside the
folder you selected and that the assets and icons folders are next to it.

STEP 2 - PLAY ALONE
-------------------
1. Click the RoadRush LAN toolbar icon.
2. Choose Single Player.
3. Pick a nickname, colour and quality, then race.

Single-player is fully offline. Node.js and the LAN server are not used.

STEP 3 - HOST A MULTIPLAYER RACE
--------------------------------
1. Open the LANServer folder.
2. Double-click Start-LAN-Server.ps1.
   If that opens an editor, right-click it and choose "Run with PowerShell".
3. If Windows Firewall asks, allow Node.js on PRIVATE networks only.
4. Keep the black server window open. It prints a Local game page and one or
   more Network game addresses.
5. On the host PC, open the Local game page:
   http://127.0.0.1:8787/play
6. Choose LAN mode, enter your nickname, and click Create Room.
7. Share the four-letter room code and the Network game address with friends.

STEP 4 - JOIN A MULTIPLAYER RACE (OTHER PLAYERS)
------------------------------------------------
1. Make sure the RoadRush LAN extension is installed.
2. Click the toolbar icon and choose LAN Multiplayer.
3. Enter the host address, for example: 192.168.1.23:8787
   Use the Network game address shown in the host's server window.
4. Click Connect, enter the room code, and click Join Room.
5. Click Ready. The host starts the race when everyone is ready.

You can also open the host's Network game address directly in Chrome or Edge
and join there. The extension is still needed for single-player.

FIREWALL AND SAFETY
-------------------
- Allow Node.js on Private networks only. Do not turn off Windows Firewall.
- Do not forward port 8787 on the router and do not put this server on the
  public internet.
- Use a trusted home, office or hotspot LAN. Guest Wi-Fi may block PC-to-PC play.
- Nicknames are not accounts or proof of identity. This is a friendly LAN
  scoreboard, not an anti-cheat service.

STOPPING THE SERVER
-------------------
Press Ctrl+C in the server window or close that window. If Ctrl+C does not work,
close the window. Do not delete the data folder while the server is running.

LEADERBOARD AND BACKUP
----------------------
The server creates this database on first start:
LANServer\data\roadrush.sqlite

It stores nicknames, race times and positions only. To back up, stop the server
and copy the whole data folder. To restore, stop the server and copy it back.
Never replace an existing database without the owner's permission.

COMMON PROBLEMS
---------------
"Node.js not found" or "too old":
    Install Node.js 24 LTS or newer, then reopen the start script.

"Port 8787 is already in use":
    Close the other server. Or run:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-LAN-Server.ps1 -Port 8788
    Riders must then use the new port.

Riders cannot connect:
    - Same network? Guest Wi-Fi often blocks PC-to-PC traffic.
    - Correct host address and port?
    - Node.js allowed on Private networks in Windows Firewall?
    - Server window still open?
    - Ask the host to read the Network game address again.

Game page will not load:
    Start the server with Start-LAN-Server.ps1. It must run from the LANServer
    folder, where server.bundle.mjs and the web folder live.

TESTING NOTES
-------------
Automated checks cover offline play, LAN rooms with two browser clients, race
validation, leaderboard persistence and release structure. A two-PC physical
test was not performed by the developer. Please try it with a friend on the same
trusted LAN and report anything that fails.
