/**
 * Board 39 model chooser (desing.pen qNrfY): what the menu shows for a set of provider groups,
 * and its keyboard. Pure, so the rules are unit-tested without a DOM:
 * - Recent: up to two provider + model rows at the top, only when 2+ providers are connected.
 * - Providers: chips in two rows, CLIs then APIs; only connected ones (a signed-out CLI keeps its
 *   chip with a warning dot and shows "Sign in…").
 * - Models of the chosen provider; Effort with only the levels the checked model supports.
 * - Search: a field at the top once a provider lists 9+ models (an OpenRouter catalog; board 39
 *   A's five-row lists have none); typing filters across providers, grouped by provider, and
 *   hides the chips and Effort.
 * - Keys: type to filter, ←/→ switch provider while the field is empty, ↑/↓ move, Enter picks,
 *   Tab goes to Effort (←/→ change level there), Esc closes.
 */
import { clampEffort, type EffortLevel, type ModelSelection } from "@kimo/ai-agent"
import type { ModelPickerGroup, ModelPickerModel } from "../platform/contract"

/** Board 39 rule "Search": the field shows once one provider lists this many models. */
export const SEARCH_THRESHOLD = 9

export interface ChooserChip {
  provider: string
  label: string
  family: "cli" | "api"
  selected: boolean
  /** A signed-out CLI: warning dot. */
  signedOut: boolean
}

export interface ChooserRow {
  /** `provider\u0000model` (unique across groups). */
  key: string
  provider: string
  model: string
  label: string
  /** The meta slot: a tag (Best, Fast, Local) or, in Recent, the provider. */
  meta?: string
  detail?: string
  checked: boolean
}

export interface ChooserView {
  kind: "empty" | "signed-out" | "models" | "search"
  showSearch: boolean
  recent: ChooserRow[]
  chips: { cli: ChooserChip[]; api: ChooserChip[] }
  /** The chosen provider (the selected chip). */
  provider: ModelPickerGroup | null
  rows: ChooserRow[]
  /** Search results by provider. */
  groups: { provider: string; label: string; rows: ChooserRow[] }[]
  /** Effort levels shown (empty: no Effort row) and the selected one. */
  efforts: EffortLevel[]
  effort: EffortLevel | undefined
}

export interface ChooserState {
  /** The chip the user moved to; null = the current model's provider. */
  provider: string | null
  query: string
  /** Index into {@link navRows}; -1 = none. */
  active: number
  zone: "list" | "effort"
}

export const TAG_LABEL: Readonly<Record<NonNullable<ModelPickerModel["tag"]>, string>> = {
  best: "Best",
  fast: "Fast",
  local: "Local",
}

const keyOf = (provider: string, model: string) => `${provider}\u0000${model}`

const rowOf = (
  g: ModelPickerGroup,
  m: ModelPickerModel,
  current: ModelSelection | null,
  meta?: string,
): ChooserRow => {
  const tag = meta ?? (m.tag ? TAG_LABEL[m.tag] : undefined)
  return {
    key: keyOf(g.provider, m.id),
    provider: g.provider,
    model: m.id,
    label: m.label,
    ...(tag ? { meta: tag } : {}),
    ...(m.detail ? { detail: m.detail } : {}),
    checked: current?.provider === g.provider && current.model === m.id,
  }
}

/** True when `m` matches the search text (label or id, case-insensitive). */
export function matches(m: Pick<ModelPickerModel, "id" | "label">, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
}

/** The chooser's content for these groups, the current pick and the menu state. */
export function chooserView(input: {
  groups: readonly ModelPickerGroup[]
  current: ModelSelection | null
  recent: readonly ModelSelection[]
  /** The session's level; shown clamped to what the checked model supports. */
  effort: EffortLevel
  /** Per-agent pick (Mode menu): no Recent-only picks of effort, no Effort row. */
  effortHidden?: boolean
  state: Pick<ChooserState, "provider" | "query">
}): ChooserView {
  const { groups, current, state } = input
  const connected = groups.filter((g) => g.available)
  const shown = groups.filter((g) => g.available || g.family === "cli")
  const showSearch = connected.some((g) => g.models.length >= SEARCH_THRESHOLD)
  const query = showSearch ? state.query : ""
  const chosen =
    shown.find((g) => g.provider === state.provider) ??
    shown.find((g) => g.provider === current?.provider && g.available) ??
    connected[0] ??
    shown[0] ??
    null
  const chip = (g: ModelPickerGroup): ChooserChip => ({
    provider: g.provider,
    label: g.chip,
    family: g.family,
    selected: g.provider === chosen?.provider,
    signedOut: !g.available,
  })
  const chips = {
    cli: shown.filter((g) => g.family === "cli").map(chip),
    api: shown.filter((g) => g.family === "api").map(chip),
  }
  const empty: ChooserView = {
    kind: "empty",
    showSearch: false,
    recent: [],
    chips: { cli: [], api: [] },
    provider: null,
    rows: [],
    groups: [],
    efforts: [],
    effort: undefined,
  }
  if (shown.length === 0) return empty
  if (query.trim()) {
    const out = connected
      .map((g) => ({
        provider: g.provider,
        label: g.chip,
        rows: g.models.filter((m) => matches(m, query)).map((m) => rowOf(g, m, current, "")),
      }))
      .filter((g) => g.rows.length > 0)
      // A search row carries no meta (board 39 C).
      .map((g) => ({ ...g, rows: g.rows.map(({ meta: _m, ...r }) => r) }))
    return { ...empty, kind: "search", showSearch, groups: out, chips }
  }
  const recent =
    connected.length >= 2
      ? input.recent
          .map((sel) => {
            const g = connected.find((x) => x.provider === sel.provider)
            const m = g?.models.find((x) => x.id === sel.model)
            return g && m ? rowOf(g, m, null, g.chip) : null
          })
          .filter((r): r is ChooserRow => r !== null)
          .slice(0, 2)
      : []
  if (!chosen?.available)
    return { ...empty, kind: "signed-out", showSearch, recent, chips, provider: chosen }
  const rows = chosen.models.map((m) => rowOf(chosen, m, current))
  const checked = chosen.models.find(
    (m) => current?.provider === chosen.provider && current.model === m.id,
  )
  const efforts = input.effortHidden ? [] : (checked?.efforts ?? [])
  return {
    kind: "models",
    showSearch,
    recent,
    chips,
    provider: chosen,
    rows,
    groups: [],
    efforts: [...efforts],
    effort: clampEffort(efforts, input.effort),
  }
}

