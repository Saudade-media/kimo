/**
 * Board 39 model chooser (desing.pen qNrfY): groups per provider, Recent, search threshold and
 * grouping, the keyboard reducer, the composer chip label, and effort / recents in the
 * controller.
 */
import { describe, expect, test } from "bun:test"
import type { CliDetection, ModelSelection, ProviderConfig } from "@kimo/ai-agent"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import { createAgentPanelController, createInWindowTools } from "../src/agent-panel"
import { modelLabel } from "../src/agent-panel/format"
import {
  type ChooserState,
  chooserKey,
  chooserView,
  initialActive,
  navRows,
  pushRecent,
  SEARCH_THRESHOLD,
} from "../src/agent-panel/model-chooser"
import { pickerGroups, providerMark, selectionEfforts } from "../src/agent-panel/picker-groups"
import { createTestRuntime, MOCK_ANTHROPIC } from "../src/agent-panel/testing"
import type { ModelPickerGroup } from "../src/platform/contract"

const CLI = (id: string, label: string, signedIn: boolean | null = true): CliDetection => ({
  id,
  label,
  installed: true,
  signedIn,
  billing: signedIn ? "subscription" : null,
})
const OLLAMA: ProviderConfig = {
  id: "custom:ollama",
  kind: "custom",
  label: "Ollama · localhost",
  models: { agent: "llama3.3:70b", fast: "qwen2.5-coder:32b" },
  free: true,
}
const OPENAI: ProviderConfig = {
  id: "openai",
  kind: "openai",
  label: "OpenAI-compatible",
  models: { agent: "gpt-4.1", fast: "gpt-4.1-mini" },
}

/** An open catalog with 10 listed ids (board 39 C: the search field shows). */
const OPENROUTER: ProviderConfig = {
  id: "openrouter",
  kind: "openrouter",
  label: "OpenRouter",
  models: { agent: "anthropic/claude-sonnet-5-5", fast: "google/gemini-2.5-flash" },
  extraModels: Array.from({ length: 8 }, (_, i) => `vendor/model-${i + 1}`),
}

const groupsOf = (
  clis: CliDetection[] = [CLI("claude-code", "Claude Code"), CLI("codex", "Codex")],
  providers: ProviderConfig[] = [MOCK_ANTHROPIC, OPENAI, OLLAMA],
): ModelPickerGroup[] =>
  pickerGroups({
    platform: "desktop",
    providers,
    clis,
    defaultSelection: { provider: "cli:claude-code", model: "default" },
  })

const STATE: ChooserState = { provider: null, query: "", active: -1, zone: "list" }
const SONNET_CC: ModelSelection = { provider: "cli:claude-code", model: "claude-sonnet-5-5" }

