export const MODES = {
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

export const DEFAULT_SETTINGS = {
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  defaultMode: MODES.learning.id,
  previewBeforeSend: false
};

export const STORAGE_KEY = 'promptBoosterSettings';

export function getModeChoices() {
  return Object.values(MODES);
}
