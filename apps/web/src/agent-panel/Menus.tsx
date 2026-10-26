/**
 * The composer's menus: the Model chooser (board 39 qNrfY, which replaced board 22 C XxdJv),
 * Skills Menu (board 22 D, e2cwq) and Mode Menu (ZFOQf, d5X1eG). Each sits just above the
 * composer: the model chooser right-aligned to it (304 wide, 4 px gap), the skills menu as wide
 * as the composer (4 px gap), the mode menu as wide as the composer (6 px gap, the "Stack" of
 * the vignette). The "…" menu (board 40 d5ZDH) sits 4 above the composer on its left edge, 232
 * wide.
 */
import type { EffortLevel, ModelSelection } from "@kimo/ai-agent"
import {
  AgentMark,
  CompactButton,
  MenuDivider,
  MenuItemDense,
  ModeOption,
  type Persona,
  personaVar,
  SegmentedText,
  Select,
  SkillRow,
} from "@kimo/ui"
import {
  BookOpen,
  ChevronDown,
  FolderOpen,
  Globe,
  GlobeLock,
  GlobeX,
  Minus,
  Plug,
  Plus,
  Search,
  Shield,
  ShieldCheck,
} from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react"
import type { AgentPanelControllerExt, AgentPanelViewState } from "./controller"
import { modelLabel } from "./format"
import {
  type ChooserChip,
  type ChooserRow,
  type ChooserState,
  chooserKey,
  chooserView,
  initialActive,
  navRows,
} from "./model-chooser"

/** The shared floating frame (Menu/Dense geometry: bg-overlay, radius-lg, shadow 0 8 24). */
function MenuFrame({
  className,
  label,
  children,
  onClose,
  onKeyDown,
  rootRef,
  style,
  testId,
  ...data
}: {
  className: string
  label: string
  children: ReactNode
  onClose(): void
  /** Runs first; a handled key (defaultPrevented) skips the frame's own Escape. */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  rootRef?: RefObject<HTMLDivElement | null>
  style?: CSSProperties
  testId: string
} & { [k: `data-${string}`]: string | undefined }) {
  const own = useRef<HTMLDivElement>(null)
  const root = rootRef ?? own
  // biome-ignore lint/correctness/useExhaustiveDependencies: `root` is a ref (stable).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || root.current?.contains(t)) return
      if (t.closest("[data-agent-menu-anchor], .kimo-menu-dense, [role=listbox]")) return
      onClose()
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => document.removeEventListener("pointerdown", onDown, true)
  }, [onClose])
  return (
    <div
      {...data}
      ref={root}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      className={`agent-menu ${className}`}
      style={style}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {children}
    </div>
  )
}

function GroupHeader({ label, status, mono }: { label: string; status?: string; mono?: boolean }) {
  return (
    <div className="agent-menu__group">
      <span className="agent-menu__group-label">{label}</span>
      <span className="agent-menu__spacer" aria-hidden="true" />
      {status != null && (
        <span
          className={
            mono
              ? "agent-menu__group-status agent-menu__group-status--mono"
              : "agent-menu__group-status"
          }
        >
          {status}
        </span>
      )}
    </div>
  )
}

/** Built-in skill descriptors as the menu shows them (board 22 D Ot3uN / aBJ0n / LqD4Z). */
const BUILTIN_SOURCE: Record<string, string> = {
  "kimo-design": "schema, ops, layout rules",
  "kimo-layout": "auto layout & responsive",
  "kimo-tokens": "variables & themes",
}

const EFFORT_LABEL: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
}

const isPrintable = (e: KeyboardEvent) =>
  e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey

/**
 * Board 39 Model chooser (desing.pen qNrfY, VlWzE): Recent › provider chips › the provider's
 * models › Effort › "Connect a provider…". 304 wide, right-aligned above the composer.
 * `target` set: picks the model of one split / side-by-side agent (no Effort row).
 */