describe("groups (rules: Providers, Models, Tags)", () => {
  test("CLI row then API row (Anthropic, OpenAI, …, Local last); only connected", () => {
    const g = groupsOf()
    expect(g.map((x) => [x.family, x.chip])).toEqual([
      ["cli", "Claude Code"],
      ["cli", "Codex"],
      ["api", "Anthropic"],
      ["api", "OpenAI"],
      ["api", "Local"],
    ])
  })

  test("API models: the static catalog, short names, Best / Fast / Local tags, detail", () => {
    const g = groupsOf()
    const anthropic = g.find((x) => x.provider === "anthropic")
    expect(anthropic?.models.map((m) => [m.label, m.tag ?? null])).toEqual([
      ["Opus 5.5", "best"],
      ["Sonnet 5.5", null],
      ["Haiku 4.5", "fast"],
      ["Fable 5.1", null],
    ])
    expect(anthropic?.models[0]?.detail).toBe("1M context · 128K output · always thinks")
    const local = g.find((x) => x.chip === "Local")
    expect(local?.models.map((m) => [m.label, m.tag, m.efforts])).toEqual([
      ["llama3.3:70b", "local", []],
      ["qwen2.5-coder:32b", "local", []],
    ])
    expect(g.find((x) => x.provider === "openai")?.models.map((m) => m.efforts.length)).toEqual([
      0, 0, 3,
    ])
  })

  test("a signed-out CLI keeps its group (unavailable); an uninstalled one is gone", () => {
    const g = groupsOf([
      CLI("claude-code", "Claude Code", false),
      { ...CLI("codex", "Codex"), installed: false },
    ])
    expect(g[0]).toMatchObject({ provider: "cli:claude-code", available: false })
    expect(g.some((x) => x.provider === "cli:codex")).toBe(false)
  })

  test("efforts and provider mark of a selection", () => {
    const g = groupsOf()
    const providers = [MOCK_ANTHROPIC, OPENAI, OLLAMA]
    expect(selectionEfforts(g, SONNET_CC, providers)).toEqual(["low", "medium", "high", "max"])
    expect(
      selectionEfforts(g, { provider: "cli:claude-code", model: "claude-haiku-4-5-20251001" }, []),
    ).toEqual([])
    // A saved "(latest)" alias is not listed but still has levels.
    expect(selectionEfforts(g, { provider: "cli:claude-code", model: "opus" }, [])).toHaveLength(4)
    expect(selectionEfforts(g, { provider: "openai", model: "o3" }, providers)).toEqual([
      "low",
      "medium",
      "high",
    ])
    expect(providerMark(SONNET_CC, providers)).toBe("cli")
    expect(providerMark({ provider: "anthropic", model: "x" }, providers)).toBe("api")
    expect(providerMark({ provider: "custom:ollama", model: "x" }, providers)).toBe("local")
  })
})

