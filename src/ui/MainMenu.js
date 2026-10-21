import {
  BIKE_COLORS,
  RESOLUTIONS,
  saveSettings,
  sanitizeNickname,
} from '../storage/Settings.js';
import { formatTime } from '../game/RaceManager.js';

function byId(id) {
  return document.getElementById(id);
}

export class MainMenu {
  constructor(options) {
    this.settings = options.settings;
    this.store = options.store;
    this.callbacks = options.callbacks ?? {};
    this.trackId = options.trackId ?? 'sunset-ridge';
    this.root = byId('menu-screen');
    this.nickname = byId('nickname');
    this.resolution = byId('resolution');
    this.graphics = byId('graphics');
    this.difficulty = byId('difficulty');
    this.audio = byId('audio');
    this.swatches = byId('color-swatches');
    this.fullscreenButton = byId('fullscreen-toggle');
    this.best = byId('menu-best');
    this.saveState = byId('save-state');
    this.storageKind = byId('storage-kind');
    this.saveTimer = null;
    this.swatchButtons = new Map();

    for (const entry of RESOLUTIONS) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.label;
      this.resolution.append(option);
    }

    for (const color of BIKE_COLORS) this.addSwatch(color);

    this.nickname.addEventListener('input', () => {
      const value = this.nickname.value.slice(0, 20);
      this.settings.nickname = value;
      this.notifySettings();
      this.scheduleSave();
    });
    this.nickname.addEventListener('blur', () => {
      const clean = sanitizeNickname(this.nickname.value);
      this.nickname.value = clean;
      this.settings.nickname = clean;
      this.notifySettings();
      this.scheduleSave();
    });

    this.resolution.addEventListener('change', () => {
      this.settings.resolution = this.resolution.value;
      this.notifySettings();
      this.scheduleSave();
    });

    this.graphics.addEventListener('change', () => {
      this.settings.graphics = this.graphics.value;
      this.notifySettings();
      this.scheduleSave();
    });

    this.difficulty.addEventListener('change', () => {
      this.settings.difficulty = this.difficulty.value;
      this.notifySettings();
      this.scheduleSave();
    });

    this.audio.addEventListener('change', () => {
      this.settings.audio = this.audio.checked;
      this.notifySettings();
      this.scheduleSave();
    });

    this.fullscreenButton.addEventListener('click', () => {
      this.callbacks.onFullscreenToggle?.();
    });

    byId('start-race').addEventListener('click', () => this.callbacks.onStartRace?.());
    byId('open-lan').addEventListener('click', () => this.callbacks.onOpenLAN?.());

    this.applySettings();
    if (this.storageKind) {
      this.storageKind.textContent = options.storageKind ? `STORAGE: ${options.storageKind.toUpperCase()}` : '';
    }
  }

  addSwatch(color) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.color = color;
    button.style.background = color;
    button.title = color;
    button.setAttribute('aria-label', `Bike colour ${color}`);
    button.addEventListener('click', () => {
      this.settings.color = color;
      this.selectSwatch(color);
      this.notifySettings();
      this.scheduleSave();
    });
    this.swatches.append(button);
    this.swatchButtons.set(color, button);
  }

  selectSwatch(color) {
    for (const [value, button] of this.swatchButtons) {
      button.classList.toggle('selected', value.toLowerCase() === color.toLowerCase());
      button.setAttribute('aria-pressed', value.toLowerCase() === color.toLowerCase() ? 'true' : 'false');
    }
  }

  applySettings() {
    this.nickname.value = this.settings.nickname;
    this.resolution.value = this.settings.resolution;
    this.graphics.value = this.settings.graphics;
    this.difficulty.value = this.settings.difficulty;
    this.audio.checked = Boolean(this.settings.audio);
    if (!this.swatchButtons.has(this.settings.color)) this.addSwatch(this.settings.color);
    this.selectSwatch(this.settings.color);
  }

  notifySettings() {
    this.callbacks.onSettingsChanged?.(this.settings);
  }

  scheduleSave() {
    this.saveState.textContent = 'SAVING';
    this.saveState.classList.add('saving');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      const saved = await saveSettings(this.store, this.settings);
      this.saveState.textContent = saved ? 'SAVED' : 'LOCAL ONLY';
      this.saveState.classList.toggle('saving', !saved);
    }, 320);
  }

  setBest(record) {
    if (record && Number.isFinite(record.bestTime)) {
      this.best.textContent = formatTime(record.bestTime);
      this.best.title = `${record.races || 0} races · ${record.wins || 0} wins`;
    } else {
      this.best.textContent = '--:--.---';
      this.best.title = '';
    }
  }

  setFullscreenState(active) {
    this.fullscreenButton.textContent = active ? 'EXIT FULLSCREEN' : 'ENTER FULLSCREEN';
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  isVisible() {
    return !this.root.classList.contains('hidden');
  }
}
