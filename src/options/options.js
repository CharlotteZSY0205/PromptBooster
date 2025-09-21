import { DEFAULT_SETTINGS } from '../common/constants.js';
import { getSettings, saveSettings } from '../common/storage.js';

/**
 * Icons (SVG, no emojis)
 */
function iconReplace() {
  return `
    <svg class="opt-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6.5 5h7M13.5 5l-2-2M13.5 5l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13.5 15h-7M6.5 15l2 2M6.5 15l2-2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}
function iconAppend() {
  return `
    <svg class="opt-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.4" stroke="currentColor" stroke-width="1.6"/>
      <path d="M10 6.5v7M6.5 10h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </svg>
  `;
}

/**
 * Templates
 */
const TEMPLATE_MAP = (() => {
  const byId = Object.fromEntries((DEFAULT_SETTINGS.items || []).map(i => [i.id, i]));
  return {
    replace_creative: byId.replace_creative || {
      type: 'boosted',
      name: 'Creative',
      content: 'You are a creative writing partner...'
    },
    replace_structured: byId.replace_structured || {
      type: 'boosted',
      name: 'Structured',
      content: 'Help me structure this task...'
    },
    append_wechat_cn: byId.append_wechat_cn || {
      type: 'append',
      name: 'WeChat Translation',
      content: 'Translate the final answer into Chinese with a friendly, conversational tone suitable for WeChat.'
    },
    append_refs: byId.append_refs || {
      type: 'append',
      name: 'Add Sources',
      content: 'Add 3–5 reputable sources with links; if uncertain, state uncertainty clearly.'
    }
  };
})();

/**
 * State
 */
let state = {
  settings: null,   // full settings object
  items: [],        // array of {id, type, name, content}
  bindings: []      // array of up to 3 ids
};

/**
 * Elements
 */
const els = {};
document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheEls();
  wireBaseForm();
  wireAddButton();
  await loadAndRender();
}

function cacheEls() {
  els.form = document.getElementById('settings-form');
  els.apiKey = document.getElementById('apiKey');
  els.apiBaseUrl = document.getElementById('apiBaseUrl');
  els.model = document.getElementById('model');
  els.previewBeforeSend = document.getElementById('previewBeforeSend');
  els.status = document.getElementById('status');

  // My Prompts
  els.addItemBtn = document.getElementById('addItemBtn');
  els.itemsList = document.getElementById('itemsList');

}

/**
 * Load + Render
 */
async function loadAndRender() {
  const settings = await getSettings();
  state.settings = settings;
  state.items = Array.isArray(settings.items) ? settings.items.slice() : [];

  // Simplified design: bindings are deprecated. Always use top-3 list order.
  state.bindings = [];
  if (Array.isArray(settings.bindings) && settings.bindings.length > 0) {
    // Clear any legacy bindings once.
    state.settings = await saveSettings({ ...settings, bindings: [] });
  }

  applyBaseSettings(settings);
  renderItems();
}

/* Optimization styles removed; no mode choices to populate. */

function applyBaseSettings(settings) {
  els.apiKey.value = settings.apiKey || '';
  els.apiBaseUrl.value = settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl;
  els.model.value = settings.model || DEFAULT_SETTINGS.model;
  els.previewBeforeSend.checked = !!settings.previewBeforeSend;
}

/**
 * Base connection form
 */
function wireBaseForm() {
  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.status.textContent = 'Saving…';
    try {
      const update = {
        apiKey: String(els.apiKey.value || '').trim(),
        apiBaseUrl: String(els.apiBaseUrl.value || '').trim() || DEFAULT_SETTINGS.apiBaseUrl,
        model: String(els.model.value || '').trim() || DEFAULT_SETTINGS.model,
        previewBeforeSend: !!els.previewBeforeSend.checked,
        // keep items and clear legacy bindings (top-3 rule)
        items: state.items,
        bindings: []
      };
      state.settings = await saveSettings(update);
      els.status.textContent = 'Settings saved.';
      els.status.className = 'success';
    } catch (err) {
      console.error('[Options] Save failed', err);
      els.status.textContent = 'Unable to save settings.';
      els.status.className = 'error';
    }
  });
}

/**
 * Items: Add/Edit via Modal + Delete
 */
function wireAddButton() {
  if (!els.addItemBtn) return;
  els.addItemBtn.addEventListener('click', () => openPromptModal('add'));
}

function openPromptModal(mode, existingId = null) {
  const isEdit = mode === 'edit';
  const item = isEdit ? state.items.find(i => i.id === existingId) : null;

  const overlay = document.createElement('div');
  overlay.className = 'pb-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="pb-modal__backdrop"></div>
    <div class="pb-modal__panel">
      <div class="pb-modal__header">
        <h3>${isEdit ? 'Edit' : 'Add'}</h3>
        <button type="button" class="pb-modal__close" aria-label="Close">×</button>
      </div>
      <div class="pb-modal__body">
        <div class="pb-toggle" role="tablist" aria-label="Type">
          <button type="button" class="pb-toggle__btn" data-type="boosted">Boosted</button>
          <button type="button" class="pb-toggle__btn" data-type="append">Append</button>
        </div>
        <label class="field">
          <span>Name (≤ 20 characters)</span>
          <input id="pb-name" type="text" maxlength="20" placeholder="Enter a short label for this requirement" />
        </label>
        <label class="field">
          <span>Content</span>
          <textarea id="pb-content" rows="7" placeholder="Enter your rewrite rule for Boosted, or text to append"></textarea>
        </label>
      </div>
      <div class="pb-modal__footer">
        <button type="button" class="btn small" data-action="reset">Reset</button>
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.pb-modal__backdrop').addEventListener('click', close);
  overlay.querySelector('.pb-modal__close').addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { capture: true });

  const toggleBtns = [...overlay.querySelectorAll('.pb-toggle__btn')];
  const inputName = overlay.querySelector('#pb-name');
  const inputContent = overlay.querySelector('#pb-content');
  let currentType = 'boosted';

  function setType(t) {
    currentType = t === 'append' ? 'append' : 'boosted';
    toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.type === currentType));
  }

  // Prefill values
  if (isEdit && item) {
    setType(item.type);
    inputName.value = item.name || '';
    inputContent.value = item.content || '';
  } else {
    setType('boosted');
    inputName.value = '';
    inputContent.value = '';
  }

  // Toggle handlers
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => setType(btn.dataset.type));
  });

  // Footer buttons
  overlay.querySelector('[data-action="reset"]').addEventListener('click', () => {
    if (isEdit && item) {
      setType(item.type);
      inputName.value = item.name || '';
      inputContent.value = item.content || '';
    } else {
      setType('boosted');
      inputName.value = '';
      inputContent.value = '';
    }
  });

  overlay.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const name = String(inputName.value || '').trim().slice(0, 20);
    const content = String(inputContent.value || '').trim();
    if (!name) { alert('Name is required.'); return; }
    if (!content) { alert('Content is required.'); return; }

    if (isEdit && item) {
      const idx = state.items.findIndex(i => i.id === item.id);
      if (idx >= 0) state.items[idx] = { ...state.items[idx], type: currentType, name, content };
    } else {
      const id = genId(currentType, name);
      state.items.push({ id, type: currentType, name, content });
    }

    // Persist and refresh
    state.settings = await saveSettings({ ...state.settings, items: state.items });
    renderItems();
    close();
  });
}

function renderItems() {
  const wrap = els.itemsList;
  wrap.innerHTML = '';
  if (!state.items.length) {
    wrap.textContent = 'No prompts yet. Click “Add” to create a Boosted or Append prompt.';
    return;
  }

  const list = document.createElement('div');
  list.className = 'items-list-grid';

  state.items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    if (idx < 3) card.classList.add('top3'); // highlight top 3
    card.dataset.id = item.id;
    card.setAttribute('draggable', 'true'); // entire row is draggable

    // Drag whole row
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    const icon = document.createElement('span');
    icon.className = `type-icon ${item.type}`;
    icon.innerHTML = item.type === 'boosted' ? iconReplace() : iconAppend();

    const label = document.createElement('div');
    label.className = 'item-label';
    label.textContent = `${item.name}`;

    const meta = document.createElement('div');
    meta.className = `item-type ${item.type}`;
    meta.textContent = item.type === 'boosted' ? 'Boosted' : 'Append';

    const actions = document.createElement('div');
    actions.className = 'item-actions-row';

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn small danger';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteItem(item.id));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openPromptModal('edit', item.id));

    actions.append(delBtn, editBtn);

    // Drag handle at far right (visual indicator)
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.innerHTML = `
      <span class="bars">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </span>
    `;

    // Build row
    card.append(icon, label, meta, actions, handle);
    list.appendChild(card);

    // Make cards droppable to reorder (entire row moves)
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('dragover');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('dragover');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('dragover');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === item.id) return;
      reorderItems(draggedId, item.id);
    });
  });

  wrap.appendChild(list);
}

function loadItemIntoForm(id) {
  const it = state.items.find(i => i.id === id);
  if (!it) return;
  els.editingId.value = it.id;
  els.itemType.value = it.type;
  els.itemName.value = it.name;
  els.itemContent.value = it.content;
}

function deleteItem(id) {
  if (!confirm('Delete this item?')) return;
  state.items = state.items.filter(i => i.id !== id);
  // Clear any legacy bindings to ensure top-3 rule
  saveSettings({ ...state.settings, items: state.items, bindings: [] }).then(s => state.settings = s);
  renderItems();
}

/**
 * Bindings (Drag & Drop into 3 slots)
 */
function wireBindingControls() {
  els.clearBindingsBtn.addEventListener('click', () => {
    state.bindings = [];
    renderBindings();
  });
  els.saveBindingsBtn.addEventListener('click', async () => {
    // enforce max 3
    state.bindings = state.bindings.slice(0, 3);
    state.settings = await saveSettings({ ...state.settings, bindings: state.bindings });
    toast('Bindings saved.');
  });

  // Allow dragging into slots
  els.slots.forEach((slot, index) => {
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('dragover');
    });
    slot.addEventListener('dragleave', () => {
      slot.classList.remove('dragover');
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/plain');
      if (!id) return;
      applyBindingAt(index, id);
    });
  });
}

function applyBindingAt(index, id) {
  // Ensure exists
  const exists = state.items.some(i => i.id === id);
  if (!exists) return;

  // Ensure unique in bindings
  state.bindings = state.bindings.filter(b => b !== id);

  // Ensure length max 3 by padding to correct length
  if (index >= 3) index = 2;

  // Fill empty indices if needed
  while (state.bindings.length < 3) state.bindings.push(null);

  state.bindings[index] = id;

  // Clean trailing nulls
  state.bindings = state.bindings.filter(v => !!v);

  renderBindings();
}

function reorderItems(draggedId, targetId) {
  const fromIdx = state.items.findIndex(i => i.id === draggedId);
  const toIdx = state.items.findIndex(i => i.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = state.items.splice(fromIdx, 1);
  state.items.splice(toIdx, 0, moved);
  // Persist new order; also keep bindings if user explicitly set them
  saveSettings({ ...state.settings, items: state.items }).then(s => state.settings = s);
  renderItems();
  // No automatic change to bindings; top-3 rule is handled in content script when bindings are empty
}

function renderBindings() {
  els.slots.forEach((slot, idx) => {
    const body = slot.querySelector('.slot-body');
    body.innerHTML = '';

    const id = state.bindings[idx] || null;
    if (!id) {
      body.innerHTML = '<div class="slot-empty">Drop item here…</div>';
      return;
    }
    const item = state.items.find(i => i.id === id);
    if (!item) {
      body.innerHTML = '<div class="slot-empty">Missing item (deleted)</div>';
      return;
    }

    const pill = document.createElement('div');
    pill.className = `slot-pill ${item.type}`;
    pill.dataset.id = id;

    const icon = document.createElement('span');
    icon.className = 'pill-icon';
    icon.innerHTML = item.type === 'boosted' ? iconReplace() : iconAppend();

    const name = document.createElement('span');
    name.className = 'pill-name';
    name.textContent = item.name;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pill-remove';
    remove.setAttribute('aria-label', 'Remove');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.bindings[idx] = null;
      state.bindings = state.bindings.filter(Boolean);
      renderBindings();
    });

    pill.append(icon, name, remove);
    addDragHandlers(pill, 'slot', idx);
    body.appendChild(pill);

    // Enable reordering within slots: drag a pill to another slot index
    pill.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
}

/**
 * Drag helpers
 */
function addDragHandlers(el, origin, slotIndex = -1) {
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', el.dataset.id || '');
    e.dataTransfer.dropEffect = origin === 'slot' ? 'move' : 'copy';
  });
}

/**
 * Utils
 */
function genId(type, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${type}-${slug}-${rand}`;
}

function toast(msg) {
  try {
    const id = 'options-toast';
    let box = document.getElementById(id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      box.style.position = 'fixed';
      box.style.right = '24px';
      box.style.bottom = '24px';
      box.style.background = 'rgba(28,27,74,0.95)';
      box.style.color = '#fff';
      box.style.padding = '10px 14px';
      box.style.borderRadius = '8px';
      box.style.zIndex = '9999';
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.style.opacity = '1';
    setTimeout(() => { box.style.opacity = '0'; }, 2200);
  } catch {}
}
