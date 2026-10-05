# 0014. M6 built-in agent: provider interface and adapters, local agent CLIs, the in-process tool loop, modes with enforced scopes, sessions, skills, placeholders and prompt nodes

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** maintainers (M6 contract phase)
- **Teardown refs:** 3.4 (AI and agents), 8.1 principles 3, 5, 6, 9.1 (`ai-agent` package), 9.2 (LLM layer, default models, key storage and provider reach), 9.4 (one tool registry), 11.3 (`kimo_spawn_agents`, scope rules), 12 (M6 row), 13.3 (provider churn, strict schemas)
- **Builds on:** [0006](0006-llm-provider-interface.md) (Kimo-owned `Provider`), [0013](0013-m5-mcp-server.md) (tool registry, envelope, policy, approvals, activity, presence), [0012](0012-m4-desktop-and-files.md) (`@kimo/platform`), format spec §5.3/§5.5
- **Design:** `desing.pen` board 22 "Built-in Agent (M6)" (D0zDSY): providers (hxt9h), agent panel (s4pGz0), modes (ZFOQf), placeholder (DzQcZ), note & prompt nodes (cf2sC), home composer (w9bz9)

## Context

M6 adds an agent inside Kimo: bring your own key for any provider, or — new requirement — run
the user's own installed agent CLI (Claude Code, Codex, Gemini CLI) on their existing
subscription. It must reuse M5's registry, policy, approvals, activity and presence so scopes are
enforced by the ops layer, never by the prompt; must work in the browser where providers allow
it; and must not repeat pen.dev's mistakes (silent model fallback, vendored CLIs, metering,
prompt-scoped parallel agents). Several builders work in parallel (desktop shell, document host,
web UI), so the seams are fixed here, in code: `packages/ai-agent` (`@kimo/ai-agent`),
`packages/platform/src/{secrets,cli-agents}.ts`, the "M6 built-in agent" section of
`apps/web/src/platform/contract.ts`, and the format additions.

## Decision

### 1. Package

`@kimo/ai-agent` depends on `@kimo/mcp-server` (main entry: browser-safe), `@kimo/core-schema`
and **`@anthropic-ai/sdk` 0.131.0** (pinned; verified on npm 2026-10-04). The main entry is
runtime-neutral and browser-safe; host services are injected (fetch, process host, skill source,
session store, M5 tool context). `@kimo/ai-agent/node` adds Node implementations (child-process
CLI host, `~/.kimo/skills` reader) for tests and the `kimo` CLI. Other adapters use raw `fetch` +
SSE, so no second SDK's churn reaches the agent.

### 2. Provider interface (`src/providers/provider.ts`, `src/types.ts`)

`Provider { id, kind, config, stream(req), listModels(), test(), modelInfo() }` with a neutral,
**append-only** message model (`user` / `assistant` / `tool`), tool specs (portable-profile JSON
Schema from the M5 registry), streaming events (`text_delta`, `thinking_delta`,
`tool_call_start/delta`, `usage`, `message_end {message, stopReason, usage, servedBy}`),
structured output (`responseSchema`), usage (input, output, cache read, cache write) and
cancellation (`AbortSignal`). Assistant messages carry the adapter's `native` content so the same
provider + model replays it verbatim (Anthropic thinking blocks are bound to model and
conversation; Gemini `thoughtSignature`s must round-trip). Errors are one `ProviderError` with a
`kind` (§6).

Adapters:

