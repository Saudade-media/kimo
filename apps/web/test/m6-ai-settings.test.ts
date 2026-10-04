/**
 * M6 Settings › AI providers and the Home composer (boards 22 hxt9h / w9bz9, 23 g6AqH, 24
 * o8YoQ): model copy, the controller over memory secrets + a fake CLI host + a mocked fetch,
 * the default precedence, usage to date, Home file creation (never overwriting, placeholder
 * first frame) and the hand-off.
 */
import { describe, expect, test } from "bun:test"
import type { CliDetection } from "@kimo/ai-agent"
import { parse } from "@kimo/core-schema"
import { importDocument } from "@kimo/editor-state"
import { createMemorySecrets } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { createPlatformAgentRuntime } from "../src/agent-panel/runtime"
import { AiProvidersPane } from "../src/ai-settings/AiProvidersPane"
import { createAiSettingsController } from "../src/ai-settings/controller"
import {
  AI_CONFIG_KEY,
  cliMeta,
  cliStatusText,
  defaultSelection,
  maskKey,
  monthBounds,
  monthUsage,
  parseAmount,
  parseConfig,
  providerMeta,
  providerRows,
  type StoredProvider,
  sanitizeTitle,
  shortModelLabel,
  tildify,
} from "../src/ai-settings/model"
import { relayAuthFor } from "../src/ai-settings/runtime"
import {
  BOARD_23_CLIS,
  createMockFetch,
  createTestAiSettings,
  memoryStorage,
} from "../src/ai-settings/testing"
import { peekHomeHandoff, stashHomeHandoff, takeHomeHandoff } from "../src/home/handoff"
import {
  createDiskFile,
  FIRST_FRAME_ID,
  homeDocument,
  ownerOrigin,
  submitHomePrompt,
  uniqueName,
} from "../src/home/submit"

const KEY = "sk-ant-api03-test-3f9a"
const cli = (over: Partial<CliDetection>): CliDetection => ({
  id: "claude-code",
  label: "Claude Code",
  installed: true,
  signedIn: true,
  billing: "subscription",
  ...over,
})

