export async function callLLM({ apiKey, apiBaseUrl, model, messages }) {
  if (!apiKey) {
    throw new Error('Missing API key. Add it from the PromptBooster options page.');
  }

  if (!apiBaseUrl) {
    throw new Error('Missing API base URL.');
  }

  const requestBody = {
    model,
    messages,
    temperature: 0.4
  };

  const response = await fetch(apiBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const firstChoice = payload?.choices?.[0];
  const content = firstChoice?.message?.content?.trim();

  if (!content) {
    throw new Error('The LLM response did not contain a usable message.');
  }

  return content;
}
