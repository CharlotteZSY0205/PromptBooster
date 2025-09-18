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

async function handleBoostRequest(payload) {
  const { originalPrompt } = payload;
  if (!originalPrompt || !originalPrompt.trim()) {
    throw new Error('Prompt is empty.');
  }

  const settings = await getSettings();
  const messages = buildChatMessages({
    originalPrompt,
    modeId: settings.defaultMode
  });

  const optimizedPrompt = await callLLM({
    apiKey: settings.apiKey,
    apiBaseUrl: settings.apiBaseUrl,
    model: settings.model,
    messages
  });

  return optimizedPrompt;
}
