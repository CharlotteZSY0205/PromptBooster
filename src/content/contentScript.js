import { DEFAULT_SETTINGS, MODES } from '../common/constants.js';
import { getSettings, observeSettings } from '../common/storage.js';

let currentSettings = { ...DEFAULT_SETTINGS };
let isProcessing = false;
let boostButton = null;
const pendingHistory = [];
const annotatedBubbles = new WeakSet();

init();

function init() {
  injectStyles();
  loadSettings();
  setupSettingsObserver();
  setupComposerObserver();
  setupMessageObserver();
}

async function loadSettings() {
  currentSettings = await getSettings();
  updateButtonTooltip();
}

function setupSettingsObserver() {
  observeSettings((settings) => {
    currentSettings = settings;
    updateButtonTooltip();
  });
}

function setupComposerObserver() {
  const observer = new MutationObserver(() => {
    ensureBoostButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureBoostButton();
}

function setupMessageObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }
        annotateIfUserMessage(node);
        const userMessages = node.querySelectorAll?.('[data-message-author-role="user"]');
        userMessages?.forEach(annotateIfUserMessage);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function annotateIfUserMessage(node) {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  if (!node.matches('[data-message-author-role="user"]')) {
    return;
  }
  if (annotatedBubbles.has(node)) {
    return;
  }
  const normalizedText = normalizeText(node.textContent || '');
  if (!normalizedText) {
    return;
  }
  if (pendingHistory.length === 0) {
    return;
  }

  const next = pendingHistory[0];
  const normalizedOptimized = normalizeText(next.optimized || '');
  if (!normalizedOptimized) {
    pendingHistory.shift();
    return;
  }
  if (!normalizedText.includes(normalizedOptimized)) {
    return;
  }

  appendOriginalPrompt(node, next.original);
  annotatedBubbles.add(node);
  pendingHistory.shift();
}

function appendOriginalPrompt(container, originalText) {
  const note = document.createElement('div');
  note.className = 'promptbooster-original-note';
  note.innerHTML = `Original prompt: <span>${escapeHtml(originalText)}</span>`;
  container.appendChild(note);
}

function ensureBoostButton() {
  const composer = findComposer();
  if (!composer) {
    return;
  }

  const sendButton = findSendButton(composer);
  if (!sendButton) {
    return;
  }

  if (!boostButton) {
    boostButton = document.createElement('button');
    boostButton.type = 'button';
    boostButton.className = 'promptbooster-button';
    boostButton.textContent = 'Boost Prompt';
    boostButton.addEventListener('click', onBoostClick);
    updateButtonTooltip();
  }

  if (boostButton.isConnected) {
    return;
  }

  sendButton.parentElement?.insertBefore(boostButton, sendButton);
}

function findComposer() {
  const composerSelectors = [
    'form[data-testid="conversation-compose"]',
    'form[method="post"]'
  ];
  for (const selector of composerSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}

function findSendButton(root = document) {
  return (
    root.querySelector('button[data-testid="send-button"]') ||
    root.querySelector('button[aria-label="Send message"]') ||
    root.querySelector('button[type="submit"]')
  );
}

function findTextarea() {
  return document.querySelector('textarea');
}

function onBoostClick() {
  if (isProcessing) {
    return;
  }
  const textarea = findTextarea();
  if (!textarea) {
    showToast('Unable to find the chat input field.');
    return;
  }

  const originalPrompt = textarea.value.trim();
  if (!originalPrompt) {
    showToast('Type a prompt first, then click Boost Prompt.');
    return;
  }

  setProcessingState(true);
  chrome.runtime.sendMessage(
    {
      type: 'BOOST_PROMPT',
      payload: { originalPrompt }
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error('PromptBooster messaging error:', chrome.runtime.lastError);
        showToast('Prompt boosting failed to start. Try again in a moment.');
        setProcessingState(false);
        return;
      }
      if (!response?.ok) {
        showToast(response?.error || 'Prompt boosting failed.');
        setProcessingState(false);
        return;
      }

      const optimizedPrompt = response.optimizedPrompt;
      if (currentSettings.previewBeforeSend) {
        showPreview({ originalPrompt, optimizedPrompt });
      } else {
        applyOptimizedPrompt({ originalPrompt, optimizedPrompt, autoSend: true });
      }
    }
  );
}

function applyOptimizedPrompt({ originalPrompt, optimizedPrompt, autoSend }) {
  const textarea = findTextarea();
  if (!textarea) {
    showToast('Unable to update the chat input field.');
    setProcessingState(false);
    return;
  }

  textarea.value = optimizedPrompt;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  pendingHistory.push({ original: originalPrompt, optimized: optimizedPrompt });

  if (autoSend) {
    sendPrompt();
    setProcessingState(false);
  } else {
    setProcessingState(false);
  }
}

function sendPrompt() {
  const sendButton = findSendButton();
  if (sendButton) {
    sendButton.click();
    return;
  }

  const textarea = findTextarea();
  if (!textarea) {
    return;
  }
  const keyboardEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    which: 13,
    keyCode: 13,
    bubbles: true
  });
  textarea.dispatchEvent(keyboardEvent);
}

