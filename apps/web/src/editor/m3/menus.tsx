/**
 * M3 menus (MenuDense `G7A3Aj`; items 28, gap 8, padding [0, 8], icon 14 `text-secondary` in the
 * Check Slot, label sm, meta xs `text-tertiary`): Instance Menu (board 11 `GK5mh`), Instance
 * Child Menu (`aDExV`), Add prop Menu (board 12 `lJC2O`) and the prop target picker.
 */
import { MenuDense, MenuDivider, type PlacementOptions, type PopoverAnchor } from "@kimo/ui"
import { useState } from "react"
import { Icon } from "../../lib/icons"
import { keyHint } from "../kbd"
import {
  componentOfSelection,
  createComponent,
  detachInstance,
  goToMain,
  replaceWithComponent,
  selectAllInstances,
} from "./actions"
import type { M3Controller } from "./controller"
import { nameOf } from "./model"
import { SwapPopover } from "./popovers"

/** A MenuItem/Dense with its design icon (RmOTH in the Check Slot). */
export function M3MenuItem({
  icon,
  label,
  meta,
  danger,
  disabled,
  onSelect,
}: {
  icon: string
  label: string
  meta?: string
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={`kimo-menu-item-dense m3-menu-item${disabled ? " m3-menu-item--disabled" : ""}${danger ? " m3-menu-item--danger" : ""}`}
      onPointerMove={(e) => {
        if (!disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus()
      }}
      onClick={() => {
        if (!disabled) onSelect?.()
      }}
    >
      <span className="kimo-menu-item-dense__check m3-menu-item__icon" aria-hidden="true">
        <Icon name={icon} size={14} />
      </span>
      <span className="kimo-menu-item-dense__label m3-menu-item__label">{label}</span>
      <span className="kimo-menu-item-dense__spacer" aria-hidden="true" />
      {meta != null && <span className="kimo-menu-item-dense__meta">{meta}</span>}
    </button>
  )
}

/** Menu Label (padding [6, 8, 4, 8], xs 600 `text-tertiary`). */
export function MenuLabel({ children }: { children: string }) {
  return <div className="m3-menu-label">{children}</div>
}

/** Instance Menu (board 11 `GK5mh`, 240). */
export function InstanceMenu({
  m3,
  id,
  anchor,
  placement,
  onClose,
}: {
  m3: M3Controller
  id: string
  anchor: PopoverAnchor
  placement?: PlacementOptions
  onClose(): void
}) {
  const [swap, setSwap] = useState(false)
  const view = m3.view()
  const n = view.getNode(id)
  const of = String(n?.of ?? view.origin(id)?.instance?.of ?? "")
  const count = Object.values(
    m3.doc().nodes as Record<string, { type?: string; of?: string }>,
  ).filter((x) => x.type === "instance" && x.of === of).length
  const real = !view.isVirtual(id)
  if (swap)
    return (
      <SwapPopover m3={m3} instance={id} anchor={anchor} placement={placement} onClose={onClose} />
    )
  const run = (f: () => void) => () => {
    onClose()
    f()
  }
  return (
    <MenuDense
      width={240}
      label="Instance"
      anchor={anchor}
      placement={placement}
      onClose={onClose}
      autoFocus
      data-testid="instance-menu"
    >
      <M3MenuItem
        icon="arrow-up-right"
        label="Go to main component"
        meta={keyHint("goToMain", "⌥⏎")}
        onSelect={run(() => goToMain(m3, id))}
      />
      <M3MenuItem
        icon="scan"
        label="Select all instances"
        meta={String(count)}
        onSelect={run(() => selectAllInstances(m3, id))}
      />
      <MenuDivider />
      <M3MenuItem
        icon="component"
        label="Create derived component"
        meta={keyHint("createComponent", "⌥⌘K")}
        disabled={!real || !!n?.component}
        onSelect={run(() => createComponent(m3, [id], null))}
      />
      <M3MenuItem
        icon="repeat"
        label="Swap instance…"
        disabled={!real}
        onSelect={() => setSwap(true)}
      />
      <MenuDivider />
      <M3MenuItem
        icon="rotate-ccw"
        label="Reset all overrides"
        disabled={!real}
        onSelect={run(() =>
          m3.run({ cmd: "resetAllOverrides", instance: id }, "Reset all overrides"),
        )}
      />
      <M3MenuItem
        icon="unlink"
        label="Detach instance"
        meta={keyHint("detachInstance", "⌥⌘B")}
        disabled={!real}
        onSelect={run(() => void detachInstance(m3, id))}
      />
    </MenuDense>
  )
}

/**
 * Instance Child Menu (board 11 `aDExV`, 260): right-click a layer inside an instance (layers
 * panel). Replace with component… opens the swap list; Hide converts delete (board 15).
 */
export function ChildMenu({
  m3,
  id,
  at,
  selection = [],
  onClose,
}: {
  m3: M3Controller
  id: string
  at: { x: number; y: number }
  /** The selection before the right-click: "Replace with selection" uses its component. */
  selection?: readonly string[]
  onClose(): void
}) {
  const [replace, setReplace] = useState(false)
  const view = m3.view()
  const anchor = { x: at.x, y: at.y, width: 0, height: 0 }
  const n = view.getNode(id)
  // A top-level instance row gets the Instance Menu.
  if (!view.isVirtual(id) && n?.type === "instance" && !view.origin(id)?.owned)
    return <InstanceMenu m3={m3} id={id} anchor={anchor} onClose={onClose} />
  const loc = view.locate(id)
  const owned = view.origin(id)?.owned
  const instance = loc?.instance ?? owned?.instance ?? null
  const path = loc?.path ?? owned?.at ?? null
  const top = instance ? view.getNode(instance) : undefined
  const selected = componentOfSelection(m3, selection, id)
  if (replace && instance && path !== null)
    return (
      <SwapPopover
        m3={m3}
        instance={id}
        anchor={anchor}
        title="Replace with component"
        onPick={(of) => {
          onClose()
          replaceWithComponent(m3, loc?.instance ? id : `${instance}/${path}`, of)
        }}
        onClose={onClose}
      />
    )
  const run = (f: () => void) => () => {
    onClose()
    f()
  }
  const name = nameOf(n)
  return (
    <MenuDense
      width={260}
      label="Layer in instance"
      anchor={anchor}
      onClose={onClose}
      autoFocus
      data-testid="child-menu"
    >
      <MenuLabel>{`${name} · in ${nameOf(top)}`}</MenuLabel>
      <M3MenuItem
        icon="replace"
        label="Replace with component…"
        disabled={!instance || path === null || !!owned}
        onSelect={() => setReplace(true)}
      />
      <M3MenuItem
        icon="copy-plus"
        label="Replace with selection"
        disabled={!instance || path === null || !!owned || selected === null}
        onSelect={run(() => {
          if (instance && path !== null && selected)
            replaceWithComponent(m3, loc?.instance ? id : `${instance}/${path}`, selected)
        })}
      />
      <M3MenuItem
        icon="eye-off"
        label="Hide layer"
        meta="⌫"
        disabled={!loc?.instance}
        onSelect={run(() => {
          if (loc?.instance && loc.path !== undefined)
            m3.run({ cmd: "hideInInstance", instance: loc.instance, path: loc.path }, "Hide layer")
        })}
      />
      <MenuDivider />
      <M3MenuItem
        icon="rotate-ccw"
        label={`Reset overrides on ${name}`}
        disabled={!instance || path === null}
        onSelect={run(() => {
          if (instance && path !== null)
            m3.run({ cmd: "resetOverride", instance, path }, `Reset overrides on ${name}`)
        })}
      />
      <M3MenuItem icon="trash-2" label="Delete (not in instances)" disabled />
    </MenuDense>
  )
}

/** Add prop Menu (board 12 `lJC2O`, 200). */
export function AddPropMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: PopoverAnchor
  onPick(type: "text" | "boolean" | "enum" | "instance" | "slot"): void
  onClose(): void
}) {
  const pick = (t: "text" | "boolean" | "enum" | "instance" | "slot") => () => {
    onClose()
    onPick(t)
  }
  return (
    <MenuDense
      width={200}
      label="Add prop"
      anchor={anchor}
      placement={{ side: "bottom", align: "end", offset: 4 }}
      onClose={onClose}
      autoFocus
      data-testid="add-prop-menu"
    >
      <MenuLabel>Add prop</MenuLabel>
      <M3MenuItem icon="type" label="Text" meta="T" onSelect={pick("text")} />
      <M3MenuItem icon="toggle-left" label="Boolean" meta="B" onSelect={pick("boolean")} />
      <M3MenuItem icon="list" label="Enum" meta="E" onSelect={pick("enum")} />
      <M3MenuItem icon="diamond" label="Instance swap" meta="I" onSelect={pick("instance")} />
      <MenuDivider />
      <M3MenuItem icon="square-dashed" label="Slot (mark a frame)" onSelect={pick("slot")} />
    </MenuDense>
  )
}

