/**
 * The model chooser's provider groups (board 39 qNrfY): CLIs first (Claude Code, Codex, Gemini
 * CLI; installed ones, signed out or not), then the connected API providers (Anthropic, OpenAI,
 * Gemini, …, Local last). Each group lists specific versioned models: a CLI's verified ids after
 * "Default (CLI decides)"; an API provider's static catalog plus its agent / fast / added ids.
 * Unconnected API providers are not listed (rule "Not connected").
 */
import {
  BUILTIN_CLI_ADAPTERS,
  type CliDetection,
  catalogInfo,
  cliIdOf,
  cliModelEfforts,
  cliProviderId,
  type EffortLevel,
  effortLevels,
  isCliProvider,
  MODEL_CATALOG,
  type ModelInfo,
  type ModelSelection,
  modelDetail,
  type ProviderConfig,
  type ProviderKind,
} from "@kimo/ai-agent"
import type { ModelPickerGroup, ModelPickerModel } from "../platform/contract"

/** Board 23 detection order, also the chip order of the CLI row. */
const CLI_ORDER = ["claude-code", "codex", "gemini-cli"]

/** API chip order (board 39 A: Anthropic, OpenAI, Gemini, Local). */
const KIND_ORDER: readonly ProviderKind[] = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "bedrock",
  "vertex",
  "foundry",
  "custom",
]

const KIND_CHIP: Readonly<Record<ProviderKind, string | null>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  bedrock: "Bedrock",
  vertex: "Vertex AI",
  foundry: "Foundry",
  custom: null,
}

/** The chooser's short model name: "Claude Opus 5.5" → "Opus 5.5". */
export const shortModelLabel = (label: string): string => label.replace(/^Claude /, "")

/** Board 39 chip text for an API provider. */
export function providerChip(p: Pick<ProviderConfig, "kind" | "label" | "free">): string {
  if (p.free) return "Local"
  return KIND_CHIP[p.kind] ?? p.label
}

const rank = (list: readonly string[], v: string) => {
  const i = list.indexOf(v)
  return i < 0 ? list.length : i
}

function apiModel(p: ProviderConfig, id: string, info: ModelInfo | undefined): ModelPickerModel {
  const efforts = info ? [...effortLevels(info)] : []
  const role = p.free
    ? ("local" as const)
    : id === p.models.agent
      ? ("agent" as const)
      : id === p.models.fast
        ? ("fast" as const)
        : undefined
  const tag = p.free ? ("local" as const) : info?.tag === "local" ? undefined : info?.tag
  return {
    id,
    label: info ? shortModelLabel(info.label) : id,
    ...(role ? { role } : {}),
    ...(tag ? { tag } : {}),
    ...(info ? { detail: modelDetail(info) } : {}),
    efforts,
    thinking: efforts.length > 0,
  }
}

export function pickerGroups(input: {
  platform: "desktop" | "web" | "node"
  providers: readonly ProviderConfig[]
  /** Unconnected API providers: kept in the signature, never listed (board 39). */
  unavailable?: readonly { id: string; label: string; tag: string }[]
  clis: readonly CliDetection[]
  defaultSelection: ModelSelection | null
  labelOf?(provider: string): string
}): ModelPickerGroup[] {
  const groups: ModelPickerGroup[] = []
  if (input.platform === "desktop") {
    const order = [...input.clis].sort((a, b) => rank(CLI_ORDER, a.id) - rank(CLI_ORDER, b.id))
    for (const d of order) {
      if (!d.installed) continue
      const adapter = BUILTIN_CLI_ADAPTERS.find((a) => a.def.id === d.id)
      const signedIn = d.signedIn === true
      const models = (adapter?.def.models ?? [{ id: "default", label: "Default (CLI decides)" }])
        .filter((m) => m.listed !== false)
        .map(
          (m): ModelPickerModel => ({
            id: m.id,
            label: m.label,
            ...(m.tag ? { tag: m.tag } : {}),
            ...(m.detail ? { detail: m.detail } : {}),
            efforts: [...(m.efforts ?? [])],
            thinking: (m.efforts?.length ?? 0) > 0,
          }),
        )
      groups.push({
        provider: cliProviderId(d.id),
        label: d.label,
        chip: d.label,
        family: "cli",
        isDefault: input.defaultSelection?.provider === cliProviderId(d.id),
        available: signedIn,
        ...(signedIn
          ? { tag: d.billing === "cli-api-key" ? "API key" : "subscription" }
          : { tag: "not signed in" }),
        billing: d.billing ?? "subscription",
        models,
      })
    }
  }
  const apis = [...input.providers].sort(
    (a, b) =>
      Number(a.free === true) - Number(b.free === true) ||
      rank(KIND_ORDER, a.kind) - rank(KIND_ORDER, b.kind),
  )
  const chips = apis.map(providerChip)
  apis.forEach((p, i) => {
    // The static catalog (open families: none) first, then the provider's own and added ids.
    const catalog = p.free
      ? []
      : (MODEL_CATALOG[p.kind].length
          ? MODEL_CATALOG[p.kind]
          : p.kind === "bedrock" || p.kind === "vertex" || p.kind === "foundry"
            ? MODEL_CATALOG.anthropic
            : []
        ).filter((m) => m.listed !== false)
    const ids = [
      ...new Set(
        [...catalog.map((m) => m.id), p.models.agent, p.models.fast, ...(p.extraModels ?? [])]
          .filter(Boolean)
          // An unlisted alias (claude-haiku-4-5) already shows as its dated id.
          .filter((id) => catalogInfo(p.kind, id)?.listed !== false),
      ),
    ]
    const chip = chips[i] as string
    groups.push({
      provider: p.id,
      label: p.label,
      // Two providers of one kind (two custom endpoints): their own labels tell them apart.
      chip: chips.filter((c) => c === chip).length > 1 ? p.label : chip,
      family: "api",
      isDefault: input.defaultSelection?.provider === p.id,
      available: true,
      ...(p.free ? { tag: "local" } : {}),
      billing: p.free ? "local" : "api",
      models: ids.map((id) => apiModel(p, id, p.free ? undefined : catalogInfo(p.kind, id))),
    })
  })
  return groups
}

/**
 * The Effort levels of a selection: its chooser row's, else (an unlisted CLI id, an id outside
 * the groups) the CLI's Default row or the catalog's. Empty: no Effort row.
 */
export function selectionEfforts(
  groups: readonly ModelPickerGroup[],
  sel: ModelSelection | null,
  providers: readonly ProviderConfig[],
): EffortLevel[] {
  if (!sel) return []
  const row = groups
    .find((g) => g.provider === sel.provider)
    ?.models.find((m) => m.id === sel.model)
  if (row) return row.efforts
  if (isCliProvider(sel.provider)) {
    const a = BUILTIN_CLI_ADAPTERS.find((x) => x.def.id === cliIdOf(sel.provider))
    return a ? [...cliModelEfforts(a.def, sel.model)] : []
  }
  const p = providers.find((x) => x.id === sel.provider)
  const inf = p && !p.free ? catalogInfo(p.kind, sel.model) : undefined
  return inf ? [...effortLevels(inf)] : []
}

/** Board 39 G: the composer chip's 12 px provider mark (terminal, cloud, hard-drive). */
export type ProviderMark = "cli" | "api" | "local"

export function providerMark(
  sel: ModelSelection | null,
  providers: readonly ProviderConfig[],
): ProviderMark | null {
  if (!sel) return null
  if (isCliProvider(sel.provider)) return "cli"
  return providers.find((p) => p.id === sel.provider)?.free ? "local" : "api"
}
