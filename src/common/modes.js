import { MODES } from './constants.js';

function buildInstruction({ originalPrompt }) {
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

  // Optimization styles removed; always use the same base instruction.
  return baseInstruction;
}

export function buildChatMessages({ originalPrompt }) {
  const systemMessage = {
    role: 'system',
    content: buildInstruction({ originalPrompt })
  };

  const userMessage = {
    role: 'user',
    content: originalPrompt
  };

  return [systemMessage, userMessage];
}
