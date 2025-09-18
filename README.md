# PromptBooster


# Prompt Booster — Product Design Document

## 1. Product Overview

**Prompt Booster** is a browser plugin/chat extension that helps users optimize their prompts when interacting with ChatGPT or other large language models. Users can either send their original prompt directly or click the **“Boost Prompt”** button, which automatically rewrites their prompt into a higher-quality version and sends it without requiring further editing.

---

## 2. Core Features

### 2.1 One-Click Enhancement

* Two options when a user types a prompt:

  * **Send**: Send the original prompt.
  * **Boost Prompt**: Automatically rewrite the prompt and send the optimized version.

### 2.2 Multiple Modes (priority order)

1. **Learning Mode** (default)

   * Rewrites prompts to encourage **deep thinking, reflective thinking, and critical thinking**.
   * Adds reasoning steps, self-questioning, and comparison prompts to guide stronger engagement.
   * **Example**:

     * Original: *“Write me an essay about artificial intelligence.”*
     * Boosted (Learning Mode): *“First, ask me 3 key questions to clarify my perspective. Then suggest two possible essay outlines with pros/cons, help me draft a thesis and evidence plan, and finally provide writing advice once I decide on a direction.”*

2. **Structured Mode**

   * Adds step-by-step instructions for clarity.
   * Example: request answers in bullet points, provide examples, then summarize.

3. **Concise Mode**

   * Keeps the original intent but rewrites the prompt to be shorter, clearer, and more precise.

4. **Creative Mode**

   * Expands prompts with brainstorming or divergent thinking elements.

### 2.3 History Comparison

* Chat history shows both versions:

  * Original prompt (small, gray text).
  * Optimized prompt (normal bubble).

### 2.4 Settings

* Default mode: Learning Mode.
* Users can switch modes in settings.
* Option to enable/disable “Preview before sending.”

---

## 3. User Flow

1. User types a prompt in the chat input box.
2. User clicks **“Boost Prompt.”**
3. The plugin:

   * Rewrites the prompt according to the selected mode.
   * Replaces the original prompt and sends it automatically.
4. The AI responds. Chat history displays both original and optimized prompts.

---

## 4. UI/UX Design

* **Input Area**: Add a **Boost Prompt** button next to the “Send” button.
* **Interaction**:

  * Click “Send” → original prompt.
  * Click “Boost Prompt” → optimized prompt, auto-sent.
* **History**: Show original prompt (gray text) and boosted prompt (normal).

---

## 5. Technical Architecture (high level, no code)

* **Frontend**: Browser extension (Chrome/Edge/Firefox), injected into chat input areas.
* **Processing Logic**: Sends the user’s prompt to a rewriting module, applies the selected mode, and returns an optimized prompt.
* **Compatibility**: First support ChatGPT web, expandable to Claude, Perplexity, and others.

---

## 6. Risks & Mitigation

* **User dissatisfaction with rewrite** → Allow easy mode switching or revert to original prompt.
* **Unwanted interruptions** → Option to always send the original prompt by default.
* **Mode overload** → Keep UI simple: one Boost button, with mode settings tucked away.

---

## 7. MVP Requirements

1. Implement **Learning Mode** as the default.
2. One-click enhancement + auto-send workflow.
3. Display original vs. optimized prompts in chat history.
4. Support mode switching (Learning / Structured / Concise / Creative).

---

👉 **Summary:**
This document positions Prompt Booster as a **user-facing productivity tool**, with **Learning Mode as the centerpiece** to encourage deeper thinking. The design emphasizes simplicity (one-click use), clear UX, and minimal configuration, making it straightforward for developers to build an MVP.

---

## 8. Development Quickstart

This repository now contains a Manifest V3 browser extension that implements the PromptBooster MVP described above.

### Load the extension in Chrome

1. Run `npm install` (optional) to set up future tooling, then build assets if needed (no compilation is required for the current MVP).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the project root folder.

### Configure PromptBooster

1. Open the extension options page from the extension card or by navigating to `chrome://extensions`, finding **PromptBooster**, and clicking **Details → Extension options**.
2. Paste an API key for your preferred OpenAI-compatible provider, confirm the API endpoint URL and model, and select the default optimization mode.
3. Toggle **Preview boosted prompt before sending** if you want to confirm rewrites before they are submitted automatically.

### Using the extension

1. Visit [https://chat.openai.com](https://chat.openai.com) and type a prompt.
2. Click **Boost Prompt** to send the text to your configured LLM and replace the input with the optimized version. If preview is enabled, approve the rewrite before the message is auto-submitted.
3. After sending, the conversation view displays the boosted prompt along with a smaller note that preserves the original wording.