function showPreview({ originalPrompt, optimizedPrompt }) {
  removeExistingPreview();
  const composer = findComposer();
  if (!composer) {
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt, autoSend: false });
    return;
  }

  const preview = document.createElement('div');
  preview.className = 'promptbooster-preview';
  preview.innerHTML = `
    <div class="promptbooster-preview__header">Preview boosted prompt</div>
    <div class="promptbooster-preview__content">
      <section>
        <h4>Original</h4>
        <p>${escapeHtml(originalPrompt)}</p>
      </section>
      <section>
        <h4>Boosted</h4>
        <p>${escapeHtml(optimizedPrompt)}</p>
      </section>
    </div>
    <div class="promptbooster-preview__actions">
      <button type="button" class="promptbooster-secondary" data-action="cancel">Keep original</button>
      <button type="button" class="promptbooster-primary" data-action="apply">Send boosted</button>
    </div>
  `;

  preview.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    removeExistingPreview();
    const textarea = findTextarea();
    if (textarea) {
      textarea.value = originalPrompt;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setProcessingState(false);
  });

  preview.querySelector('[data-action="apply"]').addEventListener('click', () => {
    removeExistingPreview();
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt, autoSend: true });
  });

  composer.appendChild(preview);
  setProcessingState(false);
}

function removeExistingPreview() {
  document.querySelectorAll('.promptbooster-preview').forEach((node) => node.remove());
}

function setProcessingState(state) {
  isProcessing = state;
  if (!boostButton) {
    return;
  }
  boostButton.disabled = state;
  boostButton.textContent = state ? 'Boosting…' : 'Boost Prompt';
}

function updateButtonTooltip() {
  if (!boostButton) {
    return;
  }
  const modeLabel = MODES[currentSettings.defaultMode]?.label || 'Learning Mode';
  boostButton.title = `Boost prompt with ${modeLabel}`;
}

function showToast(message) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'promptbooster-toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('promptbooster-toast--hide');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3200);
}

let toastContainer = null;
function getToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }
  toastContainer = document.createElement('div');
  toastContainer.className = 'promptbooster-toast-container';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function escapeHtml(value) {
  const stringValue = String(value ?? '');
  return stringValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectStyles() {
  if (document.getElementById('promptbooster-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'promptbooster-style';
  style.textContent = `
    .promptbooster-button {
      background: linear-gradient(90deg, #7c4dff, #3f51b5);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0 16px;
      margin-right: 8px;
      font-weight: 600;
      cursor: pointer;
      height: 36px;
      transition: transform 0.2s ease, opacity 0.2s ease;
    }
    .promptbooster-button:disabled {
      opacity: 0.6;
      cursor: progress;
      transform: none;
    }
    .promptbooster-button:not(:disabled):hover {
      transform: translateY(-1px);
    }
    .promptbooster-original-note {
      margin-top: 8px;
      padding: 8px 12px;
      border-left: 3px solid rgba(124, 77, 255, 0.65);
      background: rgba(63, 81, 181, 0.08);
      border-radius: 6px;
      font-size: 0.85rem;
      color: #4b5563;
      line-height: 1.4;
    }
    .promptbooster-original-note span {
      display: block;
      margin-top: 4px;
      color: #1f2937;
      white-space: pre-wrap;
    }
    .promptbooster-preview {
      margin-top: 12px;
      border: 1px solid rgba(124, 77, 255, 0.2);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 10px 30px rgba(28, 27, 74, 0.16);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 50;
    }
    .promptbooster-preview__header {
      font-weight: 600;
      font-size: 0.95rem;
      color: #1c1b4a;
    }
    .promptbooster-preview__content {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      font-size: 0.9rem;
      color: #1f2937;
    }
    .promptbooster-preview__content section {
      background: rgba(124, 77, 255, 0.06);
      border-radius: 10px;
      padding: 12px;
    }
    .promptbooster-preview__content h4 {
      margin: 0 0 6px 0;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #4338ca;
    }
    .promptbooster-preview__content p {
      margin: 0;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .promptbooster-preview__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .promptbooster-primary,
    .promptbooster-secondary {
      border-radius: 20px;
      padding: 6px 16px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .promptbooster-primary {
      background: linear-gradient(90deg, #7c4dff, #3f51b5);
      color: #fff;
    }
    .promptbooster-secondary {
      background: rgba(124, 77, 255, 0.12);
      color: #4338ca;
    }
    .promptbooster-toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 2147483647;
    }
    .promptbooster-toast {
      background: rgba(28, 27, 74, 0.95);
      color: #fff;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 0.85rem;
      box-shadow: 0 8px 20px rgba(28, 27, 74, 0.35);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    .promptbooster-toast--hide {
      opacity: 0;
      transform: translateY(6px);
    }
  `;
  document.head.appendChild(style);
}