| Adapter | Transport | Notes |
|---|---|---|
| Anthropic (default) | `@anthropic-ai/sdk` `beta.messages.stream` + `finalMessage()` | Prompt caching: breakpoint after the stable system prompt (covers tools + system) and on the newest message; volatile system text after the first breakpoint. Thinking per §3. Tools with `eager_input_streaming`; every input re-validated by M5 dispatch. No forced `tool_choice` (400 on Opus 5.5); structured output via `output_config.format`. Server-side refusal fallback `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) on first-party endpoints when enabled. SDK `maxRetries: 0` (the loop retries). |
| OpenAI-compatible | fetch + SSE | Chat Completions (`/chat/completions`, `stream_options.include_usage`) and Responses (`/responses`, `store: false`). Images in tool results follow as a user message. |
| OpenRouter | OpenAI-compatible Chat | `openrouter.ai/api/v1`, attribution headers. |
| Custom / Ollama | OpenAI-compatible or Anthropic wire | Default `http://localhost:11434/v1`, no key, `free` (estimates $0). |
| Gemini | fetch + SSE `:streamGenerateContent?alt=sse` | `x-goog-api-key`; tool schemas in `parametersJsonSchema` (full JSON Schema). |
| Bedrock / Vertex / Foundry | Anthropic wire to `kimo-relay://<platform>` | Desktop only; Rust signs (SigV4, Google ADC, Entra). |

**Browser support matrix** (`BROWSER_SUPPORT`, published in Settings and the docs):

| Provider | Web | Desktop | How |
|---|---|---|---|
| Anthropic | opt-in | direct | `dangerouslyAllowBrowser` toggle; the key is visible to page scripts |
| OpenAI-compatible | proxy | direct | CORS varies per endpoint; Test tells; else desktop or a local proxy |
| Google Gemini | direct | direct | key in header |
| OpenRouter | direct | direct | CORS allowed |
| Custom · Ollama | proxy | direct | `OLLAMA_ORIGINS` must allow the Kimo origin |
| Bedrock · Vertex · Foundry | — | direct | signed / OAuth credentials: Rust-side HTTP or a user-run proxy |
| Local agent CLIs | — | direct | process spawn (§11) |

"Direct" on desktop always means through the Rust relay (§4): webview `fetch` would hit CORS.

### 3. Models and thinking (`src/models.ts`, the one config module)

- A model is `{provider, model}`. `resolveModel` throws `unknown_model` for an unconfigured
  provider or an id that is neither in the catalog nor the provider's agent/fast/extra list —
  **never a fallback**. Open families (OpenAI-compatible, OpenRouter, custom) accept ids listed by
  the endpoint or added in Settings.
- Defaults (lead decision): agent **`claude-opus-5-5`**, fast **`claude-haiku-4-5-20251001`**
  (Anthropic is the default provider). `VERIFIED_ANTHROPIC_IDS` feeds the scheduled CI check
  against `GET /v1/models/{id}` (ADR 0006 §5). OpenAI/Gemini defaults (`gpt-4.1`/`gpt-4.1-mini`,
  `gemini-2.5-pro`/`-flash`); OpenRouter/custom ship no guessed defaults.
- Thinking is per session: **Off / Auto / Max**, shown only for models that support it.
  Anthropic effort models (Opus 5.5 cannot disable thinking): Off = effort `low`, Auto = `high`,
  Max = `max`, adaptive thinking with `display: "summarized"`. Haiku 4.5: Off = none, Auto =
  4 096, Max = 16 000 budget tokens. OpenAI reasoning models: `reasoning_effort` low/medium/high.
  Gemini 2.5: `thinkingBudget` 0 / −1 / 24 576.
- The fast model names sessions (`TITLE_SCHEMA`, structured output), summarizes and names layers.

### 4. Keys and the request relay (`@kimo/platform` `src/secrets.ts`)

- Desktop: OS keychain, **service `kimo`, account `provider.<id>`**. After saving, keys never
  enter JS: adapters use `createRelayFetch` as their `fetch`; Rust reads the key, injects the auth
  header (SDK placeholder headers are stripped), performs the request and streams the body back.
- Web: `localStorage` key **`kimo.providers`** (this origin only, never synced) with the
  `WEB_SECRETS_WARNING`; Anthropic additionally needs the browser opt-in.
