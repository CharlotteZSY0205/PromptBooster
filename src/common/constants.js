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
  previewBeforeSend: false,
  // Quick mode items for top-left composer buttons
  // type: 'replace' overwrites the input; type: 'append' adds to the end
  items: [
    {
      id: 'replace_creative',
      type: 'replace',
      name: 'Creative',
      content:
        'You are a creative writing partner. Transform my idea into a more imaginative, surprising exploration. Ask 2–3 clarifying questions and propose 3 angles before drafting. Then outline next steps I should take.'
    },
    {
      id: 'replace_structured',
      type: 'replace',
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
  // Up to 3 bound items appear as quick buttons (left to right)
  bindings: ['replace_creative', 'append_wechat_cn', 'append_refs']
};

export const STORAGE_KEY = 'promptBoosterSettings';

export function getModeChoices() {
  return Object.values(MODES);
}