export function ModelMenu({
  controller,
  state,
  target,
  onManage,
}: {
  controller: AgentPanelControllerExt
  state: AgentPanelViewState
  target?: number | null
  onManage?: () => void
}) {
  const current =
    target != null && Array.isArray(state.composer.mode.models)
      ? (state.composer.mode.models[target] ?? state.composer.model)
      : state.composer.model
  const [cs, setCs] = useState<ChooserState>({
    provider: null,
    query: "",
    active: -1,
    zone: "list",
  })
  const [detail, setDetail] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const view = chooserView({
    groups: state.picker,
    current,
    recent: state.recentModels,
    effort: state.composer.thinking,
    effortHidden: target != null,
    state: cs,
  })
  const rows = navRows(view)

  const pick = (sel: ModelSelection) => {
    if (target != null) {
      const n = state.composer.mode.agents
      const base = state.composer.model as ModelSelection
      const models = Array.isArray(state.composer.mode.models)
        ? [...state.composer.mode.models]
        : Array.from({ length: n }, () => base)
      models[target] = sel
      controller.setMode({ ...state.composer.mode, models })
      controller.openMenu(null)
    } else controller.setModel(sel)
  }
  const manage = () => {
    controller.openMenu(null)
    onManage?.()
  }

  // Focus the field when there is one (type to filter), else the menu (keys work at once).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the field appears.
  useEffect(() => {
    ;(search.current ?? root.current)?.focus({ preventScroll: true })
  }, [view.showSearch])

  const focusRow = (key: string | undefined) => {
    if (!key) return
    root.current
      ?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)
      ?.focus({ preventScroll: false })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    if (isPrintable(e) && view.showSearch && e.target !== search.current) {
      // Type to filter from anywhere in the menu.
      e.preventDefault()
      setCs((s) => ({ ...s, query: s.query + e.key, active: -1, zone: "list" }))
      search.current?.focus()
      return
    }
    const active = cs.active >= 0 ? cs.active : initialActive(view)
    const r = chooserKey({ ...cs, active }, { key: e.key, shiftKey: e.shiftKey }, view)
    if (!r.handled) return
    e.preventDefault()
    e.stopPropagation()
    setCs(r.state)
    const a = r.action
    if (a?.type === "close") controller.openMenu(null)
    else if (a?.type === "pick") pick(a.selection)
    else if (a?.type === "effort") controller.setThinking(a.level)
    else if (a?.type === "sign-in") manage()
    if (e.key === "ArrowUp" || e.key === "ArrowDown") focusRow(rows[r.state.active]?.key)
    else if (e.key === "Tab")
      (r.state.zone === "effort"
        ? root.current?.querySelector<HTMLElement>(".agent-chooser__effort [aria-checked=true]")
        : (search.current ?? root.current)
      )?.focus()
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (r.state.provider !== cs.provider) setDetail(null)
    }
  }

  const rowItem = (r: ChooserRow, index: number) => (
    <Fragment key={`${index}:${r.key}`}>
      <MenuItemDense
        label={r.label}
        checked={r.checked}
        // Board 39 C (r8UvyD): while typing, the row Enter picks is highlighted.
        highlighted={view.kind === "search" && index === (cs.active >= 0 ? cs.active : 0)}
        {...(r.meta ? { meta: r.meta, metaFont: "sans" as const } : {})}
        data-row-key={r.key}
        data-provider={r.provider}
        data-model={r.model}
        onHighlight={() => {
          setDetail(r.key)
          setCs((s) =>
            s.active === index && s.zone === "list" ? s : { ...s, active: index, zone: "list" },
          )
        }}
        onSelect={() => pick({ provider: r.provider, model: r.model })}
      />
      {detail === r.key && r.detail && (
        <div className="agent-chooser__detail" data-testid="agent-model-detail">
          <span className="agent-chooser__detail-text">{r.detail}</span>
        </div>
      )}
    </Fragment>
  )

  const chip = (c: ChooserChip) => (
    <button
      key={c.provider}
      type="button"
      className={c.selected ? "agent-chooser__chip agent-chooser__chip--on" : "agent-chooser__chip"}
      aria-pressed={c.selected}
      data-provider={c.provider}
      title={c.signedOut ? `${c.label} is signed out` : undefined}
      aria-label={c.signedOut ? `${c.label} (signed out)` : c.label}
      onClick={() => {
        setDetail(null)
        setCs((s) => ({ ...s, provider: c.provider, active: -1, zone: "list" }))
      }}
    >
      {c.signedOut && <span className="agent-chooser__dot" aria-hidden="true" />}
      <span className="agent-chooser__chip-label">{c.label}</span>
    </button>
  )

  return (
    <MenuFrame
      className="agent-menu--model agent-chooser"
      label="Model"
      testId="agent-model-menu"
      rootRef={root}
      onKeyDown={onKeyDown}
      onClose={() => controller.openMenu(null)}
      data-state={view.kind}
    >
      {view.showSearch && (
        <label className="agent-chooser__search">
          <Search className="agent-chooser__search-icon" aria-hidden="true" />
          <input
            ref={search}
            className="agent-chooser__search-input"
            type="text"
            placeholder="Search models"
            aria-label="Search models"
            value={cs.query}
            spellCheck={false}
            onChange={(e) => {
              const query = e.target.value
              setCs((s) => ({ ...s, query, active: -1, zone: "list" }))
            }}
          />
        </label>
      )}
      {view.kind === "search" &&
        (() => {
          let i = 0
          return view.groups.map((g) => (
            <Fragment key={g.provider}>
              <GroupHeader label={g.label} />
              {g.rows.map((r) => rowItem(r, i++))}
            </Fragment>
          ))
        })()}
      {view.kind !== "search" && view.kind !== "empty" && (
        <>
          {view.recent.length > 0 && (
            <>
              <GroupHeader label="Recent" />
              {view.recent.map((r, i) => rowItem(r, i))}
              <MenuDivider />
            </>
          )}
          <div className="agent-chooser__providers">
            {view.chips.cli.length > 0 && (
              <div className="agent-chooser__chip-row">{view.chips.cli.map(chip)}</div>
            )}
            {view.chips.api.length > 0 && (
              <div className="agent-chooser__chip-row">{view.chips.api.map(chip)}</div>
            )}
          </div>
          <MenuDivider />
          {view.kind === "models" && view.rows.map((r, i) => rowItem(r, view.recent.length + i))}
          {view.kind === "signed-out" && view.provider && (
            <>
              <div className="agent-chooser__signed-out">
                <span className="agent-chooser__signed-out-title">
                  {view.provider.label} is signed out
                </span>
              </div>
              <MenuItemDense
                label="Sign in…"
                className="agent-chooser__sign-in"
                onSelect={manage}
              />
            </>
          )}
          {view.efforts.length > 0 && (
            <>
              <MenuDivider />
              <div className="agent-menu__effort agent-chooser__effort">
                <span className="agent-menu__effort-label">Effort</span>
                <span className="agent-menu__spacer" aria-hidden="true" />
                <SegmentedText
                  className="agent-seg-sm"
                  label="Effort"
                  options={view.efforts.map((l) => ({ value: l, label: EFFORT_LABEL[l] }))}
                  value={view.effort ?? "high"}
                  onChange={(v) => controller.setThinking(v)}
                />
              </div>
            </>
          )}
        </>
      )}
      {view.kind === "empty" && (
        <div className="agent-chooser__empty">
          <Plug className="agent-chooser__empty-icon" aria-hidden="true" />
          <span className="agent-chooser__empty-title">No provider connected</span>
          <span className="agent-chooser__empty-hint">Sign in to a CLI or add an API key.</span>
        </div>
      )}
      <MenuDivider />
      <MenuItemDense
        label="Connect a provider…"
        icon={<Plus />}
        meta="⌘,"
        className="agent-menu__manage"
        onSelect={manage}
      />
    </MenuFrame>
  )
}

