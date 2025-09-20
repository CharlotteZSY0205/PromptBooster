import { MODES } from './constants.js';

function buildInstruction({ originalPrompt, modeId }) {
  const baseInstruction = `
1. rewrite the prompt into an exploratory, scaffolded version that encourages the student to think, plan, or reflect for themselves;
2. Avoid completing the task on their behalf;
3. If the original prompt is vague, feel free to infer the likely topic and add clarifying or guiding questions;
4. Return only the improved prompt with no prefatory text

Your rewrites should support the development of the following student abilities:
* Planning writing tasks (e.g., generating ideas, organizing outlines)
* Active exploration and self-questioning
* Self-monitoring and reflection (e.g., realizing what help they actually need)
* Incremental learning (e.g., breaking tasks into manageable parts rather than completing them all at once)
`.trim();

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