describe("chooserView (states A–F)", () => {
  test("A: Recent (2+ providers), chips, models of the current provider, Effort", () => {
    const v = chooserView({
      groups: groupsOf(),
      current: SONNET_CC,
      recent: [SONNET_CC, { provider: "anthropic", model: "claude-haiku-4-5-20251001" }],
      effort: "high",
      state: STATE,
    })
    expect(v.kind).toBe("models")
    expect(v.recent.map((r) => [r.label, r.meta])).toEqual([
      ["Sonnet 5.5", "Claude Code"],
      ["Haiku 4.5", "Anthropic"],
    ])
    expect(v.recent.every((r) => !r.checked)).toBe(true)
    expect(v.chips.cli.map((c) => [c.label, c.selected])).toEqual([
      ["Claude Code", true],
      ["Codex", false],
    ])
    expect(v.rows.map((r) => [r.label, r.meta ?? "", r.checked])).toEqual([
      ["Default (CLI decides)", "", false],
      ["Opus 5.5", "Best", false],
      ["Sonnet 5.5", "", true],
      ["Haiku 4.5", "Fast", false],
      ["Fable 5.1", "", false],
    ])
    expect(v.efforts).toEqual(["low", "medium", "high", "max"])
    expect(v.effort).toBe("high")
    // No provider lists 9+ models (Claude Code 5, Anthropic 4, …): no search field.
    expect(v.showSearch).toBe(false)
  })

  test("Recent hides with one connected provider; Effort hides for a per-agent pick", () => {
    const one = groupsOf([CLI("claude-code", "Claude Code")], [])
    const v = chooserView({
      groups: one,
      current: SONNET_CC,
      recent: [SONNET_CC],
      effort: "max",
      effortHidden: true,
      state: STATE,
    })
    expect(v.recent).toEqual([])
    expect(v.efforts).toEqual([])
    expect(v.showSearch).toBe(false)
  })

  test("C: search once a provider lists 9+; filters across providers, grouped; chips/Effort hide", () => {
    const small = groupsOf([CLI("claude-code", "Claude Code")], [])
    expect(small.every((g) => g.models.length < SEARCH_THRESHOLD)).toBe(true)
    expect(
      chooserView({ groups: small, current: null, recent: [], effort: "high", state: STATE })
        .showSearch,
    ).toBe(false)
    const big = groupsOf(undefined, [MOCK_ANTHROPIC, OPENROUTER])
    expect(
      chooserView({ groups: big, current: SONNET_CC, recent: [], effort: "high", state: STATE })
        .showSearch,
    ).toBe(true)
    const v = chooserView({
      groups: big,
      current: SONNET_CC,
      recent: [],
      effort: "high",
      state: { ...STATE, query: "son" },
    })
    expect(v.kind).toBe("search")
    expect(v.groups.map((g) => [g.label, g.rows.map((r) => r.label)])).toEqual([
      ["Claude Code", ["Sonnet 5.5"]],
      ["Anthropic", ["Sonnet 5.5"]],
      ["OpenRouter", ["anthropic/claude-sonnet-5-5"]],
    ])
    expect(v.groups[0]?.rows[0]?.checked).toBe(true)
    expect(v.efforts).toEqual([])
    // Enter picks the first match.
    const r = chooserKey({ ...STATE, query: "son", active: initialActive(v) }, { key: "Enter" }, v)
    expect(r.action).toEqual({ type: "pick", selection: SONNET_CC })
  })

  test("D: no provider connected", () => {
    const v = chooserView({ groups: [], current: null, recent: [], effort: "high", state: STATE })
    expect(v.kind).toBe("empty")
  })

  test("E: a signed-out CLI keeps its chip (warning dot) and shows Sign in…", () => {
    const g = groupsOf([CLI("claude-code", "Claude Code", false), CLI("codex", "Codex")], [])
    const v = chooserView({
      groups: g,
      current: null,
      recent: [],
      effort: "high",
      state: { ...STATE, provider: "cli:claude-code" },
    })
    expect(v.kind).toBe("signed-out")
    expect(v.chips.cli[0]).toMatchObject({ label: "Claude Code", signedOut: true, selected: true })
    expect(v.provider?.label).toBe("Claude Code")
    expect(chooserKey(STATE, { key: "Enter" }, v).action).toEqual({ type: "sign-in" })
  })

  test("F: Local models carry the Local tag and no Effort row", () => {
    const v = chooserView({
      groups: groupsOf(),
      current: { provider: "custom:ollama", model: "llama3.3:70b" },
      recent: [],
      effort: "high",
      state: STATE,
    })
    expect(v.chips.api.find((c) => c.selected)?.label).toBe("Local")
    expect(v.rows.map((r) => [r.label, r.meta])).toEqual([
      ["llama3.3:70b", "Local"],
      ["qwen2.5-coder:32b", "Local"],
    ])
    expect(v.efforts).toEqual([])
  })
})

describe("keyboard", () => {
  const view = (state: ChooserState) =>
    chooserView({ groups: groupsOf(), current: SONNET_CC, recent: [], effort: "high", state })

  test("←/→ switch provider while the field is empty, never with text in it", () => {
    let s = STATE
    let r = chooserKey(s, { key: "ArrowRight" }, view(s))
    expect(r.state.provider).toBe("cli:codex")
    s = r.state
    r = chooserKey(s, { key: "ArrowLeft" }, view(s))
    expect(r.state.provider).toBe("cli:claude-code")
    // Wraps from the first chip to the last (Local).
    r = chooserKey(r.state, { key: "ArrowLeft" }, view(r.state))
    expect(r.state.provider).toBe("custom:ollama")
    const typed = { ...STATE, query: "o" }
    expect(chooserKey(typed, { key: "ArrowRight" }, view(typed)).handled).toBe(false)
  })

  test("↑/↓ move through models (start: the checked row), Enter picks", () => {
    const v = view(STATE)
    const start = initialActive(v)
    expect(navRows(v)[start]?.label).toBe("Sonnet 5.5")
    let r = chooserKey({ ...STATE, active: start }, { key: "ArrowDown" }, v)
    expect(navRows(v)[r.state.active]?.label).toBe("Haiku 4.5")
    r = chooserKey(r.state, { key: "ArrowDown" }, v)
    r = chooserKey(r.state, { key: "ArrowDown" }, v)
    expect(navRows(v)[r.state.active]?.label).toBe("Fable 5.1")
    r = chooserKey(r.state, { key: "Enter" }, v)
    expect(r.action).toEqual({
      type: "pick",
      selection: { provider: "cli:claude-code", model: "claude-fable-5-1" },
    })
  })

  test("Tab goes to Effort; ←/→ change the level within the supported ones; Esc closes", () => {
    const v = view(STATE)
    let r = chooserKey(STATE, { key: "Tab" }, v)
    expect(r.state.zone).toBe("effort")
    r = chooserKey(r.state, { key: "ArrowRight" }, v)
    expect(r.action).toEqual({ type: "effort", level: "max" })
    r = chooserKey(r.state, { key: "ArrowLeft" }, v)
    expect(r.action).toEqual({ type: "effort", level: "medium" })
    expect(chooserKey(r.state, { key: "Tab", shiftKey: true }, v).state.zone).toBe("list")
    expect(chooserKey(STATE, { key: "Escape" }, v).action).toEqual({ type: "close" })
    // No Effort (Local): Tab is not handled.
    const local = chooserView({
      groups: groupsOf(),
      current: { provider: "custom:ollama", model: "llama3.3:70b" },
      recent: [],
      effort: "high",
      state: STATE,
    })
    expect(chooserKey(STATE, { key: "Tab" }, local).handled).toBe(false)
  })
})