/**
 * The skills the menu lists for the composer's `/` filter, in menu order (Built-in, then Yours).
 * The composer's Enter / ⌥↵ act on the first of these, so the top row is always the one picked.
 */
export function visibleSkills(state: AgentPanelViewState): { name: string }[] {
  const filter = state.composer.slash?.filter ?? ""
  const match = (n: string) => !filter || n.includes(filter)
  return [...state.skills.builtin, ...state.skills.user].filter((s) => match(s.name))
}

/** Board 22 D Skills Menu (e2cwq): Built-in (MIT) + Yours (~/.kimo/skills), Footer. */
export function SkillsMenu({
  controller,
  state,
  onOpenFolder,
}: {
  controller: AgentPanelControllerExt
  state: AgentPanelViewState
  onOpenFolder?: () => void
}) {
  const enabled = new Set(state.skills.enabled)
  const shown = new Set(visibleSkills(state).map((s) => s.name))
  const builtin = state.skills.builtin.filter((s) => shown.has(s.name))
  const user = state.skills.user.filter((s) => shown.has(s.name))
  return (
    <MenuFrame
      className="agent-menu--skills"
      label="Skills"
      testId="agent-skills-menu"
      onClose={() => controller.openMenu(null)}
    >
      <GroupHeader label="Built-in" status="MIT" mono />
      {builtin.map((s) => (
        <SkillRow
          key={s.name}
          name={s.name}
          source={BUILTIN_SOURCE[s.name] ?? s.description}
          enabled={enabled.has(s.name)}
          onToggle={(on) => controller.toggleSkill(s.name, on)}
          onInsert={() => controller.insertSkill(s.name)}
        />
      ))}
      <GroupHeader label="Yours" status="~/.kimo/skills" mono />
      {user.map((s) => (
        <SkillRow
          key={s.name}
          name={s.name}
          kind="user"
          source={`${s.name}/SKILL.md`}
          enabled={enabled.has(s.name)}
          onToggle={(on) => controller.toggleSkill(s.name, on)}
          onInsert={() => controller.insertSkill(s.name)}
        />
      ))}
      {state.skills.errors.map((e) => (
        <p key={e} className="agent-menu__error">
          {e}
        </p>
      ))}
      <MenuDivider />
      <div className="agent-menu__footer">
        {/* No user skills folder in the browser (platform.skills is desktop only). */}
        {onOpenFolder && (
          <CompactButton
            variant="ghost"
            height={26}
            padX={8}
            icon={<FolderOpen />}
            onClick={() => onOpenFolder()}
          >
            Open skills folder
          </CompactButton>
        )}
        <span className="agent-menu__spacer" aria-hidden="true" />
        <span className="agent-menu__hint">↵ insert · ⌥↵ toggle</span>
      </div>
    </MenuFrame>
  )
}

