import '../src/styles/launcher.css';
import { createStore } from '../src/storage/LocalStore.js';
import {
  BIKE_COLORS,
  RESOLUTIONS,
  loadRecords,
  loadSettings,
  saveSettings,
  sanitizeNickname,
} from '../src/storage/Settings.js';
import { formatTime } from '../src/game/RaceManager.js';

function byId(id) {
  return document.getElementById(id);
}

function openTab(path) {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: path });
      return;
    }
  } catch {
    // fall through to browser tab
  }
  window.open(path, '_blank', 'noopener');
}

function gameUrl(query = '') {
  const base = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('game.html')
    : 'game.html';
  return base + query;
}

function normalizeHost(value) {
  let text = String(value ?? '').trim();
  if (!text) throw new Error('Enter the host address printed by the server.');
  if (!/^[a-z]+:\/\//i.test(text)) text = `http://${text}`;
  const url = new URL(text);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Use an http:// address for the host page.');
  if (!url.port) url.port = '8787';
  return `${url.protocol}//${url.host}`;
}

async function boot() {
  const store = createStore();
  const settings = await loadSettings(store);
  const records = await loadRecords(store);
  let saveTimer = null;

  byId('nickname').value = settings.nickname;
  byId('graphics').value = settings.graphics;
  byId('audio').checked = settings.audio;
  byId('storage-kind').textContent = `STORAGE · ${store.kind.toUpperCase()}`;
  for (const resolution of RESOLUTIONS) {
    const option = document.createElement('option');
    option.value = resolution.id;
    option.textContent = resolution.label;
    byId('resolution').append(option);
  }
  byId('resolution').value = settings.resolution;

  const swatches = byId('swatches');
  for (const color of BIKE_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.background = color;
    button.title = color;
    button.addEventListener('click', () => {
      settings.color = color;
      refreshSwatches();
      scheduleSave();
    });
    swatches.append(button);
  }
  function refreshSwatches() {
    [...swatches.children].forEach((button) => {
      button.classList.toggle('selected', button.style.background === settings.color || button.title === settings.color);
    });
  }
  refreshSwatches();

  const best = records['sunset-ridge'];
  byId('best-time').textContent = best?.bestTime ? formatTime(best.bestTime) : '--:--.---';

  function scheduleSave() {
    byId('save-state').textContent = 'Saving…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      settings.nickname = sanitizeNickname(byId('nickname').value);
      settings.graphics = byId('graphics').value;
      settings.resolution = byId('resolution').value;
      settings.audio = byId('audio').checked;
      const saved = await saveSettings(store, settings);
      byId('save-state').textContent = saved ? 'Saved automatically.' : 'Could not save settings; gameplay is unaffected.';
    }, 250);
  }

  byId('nickname').addEventListener('input', scheduleSave);
  byId('nickname').addEventListener('blur', () => {
    byId('nickname').value = sanitizeNickname(byId('nickname').value);
    scheduleSave();
  });
  byId('graphics').addEventListener('change', scheduleSave);
  byId('resolution').addEventListener('change', scheduleSave);
  byId('audio').addEventListener('change', scheduleSave);

  byId('play-now').addEventListener('click', async () => {
    settings.nickname = sanitizeNickname(byId('nickname').value);
    await saveSettings(store, settings);
    openTab(gameUrl('?autostart=1'));
  });

  byId('open-game').addEventListener('click', async () => {
    settings.nickname = sanitizeNickname(byId('nickname').value);
    await saveSettings(store, settings);
    openTab(gameUrl());
  });

  byId('join-lan').addEventListener('click', () => {
    try {
      const host = normalizeHost(byId('server').value);
      byId('lan-status').textContent = `Opening ${host}/play …`;
      openTab(`${host}/play?lan=1&server=${encodeURIComponent(host)}`);
    } catch (error) {
      byId('lan-status').textContent = error.message;
    }
  });

  byId('server').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') byId('join-lan').click();
  });
}

boot().catch((error) => {
  console.error(error);
  const status = byId('lan-status');
  if (status) status.textContent = String(error?.message || error);
});