- Tauri commands (kept out of the frozen `TAURI_COMMANDS`; the shell adds a mirror test):
  `kimo_secret_has`, `kimo_secret_set`, `kimo_secret_delete`, `kimo_secret_list`,
  `kimo_secret_hint`, `kimo_ai_request {requestId, provider, method, url, headers, bodyBase64?,
  auth: header | none | cloud}`, `kimo_ai_abort {requestId}`; event `kimo://ai-response
  {requestId, status?, headers?, chunkBase64?, end, error?}`. Rust allows `https://`,
  `http://localhost|127.0.0.1` and `kimo-relay://bedrock|vertex|foundry` only.

### 5. The loop and the tool host (`src/loop.ts`, `src/toolhost.ts`)

- One registry: the agent calls the **same `@kimo/mcp-server` tools in process** through M5
  `dispatch` (validate → authorize → approval → handler → envelope → activity). The document
  host builder supplies the `ToolContext` (origin **`agent:kimo.<session>.<n>`**, lead n = 0),
  handlers and `DispatchOptions`; `createRegistryToolHost` adapts them and appends agent-only
  tools. Tool order is the registry's (stable for prompt caching); stubs are hidden.
- **Where the tools run** (`apps/web/src/agent-panel`). On desktop, when the window's document
  is hosted by the document host, the `ToolHostFactory` is `createHostTools`: every registry
  call is the host RPC **`agentCall {spec: {origin, label, session, policy}, name, input}`**,
  which runs it on a runtime connection opened with `McpHostRuntime.connect(identity, {origin,
  policy, scope, requestApproval})` — identity `{client: "kimo", label, session, transport:
  "in-process"}`, origin `agent:kimo.<session>.<n>`, one connection per (window, origin); the
  turn's policy replaces the previous one (`setPolicy`). So in-app agents are in the host's
  presence list (`kimo://mcp-connections`, `kimo_get_state.agents`), its activity log, pause and
  `agentUndo`, next to MCP clients. Their edits land on the host store under their own origin
  (own undo stack; the window's replica receives `remote:agent:…`, never on the user's ⌘Z, and
  an MCP client's `kimo_history` never undoes them). The window's scope travels as
  `policy.nodes` and the host runs the same `checkScope` (`scopeViolations`) against the
  authoritative tree, so OUT_OF_SCOPE is unchanged. Approvals are forwarded to the window
  (`kimo://host-agent-approval {id, origin, request}` → the agent's in-thread card → RPC
  `agentApproval {id, outcome}`), never to the board 21 prompt queue, and wait until answered;
  the window's `agentCall` has no RPC timeout (a host restart fails it TIMEOUT retryable).
  `agentRelease` / the window's `release` close its agent connections (open prompts answer
  deny). Agent-only tools (`kimo_spawn_agents`) still run in the window. With no host (web, an
  older shell) or an untitled document the window falls back to `createInWindowTools` (the
  registry in process over the window's store, same origins, scope check and approvals).
- **In-app approvals wait indefinitely** (`IN_APP_APPROVAL_TIMEOUT_MS = Infinity`); external
  MCP keeps 2 minutes. The host's `requestApproval` for `agent:*` origins must not time out;
  Stop answers pending prompts with `deny`.
- Tool calls run sequentially (op order matters) with a never-aborted signal: **Stop aborts the
  provider stream, lets the in-flight batch commit or roll back atomically**, and gives unexecuted
  calls an error result so history stays valid.
- Each successful mutating envelope (`undoToken`, not dry run) becomes an **op group** of the
  turn. **Regenerate = undo that turn's op groups (newest first, `kimo_history {action:"undo",
  token}`), then resend the same prompt and model** — last turn only (older groups are no longer
  on top). "Undo turn" uses the same list.
- Every turn ends — done, stopped, error — by clearing the placeholders it set (§9).
- Events for the panel: `turn_start`, `text_delta`, `thinking_delta`, `discard_partial`,
  `step_start/end` (AgentStep rows; label from tool + `label`), `usage` (live), `message_end`,
  `retry`, `paused`, `resumed`, `turn_end {TurnRecord}`.

### 6. Errors and retries (`src/errors.ts`, `src/cards.ts`, `src/backoff.ts`)

`ProviderError.kind`: `auth`, `rate_limit`, `network`, `offline`, `cors`, `budget`, `aborted`,
`server`, `invalid_request`, `unknown_model`, `context_length`, `refusal`,
`unsupported_platform`, `unknown`. Retryable (`rate_limit`, `network`, `server`): exponential
backoff with jitter, honoring `retry-after(-ms)`, **5 attempts**; the card reads "attempt 2 of 5".
Offline is not an attempt: the turn pauses and resumes when the platform reports online.
Errors become **inline cards** (auth danger, rate limit warning with auto-retry, offline neutral
with auto-resume, CORS web-only, budget warning, stopped by you, refusal) — never a modal, and
**applied ops are never rolled back** by an error.

### 7. Sessions and costs (`src/session.ts`, `src/pricing.ts`)

- Sessions live in app data — IndexedDB `kimo-sessions` (store `sessions`, key `id`, index
  `fileId`) on **both** web and desktop (the desktop webview has its own IndexedDB inside the
  app's data directory) — **never in the `.kimo`**. Per file, newest first, then other files;
  search over title and message text. `fileId` is the M4/M5 id (`sha256(path)[:16]`).
  *Amended at v1:* the first draft put desktop sessions in `~/.kimo/sessions/<fileId>/<sessionId>.json`.
  That was never built; one store keeps both hosts on the same code path and needs no new
  platform API or file watcher. The trade-off: desktop sessions are not plain files a user can
  grep or back up separately, and clearing the webview's data clears them. The `SessionStore`
  interface (`agent-panel/runtime.ts`) stays injectable, so a file-backed store can replace it
  later without touching the controller.
- Costs are **estimated**: usage × a **versioned price table shipped with each adapter family**
  (`PRICE_TABLES`, `priceVersion` on every estimate). Unknown models estimate to `null` (shown
  "—"), never a guess. The monthly limit pauses after the current batch; "warn per turn" asks
  before a turn expected to exceed it (side by side × N counts as one turn). Subscription CLIs
  report tokens/turns labelled "subscription", never dollars (§11).

### 8. Modes and spawn semantics (`src/modes.ts`, `src/scope.ts`)

- **Single**: scope = selection, or the page (unscoped) when nothing is selected.
- **Side by side** (≤ 6 agents, per-agent model, explore Layout / Style / Both): the lead creates
  N empty top-level frames to the right of the original (`planSideBySide`, `placeholder.by` =
  the child's origin), then spawns one child per frame with an explore brief.
- **Split**: the lead creates placeholder sections inside its scope, then calls
  **`kimo_spawn_agents`** with one child per section; only the lead may touch globals (with the
  grant).
- **Iterate**: one pass per turn on the selected frame, then a review card (next with optional
  steer / stop / revert to a pass by undoing later passes' groups).
- Children: own origin `agent:kimo.<session>.<n>`, own undo stack and activity rows,
  `childPolicy(scope)` = `edit+delete`, `nodes: [frame]`, **no grants**, `onExceed: deny`, and
  `CHILD_EXCLUDED_TOOLS` hidden (save, export, create, open, close, script).
- **Per-op scope enforcement**: the host's `DispatchOptions.targets` calls `checkScope(ops, tree,
  policy.nodes)` and returns `outOfScopeIds` as M5 `CallTargets.outOfScope`; M5 `authorize`
  fails the whole call with **OUT_OF_SCOPE** (batch rolls back). Rules: every target, parent and
  new parent inside the scope (`@key` children inherit); moves across the scope edge, deleting /
  moving / replacing a scope root, globals without the grant, `make_component`, and component
  origin edits outside the scope are rejected. A rejected op flashes a danger pill and logs an
  activity row.
- `runChildren` runs children in parallel (cap 6); "Stop all" aborts every child.

### 9. Placeholder flag, notes and prompts (format additions)

The format already had `placeholder`, `note` and `prompt`. Additive changes (still `0.1.0`, spec
§5.3, §5.5, §17, §20 row 28; schema regenerated; fixtures `valid/agent-nodes-m6.kimo`,
`lint/PROMPT_TARGET_MISSING--not-a-frame.kimo`):

- `note.author` / `prompt.author` (display name).
- `prompt.model`: also the struct **ModelRef `{provider, model}`**; the bare string stays valid
  as the legacy form and resolves only if exactly one configured provider serves it, else the run
  fails loudly (`resolveLegacyModelId`).
- `prompt.target` (Id): the frame a run is scoped to; lint **`PROMPT_TARGET_MISSING`** (warning)
  when it names no frame.
- `placeholder.by` = the owner's origin; an owner that is not live makes the frame *Interrupted*
  (orphan: Clear flag / Resume). Placeholders never lock nodes for people.
- Appendix A stays frozen (row 27): `author` and `provider` are unranked keys and serialize
  after ranked keys in code-unit order.
- Exporters (M7) and Play skip notes and prompts; agents read notes attached to or overlapping
  their scope as context and never edit a person's note.
- Prompt run = one turn with scope = `target`, or a new placeholder frame next to the prompt
  (`planPromptRun`); run state (last run, ops, cost, failure) is app data keyed by
  `<fileId>/<nodeId>`, not stored in the file. "Convert to prompt" is a `replace` that keeps id,
  position and body.

### 10. Skills (`src/skills`)

Built-in skills `kimo-design`, `kimo-layout`, `kimo-tokens` (written for Kimo, MIT) plus the
user's `~/.kimo/skills/<name>/SKILL.md` (YAML front matter `name`, `description`; hot-reloaded by
the host). A user skill may not shadow a built-in. The host source is `platform.skills`
(`@kimo/platform` `src/skills.ts`, a `SkillSource`; absent in the browser): on desktop the
commands `kimo_skills_root`, `kimo_skills_list`, `kimo_skills_read {name}`, `kimo_skills_watch /
_unwatch {watchId}` and the event `kimo://skills-changed {watchId}` (granted by `ai-agent`, not
Settings). Rust reads only `<root>/<dir>/SKILL.md` with a plain folder name, whose canonical path
stays under the canonical root (symlink escapes refused), a regular UTF-8 file ≤ 256 KiB; a
missing root lists empty; the watch creates the root and is recursive (debounced 250 ms). "/" in
the composer opens the menu; toggles enable skills for new turns; a leading `/name` forces a skill for one turn. Active skills append
to the stable (cached) system prompt in name order; the thread shows which skills a turn used.

