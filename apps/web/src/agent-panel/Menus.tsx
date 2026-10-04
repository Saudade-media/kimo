/**
 * The composer's menus (board 22): Model Menu (C, XxdJv), Skills Menu (D, e2cwq) and Mode Menu
 * (ZFOQf, d5X1eG). Each sits just above the composer: the model menu right-aligned to it
 * (280 wide, 4 px gap), the skills menu as wide as the composer (4 px gap), the mode menu as
 * wide as the composer (6 px gap, the "Stack" of the vignette).
 */
import type { ModelSelection, ThinkingMode } from "@kimo/ai-agent"
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
import { ChevronDown, FolderOpen, Minus, Plus, Settings2 } from "lucide-react"
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react"
import type { AgentPanelControllerExt, AgentPanelViewState } from "./controller"
import { modelLabel } from "./format"

/** The shared floating frame (Menu/Dense geometry: bg-overlay, radius-lg, shadow 0 8 24). */
function MenuFrame({
  className,
  label,
  children,
  onClose,
  style,
  testId,
}: {
  className: string
  label: string
  children: ReactNode
  onClose(): void
  style?: CSSProperties
  testId: string
}) {
  const root = useRef<HTMLDivElement>(null)
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
      ref={root}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      className={`agent-menu ${className}`}
      style={style}
      onKeyDown={(e) => {
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

const THINKING: { value: ThinkingMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "max", label: "Max" },
]

/** Board 22 C Model Menu (XxdJv). `target` set: picks the model of one split / side-by-side agent. */
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
  return (
    <MenuFrame
      className="agent-menu--model"
      label="Model"
      testId="agent-model-menu"
      onClose={() => controller.openMenu(null)}
    >
      {state.picker.map((g) => (
        <div key={g.provider} className="agent-menu__section" data-provider={g.provider}>
          <GroupHeader
            label={g.label}
            {...(g.isDefault ? { status: "default" } : g.tag ? { status: g.tag } : {})}
          />
          {g.available ? (
            g.models.map((m) => {
              const checked = current?.provider === g.provider && current.model === m.id
              return (
                <MenuItemDense
                  key={m.id}
                  label={m.label}
                  checked={checked}
                  {...(m.role ? { meta: m.role } : {})}
                  data-model={m.id}
                  onSelect={() => pick({ provider: g.provider, model: m.id })}
                />
              )
            })
          ) : (
            <MenuItemDense
              label={
                g.family === "cli"
                  ? `Sign in to use ${g.label}…`
                  : `Add a key to use ${g.label.replace(/^Google /, "")}…`
              }
              className="agent-menu__add"
              onSelect={() => onManage?.()}
            />
          )}
        </div>
      ))}
      {state.composer.thinkingAvailable && target == null && (
        <>
          <MenuDivider />
          <div className="agent-menu__effort">
            <span className="agent-menu__effort-label">Thinking</span>
            <span className="agent-menu__spacer" aria-hidden="true" />
            <SegmentedText
              className="agent-seg-sm"
              label="Thinking"
              options={THINKING}
              value={state.composer.thinking}
              onChange={(v) => controller.setThinking(v)}
            />
          </div>
        </>
      )}
      <MenuDivider />
      <MenuItemDense
        label="Manage providers…"
        icon={<Settings2 />}
        meta="⌘,"
        className="agent-menu__manage"
        onSelect={() => {
          controller.openMenu(null)
          onManage?.()
        }}
      />
    </MenuFrame>
  )
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
  const filter = state.composer.slash?.filter ?? ""
  const match = (n: string) => !filter || n.includes(filter)
  const enabled = new Set(state.skills.enabled)
  const builtin = state.skills.builtin.filter((s) => match(s.name))
  const user = state.skills.user.filter((s) => match(s.name))
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
