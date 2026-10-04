# Settings › AI providers + Home composer (M6, ADR 0014) — integration

Design: `desing.pen` board 23 `g6AqH` (supersedes board 22 `S1cdx`), web variant board 22
`BWkRR`, rules `N6nkaj` / `P71mt`; Home composer board 22 `w9bz9` (`fYVvl`, `XsZVb`), board 24
`o8YoQ`.

## Mount points (done)

- **Settings pane** `"ai-providers"` (new `SettingsPane` id in `@kimo/platform` types, sidebar
  item right after Agents & MCP, `key-round` in `$agent`): `SettingsView` renders
  `<AiProvidersPane platform={platform} />`. Desktop: Rust `SETTINGS_PANES`
  (`apps/desktop/src-tauri/src/window.rs`) must list `"agents-mcp"` and `"ai-providers"` so
  `openSettings("ai-providers")` lands on it (owned by the desktop builder).
- **Home** (`home/Home.tsx`, web and desktop): `<HomeComposer platform={platform} />` replaces the
  M4 "agent arrives in M6" composer.

## The controller (one per window)

```ts
import { getAiProviders, useAiProviders, useAiSettingsState } from "../ai-settings"
const ai = getAiProviders(platform)          // AiSettingsController ⊇ contract AiProvidersController
ai.state.defaultSelection                    // {provider, model} | null (precedence below)
ai.state.noProvider                          // first-run card / Agent tab first run
await ai.providerConfigs()                   // @kimo/ai-agent ProviderConfig[] (web: with apiKey)
ai.clis()                                    // CliDetection[] (desktop)
ai.recordUsage({at, provider, label, tokens, costUsd, billing, sessionId}) // after each turn
ai.labelOf("cli:codex")                      // "Codex"
ai.fetchFor("vertex")                        // the row's fetch (desktop relay + relayAuthFor; web: page fetch)
```

- Desktop: keys in the keychain (`createTauriSecrets`, service `kimo`, account
  `provider.<id>`); `test()` and `nameFile()` go through `createRelayFetch` with
  `relayAuthFor(provider)` (x-api-key / Bearer / x-goog-api-key / none / cloud). Keys never
  enter JS; Reveal is disabled. CLI detection uses `createTauriCliHost` (allowed in the Settings
  window; it never spawns there).
- Web: `createWebSecrets(localStorage)` (`kimo.providers`); Anthropic needs the browser opt-in
  (`setAllowBrowser`, re-tests a saved key); CLIs never count.
- Non-secret config (rows, models, custom endpoints, usage settings, usage ledger, last tests,
  Home card dismissal) lives in `localStorage` `kimo.ai` (`model.ts` `AiConfig`), shared by every
  window of the origin; other windows refresh on the `storage` event. The frozen
  `SettingsSchema` was not extended.
- Precedence (shown verbatim in the pane): signed-in Claude Code › other signed-in CLI › API
  default (Anthropic first) › none. Settings "Default" (`setDefault`) overrides when usable. A key
  whose last Test failed with `auth`, or that is being tested, is not usable.
- Relay rules (desktop builder): built-in providers never call another origin — their Base URL is
  read-only (`setBaseURL` throws for non-`custom` kinds); proxies / self-hosted endpoints are
  `custom:*` providers ("Add provider"), whose key is pinned to the first origin it reaches.
  Generic CLIs are written to `~/.kimo/ai/clis.json` (`persistGenericClis`) — Rust resolves only
  those. Bedrock / Vertex Test is one tiny `POST /v1/messages` (no models list there).

## Home → editor hand-off (for the Agent tab)

`home/handoff.ts`: `takeHomeHandoff(path)` / `peekHomeHandoff(path)` (sessionStorage
`kimo.home.handoff`, 5 min TTL). Record = contract `HomeAgentHandoff` + `{fileName, model,
frameId, owner, createdAt}`; `path` = desktop FileRef or web library file id. The file already
holds root frame `HomeFrame1` with `placeholder: {by: owner, since}`; `owner` =
`agent:kimo.<sessionId>.0` (API) or `mcp:<cli>.<sessionId>` (CLI). The Agent tab should take it on
mount for that file, activate itself, create the session (`id: sessionId`, origin `home`, mode
Single, scope page, `model`) and send `prompt` as the first user message with `fromHome: true`.

File naming: the fast model of a usable API provider (`nameFile`, 1.5 s budget, `TITLE_SCHEMA`),
else "Untitled"; never overwriting (" 2", " 3"…). Desktop writes `<files.newFilesDir ??
~/Documents/Kimo>/<title>.kimo`; web creates a library file (`lib/files` `createFile(name,
{document})`). "Design by hand instead": desktop `manager.newUntitled()`, web an empty library
file; the card stays dismissed until a provider is added.

## Not designed (marked in code)

- Web pane: the Local agents group is hidden (CLIs are desktop only); intro/desc copy adapted.
- "Add provider" form (custom endpoint: name, base URL, wire, models, local/no key) and the
  cloud row's Set up fields (platform, region, project).
- Failed Test result uses the Test Result frame in `danger-soft` / `danger`, CORS adds the matrix
  "how" hint.
- No "Make default" control: the Default badge follows the precedence (the controller has
  `setDefault` for the Agent tab picker).
- Home: chip presets prefill "A landing page for …" etc.; the composer's model chip opens
  Settings › AI providers (no picker on Home).

## Tests

- Unit: `apps/web/test/m6-ai-settings.test.ts` (copy, precedence, controller over memory secrets
  + fake CLI host + mocked fetch, persistence, Home submit/never-overwrite, hand-off).
- E2E: `apps/web/e2e/m6-ai.e2e.ts` on `e2e/m6-ai-harness` (desktop + web pane, Home submit, first
  run, wrong key / design by hand), one measured pass per surface.
- Test doubles: `ai-settings/testing.ts` (`createFakeCliHost`, `createMockFetch`,
  `createTestAiSettings`).