describe("model copy (board 23)", () => {
  test("CLI rows: meta, status, not found", () => {
    const claude = cli({ version: "2.1.4", path: "/Users/me/.local/bin/claude", plan: "max" })
    expect(cliMeta(claude, "claude", "/Users/me")).toBe(
      "claude 2.1.4 · ~/.local/bin/claude · Claude Max plan",
    )
    expect(cliStatusText(claude)).toBe("Signed in · max")
    const codex = cli({ id: "codex", label: "Codex", signedIn: false, billing: null })
    expect(cliStatusText(codex)).toBe("Not signed in — run `codex login`")
    expect(cliMeta(cli({ installed: false }), "gemini", null)).toBe(
      "Not on PATH · install it, then Re-check",
    )
    expect(tildify("/home/me/bin/x", null)).toBe("~/bin/x")
  })
  test("provider meta lines and masked key", () => {
    const [anthropic, openai, gemini, openrouter, ollama, cloud] = providerRows(parseConfig(null))
    if (!anthropic || !openai || !gemini || !openrouter || !ollama || !cloud) throw new Error()
    expect(providerMeta(anthropic, { isApiDefault: true })).toBe(
      "API default · claude-opus-5-5 · used when no CLI is signed in",
    )
    expect(providerMeta(openai, { isApiDefault: false })).toBe(
      "api.openai.com/v1 · Chat Completions + Responses",
    )
    expect(providerMeta(gemini, { isApiDefault: false })).toBe("generativelanguage.googleapis.com")
    expect(providerMeta(openrouter, { isApiDefault: false })).toBe(
      "openrouter.ai/api/v1 · OpenAI-compatible",
    )
    expect(providerMeta(ollama, { isApiDefault: false })).toBe(
      "http://localhost:11434/v1 · OpenAI-compatible",
    )
    expect(providerMeta(cloud, { isApiDefault: false })).toBe(
      "Signed credentials · routed through Rust-side HTTP",
    )
    expect(maskKey("anthropic", "3f9a", "desktop")).toBe("sk-ant-api03-••••••••••••••••••3f9a")
    expect(maskKey("anthropic", "3f9a", "web")).toBe("sk-ant-api03-••••••••••3f9a")
  })
  test("relay auth per provider (desktop)", () => {
    const rows = providerRows(parseConfig(null))
    expect(relayAuthFor(rows[0] as never)).toEqual({ kind: "header", header: "x-api-key" })
    expect(relayAuthFor(rows[1] as never)).toEqual({
      kind: "header",
      header: "authorization",
      scheme: "Bearer",
    })
    expect(relayAuthFor(rows[2] as never)).toEqual({ kind: "header", header: "x-goog-api-key" })
    expect(relayAuthFor(rows[4] as never)).toEqual({ kind: "none" })
    expect(relayAuthFor({ ...(rows[5] as StoredProvider), region: "us-east-1" })).toEqual({
      kind: "cloud",
      platform: "bedrock",
      region: "us-east-1",
    })
  })
  test("relay auth carries the cloud credential choice (Bedrock profile / source, Vertex, Foundry)", () => {
    const rows = providerRows(parseConfig(null))
    const bedrock = rows[5] as StoredProvider
    expect(
      relayAuthFor({ ...bedrock, region: "eu-west-1", credentials: "sso", profile: " design " }),
    ).toEqual({
      kind: "cloud",
      platform: "bedrock",
      region: "eu-west-1",
      credentials: "sso",
      profile: "design",
    })
    expect(relayAuthFor({ ...bedrock, credentials: "env", profile: "  " })).toEqual({
      kind: "cloud",
      platform: "bedrock",
      credentials: "env",
    })
    expect(
      relayAuthFor({
        ...bedrock,
        kind: "vertex",
        project: "acme",
        credentials: "service-account",
        profile: "ignored",
      }),
    ).toEqual({
      kind: "cloud",
      platform: "vertex",
      project: "acme",
      credentials: "service-account",
    })
    expect(
      relayAuthFor({ ...bedrock, kind: "foundry", resource: "res", credentials: "entra" }),
    ).toEqual({ kind: "cloud", platform: "foundry", project: "res", credentials: "entra" })
  })
  test("precedence: signed-in Claude Code › other CLI › API default › none; web ignores CLIs", () => {
    const apis = [
      { id: "openai", agentModel: "gpt-4.1" },
      { id: "anthropic", agentModel: "claude-opus-5-5" },
    ]
    expect(
      defaultSelection({ platform: "desktop", clis: [cli({})], apis, preferred: null }),
    ).toEqual({
      provider: "cli:claude-code",
      model: "default",
    })
    expect(
      defaultSelection({
        platform: "desktop",
        clis: [cli({ signedIn: false })],
        apis,
        preferred: null,
      }),
    ).toEqual({ provider: "anthropic", model: "claude-opus-5-5" })
    expect(
      defaultSelection({ platform: "web", clis: [cli({})], apis: [], preferred: null }),
    ).toBeNull()
    expect(
      defaultSelection({
        platform: "desktop",
        clis: [cli({})],
        apis,
        preferred: { provider: "openai", model: "gpt-4.1" },
      }),
    ).toEqual({ provider: "openai", model: "gpt-4.1" })
    expect(shortModelLabel({ provider: "anthropic", model: "claude-opus-5-5" }, [])).toBe(
      "Opus 5.5",
    )
    expect(shortModelLabel({ provider: "cli:claude-code", model: "default" }, [cli({})])).toBe(
      "Claude Code",
    )
  })
  test("usage: this month, per provider, subscription shows no dollars", () => {
    const now = new Date(2026, 9, 14).getTime()
    expect(monthBounds(now).label).toBe("Oct 1 – Oct 31")
    const at = now - 1000
    const u = monthUsage(
      [
        {
          at,
          provider: "anthropic",
          label: "Anthropic",
          tokens: 2_000_000,
          costUsd: 16.9,
          billing: "api",
          sessionId: "a",
        },
        {
          at,
          provider: "openai",
          label: "OpenAI-compatible",
          tokens: 300_000,
          costUsd: 1.52,
          billing: "api",
          sessionId: "b",
        },
        {
          at,
          provider: "cli:claude-code",
          label: "Claude Code",
          tokens: 10_000,
          costUsd: null,
          billing: "subscription",
          sessionId: "c",
        },
        {
          at: new Date(2026, 8, 30).getTime(),
          provider: "anthropic",
          label: "Anthropic",
          tokens: 5,
          costUsd: 99,
          billing: "api",
          sessionId: "old",
        },
      ],
      now,
    )
    expect(u.costUsd).toBeCloseTo(18.42, 5)
    expect(u.sessions).toBe(3)
    expect(u.byProvider.map((p) => p.label)).toEqual([
      "Anthropic",
      "OpenAI-compatible",
      "Claude Code",
    ])
    expect(u.byProvider[2]?.costUsd).toBeNull()
    expect(parseAmount("$50")).toBe(50)
    expect(parseAmount("abc")).toBeNull()
  })
  test("sanitizeTitle", () => {
    expect(sanitizeTitle('"Pricing page."')).toBe("Pricing page")
    expect(sanitizeTitle("a/b:c.kimo")).toBe("a b c")
    expect(sanitizeTitle("  ")).toBeNull()
  })
})

