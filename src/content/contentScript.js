/**
 * Inline constants and storage utilities to avoid ESM imports in MV3 content scripts.
 * Content scripts are classic scripts and cannot use `import` syntax.
 */
const MODES = {
  learning: {
    id: 'learning',
    label: 'Learning Mode',
    description:
      'Encourages deep, reflective thinking with clarifying questions and reasoning guidance.'
  },
  structured: {
    id: 'structured',
    label: 'Structured Mode',
    description: 'Adds a step-by-step structure with organized reasoning and summaries.'
  },
  concise: {
    id: 'concise',
    label: 'Concise Mode',
    description: 'Makes the prompt shorter, clearer, and more precise without losing intent.'
  },
  creative: {
    id: 'creative',
    label: 'Creative Mode',
    description: 'Expands the prompt with brainstorming and divergent thinking elements.'
  }
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  defaultMode: MODES.learning.id,
  previewBeforeSend: false
};

const STORAGE_KEY = 'promptBoosterSettings';

async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] || {}) };
}

function observeSettings(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[STORAGE_KEY]) return;
    const { newValue } = changes[STORAGE_KEY];
    callback({ ...DEFAULT_SETTINGS, ...(newValue || {}) });
  });
}

let currentSettings = { ...DEFAULT_SETTINGS };
let isProcessing = false;
let boostButton = null;
const pendingHistory = [];
const annotatedBubbles = new WeakSet();

const DEBUG = true;
function dbg(...args) {
  try {
    if (DEBUG) console.debug('[PromptBooster]', ...args);
  } catch {}
}

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

  // Retry for a short window on fresh loads
  const start = Date.now();
  const retry = setInterval(() => {
    ensureBoostButton();
    if (Date.now() - start > 10000) {
      clearInterval(retry);
    }
  }, 300);

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
  const sendButton = findSendButton();
  const trailingContainer = findTrailingContainer();

  if (!boostButton) {
    boostButton = document.createElement('button');
    boostButton.type = 'button';
    boostButton.className = 'promptbooster-button';
    boostButton.textContent = 'Boost Prompt';
    boostButton.setAttribute('data-testid', 'promptbooster-boost-btn');
    boostButton.addEventListener('click', onBoostClick);
    updateButtonTooltip();
  }

  // Prefer to place immediately before the send button when it exists
  if (sendButton) {
    const parent = sendButton.parentElement;
    if (!parent) {
      dbg('send button has no parent, cannot insert');
      return;
    }
    if (boostButton.isConnected && boostButton.parentElement === parent) {
      return;
    }
    try {
      parent.insertBefore(boostButton, sendButton);
      dbg('inserted Boost button before send button');
      return;
    } catch (e) {
      dbg('failed to insert before send button', e);
    }
  }

  // Fallback: append into the trailing container so it is visible even before send exists
  if (trailingContainer) {
    if (boostButton.isConnected && boostButton.parentElement === trailingContainer) {
      return;
    }
    try {
      trailingContainer.appendChild(boostButton);
      dbg('appended Boost button into trailing container (fallback)');
    } catch (e) {
      dbg('failed to append into trailing container', e);
    }
  } else {
    dbg('trailing container not found yet');
  }
}

function findComposer() {
  const composerSelectors = [
    'form[data-type="unified-composer"]',
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
    root.querySelector('#composer-submit-button') ||
    root.querySelector('button[data-testid="send-button"]') ||
    root.querySelector('button[aria-label="Send prompt"]') ||
    root.querySelector('button[aria-label="Send message"]') ||
    root.querySelector('button.composer-submit-btn') ||
    root.querySelector('button[type="submit"]')
  );
}

// Try to locate the trailing action container of the composer to host our button
function findTrailingContainer(root = document) {
  // The trailing area container often has a class literal like [grid-area:trailing]
  const area = root.querySelector('[class*="[grid-area:trailing]"]');
  if (!area) return null;

  // Inside it there is usually an inner flex container with the send button and icons
  const inner = area.querySelector('.ms-auto') || area.querySelector('.flex') || area;
  return inner || area;
}

function findEditor() {
  // Prefer ChatGPT's ProseMirror contenteditable editor
  const prosemirror = document.querySelector('div#prompt-textarea.ProseMirror[contenteditable="true"]');
  if (prosemirror) {
    return { type: 'prosemirror', el: prosemirror };
  }
  // Fallback to a visible textarea (older UIs)
  const visibleTextarea = document.querySelector('textarea:not([style*="display: none"])') || document.querySelector('textarea[name="prompt-textarea"]');
  if (visibleTextarea) {
    return { type: 'textarea', el: visibleTextarea };
  }
  return null;
}

function readPrompt() {
  const editor = findEditor();
  if (!editor) return '';
  if (editor.type === 'prosemirror') {
    return (editor.el.textContent || '').trim();
  }
  return (editor.el.value || '').trim();
}

