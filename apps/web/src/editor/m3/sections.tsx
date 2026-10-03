/**
 * Right panel M3 sections (PropSection `fWrGA` instances):
 * - Instance (board 11 `GKEMZ`): Component Row (chip + Go to main) · Actions Row (Swap /
 *   Detach / Reset) · Overrides Summary → Overrides popover; header `ellipsis` → Instance Menu.
 * - Properties (board 11 `EituC`): InstancePropRows in `declaredProps` order.
 * - Theme (boards 11/13/14 `nLE5p`): ThemePinRows + Effective.
 * - Component (board 12 `SZCqE`): Name · Description (`kimo.component.description`) · Props
 *   header (+ Add prop) · PropDefRows (+ enum Options). Derived: Derived Row (`XJ8Uy`).
 * - Slot (board 12 `noppX`): toggle · help · Expose as prop · Suggested list · Add suggestion.
 */
import {
  axisDisplayOrder,
  COMPONENT_DESCRIPTION_META_KEY,
  type DeclaredProp,
  declaredProps,
  isRef,
  type KimoDocument,
  splitQualified,
  type Variable,
} from "@kimo/core-schema"
import {
  InstancePropRow,
  OverrideDot,
  PropDefRow,
  PropOptions,
  PropSection,
  PropTextField,
  type PropType,
  ThemePinRow,
  Toggle,
} from "@kimo/ui"
import { Fragment, useRef, useState } from "react"
import { Icon } from "../../lib/icons"
import { detachInstance, goToMain, entriesOf as overrideList, setSlotOff } from "./actions"
import { type M3Controller, useBusValue } from "./controller"
import { AddPropMenu, InstanceMenu, TargetMenu } from "./menus"
import { componentName, listComponents, nameOf, propsOfInstance, summaryText } from "./model"
import { OverridesPopover, SwapPopover } from "./popovers"
import { M3Button, M3IconButton, SuggestedRow } from "./ui"

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

/** Board 09 placement: popovers open left of the 280 panel, 8 px gap. */
function leftOfPanel(anchor: HTMLElement | null) {
  const panel = anchor?.closest(".right-panel")
  const inset =
    anchor && panel ? anchor.getBoundingClientRect().left - panel.getBoundingClientRect().left : 0
  return { side: "left" as const, align: "start" as const, offset: inset + 8, flip: false }
}

// --- Instance -----------------------------------------------------------------------------------

export function InstanceSection({ m3, id }: { m3: M3Controller; id: string }) {
  const view = m3.view()
  const n = view.getNode(id)
  const origin = view.origin(id)
  const of = String(origin?.instance?.of ?? n?.of ?? "")
  const real = !view.isVirtual(id)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [swap, setSwap] = useState<HTMLElement | null>(null)
  const [overrides, setOverrides] = useState<HTMLElement | null>(null)
  const header = useRef<HTMLElement>(null)
  const { alias } = splitQualified(of)
  const entries = real ? overrideList(m3, id) : []
  return (
    <PropSection
      ref={header}
      title="Instance"
      className="m3-instance-section"
      data-testid="instance-section"
      action={{
        label: "Instance menu",
        icon: <Icon name="ellipsis" size={14} />,
        onClick: (e) => setMenu(menu ? null : e.currentTarget),
      }}
    >
      <div className="rp-body">
        <div className="m3-component-row">
          <span className="m3-component-chip">
            <span className="m3-component-chip__glyph">
              <Icon name="component" size={12} />
            </span>
            <span className="m3-component-chip__name">
              {componentName(m3.doc(), m3.libraries(), of)}
            </span>
            <span className="m3-component-chip__spacer" />
            <span className="m3-component-chip__source">{alias ?? "local"}</span>
          </span>
          <M3IconButton
            icon="arrow-up-right"
            label="Go to main component"
            size={28}
            className="m3-go-main"
            onClick={() => goToMain(m3, id)}
          />
        </div>
        {real && (
          <div className="m3-actions-row">
            <M3Button
              variant="secondary"
              icon="repeat"
              iconSize={13}
              className="m3-action-pill"
              onClick={(e) => setSwap(swap ? null : e.currentTarget)}
            >
              Swap
            </M3Button>
            <M3Button
              variant="secondary"
              icon="unlink"
              iconSize={13}
              className="m3-action-pill"
              onClick={() => void detachInstance(m3, id)}
            >
              Detach
            </M3Button>
            <M3Button
              variant="secondary"
              icon="rotate-ccw"
              iconSize={13}
              className="m3-action-pill"
              disabled={entries.length === 0}
              onClick={() =>
                m3.run({ cmd: "resetAllOverrides", instance: id }, "Reset all overrides")
              }
            >
              Reset
            </M3Button>
          </div>
        )}
        {real && (
          <button
            type="button"
            className="m3-overrides-summary"
            data-testid="overrides-summary"
            onClick={(e) => setOverrides(overrides ? null : e.currentTarget)}
          >
            <OverrideDot visible={entries.length > 0} />
            <span className="m3-overrides-summary__breakdown">{summaryText(entries)}</span>
            <span className="m3-overrides-summary__spacer" />
            <span className="m3-overrides-summary__open">
              <Icon name="chevron-right" size={12} />
            </span>
          </button>
        )}
      </div>
      {menu && (
        <InstanceMenu
          m3={m3}
          id={id}
          anchor={menu}
          placement={leftOfPanel(menu)}
          onClose={() => setMenu(null)}
        />
      )}
      {swap && (
        <SwapPopover
          m3={m3}
          instance={id}
          anchor={swap}
          placement={leftOfPanel(swap)}
          onClose={() => setSwap(null)}
        />
      )}
      {overrides && (
        <OverridesPopover
          m3={m3}
          instance={id}
          anchor={overrides}
          placement={leftOfPanel(overrides)}
          onClose={() => setOverrides(null)}
        />
      )}
    </PropSection>
  )
}