describe("AiSettingsController", () => {
  test("detects CLIs on refresh; Claude Code signed in is the default", async () => {
    const c = createTestAiSettings()
    expect(c.state.detected).toBe(false)
    await c.refresh()
    expect(c.state.detected).toBe(true)
    const ids = c.state.clis.map((x) => [
      x.detection.id,
      x.detection.installed,
      x.detection.signedIn,
    ])
    expect(ids).toEqual([
      ["claude-code", true, true],
      ["codex", true, false],
      ["gemini-cli", false, null],
    ])
    expect(c.state.defaultSelection).toEqual({ provider: "cli:claude-code", model: "default" })
    expect(c.state.agentStatus.label).toBe("Agent ready · Claude Code (subscription)")
    expect(c.state.clis[0]?.isDefault).toBe(true)
    expect(c.state.noProvider).toBe(false)
  })

  test("no CLI, no key → first run; paste key → Test OK → Connected and API default", async () => {
    const f = createMockFetch()
    const c = createTestAiSettings({ clis: {}, fetch: f })
    await c.refresh()
    expect(c.state.noProvider).toBe(true)
    expect(c.state.providers.find((p) => p.id === "anthropic")?.status).toBe("not-set")
    const t = await c.setKey("anthropic", KEY)
    expect(t.ok).toBe(true)
    const row = c.state.providers.find((p) => p.id === "anthropic")
    expect(row?.status).toBe("connected")
    expect(row?.keyHint).toBe("3f9a")
    expect(row?.isDefault).toBe(true)
    expect(c.state.noProvider).toBe(false)
    expect(c.state.defaultSelection).toEqual({ provider: "anthropic", model: "claude-opus-5-5" })
    expect(f.calls.some((x) => x.url.includes("/v1/models"))).toBe(true)
    expect(f.calls.every((x) => x.key === KEY)).toBe(true)
  })

  test("401 → Key saved + failed test with auth kind", async () => {
    const c = createTestAiSettings({ clis: {} })
    const t = await c.setKey("anthropic", "sk-ant-wrong")
    expect(t.ok).toBe(false)
    expect(t.error?.kind).toBe("auth")
    const row = c.state.providers.find((p) => p.id === "anthropic")
    expect(row?.status).toBe("key-saved")
    expect(row?.lastTest?.ok).toBe(false)
    await c.deleteKey("anthropic")
    expect(c.state.providers.find((p) => p.id === "anthropic")?.status).toBe("not-set")
  })

  test("web: CLIs never count; Anthropic needs the browser opt-in", async () => {
    const c = createTestAiSettings({ platform: "web", keys: { "provider.anthropic": KEY } })
    await c.refresh()
    expect(c.state.clis).toEqual([])
    expect(c.state.noProvider).toBe(true)
    await c.setAllowBrowser("anthropic", true)
    expect(c.state.defaultSelection?.provider).toBe("anthropic")
    const cfgs = await c.providerConfigs()
    expect(cfgs.find((x) => x.id === "anthropic")?.apiKey).toBe(KEY)
    expect(await c.revealKey("anthropic")).toBe(KEY)
  })

  test("desktop never hands keys to JS; reveal is unavailable", async () => {
    const c = createTestAiSettings({ clis: {}, keys: { "provider.anthropic": KEY } })
    await c.refresh()
    expect(await c.revealKey("anthropic")).toBeNull()
    expect((await c.providerConfigs()).find((x) => x.id === "anthropic")?.apiKey).toBeUndefined()
  })

  test("fetchFor(provider): the row's relay auth incl. Bedrock region / Vertex project; the agent runtime uses it", async () => {
    const seen: { id: string; region?: string; project?: string }[] = []
    const relayed = (async () => new Response("{}")) as unknown as typeof fetch
    const c = createAiSettingsController({
      platform: "desktop",
      os: "macos",
      secrets: createMemorySecrets({}),
      cliHost: null,
      storage: memoryStorage(),
      fetchFor: (p) => {
        seen.push({
          id: p.id,
          ...(p.region ? { region: p.region } : {}),
          ...(p.project ? { project: p.project } : {}),
        })
        return relayed
      },
    })
    await c.setCloud("bedrock", { region: "eu-west-1" })
    expect(c.fetchFor("bedrock")).toBe(relayed)
    expect(relayAuthFor({ ...(seen.at(-1) as StoredProvider), kind: "bedrock" })).toEqual({
      kind: "cloud",
      platform: "bedrock",
      region: "eu-west-1",
    })
    await c.setCloud("vertex", { region: "us-east5", project: "acme" })
    c.fetchFor("vertex")
    expect(seen.at(-1)).toEqual({ id: "vertex", region: "us-east5", project: "acme" })
    // Unknown ids: the global fetch.
    expect(c.fetchFor("nope")).not.toBe(relayed)
    const rt = createPlatformAgentRuntime(createMemoryPlatform(), c, (() => {
      throw new Error("unused")
    }) as never)
    expect(rt.fetchFor?.({ id: "vertex", kind: "vertex" } as never)).toBe(relayed)
  })

  test("Ollama: keyless test marks it Local; built-in base URLs are fixed", async () => {
    const c = createTestAiSettings({ clis: {} })
    await c.refresh()
    expect(c.state.providers.find((p) => p.id === "custom:ollama")?.status).toBe("not-set")
    const t = await c.test("custom:ollama")
    expect(t.ok).toBe(true)
    expect(c.state.providers.find((p) => p.id === "custom:ollama")?.status).toBe("local")
    await expect(c.setBaseURL("anthropic", "https://proxy.example")).rejects.toThrow(/custom/)
  })

  test("custom endpoints, settings and usage persist in kimo.ai (never keys)", async () => {
    const storage = memoryStorage()
    const c = createTestAiSettings({ clis: {}, storage })
    const id = await c.addCustom({
      label: "LM Studio",
      baseURL: "http://localhost:1234/v1",
      wire: "openai-chat",
      models: { agent: "qwen", fast: "qwen" },
      free: true,
    })
    expect(id).toBe("custom:lm-studio")
    await c.setUsageSettings({ monthlyLimitUsd: 50 })
    await c.setKey("anthropic", KEY)
    c.recordUsage({
      at: Date.now(),
      provider: "anthropic",
      label: "Anthropic",
      tokens: 100,
      costUsd: 0.5,
      billing: "api",
      sessionId: "s1",
    })
    const raw = storage.getItem(AI_CONFIG_KEY) ?? ""
    expect(raw).not.toContain(KEY)
    const again = createTestAiSettings({ clis: {}, storage })
    await again.refresh()
    expect(again.state.providers.some((p) => p.id === "custom:lm-studio")).toBe(true)
    expect(again.state.settings.monthlyLimitUsd).toBe(50)
    expect(again.state.usage.costUsd).toBe(0.5)
    await again.removeProvider("custom:lm-studio")
    expect(again.state.providers.some((p) => p.id === "custom:lm-studio")).toBe(false)
  })

  test("nameFile uses the fast model's JSON title; null without a usable API", async () => {
    const none = createTestAiSettings({ clis: BOARD_23_CLIS })
    await none.refresh()
    expect(await none.nameFile("A pricing page")).toBeNull()
    const c = createTestAiSettings({
      clis: {},
      fetch: createMockFetch({ reply: '{"title":"Pricing page"}' }),
    })
    await c.setKey("anthropic", KEY)
    expect(await c.nameFile("A pricing page for a calm budgeting app")).toBe("Pricing page")
  })

  test("pane renders board 23 copy", async () => {
    const c = createTestAiSettings()
    await c.refresh()
    const html = renderToString(h(AiProvidersPane, { platform: null, controller: c }))
    for (const s of [
      "AI providers",
      "Agent ready · Claude Code (subscription)",
      "Local agents",
      "uses your subscription",
      "Re-check all",
      "1 · Default CLI, if signed in",
      "Claude Code CLI",
      "Signed in",
      "Default",
      "claude 2.1.4 · ~/.local/bin/claude · Claude Max plan",
      "Not signed in",
      "Sign in in terminal: run “codex login”",
      "Copy command",
      "Not found",
      "Install guide",
      "API providers",
      "Add provider",
      "Usage &amp; limits",
      "Monthly limit",
      "Warn per turn above",
      "Show cost in the agent panel",
    ])
      expect(html).toContain(s)
  })
})