### 11. Local agent CLIs (`src/cli`, `@kimo/platform` `src/cli-agents.ts`)

- **Provider family `cli:<id>`**: `claude-code`, `codex`, `gemini-cli`, plus generic CLIs
  (command, args template, output format) added in Settings. The CLI runs its own loop on the
  user's subscription/login; Kimo gives it **only Kimo's MCP server** so every edit goes through
  the M5 registry with per-op policy, approvals, activity and presence (origin
  `mcp:<cli>.<session>`), and disables or sandboxes its own file tools so it cannot write the
  `.kimo` directly.
- Invocations (checked against `--help` of Claude Code 2.1.289 and codex-cli 0.146.0):
  - Claude Code: `claude -p --output-format stream-json --input-format stream-json --verbose
    --include-partial-messages --mcp-config <json> --strict-mcp-config --tools ""
    --allowedTools mcp__kimo --permission-mode dontAsk --disable-slash-commands
    --system-prompt <kimo> [--model m] [--effort low|max] [--resume <session>]`; the prompt (and
    images) is one stream-json user line on stdin (addendum 2: `--system-prompt` replaced
    `--append-system-prompt`).
  - Codex: `codex exec [resume <thread>] --json --skip-git-repo-check --sandbox read-only --cd
    <workspace> -c mcp_servers.kimo.command=… -c mcp_servers.kimo.args=[…] -c
    mcp_servers.kimo.default_tools_approval_mode="approve" [-m m] -c
    model_reasoning_effort=… -` (prompt on stdin). `approve` keeps Codex from stopping at its own
    tool prompt (nobody can answer it under `exec`); Kimo's policy and approvals still guard
    every call (ADR 0013 §9).
  - Gemini CLI: `gemini --output-format stream-json --allowed-mcp-server-names kimo [--model m]
    [--resume id] --prompt …` with a workspace `.gemini/settings.json` (Kimo MCP server
    trusted; `write_file`, `replace`, `run_shell_command`, `web_fetch` excluded).
