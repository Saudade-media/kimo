/**
 * Board 25 "v1 Polish" §4 AI providers (bM295) and §5 Agent tab (p55vU): the Add provider
 * dialog's controller paths (custom endpoint + auth scheme + origin pin, Fetch /models, draft
 * Test), the failed-test strip variants and their Details trace, the cloud set-up cards' fields,
 * and the Agent tab's first run (CLI found / key card), approval op rows and refusal edit.
 */
import { describe, expect, test } from "bun:test"
import type { CliDetection } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import type { McpApprovalRequest } from "@kimo/platform"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { createAgentPanelController, createInWindowTools } from "../src/agent-panel"
import { AgentPanel } from "../src/agent-panel/AgentPanel"
import { approvalOps } from "../src/agent-panel/approval"
import { tildePath } from "../src/agent-panel/FirstRun"
import { createTestRuntime, MOCK_ANTHROPIC, type Script } from "../src/agent-panel/testing"
import { AddProviderDialog, addProviderValid, savedTo } from "../src/ai-settings/AddProviderDialog"
import {
  authPreview,
  keyWithheld,
  maskForTrace,
  providerPill,
  type StoredProvider,
  testStrip,
} from "../src/ai-settings/model"
import { relayAuthFor } from "../src/ai-settings/runtime"
import { TestResult, traceLines } from "../src/ai-settings/TestResult"
import {
  ACME_KEY,
  ACME_MODELS,
  createMockFetch,
  createTestAiSettings,
} from "../src/ai-settings/testing"

const ACME = "https://llm.acme.internal/v1"

describe("board 25 §4 — failed test strip (c7lVl)", () => {
  test("variants: icon, label, detail, tone", () => {
    const base = { ok: false, latencyMs: 212, detail: "x" }
    expect(testStrip({ ...base, errorKind: "auth", status: 401 })).toEqual({
      tone: "danger",
      icon: "circle-x",
      label: "Connection failed",
      detail: "401 · invalid api key",
    })
    expect(
      testStrip({ ...base, errorKind: "network", detail: "ENOTFOUND llm.acme.internal" }),
    ).toEqual({
      tone: "danger",
      icon: "wifi-off",
      label: "Can't reach endpoint",
      detail: "ENOTFOUND llm.acme.internal",
    })
    expect(testStrip({ ...base, errorKind: "cors" })).toMatchObject({
      icon: "shield-x",
      label: "Blocked by the browser",
      detail: "CORS · use desktop or a proxy",
    })
    expect(
      testStrip({ ...base, errorKind: "model_missing", detail: "qwen2.5-coder not in /models" }),
    ).toEqual({
      tone: "warning",
      icon: "triangle-alert",
      label: "Reachable · model missing",
      detail: "qwen2.5-coder not in /models",
    })
    expect(testStrip({ ...base, errorKind: "timeout" })).toMatchObject({
      icon: "clock-alert",
      label: "Timed out",
      detail: "no response in 15 s",
    })
    expect(testStrip({ ok: true, latencyMs: 212, detail: "m reachable" }).label).toBe(
      "Connection OK",
    )
  })

  test("Details expander: collapsed strip + 'Details'; success has none", () => {
    const fail = {
      ok: false,
      latencyMs: 212,
      detail: "invalid",
      errorKind: "auth",
      status: 401,
      at: 0,
      trace: {
        request: `POST ${ACME}/chat/completions`,
        response: "← 401 Unauthorized · 212 ms",
        body: '{"error":{"code":"invalid_api_key"}}',
        auth: "auth: Authorization: Bearer acme_live_…7c21",
      },
    }
    expect(traceLines(fail)).toHaveLength(4)
    const html = renderToString(h(TestResult, { test: fail }))
    expect(html).toContain("Connection failed")
    expect(html).toContain("Details")
    expect(html).toContain('data-pen="MrP5Y"')
    const ok = renderToString(
      h(TestResult, { test: { ok: true, latencyMs: 9, detail: "m", at: 0 } }),
    )
    expect(ok).not.toContain("Details")
  })

  test("auth preview + masked key", () => {
    expect(authPreview({ scheme: "bearer" })).toBe("Authorization: Bearer <key>")
    expect(authPreview({ scheme: "x-api-key" })).toBe("x-api-key: <key>")
    expect(authPreview({ scheme: "custom", header: "X-Token" })).toBe("X-Token: <key>")
    expect(maskForTrace("acme_live_abcdef7c21")).toBe("acme_live_…7c21")
    expect(providerPill("unverified")).toEqual({ tone: "warning", label: "Not verified" })
  })
})