const MODES = [
  {
    mode: "single" as const,
    name: "Single",
    description: "One agent, scoped to the selection (or the page when nothing is selected).",
  },
  {
    mode: "side-by-side" as const,
    name: "Side by side",
    description: "N agents draft variants next to the original. Each owns one new frame.",
  },
  {
    mode: "split" as const,
    name: "Split",
    description:
      "The lead splits the work into placeholder frames; one agent per frame, in parallel.",
  },
  {
    mode: "iterate" as const,
    name: "Iterate",
    description:
      "Refines the selected frame in place, pass by pass, with a review step between passes.",
  },
]

/** Board 38 reasons, one text-xs line under the blocked Web access row (board 40 F / G). */
const WEB_BLOCK_REASON = {
  privacy: "No third-party fetch is on",
  model: "This model can't use the web",
} as const

const MORE_ITEMS =
  '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])'

/**
 * Board 40 "…" menu (More Menu c79jYX): Menu/Dense 232 › Item · Skills (book-open, meta count) ·
 * Divider · Item · Auto-approve (shield / shield-check warning, Toggle) · Item · Web access
 * (globe / globe-x / globe-lock, Toggle) · Reason when blocked. Opening focuses the first row;
 * ↑ ↓ Home End move, Enter and Space act, Escape closes and hands focus back to "…".
 */
export function MoreMenu({
  state,
  onSkills,
  onAutoApprove,
  onWebAccess,
  onClose,
  onEscape,
}: {
  state: AgentPanelViewState
  onSkills(): void
  onAutoApprove(): void
  onWebAccess(on: boolean): void
  /** Outside press: closes without moving focus. */
  onClose(): void
  /** Escape: closes and returns focus to the "…" button. */
  onEscape(): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const web = state.webAccess
  const blocked = web.disabled
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(MORE_ITEMS)?.focus({ preventScroll: true })
  }, [])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>(MORE_ITEMS) ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      e.preventDefault()
      items[(i + items.length) % items.length]?.focus()
    }
    if (e.key === "ArrowDown") go(at + 1)
    else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1)
    else if (e.key === "Home") go(0)
    else if (e.key === "End") go(-1)
    else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      onEscape()
    } else if (e.key === "Tab") onClose()
  }
  return (
    <MenuFrame
      className="agent-menu--more"
      label="More options"
      testId="agent-more-menu"
      data-pen="c79jYX"
      rootRef={root}
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      <MenuItemDense
        label="Skills"
        icon={<BookOpen />}
        meta={String(state.skills.enabled.length)}
        aria-haspopup="menu"
        data-testid="agent-more-skills"
        onSelect={onSkills}
      />
      <MenuDivider />
      <MenuItemDense
        label="Ask before changes"
        icon={state.autoApprove ? <Shield /> : <ShieldCheck />}
        switchOn={!state.autoApprove}
        data-testid="agent-more-auto"
        onSelect={onAutoApprove}
      />
      <MenuItemDense
        label="Web access"
        icon={blocked === "privacy" ? <GlobeLock /> : web.on && !blocked ? <Globe /> : <GlobeX />}
        switchOn={web.on && !blocked}
        disabled={!!blocked}
        data-testid="agent-more-web"
        data-state={blocked ?? (web.on ? "on" : "off")}
        aria-describedby={blocked ? "agent-more-web-reason" : undefined}
        onSelect={() => onWebAccess(!web.on)}
      />
      {blocked && (
        <p
          id="agent-more-web-reason"
          className="agent-more__reason"
          data-testid="agent-more-reason"
        >
          {WEB_BLOCK_REASON[blocked]}
        </p>
      )}
    </MenuFrame>
  )
}

function Stepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  label: string
  onChange(v: number): void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline stepper, not a form section.
    <span className="agent-stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="agent-stepper__btn"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden="true" />
      </button>
      <span className="agent-stepper__value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="agent-stepper__btn"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus aria-hidden="true" />
      </button>
    </span>
  )
}

/** Board 22 Modes › Mode Menu (d5X1eG): ModeOptions, Divider, config rows. */
export function ModeMenu({
  controller,
  state,
  personaOf,
  onPickAgentModel,
}: {
  controller: AgentPanelControllerExt
  state: AgentPanelViewState
  personaOf(index: number): Persona
  onPickAgentModel(index: number): void
}) {
  const m = state.composer.mode
  const multi = m.mode === "side-by-side" || m.mode === "split"
  const same = m.models === "same"
  const label = state.modelLabel
  return (
    <MenuFrame
      className="agent-menu--mode"
      label="Mode"
      testId="agent-mode-menu"
      onClose={() => controller.openMenu(null)}
    >
      {MODES.map((x) => (
        <ModeOption
          key={x.mode}
          mode={x.mode}
          name={x.name}
          description={x.description}
          checked={m.mode === x.mode}
          onClick={() => controller.setMode({ ...m, mode: x.mode })}
        />
      ))}
      {m.mode !== "single" && <MenuDivider />}
      {multi && (
        <div className="agent-menu__config">
          <span className="agent-menu__config-label">Agents</span>
          <span className="agent-menu__spacer" aria-hidden="true" />
          <Stepper
            label="Agents"
            value={m.agents}
            min={1}
            max={6}
            onChange={(v) =>
              controller.setMode({
                ...m,
                agents: v,
                ...(Array.isArray(m.models)
                  ? {
                      models: Array.from(
                        { length: v },
                        (_, i) =>
                          (m.models as ModelSelection[])[i] ??
                          (state.composer.model as ModelSelection),
                      ),
                    }
                  : {}),
              })
            }
          />
          <span className="agent-menu__cap">max 6</span>
        </div>
      )}
      {m.mode === "iterate" && (
        <div className="agent-menu__config">
          <span className="agent-menu__config-label">Passes</span>
          <span className="agent-menu__spacer" aria-hidden="true" />
          <Stepper
            label="Passes"
            value={m.passes}
            min={1}
            max={9}
            onChange={(v) => controller.setMode({ ...m, passes: v })}
          />
        </div>
      )}
      {multi && (
        <div className="agent-menu__config">
          <span className="agent-menu__config-label">Model per agent</span>
          <span className="agent-menu__spacer" aria-hidden="true" />
          <Select
            dense
            className="agent-menu__select"
            label="Model per agent"
            value={same ? "same" : "per"}
            options={[
              { value: "same", label: `Same · ${label}` },
              { value: "per", label: "Per agent" },
            ]}
            onChange={(v) =>
              controller.setMode({
                ...m,
                models:
                  v === "same"
                    ? "same"
                    : Array.from(
                        { length: m.agents },
                        () => state.composer.model as ModelSelection,
                      ),
              })
            }
          />
        </div>
      )}
      {multi &&
        Array.isArray(m.models) &&
        m.models.map((sel, i) => {
          const p = personaOf(i)
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one row per agent number.
            <div key={i} className="agent-menu__agent-model">
              <span className="agent-menu__agent-label">
                {m.mode === "split" ? "Split" : "Side by side"} · Agent {i + 1}:
              </span>
              <button
                type="button"
                className="agent-persona-chip"
                data-agent-menu-anchor=""
                style={
                  {
                    "--agent-persona": personaVar(p),
                    "--agent-persona-soft": personaVar(p, "soft"),
                  } as CSSProperties
                }
                onClick={() => onPickAgentModel(i)}
              >
                <AgentMark size={12} persona={p} />
                <span className="agent-persona-chip__label">{modelLabel(sel, [])}</span>
                <ChevronDown className="agent-persona-chip__chevron" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      {m.mode === "side-by-side" && (
        <div className="agent-menu__config">
          <span className="agent-menu__config-label">Explore</span>
          <span className="agent-menu__spacer" aria-hidden="true" />
          <SegmentedText
            className="agent-seg-sm"
            label="Explore"
            options={[
              { value: "layout", label: "Layout" },
              { value: "style", label: "Style" },
              { value: "both", label: "Both" },
            ]}
            value={m.explore}
            onChange={(v) => controller.setMode({ ...m, explore: v })}
          />
        </div>
      )}
    </MenuFrame>
  )
}