/** Properties (board 11 `EituC`): one InstancePropRow per declared prop. */
export function PropertiesSection({ m3, id }: { m3: M3Controller; id: string }) {
  const view = m3.view()
  const store = m3.session.store
  const n = store.getNode(id)
  const of = String(n?.of ?? "")
  const props = propsOfInstance(m3.doc(), m3.libraries(), of)
  const [swapFor, setSwapFor] = useState<{ prop: string; anchor: HTMLElement } | null>(null)
  if (!n || props.length === 0) return null
  const args = isObj(n.args) ? n.args : {}
  const slotPath = (p: DeclaredProp) => p.path
  return (
    <PropSection
      title="Properties"
      data-testid="properties-section"
      action={{
        label: "Edit component props",
        icon: <Icon name="settings-2" size={14} />,
        onClick: () => goToMain(m3, id),
      }}
    >
      <div className="rp-body">
        {props.map((p) => {
          const def = p.def as unknown as Rec
          const type = def.type as PropType
          const set = Object.hasOwn(args, p.name)
          const targetId = p.path === "" ? id : `${id}/${p.path}`
          const target = view.getNode(targetId)
          let value: unknown
          if (type === "text") value = set ? args[p.name] : target?.content
          else if (type === "boolean") value = set ? args[p.name] : target?.visible !== false
          else if (type === "enum") value = set ? args[p.name] : null
          else if (type === "instance")
            // The expanded nested instance carries no `of`; its provenance does (swaps
            // included). The declared default is the last resort.
            value = set ? args[p.name] : view.origin(targetId)?.instance?.of || def.default
          const slotOverride = isObj(n.overrides) ? n.overrides[slotPath(p)] : undefined
          const slotSet = type === "slot" && isObj(slotOverride) && slotOverride.slot === true
          const slotCount = slotSet ? store.children(id, slotPath(p)).length : undefined
          return (
            <InstancePropRow
              key={p.name}
              data-prop={p.name}
              prop={{ name: p.name, type }}
              overridden={type === "slot" ? slotSet : set}
              value={
                type === "instance"
                  ? typeof value === "string"
                    ? componentName(m3.doc(), m3.libraries(), value)
                    : undefined
                  : typeof value === "string" || typeof value === "boolean"
                    ? value
                    : undefined
              }
              options={isObj(def.options) ? Object.keys(def.options) : undefined}
              slotCount={slotCount}
              mainValue={
                type === "text" && typeof def.default === "string" ? def.default : undefined
              }
              onChange={(v) =>
                m3.run({ cmd: "setArgs", instance: id, args: { [p.name]: v } }, `Set ${p.name}`)
              }
              onReset={() =>
                type === "slot"
                  ? m3.run(
                      { cmd: "resetOverride", instance: id, path: slotPath(p) },
                      `Reset ${p.name}`,
                    )
                  : m3.run(
                      { cmd: "setArgs", instance: id, args: { [p.name]: undefined } },
                      `Reset ${p.name}`,
                    )
              }
              onSwap={(anchor) => setSwapFor({ prop: p.name, anchor })}
              onSelectContent={() =>
                m3.session.ui.getState().select(store.children(id, slotPath(p)))
              }
              onClearContent={() => {
                // "Clear" keeps the slot override but empties it (ADR 0011).
                const owned = store.children(id, slotPath(p))
                if (slotSet && owned.length)
                  m3.session.apply(
                    owned.map((o) => ({ op: "delete" as const, id: o })),
                    `Clear ${p.name}`,
                  )
                else
                  m3.run(
                    {
                      cmd: "setOverride",
                      instance: id,
                      path: slotPath(p),
                      change: { kind: "slot" },
                    },
                    `Clear ${p.name}`,
                  )
              }}
            />
          )
        })}
      </div>
      {swapFor && (
        <SwapPopover
          m3={m3}
          instance={id}
          anchor={swapFor.anchor}
          placement={leftOfPanel(swapFor.anchor)}
          title={`Swap ${swapFor.prop}`}
          onPick={(of2) => {
            m3.run(
              { cmd: "setArgs", instance: id, args: { [swapFor.prop]: of2 } },
              `Set ${swapFor.prop}`,
            )
            setSwapFor(null)
          }}
          onClose={() => setSwapFor(null)}
        />
      )}
    </PropSection>
  )
}

