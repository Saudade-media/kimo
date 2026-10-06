# Built-in agent

Kimo has its own agent in the **Agent** tab of the right panel. It edits the open file through the same tools as an [external coding agent](../../agents/index.md), so every change is an undoable step you can see on the canvas. It runs on a model you choose: a coding-agent CLI you already use, or an API key.

## Choose a model

### Local agent CLIs (desktop app)

Kimo can drive **Claude Code** (`claude`), **Codex** (`codex`) or **Gemini CLI** (`gemini`) when it is installed and signed in on your machine. Turns are then billed to your Claude, ChatGPT or Google plan (or the CLI's own API key), and Kimo never sees or stores the CLI's credentials. You can also add another CLI in **Settings › AI providers**.

Kimo finds the CLIs on your `PATH` (including your login shell's) and in the usual install folders, and checks whether each one is signed in. If one isn't, sign in from a terminal (`claude auth login`, `codex login`, or run `gemini`) and click **Re-check all**.

Kimo restricts each CLI to Kimo's own tools and, while [web access](#web-access) is on, its web tools: it runs in a private working folder under `~/.kimo/cli-workspaces/`, without file or shell tools of its own. Codex also runs without its ChatGPT apps.

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

### The model chooser

The model chip in the composer shows the model's name, with a mark for where it runs: a terminal for a CLI, a cloud for an API, a hard drive for a local runtime. Click it to open the chooser, which switches the model for the current session:

- **Recent** lists your last two picks (model and provider) when two or more providers are connected. One click picks both.
- **Provider** chips come next: the CLIs (Claude Code, Codex, Gemini CLI) on the first row, the API providers (Anthropic, OpenAI, Gemini, Local and others) on the second. Only connected providers are listed. A CLI that is installed but signed out keeps its chip with a warning dot and offers **Sign in…**.
- **Models** of the chosen provider follow. A CLI lists **Default (CLI decides)** first, which uses the model set in the CLI itself, then specific models. A tag marks the **Best** and **Fast** models and local ones. Hover a model to see its context window and output limit.
- **Effort** sets how hard the model thinks: **Low**, **Medium**, **High** or **Max**, showing only the levels the model supports. Models without the control (local models, gpt-4.1, Gemini CLI) hide it. New sessions start at High, and the level stays when you switch models.
- **Connect a provider…** (`⌘,`) opens Settings › AI providers.

When a provider lists 9 or more models, a search field appears at the top. Typing filters models across all providers, grouped by provider.

Keys: type to search, `←` / `→` switch provider while the search field is empty, `↑` / `↓` move through the models, `Enter` picks, `Tab` moves to Effort (then `←` / `→` change the level), `Esc` closes.

The specific CLI models, checked against the installed CLIs:

| CLI | Models (`--model` value) | Effort |
|---|---|---|
| Claude Code | Opus 5.5 (`claude-opus-5-5`), Sonnet 5.5 (`claude-sonnet-5-5`), Haiku 4.5 (`claude-haiku-4-5-20251001`), Fable 5.1 (`claude-fable-5-1`) | `--effort low`, `medium`, `high` or `max`; none for Haiku 4.5 |
| Codex | GPT-5.6 Terra (`gpt-5.6-terra`), GPT-5.6 Luna (`gpt-5.6-luna`) | `-c model_reasoning_effort` `low`, `medium`, `high` or `max` |
| Gemini CLI | Gemini 2.5 Pro, Gemini 2.5 Flash | None |

What each Effort level sends to an API provider:

| Model | Low | Medium | High | Max |
|---|---|---|---|---|
| Claude Opus 5.5, Sonnet 5.5, Fable 5.1 | `output_config.effort: low` | `medium` | `high` | `max` |
| Claude Haiku 4.5 | No extended thinking | 4,096 thinking tokens | 8,192 | 16,000 |
| OpenAI o3 | `reasoning_effort: low` | `medium` | `high` | Not offered |
| Gemini 2.5 Pro, Flash | `thinkingBudget: 1024` | 8,192 | 16,384 | 24,576 |

Sessions saved before 1.0 used Off, Auto and Max. They open as Low, High and Max.

## Web access

The agent can search the web and read pages when a task needs facts from outside the file, such as a library's default font stack or a product's current copy. It is on by default.

- **Settings › AI providers › Allow web access** sets it for new sessions.
- The globe button in the composer turns it off (or back on) for the current session only. A new or reopened session starts from the setting again.
- **Settings › Fonts & privacy › No third-party fetch** turns it off everywhere. The setting row and the globe show as disabled and say why.

Each search and each page read is a step in the thread ("Searching the web for “…”", "Reading example.com") and is saved with the session. On desktop it is also a row in **Activity**. The reply ends with **Sources:** and the links it used. Web access needs no approval, and auto-approve doesn't change it.

What each model uses:

| Model | Web tools |
|---|---|
| Claude Code | Its `WebSearch` and `WebFetch` tools, and no other built-in tool |
| Codex | Its live `web_search` tool |
| Gemini CLI | Its `google_web_search` and `web_fetch` tools |
| Anthropic | The `web_search` and `web_fetch` server tools. Each search costs $10 per 1,000 searches on top of tokens, and the cost estimate includes it |
| OpenAI-compatible (Responses API) | OpenAI's `web_search` tool |
| Foundry | `web_search` and `web_fetch` (basic versions) |
| Vertex | `web_search` only |
| Google Gemini, OpenRouter, custom endpoints, Bedrock, OpenAI Chat Completions, other CLIs | None. The globe is disabled ("This model can't use the web") |

With web access off, Claude Code runs with no built-in tools, Codex runs with `web_search="disabled"`, and Gemini CLI excludes both web tools.

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
