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
  previewBeforeSend: false,
  // Seed sample items/bindings so mode buttons can render without Options UI
  items: [
    {
      id: 'replace_creative',
      type: 'boosted',
      name: 'Creative',
      content:
        'You are a creative writing partner. Transform my idea into a more imaginative, surprising exploration. Ask 2–3 clarifying questions and propose 3 angles before drafting. Then outline next steps I should take.'
    },
    {
      id: 'replace_structured',
      type: 'boosted',
      name: 'Structured',
      content:
        'Help me structure this task. Break it into steps, define inputs/outputs per step, and list risks/assumptions. Ask any clarifying questions you need first.'
    },
    {
      id: 'append_wechat_cn',
      type: 'append',
      name: 'WeChat Translation',
      content:
        'Translate the final answer into Chinese with a friendly, conversational tone suitable for WeChat.'
    },
    {
      id: 'append_refs',
      type: 'append',
      name: 'Add Sources',
      content:
        'Add 3–5 reputable sources with links; if uncertain, state uncertainty clearly.'
    }
  ],
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

// Minimal save helper for content script (no import)
async function saveSettings(partialUpdate) {
  const stored = await getSettings();
  const next = { ...stored, ...partialUpdate };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

let currentSettings = { ...DEFAULT_SETTINGS };
let isProcessing = false;
let boostButton = null;
let modeButtonsHost = null;
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

  // Seed defaults if items/bindings missing so buttons can render
  let needsSave = false;
  const seeded = { ...currentSettings };
  if (!Array.isArray(seeded.items) || seeded.items.length === 0) {
    seeded.items = DEFAULT_SETTINGS.items;
    needsSave = true;
  }
  if (needsSave) {
    currentSettings = await saveSettings(seeded);
    dbg('migrated defaults for mode items/bindings');
  } else {
    currentSettings = seeded;
  }

  // Migrate legacy item types: 'replace' -> 'boosted'
  try {
    if (Array.isArray(currentSettings.items)) {
      const migrated = currentSettings.items.map(i => (i && i.type === 'replace') ? { ...i, type: 'boosted' } : i);
      const changed = JSON.stringify(migrated) !== JSON.stringify(currentSettings.items);
      if (changed) {
        currentSettings = await saveSettings({ ...currentSettings, items: migrated });
      }
    }
  } catch {}

  dbg('settings loaded', {
    previewBeforeSend: currentSettings?.previewBeforeSend,
    itemsCount: Array.isArray(currentSettings?.items) ? currentSettings.items.length : 0
  });
  updateButtonTooltip();
  try { ensureModeButtons(); } catch {}
}