// --- Theme ----------------------------------------------------------------------------------------

/**
 * Theme section: pins on real nodes (`setThemePin`) or, inside an instance, a `theme` set
 * override. `+` pins the next unpinned axis to its effective value.
 */
export function ThemeSection({ m3, id }: { m3: M3Controller; id: string }) {
  useBusValue(m3.rev)
  const view = m3.view()
  const doc = m3.doc() as KimoDocument
  const libs = m3.libraries()
  const n = view.getNode(id)
  const virtual = view.isVirtual(id)
  const effective = view.theme(id)
  const pins: Record<string, string> = isObj(n?.theme) ? (n.theme as Record<string, string>) : {}
  const local = (doc.themes ?? {}) as Record<string, string[]>
  // Display order: `kimo.themes.order` (declaration order kept by the axis planners), then
  // each linked library's axes.
  const axes: { key: string; values: string[] }[] = [
    ...axisDisplayOrder(doc).map((k) => ({ key: k, values: local[k] ?? [] })),
    ...Object.entries(libs).flatMap(([alias, lib]) =>
      Object.entries((lib.themes ?? {}) as Record<string, string[]>).map(([k, v]) => ({
        key: `${alias}:${k}`,
        values: v,
      })),
    ),
  ]
  // Board 14 `nLE5p`: a node with pins lists every axis (unpinned ones read Inherit); without
  // pins only `mode` (plus the axes added with `+`).
  const pinned = Object.keys(pins).length > 0
  const shown = axes.filter((a) => pinned || Object.hasOwn(pins, a.key) || a.key === "mode")
  const [extra, setExtra] = useState<string[]>([])
  const rows = axes.filter((a) => shown.includes(a) || extra.includes(a.key))
  const set = (axis: string, value: string | null) => {
    const loc = view.locate(id)
    if (virtual && loc?.instance && loc.path !== undefined) {
      const next = { ...pins }
      if (value === null) delete next[axis]
      else next[axis] = value
      m3.run(
        {
          cmd: "setOverride",
          instance: loc.instance,
          path: loc.path,
          change: { kind: "set", set: { theme: Object.keys(next).length ? next : undefined } },
        },
        value === null ? "Inherit theme" : "Pin theme",
      )
    } else
      m3.run(
        { cmd: "setThemePin", node: id, axis, value },
        value === null ? "Inherit theme" : "Pin theme",
      )
  }
  const nextAxis = axes.find((a) => !rows.includes(a))
  if (axes.length === 0) return null
  return (
    <PropSection
      title="Theme"
      data-testid="theme-section"
      action={
        nextAxis
          ? {
              label: "Pin another axis",
              icon: <Icon name="plus" size={14} />,
              onClick: () => setExtra((e) => [...e, nextAxis.key]),
            }
          : undefined
      }
    >
      <div className="rp-body">
        {rows.map((a) => (
          <ThemePinRow
            key={a.key}
            axis={a.key}
            values={a.values}
            pinned={Object.hasOwn(pins, a.key) ? (pins[a.key] as string) : null}
            inherited={inheritedValue(view, id, a.key, a.values)}
            onChange={(v) => set(a.key, v)}
          />
        ))}
        <div className="m3-effective">
          <span className="m3-effective__icon">
            <Icon name="git-merge" size={12} />
          </span>
          <span className="m3-effective__text">
            {`effective  ${axes
              .filter((a) => effective[a.key] !== undefined)
              .map((a) => `${a.key}=${effective[a.key]}`)
              .join(" · ")}`}
          </span>
        </div>
      </div>
    </PropSection>
  )
}

