# RoadRush LAN - milestone checklist

Updated as work is actually completed and tested.

- [x] Phase 0 - Workspace inspected, game folder isolated, toolchain checked (Node 26.4.0, Chrome, Edge).
- [x] Phase 1 - Playable offline race: menu, 3D track, bike physics, traffic, crashes, AI, timer, results, pause/restart. Browser smoke passes.
- [x] Phase 2 - Settings persistence, local records, fixed timestep, performance presets, resize/fullscreen handling implemented. Nickname/colour persistence and resize are covered by smoke; real fullscreen still needs a manual gesture. Live loop measured 60 FPS at 1152x720 in headless Chrome.
- [ ] Phase 3 - Manifest V3 production extension built and packaged; manifest/assets are verified. Manual unpacked load in Chrome/Edge still needs a human gesture because this environment's branded browsers ignore command-line extension loading.
- [ ] Phase 4 - LAN server, rooms, 8-player cap, synchronized countdown, remote bike interpolation, disconnect handling implemented. Local two-browser end-to-end race passes; the two-physical-PC acceptance check was not performed.
- [x] Phase 5 - SQLite leaderboard, server-validated finishes, and persistence across a server restart with a file database. Automated restart test and two-client LAN race pass.
- [x] Phase 6 - 45 automated tests, offline browser smoke, two-browser LAN smoke, production builds, README, server instructions and test report.
- [x] Phase 7 - `release/RoadRushLAN-Share.zip` built; allowlisted layout, forward-slash ZIP paths, extracted extension files, and extracted-server health/game-page checks pass.

## Known constraints

- Two physical PCs are not available to this session unless Auchit runs the second client. The two-PC check is reported as not performed, not passed.
- Branded Chrome/Edge in this environment print `--load-extension is not allowed` and ignore unpacked-extension automation. Manual extension load and toolbar-button testing remain a user step.
- Fullscreen and real toolbar-button behavior require a manual user gesture. Browser smoke covers the code path and page rendering, not the real extension surface.
- Multiplayer is a trusted-LAN friendly scoreboard. It is not an authenticated or cheat-proof competitive service.