function setupSettingsObserver() {
  observeSettings((settings) => {
    currentSettings = settings;
    dbg('settings changed', {
      previewBeforeSend: currentSettings?.previewBeforeSend,
      itemsCount: Array.isArray(currentSettings?.items) ? currentSettings.items.length : 0
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
  // Ensure Enter-key interception wiring is present
  try { ensureEnterWiring(); } catch {}

  // Retry for a short window on fresh loads
  const start = Date.now();
  const retry = setInterval(() => {
    ensureBoostButton();
    ensureModeButtons();
    try { ensureEnterWiring(); } catch {}
    if (Date.now() - start > 10000) {
      clearInterval(retry);
    }
  }, 300);

  ensureBoostButton();
  ensureModeButtons();
  try { ensureEnterWiring(); } catch {}
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

    const composer = findComposer();
    if (!composer) {
      dbg('composer not found yet');
      return;
    }

    // 1) Try to find the grid root of the composer (the container that uses grid-template-areas)
    const gridRoot = findComposerGridRoot(composer);
    let container = null;

    // 2) Prefer a header slot inside the grid. If none exists, create one.
    if (gridRoot) {
      container = ensureHeaderSlot(gridRoot);
      if (!container) {
        dbg('failed to ensure header slot');
      }
    }

    // 3) As a fallback, use the explicit header container if present
    if (!container) {
      container = findHeaderContainer(composer);
    }

    // 4) Final fallback: prepend into composer form so it appears above the composer UI (still outside the editor)
    if (!container) {
      container = composer;
    }

    if (!container) {
      dbg('no suitable container for mode buttons yet');
      return;
    }

    dbg('mode container target (header slot preferred)', {
      nodeName: container?.nodeName,
      className: container?.className
    });

    // Ensure a single global host; move it if the container changes
    if (modeButtonsHost && document.contains(modeButtonsHost)) {
      if (modeButtonsHost.parentElement !== container) {
        container.prepend(modeButtonsHost);
        dbg('moved existing mode host to container');
      }
    } else {
      modeButtonsHost = document.createElement('div');
      modeButtonsHost.className = 'promptbooster-modes';
      container.prepend(modeButtonsHost);
      dbg('created mode host in container');
    }

    // Deduplicate any stray hosts created by dynamic re-renders
    document.querySelectorAll('.promptbooster-modes').forEach((node) => {
      if (node !== modeButtonsHost) {
        try { node.remove(); } catch {}
      }
    });

    renderModeButtons(modeButtonsHost);
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

/**
 * Header area (top row above the editor) — preferred placement for mode buttons
 * Fallback helpers to reliably locate the grid root and ensure a header slot exists.
 */
function findHeaderContainer(root = document) {
  const area = root.querySelector('[class*="[grid-area:header]"]');
  if (!area) return null;
  dbg('header container ready', { className: area?.className || '(area)' });
  return area;
}

// Try to find the grid container that defines the composer areas (header/leading/primary/trailing)
function findComposerGridRoot(root = document) {
  // Look for a DIV that contains a grid-template-areas arbitrary class
  // Example from ChatGPT DOM: [grid-template-areas:'header_header_header'_'leading_primary_trailing'_...]
  const grid = root.querySelector('div[class*="[grid-template-areas"]') ||
               root.querySelector('div.grid[class*="grid-template-areas"]') ||
               root.querySelector('div[class*="grid"][class*="grid-cols"][class*="template-areas"]');
  if (grid) {
    dbg('composer grid root found', { className: grid.className });
  } else {
    dbg('composer grid root not found');
  }
  return grid || null;
}

// Ensure a header slot exists inside the grid root and return it
function ensureHeaderSlot(gridRoot) {
  let slot = gridRoot.querySelector('.promptbooster-header-slot');
  if (slot && gridRoot.contains(slot)) {
    return slot;
  }
  // If ChatGPT didn't render a header area child, create our own and map it to the header grid-area
  slot = document.createElement('div');
  slot.className = 'promptbooster-header-slot [grid-area:header]';
  try {
    gridRoot.insertBefore(slot, gridRoot.firstChild);
    dbg('created header slot inside grid root');
  } catch (e) {
    dbg('failed to insert header slot', e);
    return null;
  }
  return slot;
}

// Active item helpers: persist which header item is active and apply it on send
function getActiveItemId() {
  return currentSettings?.activeItemId || null;
}

async function setActiveItemId(id) {
  const next = { ...currentSettings, activeItemId: id || null };
  currentSettings = await saveSettings(next);
  try { ensureModeButtons(); } catch {}
}

function getActiveItem() {
  const id = getActiveItemId();
  if (!id) return null;
  const items = Array.isArray(currentSettings?.items) ? currentSettings.items : [];
  return items.find(i => i.id === id) || null;
}

// Intercept Enter to send boosted/appended prompt when a mode is selected
function ensureEnterWiring() {
  // Global capture listeners to preempt native handlers that may fire before editor-level listeners
  if (!document.__pbDocEnterWired) {
    const globalHandler = (e) => {
      if (e.key !== 'Enter' || !e.altKey || e.isComposing) return;

      const active = getActiveItem();
      if (!active) return; // no selection -> let native proceed

      const composer = findComposer();
      if (composer && !composer.contains(e.target)) return; // only intercept events within composer

      // Intercept native behaviour at the earliest point
      e.preventDefault();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      e.stopPropagation();

      const originalPrompt = readPrompt() || '';
      const content = String(active.content || '').trim();

      let finalText = '';
      if (active.type === 'append') {
        if (!content) {
          showToast('Selected Append item is empty.');
          return;
        }
        finalText = originalPrompt ? `${originalPrompt}\n${content}` : content;
      } else {
        finalText = content;
      }

      const ok = writePrompt(finalText);
      if (!ok) {
        showToast('Unable to update the chat input field.');
        return;
      }

      // Map original->optimized for bubble annotation
      pendingHistory.push({ original: originalPrompt, optimized: finalText });

      // Prevent any immediate native submit; then send after input events propagate
      if (composer) {
        composer.addEventListener('submit', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true, once: true });
      }
      setTimeout(() => { sendPrompt(); }, 120);
    };

    // Capture on both document and window to beat most listeners
    document.addEventListener('keydown', globalHandler, { capture: true });
    window.addEventListener('keydown', globalHandler, { capture: true });

    // Guard extra phases some UIs listen on
    const swallow = (e) => {
      if (e.key === 'Enter' && e.altKey && !e.isComposing && getActiveItem()) {
        e.preventDefault();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        e.stopPropagation();
      }
    };
    document.addEventListener('keypress', swallow, { capture: true });
    document.addEventListener('keyup', swallow, { capture: true });

    document.__pbDocEnterWired = true;
  }

  const editorRef = findEditor();
  if (!editorRef?.el) return;

  // Avoid double-wiring on dynamic re-renders
  if (editorRef.el.__pbEnterWired) return;

  const handler = (e) => {
    // Only intercept Option/Alt+Enter, and only when a mode is selected
    if (e.key !== 'Enter' || !e.altKey || e.isComposing) return;

    const active = getActiveItem();
    if (!active) return; // no selection -> let native send proceed

    // Prevent native send; we will compose and send according to the selected mode
    e.preventDefault();
    e.stopPropagation();

    const originalPrompt = readPrompt() || '';
    const content = String(active.content || '').trim();

    if (active.type === 'append') {
      if (!content) {
        showToast('Selected Append item is empty.');
        return;
      }
      const finalText = originalPrompt ? `${originalPrompt}\n${content}` : content;
      const ok = writePrompt(finalText);
      if (!ok) {
        showToast('Unable to update the chat input field.');
        return;
      }
      pendingHistory.push({ original: originalPrompt, optimized: finalText });
      const composer = findComposer();
      if (composer) {
        composer.addEventListener('submit', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        }, { capture: true, once: true });
      }
      setTimeout(() => { sendPrompt(); }, 120);
      return;
    }

    // Boosted: call LLM to generate boosted prompt, then preview-or-send
    setProcessingState(true);
    chrome.runtime.sendMessage(
      { type: 'BOOST_PROMPT', payload: { originalPrompt, rule: content } },
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
        const boosted = String(response.optimizedPrompt || '');

        if (currentSettings.previewBeforeSend) {
          showPreview({ originalPrompt, optimizedPrompt: boosted, itemType: 'boosted', sendAfterChoice: true });
          return;
        }

        const ok2 = writePrompt(boosted);
        if (!ok2) {
          showToast('Unable to update the chat input field.');
          setProcessingState(false);
          return;
        }
        pendingHistory.push({ original: originalPrompt, optimized: boosted });
        const composer = findComposer();
        if (composer) {
          composer.addEventListener('submit', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          }, { capture: true, once: true });
        }
        setTimeout(() => { sendPrompt(); setProcessingState(false); }, 120);
      }
    );
  };

  editorRef.el.addEventListener('keydown', handler, { capture: true });
  // mark element to avoid duplicate listeners if the editor persists across reflows
  editorRef.el.__pbEnterWired = true;
}

// Apply a specific item immediately to the editor and optionally send
function applyItemNow(item, { autoSend = true } = {}) {
  if (!item) return false;
  const editor = findEditor();
  if (!editor) {
    dbg('applyItemNow: composer/editor not found');
    showToast('Composer not found.');
    return false;
  }
  const current = readPrompt();
  let nextText = current || '';

  if (item.type === 'replace') {
    nextText = String(item.content || '').trim();
  } else {
    const add = String(item.content || '').trim();
    if (!add) {
      dbg('applyItemNow: append content empty');
      showToast('Empty append content.');
      return false;
    }
    nextText = nextText ? `${nextText}\n${add}` : add;
  }

  const ok = writePrompt(nextText);
  dbg('applyItemNow writePrompt', ok, { prevLen: (current || '').length, nextLen: nextText.length });
  if (!ok) {
    showToast('Unable to update the chat input field.');
    return false;
  }
  if (autoSend) {
    setTimeout(() => sendPrompt(), 80);
  }
  return true;
}

/* Removed ensureActiveSendWiring: Enter and the native Send button must always send the original prompt.
   Modified/boosted sending is only triggered via Option/Alt+Enter when a mode is selected. */

function getModeIcon(type) {
  // Boosted (previously "replace"): circular swap arrows
  if (type === 'boosted' || type === 'replace') {
    return `
      <svg class="pb-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M6.5 5h7M13.5 5l-2-2M13.5 5l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13.5 15h-7M6.5 15l2 2M6.5 15l2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
  }
  // Append: plus inside circle
  return `
    <svg class="pb-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.4" stroke="currentColor" stroke-width="1.6"/>
      <path d="M10 6.5v7M6.5 10h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  `;
}

function renderModeButtons(host) {
  const settings = currentSettings || {};
  const items = Array.isArray(settings.items) ? settings.items : [];

  // Use the top-3 items in the user-defined order to render header buttons
  const buttons = items.slice(0, 3);

  dbg('renderModeButtons', {
    itemsCount: items.length,
    buttons: buttons.map(b => ({ id: b.id, type: b.type, name: b.name }))
  });

  dbg('resolved buttons', buttons.map(b => ({ type: b.type, name: b.name })));

  // Serialize current buttons + active id to avoid unnecessary re-render
  const currentSig = host.getAttribute('data-sig');
  const nextSig = JSON.stringify({
    ids: buttons.map(b => b.id),
    activeId: getActiveItemId() || null
  });
  if (currentSig === nextSig && host.children.length > 0) {
    dbg('mode buttons signature unchanged; skipping render');
    return;
  }
  host.setAttribute('data-sig', nextSig);

  host.innerHTML = '';

  // Settings gear (always visible) - opens Options, placed left of first button
  (function () {
    const gearBtn = document.createElement('button');
    gearBtn.type = 'button';
    gearBtn.className = 'pb-gear-btn';
    gearBtn.setAttribute('aria-label', 'Open PromptBooster Settings');
    gearBtn.setAttribute('title', 'Open PromptBooster Settings');
    gearBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M8.25 2.75h3.5l.45 1.8c.2.03.39.08.57.14l1.62-1.06 2.47 2.47-1.06 1.62c.06.18.11.37.14.57l1.8.45v3.5l-1.8.45c-.03.2-.08.39-.14.57l1.06 1.62-2.47 2.47-1.62-1.06a4.8 4.8 0 0 1-.57.14l-.45 1.8h-3.5l-.45-1.8a4.8 4.8 0 0 1-.57-.14l-1.62 1.06-2.47-2.47 1.06-1.62a4.8 4.8 0 0 1-.14-.57l-1.8-.45v-3.5l1.8-.45c.03-.2.08-.39.14-.57L3.14 6.1 5.61 3.64l1.62 1.06c.18-.06.37-.11.57-.14l.45-1.8ZM10 7.25A2.75 2.75 0 1 0 10 12.75 2.75 2.75 0 0 0 10 7.25Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
      </svg>
    `;
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }, () => {});
      } catch {}
    });
    host.appendChild(gearBtn);
  })();

  if (buttons.length === 0) {
    dbg('no bound buttons to render');
  }
  const activeId = getActiveItemId();

  for (const item of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pb-mode-btn';
    if (item.id === activeId) btn.classList.add('active');
    btn.setAttribute('data-type', item.type);
    btn.setAttribute('title', `${(item.type === 'append') ? 'Append to prompt' : 'Boosted prompt'}: ${item.name}`);
    btn.innerHTML = `
      ${getModeIcon(item.type)}
      <span class="pb-mode-label">${escapeHtml(item.name)}</span>
    `;
    btn.addEventListener('click', () => onModeButtonClick(item));
    host.appendChild(btn);
  }

  // Clear Active control (only shown when an item is active)
  if (activeId) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'pb-clear-active';
    clearBtn.setAttribute('title', 'Clear active prompt');
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      setActiveItemId(null);
    });
    host.appendChild(clearBtn);

  }
}

function onModeButtonClick(item) {
  // Header buttons only select/deselect a mode; they never send or apply immediately.
  const current = getActiveItemId();
  const next = current === item.id ? null : item.id;
  dbg('toggle active item', { prev: current, next });
  setActiveItemId(next);
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
  if (isProcessing) return;

  // Mode buttons only select/deselect. Boost applies according to the selected item.
  const active = getActiveItem();
  if (!active) {
    showToast('Please select a mode before clicking Boost.');
    return;
  }

  const originalPrompt = readPrompt() || '';
  const rule = String(active.content || '').trim();

  if (active.type === 'append') {
    if (!rule) {
      showToast('Selected Append item is empty.');
      return;
    }
    setProcessingState(true);
    const finalText = originalPrompt ? `${originalPrompt}\n${rule}` : rule;

    /* Append never shows the review panel; always write and send immediately */

    const ok = writePrompt(finalText);
    if (!ok) {
      showToast('Unable to update the chat input field.');
      setProcessingState(false);
      return;
    }
    pendingHistory.push({ original: originalPrompt, optimized: finalText });
    setTimeout(() => { sendPrompt(); setProcessingState(false); }, 80);
    return;
  }

  // Boosted: call LLM with (rule + originalPrompt), then preview or send
  setProcessingState(true);
  chrome.runtime.sendMessage(
    { type: 'BOOST_PROMPT', payload: { originalPrompt, rule } },
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
      const optimizedPrompt = String(response.optimizedPrompt || '');

      if (currentSettings.previewBeforeSend) {
        showPreview({
          originalPrompt,
          optimizedPrompt,
          itemType: 'boosted',
          sendAfterChoice: true
        });
        return;
      }

      const ok = writePrompt(optimizedPrompt);
      if (!ok) {
        showToast('Unable to update the chat input field.');
        setProcessingState(false);
        return;
      }
      pendingHistory.push({ original: originalPrompt, optimized: optimizedPrompt });
      setTimeout(() => { sendPrompt(); setProcessingState(false); }, 80);
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

function showPreview({ originalPrompt, optimizedPrompt, itemType = 'boosted', sendAfterChoice = false }) {
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

  // Collapse when clicking anywhere outside the panel, keep content intact
  const onOutsidePointer = (evt) => {
    if (!inline.contains(evt.target)) {
      inline.setAttribute('data-collapsed', 'true');
      const toggleBtn = inline.querySelector('[data-action="toggle"]');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    }
  };
  document.addEventListener('pointerdown', onOutsidePointer, { capture: true });

  // Allow expanding by clicking the collapsed bar itself
  inline.addEventListener('click', (evt) => {
    if (inline.getAttribute('data-collapsed') === 'true') {
      inline.setAttribute('data-collapsed', 'false');
      const toggleBtn = inline.querySelector('[data-action="toggle"]');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
      evt.stopPropagation();
    }
  });

  // Ensure cleanup removes outside listener too
  const prevCleanup = inline.__pbCleanup;
  inline.__pbCleanup = () => {
    try { document.removeEventListener('pointerdown', onOutsidePointer, { capture: true }); } catch {}
    try { prevCleanup?.(); } catch {}
  };

  // Use Original
  inline.querySelector('[data-action="use-original"]').addEventListener('click', () => {
    removeExistingPreview();
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt: originalPrompt, itemType: 'replace', autoSend: !!sendAfterChoice });
  });

  // Use Boosted (take edited content if changed)
  inline.querySelector('[data-action="use-boosted"]').addEventListener('click', () => {
    const editedEl = inline.querySelector('[data-testid="promptbooster-edit"]');
    const edited = editedEl ? (editedEl.innerText || editedEl.textContent || '').trim() : optimizedPrompt;
    removeExistingPreview();
    applyOptimizedPrompt({ originalPrompt, optimizedPrompt: edited || optimizedPrompt, itemType, autoSend: !!sendAfterChoice });
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
  boostButton.title = 'Boost prompt';
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

    :root {
      --pb-brand-50: rgba(124, 77, 255, 0.12);
      --pb-brand-700: #4338ca;
      --pb-neutral-bg: #f5f5f7;
      --pb-text: #374151;
      --pb-disabled-bg: #f0f0f3;
      --pb-disabled-text: rgba(55, 65, 81, 0.45);
      --pb-hover-shadow: 0 2px 8px rgba(28,27,74,0.08);
    }
    /* Mode buttons (top-left of composer) */
    .promptbooster-header-slot {
      display: flex;
      align-items: center;
      gap: 6px;
      padding-bottom: 4px;
    }
    .promptbooster-modes {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0 8px 6px 0; /* ensure space below when we prepend to composer */
    }
    .pb-mode-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid transparent; /* visually borderless */
      background: var(--pb-neutral-bg); /* neutral idle */
      color: var(--pb-text);
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
      white-space: nowrap;
      outline: none; /* use focus-visible */
    }
    .pb-mode-btn:hover {
      transform: translateY(-1px);
      box-shadow: var(--pb-hover-shadow);
    }
    .pb-mode-btn:focus-visible {
      outline: 2px solid #7c4dff; /* accessible focus ring */
      outline-offset: 2px;
    }
    .pb-mode-btn .pb-icon {
      width: 14px;
      height: 14px;
      display: inline-block;
      line-height: 1;
    }
    /* Active selection styling */
    .pb-mode-btn.active {
      background: var(--pb-brand-50); /* light brand fill */
      color: var(--pb-brand-700);     /* darker brand text */
      box-shadow: inset 0 0 0 1px rgba(124,77,255,0.0); /* subtle inner glow (no visible border) */
    }
    .pb-mode-btn:disabled {
      background: var(--pb-disabled-bg);
      color: var(--pb-disabled-text);
      cursor: not-allowed;
      opacity: 0.7;
    }
    .pb-clear-active {
      margin-left: 8px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid transparent; /* consistent with other buttons */
      background: var(--pb-neutral-bg); /* neutral idle like mode buttons */
      color: var(--pb-text);
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .pb-clear-active:hover {
      transform: translateY(-1px);
      box-shadow: var(--pb-hover-shadow);
    }
    .pb-clear-active:focus-visible {
      outline: 2px solid #7c4dff;
      outline-offset: 2px;
    }
    /* Small settings gear placed to the right of Clear */
    .pb-gear-btn {
      margin-left: 22px; /* 再向右移约3mm */
      margin-right: 4px; /* 与右侧按钮的间距更紧凑 */
      width: 36px;  /* 直径+约2mm */
      height: 36px; /* 直径+约2mm */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      transition: box-shadow 0.15s ease, transform 0.15s ease, color 0.15s ease;
    }
    .pb-gear-btn:hover {
      color: #374151;
      box-shadow: 0 2px 8px rgba(28,27,74,0.08);
      transform: translateY(-1px);
    }
    .pb-gear-btn:focus-visible {
      outline: 2px solid #7c4dff;
      outline-offset: 2px;
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
    /* Collapsed state: show a small obtuse triangle centered above the input */
    .promptbooster-inline[data-collapsed="true"] {
      position: relative;
      height: 0;                 /* collapse the panel itself */
      padding: 0;
      border: none;
      background: transparent;
      box-shadow: none;
      margin: 6px 0 10px 0;      /* small gap above input */
      cursor: pointer;
      overflow: visible;
    }
    .promptbooster-inline[data-collapsed="true"]::after {
      content: '';
      position: absolute;
      top: -12px; /* ~3mm above the composer */
      left: 50%;
      transform: translate(-50%, 0);
      width: 64px;               /* wider base for a clear obtuse shape */
      height: 26px;              /* increased height by ~3mm */
      background: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='26' viewBox='0 0 64 26'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='%237c4dff'/><stop offset='1' stop-color='%233f51b5'/></linearGradient></defs><polygon points='32,0 64,26 0,26' fill='url(%23g)' stroke='url(%23g)' stroke-linejoin='round' stroke-width='2'/></svg>");
      background-repeat: no-repeat;
      background-size: 100% 100%;
      filter: drop-shadow(0 3px 10px rgba(28, 27, 74, 0.25)); /* subtle shadow */
      z-index: 2;
    }
    /* Mask any stray line directly above triangle */
    .promptbooster-inline[data-collapsed="true"]::before {
      content: '';
      position: absolute;
      top: -16px;                /* slightly higher mask to hide any stray line */
      left: 50%;
      transform: translateX(-50%);
      width: 72px;               /* wider than triangle base */
      height: 4px;               /* a bit thicker to ensure coverage */
      background: #fff;          /* assumes light composer bg */
      border-radius: 3px;
      z-index: 1;
    }
    .promptbooster-inline[data-collapsed="true"] .pb-inline__header {
      display: none;
    }
    .promptbooster-inline[data-collapsed="true"] .pb-inline__footer {
      display: none; /* hide action buttons when collapsed */
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