function inheritedValue(
  view: ReturnType<M3Controller["view"]>,
  id: string,
  axis: string,
  values: readonly string[],
): string {
  const parent = view.getNode(id)?.parent
  if (typeof parent === "string") {
    const v = view.theme(parent)[axis]
    if (v) return v
  }
  return values[0] ?? ""
}

// --- Component (main) -----------------------------------------------------------------------------

const FIELD_OF: Record<string, string> = { text: "content", boolean: "visible" }

/**
 * The Default field of a PropDefRow: none for enum (§9.6: enum props have no default) and slot
 * props (board 12 `NqtqB`: no Default field); an instance default shows the component name.
 */
function propDefault(
  type: PropType,
  value: unknown,
  name: (qid: string) => string,
): string | undefined {
  if (type === "enum" || type === "slot") return undefined
  if (value === undefined) return ""
  if (type === "instance" && typeof value === "string") return name(value)
  return String(value)
}

export function ComponentSection({ m3, id }: { m3: M3Controller; id: string }) {
  const store = m3.session.store
  const n = store.getNode(id)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [targetFor, setTargetFor] = useState<{ prop: string; anchor: HTMLElement } | null>(null)
  const drag = useRef<string | null>(null)
  if (!n?.component) return null
  const doc = m3.doc()
  const props = declaredProps({ doc, libraries: m3.libraries() }, { alias: null, id, node: n })
  const derived = n.type === "instance"
  const meta = isObj(n.meta) ? n.meta : {}
  const description =
    typeof meta[COMPONENT_DESCRIPTION_META_KEY] === "string"
      ? (meta[COMPONENT_DESCRIPTION_META_KEY] as string)
      : ""
  const targetLabel = (p: DeclaredProp) => {
    const def = p.def as unknown as Rec
    const layer =
      p.path === ""
        ? "Root"
        : nameOf(
            m3.view().getNode(derived ? `${id}/${p.path}` : String(def.target)),
            String(def.target),
          )
    const field =
      def.type === "enum"
        ? String(def.field)
        : def.type === "instance"
          ? "of"
          : def.type === "slot"
            ? ""
            : (FIELD_OF[String(def.type)] ?? "")
    return field ? `${layer} · ${field}` : layer
  }
  const counts = {
    inherited: props.filter((p) => p.inherited).length,
    redeclared: props.filter((p) => p.redeclared && !p.inherited).length,
  }
  const addProp = (type: "text" | "boolean" | "enum" | "instance") => {
    const descendants: string[] = []
    const walk = (pid: string) => {
      for (const c of store.children(pid)) {
        descendants.push(c)
        if (store.getNode(c)?.type !== "instance") walk(c)
      }
    }
    walk(id)
    const pick = (pred: (x: Rec) => boolean) =>
      descendants.find((d) => pred(store.getNode(d) as Rec))
    let target: string | undefined
    let def: Rec
    const base = { text: "label", boolean: "show", enum: "size", instance: "icon" }[type]
    const name = freePropName(
      base,
      props.map((p) => p.name),
    )
    if (type === "text") {
      target = pick((x) => x.type === "text")
      if (!target)
        return m3.toast({ tone: "warning", text: "Add a text layer to the component first" })
      def = { type, target, field: "content" }
      const content = store.getNode(target)?.content
      if (typeof content === "string") def.default = content
    } else if (type === "boolean") {
      target = descendants[0]
      if (!target) return m3.toast({ tone: "warning", text: "Add a layer to the component first" })
      def = { type, target, field: "visible", default: true }
    } else if (type === "enum") {
      def = { type, target: id, field: "opacity", options: { full: 1, half: 0.5 } }
    } else {
      target = pick((x) => x.type === "instance")
      if (!target)
        return m3.toast({ tone: "warning", text: "Add an instance layer to the component first" })
      def = { type, target }
      const of = store.getNode(target)?.of
      if (typeof of === "string") def.default = of
    }
    m3.run({ cmd: "declareProp", component: id, name, def: def as never }, "Add prop")
  }
  return (
    <PropSection
      title="Component"
      data-testid="component-section"
      action={{
        label: "Component menu",
        icon: <Icon name="ellipsis" size={14} />,
        onClick: () => undefined,
      }}
    >
      <div className="rp-body">
        {derived ? (
          <div className="m3-derived-row">
            <span className="m3-derived-row__glyph">
              <Icon name="diamond" size={12} />
            </span>
            <span className="m3-derived-row__label">Instance of</span>
            <span className="m3-derived-row__base">
              {componentName(doc, m3.libraries(), String(n.of))}
            </span>
            <span className="m3-derived-row__spacer" />
            <M3IconButton
              icon="arrow-up-right"
              iconSize={14}
              size={20}
              label="Go to base component"
              onClick={() => goToMain(m3, id)}
            />
          </div>
        ) : (
          <div className="rp-field">
            <PropTextField
              prefix="Name"
              inputLabel="Component name"
              value={nameOf(n, "Component")}
              onCommit={(t) => {
                if (t.trim())
                  m3.session.apply(
                    [{ op: "update", id, set: { name: t.trim() } }],
                    "Rename component",
                  )
                return true
              }}
            />
          </div>
        )}
        <div className="m3-description">
          <div className="m3-description__label-row">
            <span className="m3-description__label">Description</span>
            <span className="m3-description__spacer" />
            <span className="m3-description__key">{COMPONENT_DESCRIPTION_META_KEY}</span>
          </div>
          <textarea
            className="m3-description__box"
            aria-label="Component description"
            placeholder="What it's for, where it goes…"
            defaultValue={description}
            key={description}
            rows={2}
            onBlur={(e) => {
              const t = e.currentTarget.value.trim()
              if (t !== description)
                m3.run(
                  { cmd: "setComponentDescription", component: id, text: t || null },
                  "Edit description",
                )
            }}
          />
        </div>
        <div className="m3-props-header">
          <span className="m3-props-header__title">Props</span>
          <span className="m3-props-header__count">
            {derived
              ? `${props.length} · ${counts.inherited} inherited · ${counts.redeclared} redeclared`
              : props.length}
          </span>
          <span className="m3-props-header__spacer" />
          <M3IconButton
            icon="plus"
            label="Add prop"
            size={24}
            iconSize={14}
            className="m3-add-prop"
            onClick={(e) => setMenu(menu ? null : e.currentTarget)}
          />
        </div>
        <div className="m3-props-list">
          {props.map((p) => {
            const def = p.def as unknown as Rec
            const type = def.type as PropType
            const options = isObj(def.options)
              ? Object.entries(def.options).map(([k, v]) => ({ name: k, value: optionText(v) }))
              : undefined
            const state = p.inherited ? "inherited" : p.redeclared ? "redeclared" : "own"
            return (
              <Fragment key={p.name}>
                <PropDefRow
                  name={p.name}
                  type={type}
                  target={targetLabel(p)}
                  defaultValue={propDefault(type, def.default, (q) =>
                    componentName(doc, m3.libraries(), q),
                  )}
                  state={state}
                  data-prop={p.name}
                  onRename={(to) =>
                    m3.run(
                      { cmd: "updateProp", component: id, name: p.name, patch: { rename: to } },
                      "Rename prop",
                    )
                  }
                  onTypeChange={(t) => {
                    if (t === type) return
                    if (t === "slot")
                      return m3.toast({
                        tone: "warning",
                        text: "Slots are marked on a frame (Slot section)",
                      })
                    m3.run({ cmd: "removeProp", component: id, name: p.name }, "Change prop type")
                    addProp(t)
                  }}
                  onPickTarget={() => {
                    const el = document.querySelector<HTMLElement>(
                      `[data-testid="component-section"] [data-prop="${CSS.escape(p.name)}"]`,
                    )
                    if (el) setTargetFor({ prop: p.name, anchor: el })
                  }}
                  onDefaultCommit={(v) => {
                    // Instance defaults show the component name; write the QId it names.
                    const next =
                      type === "boolean"
                        ? v.trim() === "true"
                        : type === "instance"
                          ? (listComponents(doc, m3.libraries(), null).find(
                              (c) => c.name === v.trim() || c.qid === v.trim(),
                            )?.qid ?? v)
                          : v
                    m3.run(
                      {
                        cmd: "updateProp",
                        component: id,
                        name: p.name,
                        patch: { default: v === "" ? undefined : next },
                      },
                      "Set prop default",
                    )
                  }}
                  onRemove={() =>
                    m3.run({ cmd: "removeProp", component: id, name: p.name }, "Remove prop")
                  }
                  dragHandleProps={
                    p.inherited
                      ? undefined
                      : {
                          draggable: true,
                          onDragStart: () => {
                            drag.current = p.name
                          },
                        }
                  }
                  onDragOver={(e) => {
                    if (drag.current) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = drag.current
                    drag.current = null
                    if (from && from !== p.name)
                      m3.run(
                        { cmd: "reorderProp", component: id, name: from, before: p.name },
                        "Reorder props",
                      )
                  }}
                />
                {type === "enum" && (
                  <PropOptions
                    field={String(def.field)}
                    options={options ?? []}
                    readOnly={p.inherited}
                    data-options={p.name}
                    onAddOption={() => {
                      const opts = isObj(def.options) ? def.options : {}
                      const k = freePropName("option", Object.keys(opts))
                      m3.run(
                        {
                          cmd: "updateProp",
                          component: id,
                          name: p.name,
                          patch: { options: { ...opts, [k]: Object.values(opts)[0] ?? 0 } },
                        },
                        "Add option",
                      )
                    }}
                    onOptionChange={(i, o) => {
                      const entries = Object.entries(isObj(def.options) ? def.options : {})
                      if (o === null) {
                        if (entries.length <= 1) return
                        entries.splice(i, 1)
                      } else entries[i] = [o.name, parseOption(o.value)]
                      m3.run(
                        {
                          cmd: "updateProp",
                          component: id,
                          name: p.name,
                          patch: { options: Object.fromEntries(entries) },
                        },
                        "Edit option",
                      )
                    }}
                  />
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
      {menu && <AddPropMenu anchor={menu} onPick={addProp} onClose={() => setMenu(null)} />}
      {targetFor && (
        <TargetMenu
          m3={m3}
          component={id}
          anchor={targetFor.anchor}
          onPick={(t) =>
            m3.run(
              { cmd: "updateProp", component: id, name: targetFor.prop, patch: { target: t } },
              "Set prop target",
            )
          }
          onClose={() => setTargetFor(null)}
        />
      )}
    </PropSection>
  )
}

function freePropName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let i = 2; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`
}

/** Enum option values display: arrays joined with spaces ("8 16"). */
export function optionText(v: unknown): string {
  if (Array.isArray(v)) return v.join(" ")
  if (isRef(v)) return `{${v.$ref}}`
  return typeof v === "string" ? v : JSON.stringify(v)
}

/** Parses an option value: "8 16" → [8, 16], "12" → 12, JSON, else the text. */
export function parseOption(text: string): unknown {
  const t = text.trim()
  if (/^-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?)+$/.test(t)) return t.split(/\s+/).map(Number)
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  try {
    return JSON.parse(t)
  } catch {
    return t
  }
}

// --- Slot -----------------------------------------------------------------------------------------

export function SlotSection({ m3, id }: { m3: M3Controller; id: string }) {
  const store = m3.session.store
  const n = store.getNode(id)
  const [add, setAdd] = useState<HTMLElement | null>(null)
  if (n?.type !== "frame") return null
  const doc = m3.doc()
  // The enclosing main (slots are frames inside a component).
  let main: string | null = null
  for (let cur: unknown = id; typeof cur === "string"; cur = store.getNode(cur)?.parent) {
    if (store.getNode(cur)?.component) {
      main = cur
      break
    }
  }
  if (!main || main === id) return null
  const slot = isObj(n.slot) ? n.slot : null
  const suggested = slot && Array.isArray(slot.suggested) ? (slot.suggested as string[]) : []
  const mainNode = store.getNode(main)
  const props = mainNode
    ? declaredProps({ doc, libraries: m3.libraries() }, { alias: null, id: main, node: mainNode })
    : []
  const exposed = props.find(
    (p) => (p.def as unknown as Rec).type === "slot" && (p.def as unknown as Rec).target === id,
  )
  const propName =
    exposed?.name ??
    nameOf(n)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "") ??
    "content"
  return (
    <PropSection
      title={
        <span className="m3-slot-header">
          Slot
          <span className="m3-slot-header__spacer" />
          <Toggle
            label="Slot"
            checked={!!slot}
            onChange={(on) =>
              on
                ? m3.run({ cmd: "setSlot", frame: id, slot: {} }, "Make slot")
                : void setSlotOff(m3, id)
            }
          />
        </span>
      }
      className="m3-slot-section"
      data-testid="slot-section"
    >
      {slot && (
        <div className="rp-body">
          <p className="m3-slot-help">
            Instances can replace this frame's children. Suggestions are advisory — any layer can go
            in.
          </p>
          <div className="m3-expose-row">
            <span className="m3-expose-row__label">Expose as prop</span>
            <span className="m3-expose-row__spacer" />
            <span className="m3-expose-row__prop">{propName}</span>
            <Toggle
              label="Expose as prop"
              checked={!!exposed}
              onChange={(on) =>
                on
                  ? m3.run(
                      {
                        cmd: "declareProp",
                        component: main as string,
                        name: propName || "content",
                        def: { type: "slot", target: id } as never,
                      },
                      "Expose slot",
                    )
                  : exposed &&
                    m3.run(
                      { cmd: "removeProp", component: main as string, name: exposed.name },
                      "Unexpose slot",
                    )
              }
            />
          </div>
          <div className="m3-suggested-header">
            <span className="m3-suggested-header__title">Suggested</span>
            <span className="m3-suggested-header__count">{suggested.length}</span>
          </div>
          <div className="m3-suggested-list">
            {suggested.map((q) => (
              <SuggestedRow
                key={q}
                name={componentName(doc, m3.libraries(), q)}
                indent={8}
                className="m3-suggested-row"
                trailing={
                  <M3IconButton
                    icon="x"
                    iconSize={12}
                    size={20}
                    label={`Remove ${q}`}
                    onClick={() =>
                      m3.run(
                        {
                          cmd: "setSlot",
                          frame: id,
                          slot: { suggested: suggested.filter((s) => s !== q) },
                        },
                        "Remove suggestion",
                      )
                    }
                  />
                }
              />
            ))}
          </div>
          <M3Button
            variant="ghost"
            icon="plus"
            className="m3-add-suggestion"
            onClick={(e) => setAdd(add ? null : e.currentTarget)}
          >
            Add suggestion
          </M3Button>
        </div>
      )}
      {add && (
        <SwapPopover
          m3={m3}
          instance={id}
          anchor={add}
          placement={leftOfPanel(add)}
          title="Suggest a component"
          onPick={(of) => {
            setAdd(null)
            if (!suggested.includes(of))
              m3.run(
                { cmd: "setSlot", frame: id, slot: { suggested: [...suggested, of] } },
                "Add suggestion",
              )
          }}
          onClose={() => setAdd(null)}
        />
      )}
    </PropSection>
  )
}

/** Variables for `Variable` import (keeps the type import used). */
export type { Variable }