- One process per turn in the **session workspace `~/.kimo/cli-workspaces/<session>/`**;
  follow-ups resume the CLI's own session. The MCP shim inherits that cwd, so the document host
  maps `hello.cwd` (and `hello.ppid` = the spawned pid) to the agent session: its policy (scope in
  modes) and the presence label. Output is parsed into the same `AgentEvent`s as the API loop;
  op groups come from the envelopes in tool results, so regenerate / undo turn work the same.
  Stop sends SIGINT, then SIGTERM (3 s), SIGKILL (6 s).
- **Detection** never prompts: PATH + common install dirs, `--version`, and `claude auth status
  --json` / `codex login status` / Gemini auth-file or env presence → installed, signed in,
  version, account, billing (`subscription` | `cli-api-key`).
- **Default precedence**: Claude Code CLI installed and signed in → other signed-in CLIs → API
  keys (default provider first) → none (first-run card). Settings "Default" and the per-session
  picker override. Web never uses CLIs.
- **Costs**: subscription CLIs show tokens/turns labelled "subscription"; the CLI's reported
  dollar figure is kept (`TurnRecord.cli.reportedCostUsd`) but shown only for `cli-api-key`.
- Tauri commands (desktop builder; mirror test like M5): `kimo_cli_which {command, extraDirs}`,
  `kimo_cli_exec {path, args, timeoutMs, env?}`, `kimo_cli_home_file_exists {relPath}`,
  `kimo_cli_has_env {name}`, `kimo_cli_prepare_workspace {session, files}`, `kimo_cli_spawn
  {path, args, cwd, env?} → {processId, pid}`, `kimo_cli_write`, `kimo_cli_close_stdin`,
  `kimo_cli_kill {processId, signal}`; events `kimo://cli-output {processId, stream, chunk}`,
  `kimo://cli-exit {processId, code, signal}`. Rust only runs paths it resolved for allowed
  command names (`claude`, `codex`, `gemini`, user-added generic CLIs), only in
  `~/.kimo/cli-workspaces/`, answers file probes only for an allow-list, never returns env values.

