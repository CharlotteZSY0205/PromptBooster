# PromptBooster Extension Installation Guide

This guide will walk you through installing the PromptBooster browser extension step by step. This extension works on Google Chrome, Microsoft Edge, and other Chromium-based browsers. If you're new to browser extensions, don't worry—this is straightforward!

## Prerequisites

- A computer with Google Chrome or another Chromium-based browser (like Edge or Brave) installed.
- Basic familiarity with your operating system (e.g., how to open folders and run commands).
- (Optional) Node.js installed on your system if you need to build the extension from source. You can download it from [nodejs.org](https://nodejs.org) if it's not already installed.

> **Note:** If you're installing a pre-built version, you don't need Node.js. Check if the repository has a built version (no `dist` folder visible? You may need to build).

## Step 1: Download the Extension Code

1. Go to the GitHub repository for PromptBooster: [https://github.com/CharlotteZSY0205/PromptBooster](https://github.com/CharlotteZSY0205/PromptBooster).
2. Click the green "Code" button.
3. Select "Download ZIP" to download the source code as a ZIP file.
4. Unzip the downloaded file to a folder on your computer (e.g., Desktop or Documents). This folder will be your extension's root directory.

Alternatively, if you have Git installed:
- Open a terminal/command prompt.
- Run: `git clone https://github.com/CharlotteZSY0205/PromptBooster.git`
- Navigate to the cloned folder.

## Step 2: (Optional) Build the Extension

The extension might need to be built from source code. Check if there's a `dist` or `build` folder in the unzipped/cloned directory. If not, or if you see source files like `.js` in `src/`, follow these steps:

1. Open a terminal or command prompt.
2. Navigate to the extension's root folder (where `package.json` is located).
   - Example: `cd Desktop/PromptBooster` (adjust based on where you unzipped it).
3. Install dependencies (if any):
   - Run: `npm install`
   - This might take a minute. It's setting up tools for building.
4. Build the extension:
   - Run: `npm run build`
   - This compiles the source into a ready-to-use version. If it fails, the extension might not need building—proceed to Step 3.

> **Tip for Novices:** If you see an error, try skipping to Step 3. Many extensions don't need building if they're simple injects.

## Step 3: Load the Extension into Your Browser

### For Google Chrome:
1. Open Google Chrome.
2. Type `chrome://extensions/` in the address bar and press Enter.
3. In the top-right corner, toggle on "Developer mode."
4. Click the "Load unpacked" button.
5. Select the extension's root folder (the one with `manifest.json` inside). If you built it, select the `dist` or `build` folder if it exists; otherwise, select the main folder.
6. The extension should now appear in your list of extensions with the name "PromptBooster."

### For Microsoft Edge:
1. Open Microsoft Edge.
2. Type `edge://extensions/` in the address bar and press Enter.
3. In the bottom-left corner, toggle on "Developer mode."
4. Click "Load unpacked" and select the extension's root folder as above.
5. It should load similarly to Chrome.

### For Firefox:
> **Warning:** The extension is built for Chromium-based browsers (Chrome/Edge). For Firefox, it needs conversion to an older format, which is more advanced. If you're a novice, consider using Chrome instead. If you must use Firefox, search for "convert Chrome extension to Firefox" or ask for help in forums.

## Step 4: Configure the Extension

1. After loading, find the PromptBooster extension in your extensions list (still on the `chrome://extensions` page).
2. Click on the "Details" button next to it.
3. Click "Extension options" to open the settings page.
4. Here, you'll need to set up:
   - **API Key:** Paste your API key from an OpenAI-compatible provider (e.g., OpenAI or a service like Grok).
   - **API Endpoint URL:** The URL for your provider's API (defaults are usually fine).
   - **Model:** Select the model you want to use for rewriting (e.g., GPT-4).
   - **Default Mode:** Choose your preferred mode (Learning Mode is recommended for beginners).
   - **Preview Option:** Toggle whether you want to see the rewritten prompt before sending it. Enable this if you're unsure about changes.
5. Save your settings.

> **Tip:** Get an API key from OpenAI's website if you don't have one. Sign up and get one from their API section.

## Step 5: Test the Extension

1. Go to [ChatGPT's website](https://chat.openai.com) (or another supported chatbot).
2. Make sure you're logged in.
3. Type a prompt in the chat box, like: "Tell me about dogs."
4. You should see a new "Boost Prompt" button next to the "Send" button.
5. Click "Boost Prompt" to let the extension rewrite and send an improved version.
   - If preview is enabled, you'll see the rewritten prompt first and can edit or approve it.
6. In the chat history, you'll see your original prompt (in gray) and the boosted one.

## Troubleshooting

- **Extension not loading?** Make sure you selected the correct folder (where `manifest.json` is). If built, use the `dist` folder.
- **API errors?** Double-check your API key, endpoint, and model in settings.
- **Button not showing?** Refresh the page or make sure you're on chat.openai.com. The extension only works on specific sites.
- **Build failed?** Skip building and try loading the source directly—many simple extensions work without it.
- **Permission issues?** The extension needs permissions for storage and active tabs. Grant them when prompted.

## What's Next?

Once installed, explore the different modes in settings: Learning Mode, Structured Mode, etc. Refer to the README.md for more features.

If you encounter issues, feel free to ask for help or check the GitHub repository for updates.

Happy prompting! 🚀
