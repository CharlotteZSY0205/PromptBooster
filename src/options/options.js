import { DEFAULT_SETTINGS, getModeChoices } from '../common/constants.js';
import { getSettings, saveSettings } from '../common/storage.js';

document.addEventListener('DOMContentLoaded', init);

async function init() {
  populateModeChoices();
  const settings = await getSettings();
  applySettings(settings);
  const form = document.getElementById('settings-form');
  form.addEventListener('submit', onSubmit);
}

function populateModeChoices() {
  const modeSelect = document.getElementById('defaultMode');
  const fragment = document.createDocumentFragment();
  for (const mode of getModeChoices()) {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = `${mode.label} — ${mode.description}`;
    fragment.appendChild(option);
  }
  modeSelect.appendChild(fragment);
}

function applySettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  document.getElementById('apiKey').value = merged.apiKey;
  document.getElementById('apiBaseUrl').value = merged.apiBaseUrl;
  document.getElementById('model').value = merged.model;
  document.getElementById('defaultMode').value = merged.defaultMode;
  document.getElementById('previewBeforeSend').checked = merged.previewBeforeSend;
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('status');
  status.textContent = 'Saving…';

  const formData = new FormData(form);
  const update = {
    apiKey: String(formData.get('apiKey') || '').trim(),
    apiBaseUrl: String(formData.get('apiBaseUrl') || '').trim() || DEFAULT_SETTINGS.apiBaseUrl,
    model: String(formData.get('model') || '').trim() || DEFAULT_SETTINGS.model,
    defaultMode: String(formData.get('defaultMode') || DEFAULT_SETTINGS.defaultMode),
    previewBeforeSend: formData.get('previewBeforeSend') === 'on'
  };

  try {
    await saveSettings(update);
    status.textContent = 'Settings saved.';
    status.className = 'success';
  } catch (error) {
    console.error('PromptBooster save failed', error);
    status.textContent = 'Unable to save settings. See the console for details.';
    status.className = 'error';
  }
}