### 12. UI contract

`apps/web/src/platform/contract.ts` "M6 built-in agent": `AgentPanelState` /
`AgentPanelController` (thread, steps, meta, cards, composer with queue, sessions, skills,
picker groups incl. CLIs, mode summary, in-app approval, first-run), `AiProvidersState` /
`AiProvidersController` (keys, test, models, base URL, browser opt-in, custom endpoints, CLIs,
usage & limits, matrix), `HomeAgentHandoff`, `HomeAgentCardState`, `PromptRunStates`, and a
compile-time equality of `CliProcessHostLike` with the agent's `CliProcessHost`.

## Consequences

- One loop, one registry, one policy engine for every agent — in-app API agents, local CLIs and
  external MCP hosts — so scope, attribution and undo behave identically.
- Claude-specific features (caching, adaptive thinking, refusal fallback) ship on day one; other
  providers share the loop through small fetch adapters with mocked-fetch tests.
- Keys stay out of JS on desktop at the cost of a relay command pair and an event stream.
- Local CLIs add 9 Tauri commands and depend on third-party flag stability; flags are pinned in
  one file with tests over recorded output, and a CLI that changes format degrades to an error
  card, never to a direct file write.
- Format: three additive fields and one lint; no feature flag (older readers report
  `UNKNOWN_PROPERTY` and preserve them).