describe("board 25 §4 — Add provider (uOwr0)", () => {
  test("Add is enabled once Name + Base URL + key are valid", () => {
    const d = {
      type: "custom" as const,
      label: "Acme",
      baseURL: ACME,
      key: ACME_KEY,
      auth: { scheme: "bearer" as const },
    }
    expect(addProviderValid(d)).toBe(true)
    expect(addProviderValid({ ...d, label: " " })).toBe(false)
    expect(addProviderValid({ ...d, baseURL: "llm.acme" })).toBe(false)
    expect(addProviderValid({ ...d, key: "" })).toBe(false)
    expect(addProviderValid({ ...d, key: "", baseURL: "http://localhost:1234/v1" })).toBe(true)
    expect(addProviderValid({ ...d, auth: { scheme: "custom", header: "" } })).toBe(false)
    expect(addProviderValid({ ...d, type: "openai", baseURL: "" })).toBe(true)
    expect(savedTo("custom:acme-gateway", "keychain", "macos")).toBe(
      "Saved to macOS Keychain · kimo/provider.custom:acme-gateway",
    )
  })

  test("renders the dialog frame with its fields in node order", () => {
    const ctl = createTestAiSettings({ clis: {} })
    const html = renderToString(
      h(AddProviderDialog, {
        ctl,
        backend: "keychain",
        os: "macos",
        onAdded: () => {},
        onCancel: () => {},
      }),
    )
    const order = [
      "cmSwF",
      "mjxjz",
      "Fvp9F",
      "UqJ1i",
      "Qym0o",
      "l7EYr",
      "W2ERTF",
      "F1hbeP",
      "ThgQE",
    ]
    let at = -1
    for (const pen of order) {
      const i = html.indexOf(`data-pen="${pen}"`)
      expect(i).toBeGreaterThan(at)
      at = i
    }
    expect(html).toContain("Custom endpoint (OpenAI-compatible)")
    expect(html).toContain("Authorization: Bearer &lt;key&gt;")
    expect(html).toContain("Fetch /models")
  })

  test("custom endpoint: Fetch /models, Add runs the Test, key pinned to the origin", async () => {
    const fetch = createMockFetch()
    const c = createTestAiSettings({ clis: {}, fetch })
    await c.refresh()
    const input = {
      type: "custom" as const,
      label: "Acme gateway",
      baseURL: ACME,
      auth: { scheme: "bearer" as const },
      key: ACME_KEY,
      models: [] as string[],
    }
    expect(await c.fetchModels(input)).toEqual(ACME_MODELS)
    // The throwaway draft key is gone again (desktop relay stand-in).
    expect(c.storedOf("custom:draft")).toBeUndefined()
    const draft = await c.testDraft({ ...input, models: ["llama-3.3-70b"] })
    expect(draft.ok).toBe(true)
    const { id, test: t } = await c.addProvider({ ...input, models: ACME_MODELS })
    expect(id).toBe("custom:acme-gateway")
    expect(t.ok).toBe(true)
    const row = c.storedOf(id) as StoredProvider
    expect(row.models).toEqual({ agent: "llama-3.3-70b", fast: "qwen2.5-coder" })
    expect(row.pinnedOrigin).toBe("https://llm.acme.internal")
    expect(row.unverified).toBeUndefined()
    expect(c.state.providers.find((p) => p.id === id)?.status).toBe("connected")
    // Same host, other path: fine. Another host: the key is withheld (relay gets no auth).
    await c.setBaseURL(id, "https://llm.acme.internal/v2")
    expect(keyWithheld(c.storedOf(id) as StoredProvider)).toBe(false)
    await c.setBaseURL(id, "https://evil.example/v1")
    const moved = c.storedOf(id) as StoredProvider
    expect(keyWithheld(moved)).toBe(true)
    expect(relayAuthFor(moved)).toEqual({ kind: "none" })
    // Re-entering the key clears the pin.
    await c.setBaseURL(id, ACME)
    await c.setKey(id, ACME_KEY)
    expect((c.storedOf(id) as StoredProvider).pinnedOrigin).toBe("https://llm.acme.internal")
  })

  test("custom auth schemes reach the relay as headers", () => {
    const p: StoredProvider = {
      id: "custom:x",
      kind: "custom",
      label: "X",
      baseURL: ACME,
      models: { agent: "m", fast: "m" },
      custom: true,
    }
    expect(relayAuthFor({ ...p, auth: { scheme: "bearer" } })).toEqual({
      kind: "header",
      header: "authorization",
      scheme: "Bearer",
    })
    expect(relayAuthFor({ ...p, auth: { scheme: "x-api-key" } })).toEqual({
      kind: "header",
      header: "x-api-key",
    })
    expect(relayAuthFor({ ...p, auth: { scheme: "custom", header: "X-Api-Token" } })).toEqual({
      kind: "header",
      header: "x-api-token",
    })
  })

  test("a failing first Test still adds it, Not verified, with the Details trace", async () => {
    const c = createTestAiSettings({ clis: {}, platform: "web" })
    await c.refresh()
    const { id, test: t } = await c.addProvider({
      type: "custom",
      label: "Acme gateway",
      baseURL: ACME,
      auth: { scheme: "bearer" },
      key: "acme_live_wrongkey9999",
      models: ACME_MODELS,
    })
    expect(t.ok).toBe(false)
    expect(c.storedOf(id)?.unverified).toBe(true)
    const st = c.testOf(id)
    expect(st?.errorKind).toBe("auth")
    expect(st?.status).toBe(401)
    expect(st?.trace?.request).toBe(`GET ${ACME}/models`)
    expect(st?.trace?.response).toMatch(/^← 401 Unauthorized · \d+ ms$/)
    expect(st?.trace?.body).toBe('{"error":{"code":"invalid_api_key"}}')
    expect(st?.trace?.auth).toBe("auth: Authorization: Bearer acme_live_…9999")
  })

  test("variants: unreachable, model missing (warning), timed out", async () => {
    const c = createTestAiSettings({ clis: {}, testTimeoutMs: 80 })
    await c.refresh()
    const add = (baseURL: string, models: string[]) =>
      c.addProvider({
        type: "custom",
        label: `E ${baseURL.length}${models.join()}`,
        baseURL,
        auth: { scheme: "bearer" },
        key: ACME_KEY,
        models,
      })
    const down = await add("https://down.acme.internal/v1", ["llama-3.3-70b"])
    expect(c.testOf(down.id)?.errorKind).toBe("network")
    expect(c.testOf(down.id)?.detail).toContain("ENOTFOUND down.acme.internal")
    const missing = await add(ACME, ["qwen9-coder"])
    expect(c.testOf(missing.id)?.errorKind).toBe("model_missing")
    expect(c.testOf(missing.id)?.detail).toBe("qwen9-coder not in /models")
    const slow = await add("https://slow.acme.internal/v1", ["m"])
    expect(c.testOf(slow.id)?.errorKind).toBe("timeout")
    expect(testStrip(c.testOf(slow.id) as never).detail).toBe("no response in 0 s")
  })
})