// Ensure ProseMirror DOM reflects our text and caret is placed at end
function setProseMirrorContent(el, text) {
  const lines = String(text ?? '').split(/\n/);
  const html = lines.map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
  el.innerHTML = html;
  try {
    placeCaretAtEnd(el);
  } catch {}
}

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection?.();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function writePrompt(text) {
  const editor = findEditor();
  if (!editor) return false;

  if (editor.type === 'prosemirror') {
    const el = editor.el;
    try {
      el.focus();
      // Replace entire content via execCommand (some PM setups listen to this)
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } catch {}
    // Ensure DOM matches expected ProseMirror structure and caret is correct
    setProseMirrorContent(el, text);
    // Fire events that frameworks often listen for
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // Sync fallback textarea if present
    const fb = document.querySelector('textarea[name="prompt-textarea"]');
    if (fb) {
      fb.value = text;
      fb.dispatchEvent(new Event('input', { bubbles: true }));
      fb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  } else {
    editor.el.value = text;
    editor.el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}

function onBoostClick() {
  if (isProcessing) {
    return;
  }
  const originalPrompt = readPrompt();
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
  const ok = writePrompt(optimizedPrompt);
  if (!ok) {
    showToast('Unable to update the chat input field.');
    setProcessingState(false);
    return;
  }

  pendingHistory.push({ original: originalPrompt, optimized: optimizedPrompt });

  if (autoSend) {
    // Give the app a brief moment to process the input changes before sending
    setTimeout(() => {
      sendPrompt();
    }, 100);
  }
  setProcessingState(false);
}

function sendPrompt() {
  const sendButton = findSendButton();
  if (sendButton) {
    sendButton.click();
    return;
  }

  const editor = findEditor();
  if (!editor?.el) {
    return;
  }
  const keyboardEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    which: 13,
    keyCode: 13,
    bubbles: true
  });
  editor.el.dispatchEvent(keyboardEvent);
}

function showPreview({ originalPrompt, optimizedPrompt }) {
  removeExistingPreview();
  const composer = findComposer();
  if (!composer) {
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt, autoSend: false });
    return;
  }

  // Build a modal overlay appended to <body> to avoid ChatGPT composer event interference
  const overlay = document.createElement('div');
  overlay.className = 'promptbooster-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="promptbooster-modal__backdrop"></div>
    <div class="promptbooster-modal__panel promptbooster-preview">
      <div class="promptbooster-preview__header">Preview boosted prompt</div>
      <div class="promptbooster-preview__content">
        <section>
          <h4>Original</h4>
          <p>${escapeHtml(originalPrompt)}</p>
        </section>
        <section>
          <h4>Edit boosted</h4>
          <div class="promptbooster-editable" contenteditable="true" role="textbox" aria-multiline="true" data-testid="promptbooster-edit">${escapeHtml(optimizedPrompt)}</div>
        </section>
      </div>
      <div class="promptbooster-preview__actions">
        <button type="button" class="promptbooster-secondary" data-action="cancel">Keep original</button>
        <button type="button" class="promptbooster-primary" data-action="apply">Send boosted</button>
      </div>
    </div>
  `;
  const preview = overlay.querySelector('.promptbooster-preview');

  // Make the inline editor truly editable without the page intercepting keys
  const editBox = preview.querySelector('[data-testid="promptbooster-edit"]');
  if (editBox) {
    editBox.addEventListener('keydown', (e) => {
      // prevent the ChatGPT form/global handlers from hijacking keys
      e.stopPropagation();
      // Allow Shift+Enter for newline; Enter alone inserts line break without submitting form
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        try {
          document.execCommand('insertLineBreak');
        } catch {}
      }
    }, { capture: true });
    editBox.addEventListener('paste', (e) => {
      e.stopPropagation();
    }, { capture: true });
    // Focus the editor so user can type immediately
    setTimeout(() => { try { editBox.focus(); } catch {} }, 0);
  }

  // Global key handling for the modal (stop propagation and support Escape)
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      removeExistingPreview();
      writePrompt(originalPrompt);
      setProcessingState(false);
    }
  }, { capture: true });

  // Click on backdrop cancels
  overlay.querySelector('.promptbooster-modal__backdrop').addEventListener('click', () => {
    removeExistingPreview();
    writePrompt(originalPrompt);
    setProcessingState(false);
  });

  preview.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    removeExistingPreview();
    writePrompt(originalPrompt);
    setProcessingState(false);
  });

  preview.querySelector('[data-action="apply"]').addEventListener('click', () => {
    const editedEl = preview.querySelector('[data-testid="promptbooster-edit"]');
    const edited = editedEl ? (editedEl.innerText || editedEl.textContent || '').trim() : optimizedPrompt;
    removeExistingPreview();
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt: edited || optimizedPrompt, autoSend: true });
  });

  document.body.appendChild(overlay);
  // Focus overlay so keyboard stays within modal
  setTimeout(() => { try { overlay.focus(); } catch {} }, 0);
  setProcessingState(false);
}

function removeExistingPreview() {
  document.querySelectorAll('.promptbooster-modal, .promptbooster-preview').forEach((node) => node.remove());
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
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 110px;
      height: 36px;
      background: linear-gradient(90deg, #7c4dff, #3f51b5);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0 12px;
      margin-right: 8px;
      font-weight: 600;
      cursor: pointer;
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
      pointer-events: auto;
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
    .promptbooster-editable {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      font: inherit;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid rgba(124, 77, 255, 0.35);
      background: #fff;
      color: #1f2937;
      outline: none;
      box-sizing: border-box;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .promptbooster-editable:focus {
      border-color: #7c4dff;
      box-shadow: 0 0 0 3px rgba(124, 77, 255, 0.15);
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

    /* Modal overlay for preview */
    .promptbooster-modal {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: grid;
      place-items: center;
    }
    .promptbooster-modal__backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(2px);
    }
    .promptbooster-modal__panel {
      position: relative;
      max-width: 720px;
      width: min(92vw, 720px);
      max-height: 80vh;
      overflow: auto;
    }
  `;
  document.head.appendChild(style);
}
