import { MODES } from './constants.js';

function buildInstruction({ originalPrompt, modeId }) {
  const baseInstruction =
    'Rewrite the user\'s prompt to make it more effective for a large language model assistant. '
    + 'Return only the improved prompt with no prefatory text.';

  switch (modeId) {
    case MODES.structured.id:
      return (
        baseInstruction +
        ' Emphasize step-by-step structure, request organized answers, and encourage summaries after each major step.'
      );
    case MODES.concise.id:
      return (
        baseInstruction +
        ' Keep it short and precise, removing redundancy while protecting the original intent and required constraints.'
      );
    case MODES.creative.id:
      return (
        baseInstruction +
        ' Encourage imaginative thinking, brainstorming alternatives, and exploring diverse directions relevant to the user\'s goal.'
      );
    case MODES.learning.id:
    default:
      return (
        baseInstruction +
        ' Focus on deep thinking, self-critique, and reflective questioning. Ask for clarifications when helpful and suggest structured reasoning steps.'
      );
  }
}

export function buildChatMessages({ originalPrompt, modeId }) {
  const systemMessage = {
    role: 'system',
    content: buildInstruction({ originalPrompt, modeId })
  };

  const userMessage = {
    role: 'user',
    content: originalPrompt
  };

  return [systemMessage, userMessage];
}