describe("board 25 §4 — cloud set-up cards (gpmey)", () => {
  test("one card per cloud keeps its fields; the last set up routes the row", async () => {
    const c = createTestAiSettings({ clis: {} })
    await c.refresh()
    await c.setCloud("bedrock", {
      region: "us-east-1",
      credentials: "profile",
      profile: "default",
      model: "anthropic.claude-opus-5-5",
    })
    await c.setCloud("vertex", { project: "acme-design-prod", region: "us-east5" })
    await c.setCloud("foundry", { resource: "acme-ai-foundry", project: "design-agents" })
    expect(c.storedOf("bedrock")).toMatchObject({
      region: "us-east-1",
      profile: "default",
      models: { agent: "anthropic.claude-opus-5-5" },
    })
    expect(c.storedOf("vertex")).toMatchObject({ project: "acme-design-prod", region: "us-east5" })
    const foundry = c.storedOf("foundry") as StoredProvider
    expect(c.state.providers.find((p) => p.kind === "foundry")?.id).toBe("foundry")
    // The relay's `project` slot carries the Foundry resource.
    expect(relayAuthFor(foundry)).toEqual({
      kind: "cloud",
      platform: "foundry",
      project: "acme-ai-foundry",
    })
    await c.setCloud("vertex", { region: "" })
    expect(c.storedOf("vertex")?.region).toBeUndefined()
    expect(c.storedOf("vertex")?.project).toBe("acme-design-prod")
  })
})

