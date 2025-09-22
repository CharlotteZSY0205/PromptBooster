import { DEFAULT_SETTINGS, STORAGE_KEY } from '../common/constants.js';
import { getSettings } from '../common/storage.js';
import { buildChatMessages } from '../common/modes.js';
import { callLLM } from '../common/apiClient.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(STORAGE_KEY).then((result) => {
    if (!result[STORAGE_KEY]) {
      chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_OPTIONS') {
    openOptionsPage()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('PromptBooster options open failed:', err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true; // async
  }

  if (message?.type === 'BOOST_PROMPT') {
    handleBoostRequest(message.payload)
      .then((optimizedPrompt) => {
        sendResponse({ ok: true, optimizedPrompt });
      })
      .catch((error) => {
        console.error('PromptBooster boost failed:', error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
  return false;
});

async function openOptionsPage() {
  // Prefer the official API; falls back to opening the bundled HTML.
  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.openOptionsPage(() => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    });
    return;
  } catch (e) {
    // Fallbacks: try our known options path(s)
    const candidates = ['src/options/options.html', 'options.html'];
    for (const path of candidates) {
      try {
        const url = chrome.runtime.getURL(path);
        await chrome.tabs.create({ url });
        return;
      } catch {}
    }
    // Last resort: extensions page deep link
    try {
      await chrome.tabs.create({ url: `chrome://extensions/?options=${chrome.runtime.id}` });
      return;
    } catch (finalErr) {
      throw finalErr || e;
    }
  }
}

async function handleBoostRequest(payload) {
  const { originalPrompt, rule } = payload;
  if (!originalPrompt || !originalPrompt.trim()) {
    throw new Error('Prompt is empty.');
  }

  const settings = await getSettings();
  // Build messages for Boosted Prompt; include rule when provided
  const messages = buildChatMessages({
    originalPrompt,
    rule
  });

  const optimizedPrompt = await callLLM({
    apiKey: settings.apiKey,
    apiBaseUrl: settings.apiBaseUrl,
    model: settings.model,
    messages
  });

  return optimizedPrompt;
}