## Alternatives considered

- **Vercel AI SDK for every provider**: provider features arrive late and its churn would reach
  the loop; rejected (ADR 0006).
- **Spawning children as separate MCP connections over the socket**: more moving parts and a
  2-minute approval timeout; in-process dispatch is simpler and shares the host's state.
- **Prompt-only scopes (pen.dev)**: not enforceable; rejected for per-op `checkScope`.
- **Keys in JS on desktop (keychain read into memory)**: simpler, but exposes keys to any script
  in the webview; rejected for the relay.
- **Storing sessions in the `.kimo`**: bloats diffs and leaks conversations into repos; rejected.
- **Bundling agent CLIs**: rejected (ADR 0006 §7); Kimo only drives what the user installed.

## Open questions

1. Gemini CLI flags (`--output-format stream-json`, `--resume`, `tools.exclude`) and its auth
   detection follow the docs but were not run locally (not installed here); verify before release.
2. Codex `exec resume` accepting the same flags as `exec`, and whether `--ignore-user-config`
   should isolate it from the user's other MCP servers.
3. Claude Code: whether to pass `--setting-sources` to skip user hooks in the Kimo workspace.
4. OpenAI and Gemini price tables are dated 2025-08; refresh before release (CI cannot verify).
5. Prompt-node run state is app data; should a "last run" summary be shareable through the file
   (e.g. `meta.kimo.prompt`) for teams?
6. Approvals for CLI agents: their MCP calls use the M5 2-minute timeout (they are external MCP
   clients); should the host extend it for CLIs Kimo itself spawned?
7. Iterate passes across a CLI provider need the CLI to stop after one pass; enforced by prompt
   only today.

## Addendum (2026-10-05, board 31 "Agent progress")

