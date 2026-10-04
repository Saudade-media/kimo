# Built-in agent

Kimo has its own agent in the **Agent** tab of the right panel. It edits the open file through the same tools as an [external coding agent](../../agents/index.md), so every change is an undoable step you can see on the canvas. It runs on a model you choose: a coding-agent CLI you already use, or an API key.

## Choose a model

### Local agent CLIs (desktop app)

Kimo can drive **Claude Code** (`claude`), **Codex** (`codex`) or **Gemini CLI** (`gemini`) when it is installed and signed in on your machine. Turns are then billed to your Claude, ChatGPT or Google plan (or the CLI's own API key), and Kimo never sees or stores the CLI's credentials. You can also add another CLI in **Settings › AI providers**.

Kimo finds the CLIs on your `PATH` (including your login shell's) and in the usual install folders, and checks whether each one is signed in. If one isn't, sign in from a terminal (`claude auth login`, `codex login`, or run `gemini`) and click **Re-check all**.

Kimo restricts each CLI to Kimo's own tools: it runs in a private working folder under `~/.kimo/cli-workspaces/`, without file, shell or web tools of its own.

### API providers

**Settings › AI providers** lists:

- **Anthropic**
- **OpenAI-compatible**
- **Google Gemini**
- **OpenRouter**
- **Custom endpoint · Ollama** (a local OpenAI-compatible server such as Ollama at `http://localhost:11434/v1`; no key needed)
- **Bedrock · Vertex · Foundry** (Claude through AWS, Google Cloud or Azure credentials; desktop only)
- **Add provider** for any other endpoint speaking the OpenAI Chat, OpenAI Responses or Anthropic API

Saving a key runs **Test** right away: it lists the provider's models and sends one tiny request, so it costs a few tokens.

### Which model is used

When you open the Agent tab, Kimo picks:

1. The default you chose (for example with **Use Claude Code** on the first-run card), if it is still usable.
2. Claude Code, if it is installed and signed in.
3. Another signed-in CLI.
4. An API provider: Anthropic first, otherwise the first one configured.
5. Otherwise the panel asks you to **Connect a model**.

The model picker in the composer switches models for the current session. On desktop it lists the CLIs first (tagged **subscription** or **API key**, or **not signed in**), then the API providers. Models that support it have a **Thinking** control (Off, Auto, Max).

## Where keys are kept

| | Desktop app | Browser |
|---|---|---|
| API keys | The OS keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux). Kimo's web layer never sees them: the desktop app adds them to each request itself | `localStorage` of the Kimo origin. Scripts on that page can read it, so prefer the desktop app |
| CLI sign-in | Stays with the CLI | CLIs aren't available |
| Custom endpoints | The key is only sent to the origin you saved it for | Same |

> [!WARNING]
> **Anthropic in the browser.** Calling Anthropic from a web page exposes the key to the page, so the browser needs an explicit opt-in (connecting from the first-run card counts as one). OpenAI-compatible endpoints and Ollama only work in the browser when they allow Kimo's origin (CORS; for Ollama set `OLLAMA_ORIGINS`). Bedrock, Vertex, Foundry and local CLIs are desktop only.

## Next

- [The Agent tab](agent-tab.md): sessions, modes, approvals and costs
- [Skills](skills.md): built-in and your own
- [Prompts and placeholders](prompts-and-placeholders.md): prompts that live on the canvas
