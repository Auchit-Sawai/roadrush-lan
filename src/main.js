import './styles/game.css';
import { createStore } from './storage/LocalStore.js';
import {
  loadRecords,
  loadSettings,
  recordRaceResult,
  saveRecords,
  saveSettings,
} from './storage/Settings.js';
import { MainMenu } from './ui/MainMenu.js';
import { HUD } from './ui/HUD.js';
import { Results } from './ui/Results.js';
import { LANMenu } from './ui/LANMenu.js';
import { Game } from './game/Game.js';
import { SoundEngine } from './game/Sound.js';

const TRACK_ID = 'sunset-ridge';

class App {
  constructor(options) {
    this.store = options.store;
    this.settings = options.settings;
    this.records = options.records;
    this.sound = options.sound;
    this.resultsMode = 'offline';
    this.toastTimer = null;

    this.pauseScreen = document.getElementById('pause-screen');
    this.pauseSubtitle = document.getElementById('pause-subtitle');
    this.resultsScreen = document.getElementById('results-screen');

    this.hud = new HUD();
    this.results = new Results({
      onRestart: () => this.restartRace(),
      onMenu: () => this.showMenu(),
      onLAN: () => this.returnToLANLobby(),
    });

    this.menu = new MainMenu({
      settings: this.settings,
      store: this.store,
      records: this.records,
      trackId: TRACK_ID,
      storageKind: this.store.kind,
      callbacks: {
        onStartRace: () => this.startOffline(),
        onOpenLAN: () => this.openLAN(),
        onSettingsChanged: (settings) => this.applySettings(settings),
        onFullscreenToggle: () => this.toggleFullscreen(),
        onToast: (message) => this.toast(message),
      },
    });

    this.lan = new LANMenu({
      settings: this.settings,
      callbacks: {
        onBack: () => this.closeLAN(),
        onRaceStart: (session, info) => this.startLANRace(session, info),
        onToast: (message) => this.toast(message),
        onDisconnected: () => this.toast('LAN connection lost. Return to the lobby or reconnect.'),
      },
    });

    this.game = new Game({
      canvas: document.getElementById('game-canvas'),
      settings: this.settings,
      hud: this.hud,
      sound: this.sound,
      callbacks: {
        onFinish: (results, options) => this.handleFinish(results, options),
        onPauseChange: (paused) => this.handlePause(paused),
        onEscape: () => this.handleEscape(),
        onRestartKey: () => this.handleRestartKey(),
        onToast: (message) => this.toast(message),
      },
    });

    document.getElementById('resume-race').addEventListener('click', () => this.game.resume());
    document.getElementById('pause-restart').addEventListener('click', () => this.restartRace());
    document.getElementById('quit-menu').addEventListener('click', () => this.showMenu());

    document.addEventListener('fullscreenchange', () => {
      const active = Boolean(document.fullscreenElement);
      this.menu.setFullscreenState(active);
      this.settings.fullscreen = active;
      saveSettings(this.store, this.settings);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game.running && !this.game.paused && !this.game.localFinished) {
        this.game.pause();
      }
    });