/** The rows ↑/↓ move through, top to bottom (Recent, then models; or the search results). */
export function navRows(v: ChooserView): ChooserRow[] {
  if (v.kind === "search") return v.groups.flatMap((g) => g.rows)
  if (v.kind === "models") return [...v.recent, ...v.rows]
  return v.recent
}

/** Where the highlight starts: the checked model row, else the first row. */
export function initialActive(v: ChooserView): number {
  const rows = navRows(v)
  if (v.kind === "search") return rows.length ? 0 : -1
  const i = rows.findIndex((r, k) => r.checked && k >= v.recent.length)
  return i >= 0 ? i : rows.length ? 0 : -1
}

export type ChooserAction =
  | { type: "pick"; selection: ModelSelection }
  | { type: "effort"; level: EffortLevel }
  | { type: "close" }
  | { type: "sign-in" }

/**
 * One key press. `view` must be the view for `state`. Returns the next state, an action, and
 * whether the key was handled (the caller prevents the default then). Printable keys are not
 * handled here: they go to the search field.
 */
export function chooserKey(
  state: ChooserState,
  key: { key: string; shiftKey?: boolean },
  view: ChooserView,
): { state: ChooserState; action?: ChooserAction; handled: boolean } {
  const rows = navRows(view)
  const allChips = [...view.chips.cli, ...view.chips.api]
  const hasEffort = view.kind === "models" && view.efforts.length > 0
  const same = { state, handled: false }
  switch (key.key) {
    case "Escape":
      return { state, action: { type: "close" }, handled: true }
    case "Tab": {
      if (!hasEffort) return same
      const zone = key.shiftKey ? "list" : state.zone === "list" ? "effort" : "list"
      return { state: { ...state, zone }, handled: true }
    }
    case "ArrowLeft":
    case "ArrowRight": {
      const dir = key.key === "ArrowRight" ? 1 : -1
      if (state.zone === "effort" && hasEffort) {
        const at = view.efforts.indexOf(view.effort ?? (view.efforts[0] as EffortLevel))
        const next = view.efforts[Math.max(0, Math.min(view.efforts.length - 1, at + dir))]
        if (!next || next === view.effort) return { state, handled: true }
        return { state, action: { type: "effort", level: next }, handled: true }
      }
      if (state.query !== "" || allChips.length < 2) return same
      const at = allChips.findIndex((c) => c.selected)
      const next = allChips[(at + dir + allChips.length) % allChips.length]
      if (!next) return same
      return {
        state: { ...state, provider: next.provider, active: -1, zone: "list" },
        handled: true,
      }
    }
    case "ArrowDown":
    case "ArrowUp": {
      if (rows.length === 0) return { state, handled: true }
      const dir = key.key === "ArrowDown" ? 1 : -1
      const from = state.zone === "effort" ? rows.length : state.active
      const next =
        from < 0
          ? dir > 0
            ? 0
            : rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, from + dir))
      return { state: { ...state, active: next, zone: "list" }, handled: true }
    }
    case "Enter": {
      if (view.kind === "signed-out" && state.active < 0)
        return { state, action: { type: "sign-in" }, handled: true }
      const row = rows[state.active >= 0 ? state.active : 0]
      if (!row) return { state, handled: true }
      return {
        state,
        action: { type: "pick", selection: { provider: row.provider, model: row.model } },
        handled: true,
      }
    }
    default:
      return same
  }
}

/** Board 39 Recent: `pick` first, then the earlier picks, distinct, at most `max`. */
export function pushRecent(
  list: readonly ModelSelection[],
  pick: ModelSelection,
  max = 2,
): ModelSelection[] {
  return [
    { provider: pick.provider, model: pick.model },
    ...list.filter((s) => s.provider !== pick.provider || s.model !== pick.model),
  ].slice(0, max)
}
