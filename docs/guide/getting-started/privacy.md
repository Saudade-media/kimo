# Privacy

Kimo is local first. Your designs are files on your machine (or in your browser's storage), there is no account, and Kimo has **no telemetry**: no analytics, no crash reporting, no usage tracking.

## What leaves your machine

Kimo only talks to the network for these:

| What | When | Where to |
|---|---|---|
| **Google Fonts** | The first time a file uses a Google font you don't have; then it is stored in the file's `assets/` folder and cached, so it is never fetched again | `fonts.googleapis.com`, `fonts.gstatic.com` (no cookies, no referrer) |
| **Offline font pack** | Only when you press **Download** in Settings › Fonts & privacy | `fonts.googleapis.com`, `fonts.gstatic.com` |
| **AI providers** | Only when you configure a provider and use the built-in agent: each turn, **Test**, and naming sessions and files with the fast model | The provider you chose (Anthropic, OpenAI, Google, OpenRouter, your own endpoint, AWS, Google Cloud or Azure) |
| **Agent CLIs** | When the built-in agent runs on Claude Code, Codex or Gemini CLI | Whatever that CLI contacts; Kimo only starts it |
| **Update check** (desktop) | When the app starts, and **Check now** | GitHub releases. **Download updates** controls whether updates download |

Links you click (provider key pages, install guides, docs) open in your browser.

## Turning things off

**Settings › Fonts & privacy**:

- **Google Fonts** off: Kimo never fetches fonts; missing fonts render with a fallback until you install them.
- **No third-party fetch** on: blocks every request to Google, including the offline font pack download. Kimo never loads remote image URLs in any case: images are always files in the file's `assets/` folder.

Fonts already stored in a file, installed, in the [offline font pack](../editor/fonts.md#offline-font-pack) or in the cache keep working either way.

The built-in agent makes no request until you add a provider or a CLI is used.

## Keys and conversations

- **API keys:** in the desktop app, in your OS keychain; requests are signed by the app itself, so the editor never sees the key. In the browser, in the page's `localStorage`. See [Providers](../built-in-agent/providers.md#where-keys-are-kept).
- **Agent sessions** are stored on this device, not in the `.kimo` file.
- **Copy diagnostics** (Help) copies only your version, platform, renderer and locale, and only when you paste it somewhere.
