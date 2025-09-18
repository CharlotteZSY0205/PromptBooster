import { DEFAULT_SETTINGS, STORAGE_KEY } from './constants.js';

function mergeSettings(partial) {
  return { ...DEFAULT_SETTINGS, ...partial };
}

export async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return mergeSettings(stored[STORAGE_KEY] || {});
}

export async function saveSettings(partialUpdate) {
  const current = await getSettings();
  const next = { ...current, ...partialUpdate };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

export function observeSettings(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) {
      return;
    }
    const { newValue } = changes[STORAGE_KEY];
    callback(mergeSettings(newValue || {}));
  });
}
