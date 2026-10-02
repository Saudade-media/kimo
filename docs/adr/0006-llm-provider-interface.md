# 0006. A Kimo-owned LLM `Provider` interface, Claude by default

- **Status:** Accepted
- **Date:** 2026-10-02
- **Teardown refs:** 8.1 principles 3 and 6, 9.2 (LLM layer, default models, key storage and provider reach), 7.2 (delimited model ids, vendored CLIs), 12 (M6), 13.3 (provider API churn, tool schema incompatibilities)

## Context

The built-in agent (M6) must be provider-agnostic (principle 6) while still using first-class
Claude features such as prompt caching and extended thinking. pen.dev bundles four agent runtimes
(~1 GB app) and parses delimited model-id strings, which silently fell back to another provider
(`[gh pen#3]`, 7.2). Multi-provider SDKs churn across major versions (13.3), and providers differ
in what works from a browser without a backend (9.2).

## Decision

1. `packages/ai-agent` defines a **Kimo-owned `Provider` interface**: messages, tool definitions,
   streaming, structured output and usage/cost reporting. The agent loop, skills, permissions and
   parallel agents depend only on this interface.
2. **Default adapter: Anthropic**, implemented directly on `@anthropic-ai/sdk` so prompt caching and
   extended thinking are available without lowest-common-denominator limits. Claude is the default
   provider.
3. **Secondary adapters:** OpenAI-compatible (Chat Completions and Responses), Gemini, and custom
   OpenAI- or Anthropic-compatible endpoints. They may wrap a multi-provider SDK (e.g. Vercel AI SDK,
   pinned) behind the interface, so its version churn is contained in one adapter.
4. **Typed model selection.** A model is `{ provider, model }`, never a delimited string. An
   unknown provider or model **fails loudly**; there is no silent fallback.
5. **Model ids are verified at build time.** Default ids (teardown 9.2 names `claude-opus-5-5` for
   the agent and a faster Claude model as the "fast" option) live in one config module, and a CI
   step checks them against the Anthropic Models API. Unverified ids (e.g. `claude-sonnet-5-5`)
   must not ship as defaults.
6. **Keys and reach.** Bring your own key, unlimited, no account. Desktop stores keys in the OS
   keychain; web stores them locally only, never synced. A published per-provider matrix states
   what works from a browser; Bedrock/Vertex/Foundry are routed only through desktop (Rust-side
   HTTP) or a user-run proxy.
7. **No vendored agent CLIs.** Optional adapters may detect and drive the user's own installed CLIs.

## Consequences

- Claude-specific features ship on day one; other providers get the same loop through adapters.
- One more abstraction to maintain, and adapters need conformance tests (streaming, tool calls,
  structured output, usage) run against each provider (M6 exit: one prompt → screen across ≥ 3
  providers).
- Tool JSON Schemas must pass strict validators for Anthropic, OpenAI and Gemini in CI (13.3,
  avoids `[gh pencil#9]`); this is shared with the MCP tool registry.
- The build-time model check needs network and an API key in CI; it runs in a scheduled or release
  job, not in every local `bun run check`.

## Alternatives considered

- **Vercel AI SDK only:** broad coverage, but provider-specific features arrive late (INFERRED) and
  major-version churn would reach the whole agent.
- **Vendoring agent CLIs (pen.dev):** huge bundles, metering, and behaviour we cannot control.
- **Anthropic-only:** simplest, but violates principle 6.

## Revisit when

M6 starts, or a provider SDK change breaks the interface's assumptions.