// --- §5 Agent tab ------------------------------------------------------------------------------

function panel(
  extra: Partial<Parameters<typeof createTestRuntime>[0]> & {
    rt?: Partial<ReturnType<typeof createTestRuntime>>
  } = {},
  script: Script = () => ({ text: "Done." }),
) {
  const d = createEmptyDocument("P") as KimoDocument & { nodes: Record<string, unknown> }
  d.nodes.Pricing0001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Pricing",
    x: 0,
    y: 0,
    w: 9,
    h: 9,
  }
  const store = importDocument(d)
  const tools = createInWindowTools({ store, path: "/u/P.kimo" })
  const { rt: over, ...opts } = extra
  const rt = { ...createTestRuntime({ tools: tools.factory, script, ...opts }), ...over }
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f",
    fileName: "P.kimo",
    docId: () => tools.docId(),
    nodeName: () => undefined,
    frameBox: () => null,
  })
  return { c, rt }
}

const claude = (over: Partial<CliDetection> = {}): CliDetection => ({
  id: "claude-code",
  label: "Claude Code",
  installed: true,
  path: "/Users/me/.local/bin/claude",
  signedIn: true,
  billing: "subscription",
  ...over,
})

describe("board 25 §5 — Agent tab first run (FrS9y / D8covN)", () => {
  test("CLI found, not chosen yet → the CLI card; Use → composer enabled", async () => {
    let chosen = false
    const { c } = panel({
      providers: [],
      clis: [claude({ id: "codex", label: "Codex" }), claude()],
      defaultSelection: { provider: "cli:claude-code", model: "default" },
      rt: {
        cliConfirmed: () => chosen,
        chooseCli: async () => {
          chosen = true
        },
        apiReady: () => false,
      },
    })
    await c.refresh()
    expect(c.state.onboarding?.kind).toBe("cli")
    // Detection order: Claude Code first, whatever order the host reported.
    expect(c.state.onboarding?.kind === "cli" && c.state.onboarding.cli.id).toBe("claude-code")
    expect(c.state.composerDisabled).toBe(true)
    const html = renderToString(
      h(AgentPanel, { controller: c, fileName: "P", platform: "desktop" }),
    )
    expect(html).toContain("Meet Kimo")
    expect(html).toContain("Use Claude Code")
    expect(html).toContain("~/.local/bin/claude · signed in")
    expect(html).toContain("Connect a model to start")
    expect(html).not.toContain("agent-thread-title")
    await c.chooseCli("claude-code")
    expect(c.state.onboarding).toBeNull()
    expect(c.state.composerDisabled).toBe(false)
    expect(c.state.composer.model).toEqual({ provider: "cli:claude-code", model: "default" })
  })

  test("nothing found → key card; Connect tests the key; a pass opens the thread", async () => {
    let ready = false
    const keys: string[] = []
    const { c } = panel({
      providers: [],
      clis: [],
      defaultSelection: null,
      rt: {
        apiReady: () => ready,
        connectKey: async (_p, key) => {
          keys.push(key)
          ready = key === "sk-ant-good"
          return ready ? { ok: true, detail: "ok" } : { ok: false, detail: "401 invalid x-api-key" }
        },
      },
    })
    await c.refresh()
    expect(c.state.onboarding?.kind).toBe("key")
    const html = renderToString(h(AgentPanel, { controller: c, fileName: "P", platform: "web" }))
    expect(html).toContain("Connect a model")
    expect(html).toContain("Anthropic API key")
    expect(html).toContain("Other providers")
    // Web: no "Have Claude Code?" hint (CLIs run on desktop only).
    expect(html).not.toContain("Have Claude Code?")
    const bad = await c.connectKey("sk-ant-bad")
    expect(bad.ok).toBe(false)
    expect(c.state.onboarding).toMatchObject({ kind: "key", error: "401 invalid x-api-key" })
    const good = await c.connectKey("sk-ant-good")
    expect(good.ok).toBe(true)
    expect(keys).toEqual(["sk-ant-bad", "sk-ant-good"])
    expect(c.state.onboarding).toBeNull()
  })

  test("tildePath", () => {
    expect(tildePath("/Users/me/.local/bin/claude")).toBe("~/.local/bin/claude")
    expect(tildePath("/usr/local/bin/codex")).toBe("/usr/local/bin/codex")
  })
})

