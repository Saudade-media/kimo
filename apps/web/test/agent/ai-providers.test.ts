/**
 * AI provider settings: where API keys may go. A key is pinned to its endpoint's origin, never
 * handed to JS on desktop, never written to the config, and masked in a failed test's trace.
 */
import { describe, expect, test } from "bun:test"
import { AI_CONFIG_KEY, keyWithheld, type StoredProvider } from "../../src/ai-settings/model"
import { relayAuthFor } from "../../src/ai-settings/runtime"
import {
  ACME_KEY,
  ACME_MODELS,
  createMockFetch,
  createTestAiSettings,
  memoryStorage,
} from "../../src/ai-settings/testing"

const ACME = "https://llm.acme.internal/v1"
const KEY = "sk-ant-api03-test-3f9a"

describe("custom endpoint keys", () => {
  test("Add runs the Test and pins the key to the endpoint's origin", async () => {
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
    const { id, test: t } = await c.addProvider({ ...input, models: ACME_MODELS })
    expect(id).toBe("custom:acme-gateway")
    expect(t.ok).toBe(true)
    const row = c.storedOf(id) as StoredProvider
    expect(row.pinnedOrigin).toBe("https://llm.acme.internal")
    expect(row.unverified).toBeUndefined()
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

  test("a failing first Test still adds the provider as not verified, with the key masked in the trace", async () => {
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
    expect(st?.trace?.auth).toBe("auth: Authorization: Bearer acme_live_…9999")
    expect(JSON.stringify(st?.trace)).not.toContain("wrongkey9999")
  })
})

describe("provider keys", () => {
  test("desktop never hands keys to JS; reveal is unavailable", async () => {
    const c = createTestAiSettings({ clis: {}, keys: { "provider.anthropic": KEY } })
    await c.refresh()
    expect(await c.revealKey("anthropic")).toBeNull()
    expect((await c.providerConfigs()).find((x) => x.id === "anthropic")?.apiKey).toBeUndefined()
  })

  test("web: Anthropic needs the browser opt-in before its key is used", async () => {
    const c = createTestAiSettings({ platform: "web", keys: { "provider.anthropic": KEY } })
    await c.refresh()
    expect(c.state.noProvider).toBe(true)
    await c.setAllowBrowser("anthropic", true)
    expect(c.state.defaultSelection?.provider).toBe("anthropic")
    const cfgs = await c.providerConfigs()
    expect(cfgs.find((x) => x.id === "anthropic")?.apiKey).toBe(KEY)
    expect(await c.revealKey("anthropic")).toBe(KEY)
  })

  test("custom endpoints, settings and usage persist in kimo.ai, never keys", async () => {
    const storage = memoryStorage()
    const c = createTestAiSettings({ clis: {}, storage })
    await c.addCustom({
      label: "LM Studio",
      baseURL: "http://localhost:1234/v1",
      wire: "openai-chat",
      models: { agent: "qwen", fast: "qwen" },
      free: true,
    })
    await c.setUsageSettings({ monthlyLimitUsd: 50 })
    await c.setKey("anthropic", KEY)
    expect(storage.getItem(AI_CONFIG_KEY) ?? "").not.toContain(KEY)
    const again = createTestAiSettings({ clis: {}, storage })
    await again.refresh()
    expect(again.state.providers.some((p) => p.id === "custom:lm-studio")).toBe(true)
    expect(again.state.settings.monthlyLimitUsd).toBe(50)
  })
})
