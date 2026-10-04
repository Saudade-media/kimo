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

- Sessions live in app data — desktop `~/.kimo/sessions/<fileId>/<sessionId>.json`, web IndexedDB
  `kimo-sessions` — **never in the `.kimo`**. Per file, newest first, then other files; search
  over title and message text. `fileId` is the M4/M5 id (`sha256(path)[:16]`).
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
    --allowedTools mcp__kimo --permission-mode dontAsk --append-system-prompt <kimo>
    [--model m] [--effort low|max] [--resume <session>]`; the prompt (and images) is one
    stream-json user line on stdin.
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