describe("Home submit", () => {
  test("uniqueName never reuses an existing name", async () => {
    const taken = new Set(["Pricing page", "Pricing page 2"])
    expect(await uniqueName("Pricing page", async (n) => taken.has(n))).toBe("Pricing page 3")
  })

  test("homeDocument: one root frame with placeholder {by: owner}; valid", () => {
    const owner = ownerOrigin({ provider: "anthropic", model: "claude-opus-5-5" }, "k3x9qa")
    expect(owner).toBe("agent:kimo.k3x9qa.0")
    expect(ownerOrigin({ provider: "cli:claude-code", model: "default" }, "k3x9qa")).toBe(
      "mcp:claude-code.k3x9qa",
    )
    const d = homeDocument({ title: "Pricing page", preset: "Mobile app", owner, now: new Date(0) })
    const f = (d.nodes as Record<string, Record<string, unknown>>)[FIRST_FRAME_ID]
    expect(f).toMatchObject({ type: "frame", name: "Pricing page", w: 390, h: 844 })
    expect(f?.placeholder).toEqual({ by: owner, since: "1970-01-01T00:00:00.000Z" })
  })

  test("desktop: creates <title>.kimo in New files go to, never overwriting; hand-off stashed", async () => {
    const p = createMemoryPlatform({ settings: { "files.newFilesDir": "/Users/me/Kimo" } })
    await p.settings.ready
    await p.files.writeTextAtomic("/Users/me/Kimo/Pricing page.kimo", "{}", { mkdirs: true })
    const stashed: unknown[] = []
    const steps: string[] = []
    const h1 = await submitHomePrompt(
      "A pricing page for a calm budgeting app, three tiers, soft greens",
      undefined,
      {
        platform: p,
        model: { provider: "anthropic", model: "claude-opus-5-5" },
        nameFile: async () => "Pricing page",
        stash: (x) => stashed.push(x),
      },
      (s) => steps.push(s.step),
    )
    expect(h1.path).toBe("/Users/me/Kimo/Pricing page 2.kimo")
    expect(h1.fileName).toBe("Pricing page 2.kimo")
    expect(steps).toEqual(["created", "opening"])
    expect(stashed).toHaveLength(1)
    expect((await p.files.readText("/Users/me/Kimo/Pricing page.kimo")).text).toBe("{}")
    // Valid: importDocument throws on schema errors.
    const store = importDocument(parse((await p.files.readText(h1.path)).text))
    expect(store.getNode(FIRST_FRAME_ID)?.type).toBe("frame")
    const r = await createDiskFile(p, "Pricing page", (n) =>
      homeDocument({ title: n, owner: null }),
    )
    expect(r.name).toBe("Pricing page 3")
  })

  test("fallback title Untitled", async () => {
    const p = createMemoryPlatform({ settings: { "files.newFilesDir": "/tmp/k" } })
    await p.settings.ready
    const r = await submitHomePrompt("x", undefined, {
      platform: p,
      model: { provider: "cli:claude-code", model: "default" },
      nameFile: async () => null,
      stash: () => {},
    })
    expect(r.fileName).toBe("Untitled.kimo")
    expect(r.owner).toBe(`mcp:claude-code.${r.sessionId}`)
  })

  test("hand-off: take once, expires", () => {
    const rec = {
      prompt: "p",
      path: "/a.kimo",
      sessionId: "s",
      fileName: "a.kimo",
      model: { provider: "anthropic", model: "claude-opus-5-5" },
      frameId: FIRST_FRAME_ID,
      owner: "agent:kimo.s.0",
      createdAt: 1000,
    }
    stashHomeHandoff(rec)
    expect(peekHomeHandoff("/a.kimo", 2000)?.prompt).toBe("p")
    expect(takeHomeHandoff("/a.kimo", 2000)?.prompt).toBe("p")
    expect(takeHomeHandoff("/a.kimo", 2000)).toBeNull()
    stashHomeHandoff(rec)
    expect(takeHomeHandoff("/a.kimo", 1000 + 10 * 60_000)).toBeNull()
  })
})