    this.menu.setFullscreenState(Boolean(document.fullscreenElement));
    this.menu.setBest(this.records[TRACK_ID]);
    this.showMenu();
    this.sound.setEnabled(this.settings.audio);
  }

  applySettings(settings) {
    this.sound.setEnabled(settings.audio);
    this.game.setPlayerColor(settings.color);
    if (this.game.builtGraphics !== settings.graphics) {
      this.game.setGraphicsPreset(settings.graphics);
    }
    this.game.resize();
  }

  startOffline() {
    if (this.game.running) return;
    this.menu.hide();
    this.lan.hide();
    this.results.hide();
    this.pauseScreen.classList.add('hidden');
    this.hud.show();
    this.sound.setEnabled(this.settings.audio);
    if (this.settings.fullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        this.toast('Fullscreen was refused by the browser. Windowed mode is still available.');
      });
    }
    this.game.startRace({ mode: 'offline' });
  }

  restartRace() {
    if (this.resultsMode === 'lan') {
      this.returnToLANLobby();
      return;
    }
    this.results.hide();
    this.pauseScreen.classList.add('hidden');
    this.hud.show();
    this.sound.setEnabled(this.settings.audio);
    this.game.startRace({ mode: 'offline' });
  }

  startLANRace(session, info) {
    this.resultsMode = 'lan';
    this.results.hide();
    this.pauseScreen.classList.add('hidden');
    this.lan.hide();
    this.hud.show();
    this.sound.setEnabled(this.settings.audio);
    this.game.startRace({ mode: 'lan', session, info });
  }

  handleFinish(results, options) {
    this.pauseScreen.classList.add('hidden');
    this.hud.hide();
    if (options?.lan) {
      this.resultsMode = 'lan';
      this.results.show(results, {
        lan: true,
        waiting: Boolean(options.waiting),
        note: options.note,
      });
      return;
    }

    this.resultsMode = 'offline';
    const normalized = {
      ...results,
      standings: (results.standings ?? []).map((entry, index) => ({
        ...entry,
        position: index + 1,
      })),
    };
    this.records = recordRaceResult(this.records, TRACK_ID, normalized);
    saveRecords(this.store, this.records).then((saved) => {
      if (!saved) this.toast('Race result could not be saved locally, but gameplay is unaffected.');
      this.menu.setBest(this.records[TRACK_ID]);
    });
    this.menu.setBest(this.records[TRACK_ID]);
    this.results.show(normalized, { lan: false, waiting: false });
  }

  handlePause(paused) {
    this.pauseScreen.classList.toggle('hidden', !paused);
    this.pauseSubtitle.textContent = this.game.mode === 'lan'
      ? 'The LAN race keeps running on the host while this screen is open. You can still resume.'
      : 'The race timer is stopped while the race is paused.';
    if (paused) this.hud.setCountdown(null);
  }

  handleEscape() {
    if (!this.pauseScreen.classList.contains('hidden')) {
      this.game.resume();
      return;
    }
    if (!this.resultsScreen.classList.contains('hidden')) return;
    if (this.lan.isVisible()) {
      this.closeLAN();
      return;
    }
    if (this.game.running) this.game.pause();
  }

  handleRestartKey() {
    if (this.resultsMode === 'lan') return;
    if (!this.resultsScreen.classList.contains('hidden')) this.restartRace();
  }

  openLAN() {
    this.game.stopRace();
    this.menu.hide();
    this.results.hide();
    this.pauseScreen.classList.add('hidden');
    this.hud.hide();
    this.resultsMode = 'lan';
    this.lan.open();
  }

  closeLAN() {
    this.lan.shutdown();
    this.showMenu();
  }

  returnToLANLobby() {
    this.results.hide();
    this.hud.hide();
    this.pauseScreen.classList.add('hidden');
    this.game.stopRace();
    this.lan.open();
  }

  showMenu() {
    this.results.hide();
    this.pauseScreen.classList.add('hidden');
    this.lan.hide();
    this.hud.hide();
    this.game.stopRace();
    this.menu.setBest(this.records[TRACK_ID]);
    this.menu.setFullscreenState(Boolean(document.fullscreenElement));
    this.menu.show();
    this.resultsMode = 'offline';
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      this.toast('The browser refused fullscreen. You can keep playing in a normal window.');
    }
  }

  toast(message) {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => element.classList.add('hidden'), 4500);
  }
}

async function boot() {
  const store = createStore();
  const settings = await loadSettings(store);
  const records = await loadRecords(store);
  const sound = new SoundEngine();
  sound.setEnabled(settings.audio);
  const app = new App({ store, settings, records, sound });

  window.__roadrush = {
    ready: true,
    version: '0.1.0',
    startOffline: () => app.startOffline(),
    showMenu: () => app.showMenu(),
    openLAN: () => app.openLAN(),
    connectLAN: () => app.lan.connect(),
    state: () => app.game.getDebugState(),
    input: (input) => app.game.setDebugInput(input),
    step: (seconds) => app.game.debugStep(seconds),
    forceStart: () => app.game.forceRaceStart(),
    finishNow: () => app.game.finishNow(),
    pause: () => app.game.pause(),
    resume: () => app.game.resume(),
    settings: () => ({ ...app.settings }),
    records: () => ({ ...app.records }),
    storageKind: store.kind,
  };
  document.documentElement.dataset.roadrushReady = 'true';

  // LAN play needs the host's own server, which a hosted copy on github.io can never reach.
  if (/github.io$/.test(location.hostname)) {
    document.getElementById('open-lan')?.classList.add('hidden');
    const note = document.getElementById('storage-kind');
    if (note) note.textContent = 'ONLINE DEMO · LAN MODE NEEDS THE DESKTOP BUILD';
  }

  const params = new URLSearchParams(location.search);
  if (params.get('autostart') === '1') {
    app.startOffline();
  } else if (params.get('lan') === '1') {
    app.openLAN();
    setTimeout(() => app.lan.connect(), 60);
  }
}

boot().catch((error) => {
  console.error('RoadRush failed to start', error);
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#0a1018;color:#f3eee2;font-family:Segoe UI,sans-serif;z-index:99;padding:30px;text-align:center';
  panel.innerHTML = '<div><h2 style="color:#e63946">RoadRush could not start</h2><p>The WebGL renderer or game assets failed to load.</p><p style="color:#93a4b6;max-width:60ch"></p></div>';
  panel.querySelector('p:last-child').textContent = String(error?.message || error);
  document.body.append(panel);
});