describe("recents", () => {
  test("pushRecent: newest first, distinct, two at most", () => {
    const a = { provider: "anthropic", model: "a" }
    const b = { provider: "cli:codex", model: "b" }
    const c = { provider: "anthropic", model: "c" }
    expect(pushRecent([], a)).toEqual([a])
    expect(pushRecent([a], b)).toEqual([b, a])
    expect(pushRecent([b, a], a)).toEqual([a, b])
    expect(pushRecent([b, a], c)).toEqual([c, b])
  })

  test("the controller saves picks and keeps the effort level across models", async () => {
    const store = importDocument(createEmptyDocument())
    const tools = createInWindowTools({ store, path: "/u/me/a.kimo" })
    const rt = createTestRuntime({
      tools: tools.factory,
      script: () => ({ text: "ok" }),
      providers: [MOCK_ANTHROPIC, OPENAI],
      recentModels: [{ provider: "openai", model: "gpt-4.1" }],
    })
    const c = createAgentPanelController({
      runtime: rt,
      fileId: "f",
      fileName: "a.kimo",
      docId: () => tools.docId(),
    })
    await c.refresh()
    expect(c.state.recentModels).toEqual([{ provider: "openai", model: "gpt-4.1" }])
    c.setThinking("max")
    c.setModel({ provider: "anthropic", model: "claude-sonnet-5-5" })
    expect(rt.recentSaved()).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5-5" },
      { provider: "openai", model: "gpt-4.1" },
    ])
    expect(c.state.composer.efforts).toEqual(["low", "medium", "high", "max"])
    expect(c.state.composer.thinking).toBe("max")
    expect(c.state.modelLabel).toBe("Sonnet 5.5")
    expect(c.state.modelMark).toBe("api")
    c.setModel({ provider: "openai", model: "gpt-4.1" })
    expect(c.state.composer.thinkingAvailable).toBe(false)
    expect(c.state.composer.thinking).toBe("max")
  })
})

describe("composer chip label (G: model name only)", () => {
  test("CLI ids show their short name; Default shows the CLI", () => {
    const clis = [CLI("claude-code", "Claude Code")]
    expect(modelLabel(SONNET_CC, clis)).toBe("Sonnet 5.5")
    expect(modelLabel({ provider: "cli:codex", model: "gpt-5.6-luna" }, clis)).toBe("GPT-5.6 Luna")
    expect(modelLabel({ provider: "cli:claude-code", model: "default" }, clis)).toBe("Claude Code")
    expect(modelLabel({ provider: "anthropic", model: "claude-opus-5-5" }, [])).toBe("Opus 5.5")
  })
})
