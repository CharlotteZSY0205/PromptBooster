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

// Expose minimal debug helpers
try {
  window.PromptBoosterDebug = {
    getSettings: () => ({ ...currentSettings }),
    forceEnsure: () => {
      dbg('forceEnsure invoked');
      try {
        ensureModeButtons();
        ensureBoostButton();
      } catch (e) {
        dbg('forceEnsure error', e);
      }
    }
  };
} catch {}

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
  dbg('settings loaded', {
    defaultMode: currentSettings?.defaultMode,
    previewBeforeSend: currentSettings?.previewBeforeSend,
    itemsCount: Array.isArray(currentSettings?.items) ? currentSettings.items.length : 0,
    bindings: currentSettings?.bindings
  });
  updateButtonTooltip();
}

function setupSettingsObserver() {
  observeSettings((settings) => {
    currentSettings = settings;
    dbg('settings changed', {
      defaultMode: currentSettings?.defaultMode,
      previewBeforeSend: currentSettings?.previewBeforeSend,
      itemsCount: Array.isArray(currentSettings?.items) ? currentSettings.items.length : 0,
      bindings: currentSettings?.bindings
    });
    updateButtonTooltip();
    // re-render mode buttons on settings change
    try { ensureModeButtons(); } catch {}
  });
}

function setupComposerObserver() {
  const observer = new MutationObserver(() => {
    ensureBoostButton();
    ensureModeButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Retry for a short window on fresh loads
  const start = Date.now();
  const retry = setInterval(() => {
    ensureBoostButton();
    ensureModeButtons();
    if (Date.now() - start > 10000) {
      clearInterval(retry);
    }
  }, 300);

  ensureBoostButton();
  ensureModeButtons();
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

/* ========= Mode Buttons (Replace / Append) ========= */

function ensureModeButtons() {
  try {
    dbg('ensureModeButtons start');
    const container = findLeadingContainer();
    if (!container) {
      dbg('leading container not found yet');
      return;
    }

    // find existing host
    let host = container.querySelector('.promptbooster-modes');
    if (!host) {
      host = document.createElement('div');
      host.className = 'promptbooster-modes';
      // Prepend to leading container so it's leftmost
      container.prepend(host);
      dbg('created mode host in leading container');
    } else {
      dbg('mode host exists');
    }

    renderModeButtons(host);
  } catch (e) {
    dbg('ensureModeButtons error', e);
  }
}

// Leading area container (top-left of composer)
function findLeadingContainer(root = document) {
  // ChatGPT uses a grid area marker like [grid-area:leading]
  // Inside that, there is often a flex wrapper with existing icons
  const area = root.querySelector('[class*="[grid-area:leading]"]');
  if (!area) {
    dbg('leading area not found');
    return null;
  }
  // Prefer a direct flex child if available; otherwise, use the area itself
  const inner = area.querySelector('.flex') || area;
  dbg('leading container ready', { className: inner?.className || '(area)' });
  return inner;
}

function renderModeButtons(host) {
  const settings = currentSettings || {};
  const items = Array.isArray(settings.items) ? settings.items : [];
  const bindings = Array.isArray(settings.bindings) ? settings.bindings.slice(0, 3) : [];

  dbg('renderModeButtons', {
    itemsCount: items.length,
    bindings,
    sampleItems: items.slice(0, 3).map(x => ({ id: x.id, type: x.type, name: x.name }))
  });

  // Build a map for quick lookup
  const byId = new Map(items.map(it => [it.id, it]));

  // Create the three buttons based on bindings
  const buttons = bindings
    .map(id => byId.get(id))
    .filter(Boolean)
    .slice(0, 3);

  dbg('resolved buttons', buttons.map(b => ({ type: b.type, name: b.name })));

  // Serialize current buttons to avoid unnecessary re-render
  const currentSig = host.getAttribute('data-sig');
  const nextSig = JSON.stringify(buttons.map(b => `${b.type}:${b.name}`));
  if (currentSig === nextSig && host.children.length > 0) {
    dbg('mode buttons signature unchanged; skipping render');
    return;
  }
  host.setAttribute('data-sig', nextSig);

  host.innerHTML = '';
  if (buttons.length === 0) {
    dbg('no bound buttons to render');
  }
  for (const item of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pb-mode-btn';
    btn.setAttribute('data-type', item.type);
    btn.setAttribute('title', `${item.type === 'replace' ? 'Replace prompt' : 'Append to prompt'}: ${item.name}`);
    btn.innerHTML = `
      <span class="pb-mode-icon">${item.type === 'replace' ? '🔄' : '➕'}</span>
      <span class="pb-mode-label">${escapeHtml(item.name)}</span>
    `;
    btn.addEventListener('click', () => onModeButtonClick(item));
    host.appendChild(btn);
  }
}

function onModeButtonClick(item) {
  dbg('mode button click', { type: item?.type, name: item?.name, contentLen: (item?.content || '').length });
  const editor = findEditor();
  if (!editor) {
    dbg('composer not found on click');
    showToast('Composer not found.');
    return;
  }
  const current = readPrompt();
  let nextText = current || '';

  if (item.type === 'replace') {
    nextText = String(item.content || '').trim();
  } else {
    const add = String(item.content || '').trim();
    if (!add) {
      dbg('append content empty');
      showToast('Empty append content.');
      return;
    }
    // Append with a separating newline if current text exists
    nextText = nextText ? `${nextText}\n${add}` : add;
  }

  const ok = writePrompt(nextText);
  dbg('writePrompt result', ok, { prevLen: (current || '').length, nextLen: nextText.length });
  if (!ok) {
    showToast('Unable to update the chat input field.');
    return;
  }

  // Auto-send after applying
  setTimeout(() => {
    dbg('auto-sending after mode apply');
    sendPrompt();
  }, 80);
}

/* ========= Existing composer helpers ========= */
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

  const inline = document.createElement('div');
  inline.className = 'promptbooster-inline';
  inline.setAttribute('data-collapsed', 'false');
  inline.innerHTML = `
    <div class="pb-inline__header">
      <button type="button" class="pb-inline__toggle" data-action="toggle" aria-expanded="true" aria-controls="pb-inline-content">
        ▼ Prompt Review
      </button>
    </div>
    <div class="pb-inline__content" id="pb-inline-content">
      <section class="pb-col">
        <h4>Original</h4>
        <div class="pb-box">
          <pre class="pb-text">${escapeHtml(originalPrompt)}</pre>
        </div>
      </section>
      <section class="pb-col">
        <h4>Boosted</h4>
        <div class="pb-box">
          <div class="promptbooster-editable" contenteditable="true" role="textbox" aria-multiline="true" data-testid="promptbooster-edit">${escapeHtml(optimizedPrompt)}</div>
        </div>
      </section>
    </div>
    <div class="pb-inline__footer">
      <button type="button" class="promptbooster-secondary" data-action="use-original">Use Original</button>
      <button type="button" class="promptbooster-primary" data-action="use-boosted">Use Boosted</button>
    </div>
  `;

  // Insert above the main editor area if possible, otherwise prepend to composer
  const firstChild = composer.firstElementChild;
  if (firstChild) {
    composer.insertBefore(inline, firstChild);
  } else {
    composer.appendChild(inline);
  }

  // Stop ChatGPT composer from intercepting keystrokes within our editable box
  const editBox = inline.querySelector('[data-testid="promptbooster-edit"]');
  if (editBox) {
    editBox.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        try { document.execCommand('insertLineBreak'); } catch {}
      }
    }, { capture: true });
    editBox.addEventListener('paste', (e) => { e.stopPropagation(); }, { capture: true });
    setTimeout(() => { try { editBox.focus(); } catch {} }, 0);
  }

  // Expand/Collapse
  inline.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
    const collapsed = inline.getAttribute('data-collapsed') === 'true';
    inline.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
    e.currentTarget.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
  });

  // Use Original
  inline.querySelector('[data-action="use-original"]').addEventListener('click', () => {
    removeExistingPreview();
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt: originalPrompt, autoSend: true });
  });

  // Use Boosted (take edited content if changed)
  inline.querySelector('[data-action="use-boosted"]').addEventListener('click', () => {
    const editedEl = inline.querySelector('[data-testid="promptbooster-edit"]');
    const edited = editedEl ? (editedEl.innerText || editedEl.textContent || '').trim() : optimizedPrompt;
    removeExistingPreview();
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt: edited || optimizedPrompt, autoSend: true });
  });

  // Collapse+remove animation when native ChatGPT Send is used
  const nativeSendBtn = findSendButton();
  const editorRef = findEditor();

  function collapseAndRemove() {
    const el = inline;
    // Measure current height and set fixed height to enable transition
    const h = el.offsetHeight;
    el.style.height = h + 'px';
    el.style.opacity = '1';
    el.style.overflow = 'hidden';
    // Force reflow
    void el.offsetHeight;
    // Animate to 0 height and fade out
    el.style.transition = 'height 200ms ease, opacity 180ms ease';
    el.style.height = '0px';
    el.style.opacity = '0';
    // Remove after animation
    setTimeout(() => {
      try { el.remove(); } catch {}
    }, 250);
  }

  const onNativeClick = () => collapseAndRemove();
  const onEditorEnter = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      collapseAndRemove();
    }
  };

  if (nativeSendBtn) nativeSendBtn.addEventListener('click', onNativeClick, { once: true });
  if (editorRef?.el) editorRef.el.addEventListener('keydown', onEditorEnter, { capture: true });

  // Cleanup for listeners when panel is removed
  inline.__pbCleanup = () => {
    try {
      if (nativeSendBtn) nativeSendBtn.removeEventListener('click', onNativeClick);
      if (editorRef?.el) editorRef.el.removeEventListener('keydown', onEditorEnter, { capture: true });
    } catch {}
  };

  setProcessingState(false);
}

