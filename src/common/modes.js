import { MODES } from './constants.js';

/**
 * Build the system instruction for Boosted Prompt.
 * The LLM should transform the user's original prompt according to a user-authored rewrite rule.
 * It must not solve the task; it should only return the rewritten prompt text.
 */
function buildInstruction({ rule }) {
  const baseInstruction = `
You are a prompt optimizer. The user will provide:
- A rewrite rule describing how they want their original prompt to be transformed
- The original prompt itself

Your task:
- Produce a single improved prompt that follows the user's rewrite rule
- Do NOT answer or solve the prompt
- Do NOT add explanations or commentary
- Return ONLY the rewritten prompt text with no prefixes or suffixes
`.trim();

  const ruleLine = `Rewrite Rule: ${String(rule || '').trim() || '(none provided)'}`;
  return `${baseInstruction}\n\n${ruleLine}`;
}

/**
 * Build chat-completion messages combining the system instruction (with rule)
 * and a user message that includes the original prompt.
 */
export function buildChatMessages({ originalPrompt, rule }) {
  const systemMessage = {
    role: 'system',
    content: buildInstruction({ rule })
  };

  const userMessage = {
    role: 'user',
    content: `Original Prompt:\n${String(originalPrompt || '').trim()}`
  };

  return [systemMessage, userMessage];
}
