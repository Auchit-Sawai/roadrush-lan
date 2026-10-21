const memory = new Map();

function hasChromeStorage() {
  try {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  } catch {
    return false;
  }
}

function chromeGet(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(result ? result[key] : undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function chromeSet(key, value) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: value }, () => {
        resolve(!(chrome.runtime && chrome.runtime.lastError));
      });
    } catch {
      resolve(false);
    }
  });
}

export function createStore() {
  const useChrome = hasChromeStorage();
  return {
    kind: useChrome ? 'chrome' : 'local',
    async get(key, fallback = undefined) {
      try {
        if (useChrome) {
          const value = await chromeGet(key);
          return value === undefined ? fallback : value;
        }
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return memory.has(key) ? memory.get(key) : fallback;
      }
    },
    async set(key, value) {
      try {
        if (useChrome) {
          const saved = await chromeSet(key, value);
          if (!saved) memory.set(key, value);
          return saved;
        }
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        memory.set(key, value);
        return false;
      }
    },
    async remove(key) {
      try {
        if (useChrome) {
          await new Promise((resolve) => chrome.storage.local.remove([key], resolve));
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        memory.delete(key);
      }
    },
  };
}