**Status mechanism: narration, not a tool.** The panel no longer streams text or live tokens.
While a turn runs it shows one status line (`AgentStatus`): the agent's own progress note, else
the running tool described from its input (`stepLabel(call, names)`: "Adding 12 layers in
Pricing", "Editing 6 layers in Hero", "Copying Home", "Reading the Home page", "Exporting PNG"),
else "Thinking…". The system prompt and `kimo-design` skill ask the model to write one short line
before each tool call; `ProgressTracker` (`src/progress.ts`) treats the text streamed since the
last tool call as the note (only complete lines or sentences, so a reply never shows word by
word) and `replyOf(messages)` takes the text after the last tool call as the reply, shown when
the turn ends. The CLI engine keeps only that final segment as the turn's assistant message.

Why not a `kimo_status` tool or an MCP notification: a tool costs a model round trip and tokens
per step, shows up in every MCP client's tool list, and a notification has no portable way for
the model to emit it across API providers and three CLIs. Narration needs nothing new on the wire:
API streams and CLI stdout already arrive as `text_delta` / `step_start` events, so it works the
same for every provider, and it degrades to tool-derived labels when a model writes no notes.
Thinking text is never used.

Also: steps fold behind an "N steps" toggle (auto-open on a failure, not remembered); MessageMeta
shows on hover only; a `BATCH_TOO_LARGE` step (ADR 0013 addendum 3) is dropped from the steps
list; each landed edit flashes its top-most changed layers on the canvas
(`AgentCanvasProps.landed`, the placeholder-flash ring in the persona hue) and the status line's
Follow chip zooms to them; canvas agent labels show the agent's name only.


## Addendum 2 (2026-10-05, board 31 token pass)

Measured with the real Claude Code CLI (`claude -p`, Sonnet, signed in) on the landing example,
landing frame selected, "create a variant to add a pricing table", through the panel controller
and headless `kimo mcp` (the harness has no `docId` in context, so both runs open the file):

| | before (3 runs) | after (2 final runs) |
|---|---|---|
| model calls | 7–8 | 4–5 |
| new input (input + cache write) | 32–34k | 11–13k |
| cached input re-read | 217–270k | 54–74k |
| output | 3.8–4.5k | 2.7–2.8k |
| failed calls | 0 | 0 |
| first layer / total | 10–11 s / 31–37 s | 17 s / 24 s |

The first call alone went from ~27.8k to ~14k tokens (system prompt + tools).

- **CLI prompts replace, never append** (`src/cli/adapters.ts`). Claude Code: `--system-prompt`
  (flag checked on 2.1.289), `--disable-slash-commands`, env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`
  and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (the user's CLAUDE.md and memory are coding notes; user
  settings, auth and env still load; `--bare` would drop OAuth, `--safe-mode` drops our MCP
  server). Codex 0.146: `-c model_instructions_file=<workspace>/.kimo/instructions.md` replaces
  its base instructions (measured 14.7k → 10.3k input on a one-line turn; `base_instructions` is
  ignored, `developer_instructions` only adds a message), on resumed turns too. Gemini CLI:
  `GEMINI_SYSTEM_MD=<workspace>/.gemini/system.md` (from its docs; not installed here,
  unverified). Built-in tools stay disabled / sandboxed as before.
- **Volatile context in the user message.** `buildSystemPrompt` still splits stable/volatile; a
  CLI turn sends the stable part as the system prompt and the volatile part (scope, selection,
  document, outline) wrapped in `<kimo-context>` at the top of the user message
  (`promptWithContext`), because Claude Code records the system prompt once per session
  (`--system-prompt-snapshot on`) and a resumed turn would otherwise see the first turn's
  selection. API turns keep it after the cache breakpoint.
- **Turn context: document + page outline** (`src/outline.ts`, `AgentPanelOptions.outline` /
  `cliDocId`). The context names the open document (`docId`: the window's for API turns, the
  document host's for CLI turns, none when the window is not hosted) and carries
  `buildPageOutline`: one line per node (id, type, name, canvas box, layout / fill / radius /
  text style with format field names, text snippet), the selection first and as deep as fits,
  other top-level nodes one level deep, `+N` for elided children, at most 12k characters (~3k
  tokens) with a note naming `kimo_query` when shortened. The landing page is ~7k characters.
  The base prompt and the `kimo-design` skill tell the model to use them instead of
  `kimo_get_state` / exploratory queries and to start a variant with one copy plus the new
  section's skeleton inside it (`@copyKey`, `@copyKey/<id>`). Render behaviour is unchanged.
- **Hover tokens are new tokens** (`turnMeta`, `format.ts`): `tokensIn` = input + cache writes,
  `tokensOut` = output, label "21.1k new tokens" with the split (and the cached input left out)
  as the tooltip; the thread header, mode rows and the usage ledger count the same way. The
  per-turn cost warning estimate is unchanged.

## Addendum 3 (2026-10-05, board 34 "Auto-approve")

- **Per-session switch** (`AgentPanelControllerExt.setAutoApprove`, view state `autoApprove`).
  Off for every new session, a reopened session and a Home hand-off; held in the controller only
  and never written to the session file. The composer's shield (after the mode chip) asks once
  with the confirm (board 34 k0K1nN) before turning it on; the chip **Auto-approve is on** above
  the composer turns it off.
- **Flow**: the controller's `requestApproval` resolves `auto` at once while it is on (in-window
  tools, and CLI turns through the document host: `agentApproval` and the window's forwarder
  accept `auto`). Turning it on resolves every pending card as `auto`, oldest first. The M5
  dispatch logs the approval with `outcome: "auto"` (desktop Activity tab).
- **Thread line**: `autoApprovalLine(request)` ("Approved automatically: saved landing.kimo",
  past tense of the card's op rows) appended to the running agent message
  (`AgentMessageView.autoApproved`), saved with the turn (`TurnRecord.autoApproved`, optional)
  and restored by `messagesFromTurns`.
- **Still enforced**: scopes are not approvals for spawned agents (`childPolicy` denies), the
  40-new-layer batch limit and the document host's path and read-only checks stay as they are.