describe("board 25 §5 — approval op rows (G9V6Kf), refusal (dIkT6)", () => {
  const req = (over: Partial<McpApprovalRequest>): McpApprovalRequest => ({
    id: "a1",
    client: { client: "kimo", label: "Kimo", session: "s", transport: "in-process" } as never,
    tool: "kimo_apply_ops",
    reason: { kind: "destructive", ops: ["delete"], nodeIds: ["n1", "n2", "n3"] },
    summary: "Apply ops: delete on 3 node(s)",
    requestedAt: 0,
    expiresAt: 0,
    ...over,
  })

  test("icon · verb · target · scope", () => {
    expect(approvalOps(req({}), { parentName: () => "Pricing" })).toEqual([
      { icon: "trash-2", label: "Delete 3 layers", meta: "in Pricing" },
    ])
    expect(
      approvalOps(req({ preview: { inserted: 1, updated: 2, deleted: 3, nodeIds: ["n1"] } }), {
        parentName: () => "Pricing",
      }).map((r) => `${r.icon} ${r.label} ${r.meta}`),
    ).toEqual([
      "trash-2 Delete 3 layers in Pricing",
      "pencil Edit 2 layers in Pricing",
      "plus Add 1 layer in Pricing",
    ])
    expect(approvalOps(req({ reason: { kind: "grant", grant: "globals" } }))).toEqual([
      { icon: "variable", label: "Edit global variables", meta: "global" },
    ])
    expect(
      approvalOps(req({ reason: { kind: "file", path: "/u/me/Out.kimo", action: "save" } })),
    ).toEqual([{ icon: "save", label: "Save Out.kimo", meta: "/u/me" }])
    expect(approvalOps(req({ reason: { kind: "scope", nodeIds: ["x"] } }))[0]?.meta).toBe(
      "outside its area",
    )
  })

  test("refusal: neutral card with the model's reason; Edit request prefills the composer", async () => {
    const { c } = panel({}, () => ({
      text: "Recreating the Stripe logo pixel-for-pixel isn't something I'll draw.",
      stop: "refusal",
    }))
    await c.refresh()
    await c.send("Draw the Stripe logo exactly")
    const a = c.state.messages.find((m) => m.kind === "agent")
    if (a?.kind !== "agent") throw new Error("no agent message")
    expect(a.card?.kind).toBe("refusal")
    const html = renderToString(h(AgentPanel, { controller: c, fileName: "P" }))
    expect(html).toContain("Kimo won&#x27;t do this one")
    expect(html).toContain("isn&#x27;t something I&#x27;ll draw")
    expect(html).toContain("Edit request")
    expect(html).not.toContain("kimo-error-card--warning")
    c.editRequest(a.turnId)
    expect(c.state.composer.text).toBe("Draw the Stripe logo exactly")
  })

  test("generic error: circle-x card, Something went wrong, Retry + Copy error", async () => {
    const { c } = panel({}, () => ({
      error: "invalid_request",
      status: 400,
      message: "Anthropic returned 400 · invalid_request_error",
    }))
    await c.refresh()
    await c.send("hi")
    const html = renderToString(h(AgentPanel, { controller: c, fileName: "P" }))
    expect(c.state.messages.some((m) => m.kind === "agent" && m.card?.kind === "error")).toBe(true)
    expect(html).toContain("Something went wrong")
    expect(html).toContain("Retry")
    expect(html).toContain("Copy error")
    expect(html).toContain("Nothing was changed on the canvas.")
    expect(html).toContain('data-pen="u8mh7l"')
  })
})

// Keeps MOCK_ANTHROPIC referenced for the default-provider runtime above.
void MOCK_ANTHROPIC
