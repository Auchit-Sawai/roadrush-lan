import '../src/styles/popup.css';
import { createStore } from '../src/storage/LocalStore.js';
import { loadRecords, loadSettings } from '../src/storage/Settings.js';
import { formatTime } from '../src/game/RaceManager.js';

function byId(id) {
  return document.getElementById(id);
}

function extensionUrl(page, query = '') {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL(page) + query;
  return page + query;
}

function openTab(url) {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
      window.close();
      return;
    }
  } catch {
    // fall through
  }
  window.open(url, '_blank', 'noopener');
}

async function boot() {
  const store = createStore();
  const settings = await loadSettings(store);
  const records = await loadRecords(store);
  byId('rider').textContent = settings.nickname;
  const best = records['sunset-ridge'];
  byId('best').textContent = best?.bestTime ? formatTime(best.bestTime) : '--:--.---';

  byId('quick-race').addEventListener('click', () => openTab(extensionUrl('game.html', '?autostart=1')));
  byId('open-game').addEventListener('click', () => openTab(extensionUrl('game.html')));
  byId('open-launcher').addEventListener('click', () => openTab(extensionUrl('launcher.html')));
}

boot().catch((error) => {
  console.error(error);
  const rider = byId('rider');
  if (rider) rider.textContent = 'Unavailable';
});