/** Target picker: the component's root and descendants ("Label · content"). */
export function TargetMenu({
  m3,
  component,
  anchor,
  frames = false,
  onPick,
  onClose,
}: {
  m3: M3Controller
  component: string
  anchor: PopoverAnchor
  /** Slot (mark a frame): list the component's frames only (no Root). */
  frames?: boolean
  onPick(target: string): void
  onClose(): void
}) {
  const store = m3.session.store
  const items: { id: string; name: string; depth: number }[] = []
  const walk = (id: string, depth: number) => {
    for (const c of store.children(id)) {
      if (!frames || store.getNode(c)?.type === "frame")
        items.push({ id: c, name: nameOf(store.getNode(c)), depth })
      if (store.getNode(c)?.type !== "instance") walk(c, depth + 1)
    }
  }
  walk(component, 1)
  return (
    <MenuDense
      width={240}
      label={frames ? "Slot frame" : "Prop target"}
      anchor={anchor}
      onClose={onClose}
      autoFocus
    >
      <MenuLabel>{frames ? "Frame to make a slot" : "Target layer"}</MenuLabel>
      {!frames && (
        <M3MenuItem
          icon="component"
          label="Root"
          onSelect={() => {
            onClose()
            onPick(component)
          }}
        />
      )}
      {items.map((it) => (
        <M3MenuItem
          key={it.id}
          icon={store.getNode(it.id)?.type === "text" ? "type" : "frame"}
          label={`${"  ".repeat(it.depth - 1)}${it.name}`}
          onSelect={() => {
            onClose()
            onPick(it.id)
          }}
        />
      ))}
    </MenuDense>
  )
}