function removeExistingPreview() {
  document.querySelectorAll('.promptbooster-modal, .promptbooster-preview, .promptbooster-inline').forEach((node) => {
    try { node.__pbCleanup?.(); } catch {}
    node.remove();
  });
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

    /* Mode buttons (top-left of composer) */
    .promptbooster-modes {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: 8px;
    }
    .pb-mode-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(124, 77, 255, 0.35);
      background: rgba(124, 77, 255, 0.08);
      color: #4338ca;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
      white-space: nowrap;
    }
    .pb-mode-btn:hover {
      background: rgba(124, 77, 255, 0.14);
      transform: translateY(-1px);
      border-color: rgba(124, 77, 255, 0.5);
    }
    .pb-mode-btn .pb-mode-icon {
      font-size: 13px;
      line-height: 1;
    }
    .pb-mode-btn[data-type="replace"] {
      background: rgba(59, 130, 246, 0.10);
      border-color: rgba(59, 130, 246, 0.35);
      color: #1d4ed8;
    }
    .pb-mode-btn[data-type="replace"]:hover {
      background: rgba(59, 130, 246, 0.16);
      border-color: rgba(59, 130, 246, 0.5);
    }
    .pb-mode-btn[data-type="append"] {
      background: rgba(16, 185, 129, 0.10);
      border-color: rgba(16, 185, 129, 0.35);
      color: #047857;
    }
    .pb-mode-btn[data-type="append"]:hover {
      background: rgba(16, 185, 129, 0.16);
      border-color: rgba(16, 185, 129, 0.5);
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

    /* Inline comparison panel above composer */
    .promptbooster-inline {
      margin: 8px 0 10px 0;
      border: 1px solid rgba(124, 77, 255, 0.2);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 6px 20px rgba(28, 27, 74, 0.10);
    }
    .pb-inline__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(124, 77, 255, 0.15);
    }
    .pb-inline__toggle {
      appearance: none;
      background: transparent;
      border: none;
      color: #4338ca;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
    }
    .promptbooster-inline[data-collapsed="true"] .pb-inline__content {
      display: none;
    }
    .pb-inline__content {
      padding: 12px;
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      align-items: stretch; /* make columns equal height based on tallest */
    }
    .pb-col {
      display: flex;
      flex-direction: column;
      min-height: 160px; /* base height */
    }
    .pb-col h4 {
      margin: 0 0 6px 0;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #4338ca;
    }
    .pb-box {
      flex: 1; /* fill remaining height so both columns equalize */
      display: flex; /* allow inner content to flex to equal height */
      height: 100%;
    }
    .pb-text {
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(124, 77, 255, 0.06);
      color: #1f2937;
      white-space: pre-wrap;
      line-height: 1.5;
      flex: 1;             /* fill the equalized height */
      max-height: 480px;   /* allow taller content before scrolling */
      overflow: auto;
    }
    /* Ensure the editable fills the equalized height when inside inline panel */
    .promptbooster-inline .promptbooster-editable {
      min-height: 0;
      flex: 1;          /* fill equalized height */
      overflow: auto;
      max-height: 480px;
    }
    .pb-inline__footer {
      border-top: 1px solid rgba(124, 77, 255, 0.15);
      padding: 8px 12px 12px 12px;
      display: flex;
      gap: 12px; /* 150% of previous 8px */
      justify-content: flex-end;
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
