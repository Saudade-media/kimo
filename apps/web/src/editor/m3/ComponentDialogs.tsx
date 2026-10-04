/**
 * Board 27 §8 Components dialogs (desing.pen d7gkR), all `Dialog` (bDVhS) instances:
 * - Replace main (FM0o5, 400): component tone, `replace`; Body (R8Sfb) bg-subtle, radius-md,
 *   column, gap 6, padding [10, 12]: three Lines (row, gap 8, center: icon 14 + sans 12).
 * - Fix broken overrides (ZNXQU, 776): warning-soft Icon Wrap, `wrench`; Body (i8qaaD) column of
 *   Rows (stroke bottom 1, gap 10, padding [8, 0], center): Where 150 (column, gap 2: Instance
 *   sans 12 · Path mono 11 tertiary) · Override mono 11 secondary 110 · Reason sans 11 tertiary
 *   fill · Action Select 190. Footer: Reset all · Cancel · Apply N fixes.
 * - Duplicate main (Y47JJA, 400): `copy`; Body (NqNjc) column, gap 4: two ModeOption rows
 *   (leX10: gap 10, padding 8, radius-md; Tile 28 component-soft, icon 14 component) and
 *   Remember (gap 8, padding [6, 8, 0, 8]: Box 14 radius 3 stroke border-strong · sans 11).
 * Plus the instance panel's Broken strip (c16xy) and the Component menu (dgOzz).
 */
import {
  type BrokenOverride,
  brokenOverrides,
  componentOfFamily,
  type OverrideFixRequest,
  remapCandidates,
  replaceMainPreview,
} from "@kimo/core-schema"
import { basenameOf, dirnameOf, KIMO_FILE_FILTER, resolveRelativeRef } from "@kimo/platform"
import { Dialog, MenuDense, MenuDivider, type PopoverAnchor, Select } from "@kimo/ui"
import { useEffect, useMemo, useState } from "react"
import { Icon } from "../../lib/icons"
import { useOptionalRuntime } from "../../platform/runtime"
import { commandsFor } from "../clipboard/useEditorCommands"
import { goToMain } from "./actions"
import { type M3Controller, useBusValue } from "./controller"
import { nameOf } from "./model"

type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)

const ctxOf = (m3: M3Controller) => ({ doc: m3.doc(), libraries: m3.libraries() })

/** The other selected node when the selection is exactly one main + one replaceable node. */
export function replaceSource(m3: M3Controller, main: string): string | null {
  const sel = m3.session.ui.getState().selection.filter((id) => id !== main)
  const all = m3.session.ui.getState().selection
  if (all.length !== 2 || !all.includes(main) || sel.length !== 1) return null
  const r = replaceMainPreview(ctxOf(m3), main, sel[0] as string)
  return "instances" in r ? (sel[0] as string) : null
}

/** Opens the Replace dialog (rule Y4XQq6: 1 main + 1 non-instance node). */
export function openReplaceMain(m3: M3Controller, main: string): boolean {
  const source = replaceSource(m3, main)
  if (!source) {
    m3.toast({
      tone: "warning",
      text: "Select the main and one other layer (not an instance of it)",
    })
    return false
  }
  m3.componentDialog.set({ kind: "replaceMain", main, source })
  return true
}

/** Hosts the open component dialog and wires the Settings › General preference. */
export function ComponentDialogs({ m3 }: { m3: M3Controller }) {
  const state = useBusValue(m3.componentDialog)
  const runtime = useOptionalRuntime()
  const settings = runtime?.platform.settings ?? null
  useEffect(() => {
    if (!settings) return
    m3.prefs = {
      duplicateMain: () => settings.get("general.duplicateMain"),
      setDuplicateMain: (v) => void settings.set("general.duplicateMain", v).catch(() => {}),
    }
    return () => {
      m3.prefs = null
    }
  }, [m3, settings])
  // Library links of a file on disk are picked and re-read through the platform (gPEqc).
  const platform = runtime?.platform ?? null
  useEffect(() => {
    const doc = m3.session.document
    if (!platform || !doc) return
    m3.fileHost = {
      docRef: () => m3.session.document?.ref ?? null,
      pick: async () => {
        const [ref] = await platform.dialogs.openFile({
          title: "Link library",
          filters: [KIMO_FILE_FILTER],
          defaultDir: dirnameOf(doc.ref),
        })
        if (!ref) return null
        return { ref, name: basenameOf(ref), bytes: await platform.files.readBytes(ref) }
      },
      read: (ref) => platform.files.readBytes(ref),
    }
    m3.libs.reader = (path) => {
      const at = m3.session.document?.ref
      return at ? platform.files.readBytes(resolveRelativeRef(at, path)) : Promise.reject()
    }
    return () => {
      m3.fileHost = null
      m3.libs.reader = null
    }
  }, [m3, platform])
  if (!state) return null
  const close = () => m3.componentDialog.set(null)
  if (state.kind === "replaceMain")
    return <ReplaceMainDialog m3={m3} main={state.main} source={state.source} onClose={close} />
  if (state.kind === "fixOverrides")
    return <FixOverridesDialog m3={m3} component={state.component} onClose={close} />
  return (
    <DuplicateMainDialog
      m3={m3}
      ids={state.ids}
      main={state.main}
      resolve={state.resolve}
      onClose={close}
    />
  )
}

// --- (b) Replace main ----------------------------------------------------------------------------

function ReplaceMainDialog({
  m3,
  main,
  source,
  onClose,
}: {
  m3: M3Controller
  main: string
  source: string
  onClose(): void
}) {
  const store = m3.session.store
  const mainName = nameOf(store.getNode(main), "Component")
  const srcName = nameOf(store.getNode(source), "Layer")
  const p = useMemo(() => replaceMainPreview(ctxOf(m3), main, source), [m3, main, source])
  if (!("instances" in p)) return null
  const lines: { icon: string; tone: "success" | "warning"; text: string }[] = [
    {
      icon: "check",
      tone: "success",
      text: `${p.instances} instance${p.instances === 1 ? "" : "s"} update`,
    },
    {
      icon: "check",
      tone: "success",
      text: `${p.kept} override${p.kept === 1 ? "" : "s"} kept — matched by layer name`,
    },
  ]
  if (p.unmatched > 0)
    lines.push({
      icon: "triangle-alert",
      tone: "warning",
      text: `${p.unmatched} override${p.unmatched === 1 ? "" : "s"} can't be matched — review after`,
    })
  return (
    <div className="m3-scrim" data-testid="replace-main-dialog">
      <Dialog
        size="sm"
        tone="component"
        icon={<Icon name="replace" size={16} />}
        title={`Replace “${mainName}” with “${srcName}”?`}
        description={`“${srcName}” becomes the main component — same id, same props. The old main's layers are discarded.`}
        confirmLabel="Replace"
        onCancel={onClose}
        onConfirm={() => {
          onClose()
          const r = m3.run({ cmd: "replaceMain", main, source }, "Replace main with selection")
          if (r.ok && p.unmatched > 0)
            m3.toast({
              tone: "warning",
              text: `${p.unmatched} override${p.unmatched === 1 ? "" : "s"} can't be matched`,
              action: {
                label: "Review",
                run: () => m3.componentDialog.set({ kind: "fixOverrides", component: main }),
              },
            })
        }}
      >
        <div className="m3-replace-body">
          {lines.map((l) => (
            <div key={l.text} className="m3-replace-body__line">
              <span className={`m3-replace-body__icon m3-replace-body__icon--${l.tone}`}>
                <Icon name={l.icon} size={14} />
              </span>
              <span className="m3-replace-body__text">{l.text}</span>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  )
}

// --- (c) Fix broken overrides ----------------------------------------------------------------------

/** "content: “New”", "fill: $brand:cta", "visible: false", "slot". */
export function overrideText(b: BrokenOverride): string {
  if (b.kind === "variable") return `${b.field}: $${b.variable}`
  const ov = b.override
  if (ov.slot === true) return "slot"
  if (ov.replace === true) return "replace"
  if (!isObj(ov.set)) return "override"
  const entries = Object.entries(ov.set)
  const [k, v] = entries[0] ?? ["", ""]
  const val =
    typeof v === "string"
      ? `“${v}”`
      : isObj(v) && typeof v.$ref === "string"
        ? `$${v.$ref}`
        : JSON.stringify(v)
  return `${k}: ${val}${entries.length > 1 ? ` +${entries.length - 1}` : ""}`
}

/** "Layer removed" · "Variable missing" · "Library variable renamed". */
export function reasonText(b: BrokenOverride): string {
  if (b.kind === "layer") return "Layer removed"
  return b.variable?.includes(":") ? "Library variable renamed" : "Variable missing"
}

function rowKey(b: BrokenOverride) {
  return `${b.instance}\u0000${b.key}\u0000${b.kind}\u0000${b.field ?? ""}`
}

function FixOverridesDialog({
  m3,
  component,
  onClose,
}: {
  m3: M3Controller
  component: string
  onClose(): void
}) {
  const ctx = useMemo(() => ctxOf(m3), [m3])
  const rows = useMemo(() => brokenOverrides(ctx, component), [ctx, component])
  const cands = useMemo(() => rows.map((b) => remapCandidates(ctx, b).slice(0, 12)), [ctx, rows])
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((b, i) => [rowKey(b), cands[i]?.[0] ? `remap:${cands[i]?.[0]?.value}` : "reset"]),
    ),
  )
  const store = m3.session.store
  const compName = nameOf(store.getNode(component), "Component")
  const instances = new Set(rows.map((b) => b.instance)).size
  const fixes = rows.filter((b) => choice[rowKey(b)] !== "keep").length
  const where = (b: BrokenOverride) => {
    if (b.path) return b.path
    const first = b.key.split("/")[0] ?? b.key
    const n = store.getNode(first)
    return n ? nameOf(n, first) : b.key
  }
  const apply = () => {
    const list: OverrideFixRequest[] = rows.map((b) => {
      const c = choice[rowKey(b)] ?? "keep"
      return {
        instance: b.instance,
        key: b.key,
        kind: b.kind,
        source: b.source,
        ...(b.field !== undefined ? { field: b.field } : {}),
        fix: c.startsWith("remap:")
          ? { action: "remap", to: c.slice(6) }
          : c === "reset"
            ? { action: "reset" }
            : { action: "keep" },
      }
    })
    onClose()
    m3.run({ cmd: "fixOverrides", fixes: list }, "Fix broken overrides")
  }
  return (
    <div className="m3-scrim" data-testid="fix-overrides-dialog">
      <Dialog
        width={776}
        className="m3-fix-dialog"
        icon={<Icon name="wrench" size={16} />}
        title="Fix broken overrides"
        description={
          rows.length
            ? `${rows.length} override${rows.length === 1 ? "" : "s"} on ${instances} instance${instances === 1 ? "" : "s"} point at layers or variables that no longer exist in “${compName}”.`
            : `Every override of “${compName}” matches.`
        }
        tertiary={{
          label: "Reset all",
          onClick: () => setChoice(Object.fromEntries(rows.map((b) => [rowKey(b), "reset"]))),
        }}
        confirmLabel={`Apply ${fixes} fix${fixes === 1 ? "" : "es"}`}
        confirmDisabled={fixes === 0}
        onCancel={onClose}
        onConfirm={apply}
      >
        <div className="m3-fix-body">
          {rows.map((b, i) => {
            const k = rowKey(b)
            const options = [
              ...(cands[i] ?? []).map((c) => ({
                value: `remap:${c.value}`,
                label: `Remap → ${c.label}`,
              })),
              { value: "reset", label: "Reset" },
              { value: "keep", label: "Keep" },
            ]
            return (
              <div key={k} className="m3-fix-row" data-key={b.key}>
                <div className="m3-fix-row__where">
                  <span className="m3-fix-row__instance">
                    {nameOf(store.getNode(b.instance), "Instance")}
                  </span>
                  <span className="m3-fix-row__path">{where(b)}</span>
                </div>
                <span className="m3-fix-row__override">{overrideText(b)}</span>
                <span className="m3-fix-row__reason">{reasonText(b)}</span>
                <Select
                  className="m3-fix-row__action"
                  label={`Fix ${b.key}`}
                  options={options}
                  value={choice[k] ?? "keep"}
                  onChange={(v) => setChoice((c) => ({ ...c, [k]: v }))}
                />
              </div>
            )
          })}
        </div>
      </Dialog>
    </div>
  )
}

/** Broken overrides of one instance (the strip's count). */
export function brokenOf(m3: M3Controller, instance: string): BrokenOverride[] {
  const comp = componentOfFamily(ctxOf(m3), instance)
  if (!comp) return []
  return brokenOverrides(ctxOf(m3), comp).filter((b) => b.instance === instance)
}

/** Instance panel Broken strip (c16xy): warning-soft, "N overrides don't match" · Review. */
export function BrokenStrip({ m3, instance }: { m3: M3Controller; instance: string }) {
  useBusValue(m3.rev)
  const n = brokenOf(m3, instance).length
  const comp = componentOfFamily(ctxOf(m3), instance)
  if (n === 0 || !comp) return null
  return (
    <div className="m3-broken-strip" data-testid="broken-strip">
      <span className="m3-broken-strip__icon">
        <Icon name="triangle-alert" size={14} />
      </span>
      <span className="m3-broken-strip__label">
        {n} override{n === 1 ? " doesn't" : "s don't"} match
      </span>
      <span className="m3-broken-strip__spacer" aria-hidden="true" />
      <button
        type="button"
        className="m3-broken-strip__action"
        onClick={() => m3.componentDialog.set({ kind: "fixOverrides", component: comp })}
      >
        Review
      </button>
    </div>
  )
}

// --- (d) Duplicate main ---------------------------------------------------------------------------

function DuplicateMainDialog({
  m3,
  ids,
  main,
  resolve,
  onClose,
}: {
  m3: M3Controller
  ids: readonly string[]
  main: string
  resolve?: (mode: "instance" | "component" | null) => void
  onClose(): void
}) {
  const [mode, setMode] = useState<"instance" | "component">("instance")
  const [remember, setRemember] = useState(false)
  const name = nameOf(m3.session.store.getNode(main), "Component")
  const confirm = () => {
    onClose()
    if (remember) m3.prefs?.setDuplicateMain(mode)
    if (resolve) resolve(mode)
    else commandsFor(m3.session)?.duplicateMain(mode, ids)
  }
  const options = [
    {
      mode: "instance" as const,
      icon: "diamond",
      name: "As an instance",
      desc: `Linked to “${name}”. Most common.`,
    },
    {
      mode: "component" as const,
      icon: "component",
      name: "As a new component",
      desc: `Independent copy named “${name.replace(/\s+\d+$/, "")} 2”, with its props.`,
    },
  ]
  return (
    <div className="m3-scrim" data-testid="duplicate-main-dialog">
      <Dialog
        size="sm"
        icon={<Icon name="copy" size={16} />}
        title={`Duplicate “${name}”`}
        description="This is a main component."
        confirmLabel="Duplicate"
        onCancel={() => {
          onClose()
          resolve?.(null)
        }}
        onConfirm={confirm}
        onKeyDown={(e) => {
          // d7gkR BX6C3: "Default (↵) = instance" — Enter confirms the chosen option (the
          // option rows and the Remember box keep Enter for themselves).
          const t = e.target as HTMLElement
          if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
          if (t.closest("[role=radio], .m3-dup-remember")) return
          e.preventDefault()
          confirm()
        }}
      >
        <div className="m3-dup-body" role="radiogroup" aria-label="Duplicate as">
          {options.map((o) => (
            // biome-ignore lint/a11y/useSemanticElements: a design option row acting as a radio.
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={mode === o.mode}
              data-mode={o.mode}
              className={`m3-dup-option${mode === o.mode ? " m3-dup-option--on" : ""}`}
              onClick={() => setMode(o.mode)}
            >
              <span className="m3-dup-option__tile">
                <Icon name={o.icon} size={14} />
              </span>
              <span className="m3-dup-option__text">
                <span className="m3-dup-option__name">{o.name}</span>
                <span className="m3-dup-option__desc">{o.desc}</span>
              </span>
              {mode === o.mode && (
                <span className="m3-dup-option__check">
                  <Icon name="check" size={14} />
                </span>
              )}
            </button>
          ))}
          <label className="m3-dup-remember">
            <input
              type="checkbox"
              className="m3-dup-remember__input"
              checked={remember}
              onChange={(e) => setRemember(e.currentTarget.checked)}
            />
            <span className="m3-dup-remember__box" aria-hidden="true">
              {remember && <Icon name="check" size={10} />}
            </span>
            <span className="m3-dup-remember__label">Remember my choice</span>
          </label>
        </div>
      </Dialog>
    </div>
  )
}

// --- Component menu (dgOzz) -----------------------------------------------------------------------

/** Component menu (board 27 dgOzz, 256): the Component section header's ellipsis. */
export function ComponentMenu({
  m3,
  id,
  anchor,
  onClose,
}: {
  m3: M3Controller
  id: string
  anchor: PopoverAnchor
  onClose(): void
}) {
  const nodes = m3.doc().nodes as Record<string, Rec>
  const instances = Object.keys(nodes).filter(
    (k) => nodes[k]?.type === "instance" && nodes[k]?.of === id,
  )
  const derived = m3.session.store.getNode(id)?.type === "instance"
  const canReplace = replaceSource(m3, id) !== null
  const run = (f: () => void) => () => {
    onClose()
    f()
  }
  return (
    <MenuDense
      width={256}
      label="Component"
      anchor={anchor}
      onClose={onClose}
      autoFocus
      data-testid="component-menu"
    >
      <MenuRow
        label="Go to main component"
        disabled={!derived}
        onSelect={run(() => goToMain(m3, id))}
      />
      <MenuRow
        label="Select all instances"
        meta={String(instances.length)}
        disabled={instances.length === 0}
        onSelect={run(() => m3.session.ui.getState().select(instances))}
      />
      <MenuDivider />
      <MenuRow
        label="Replace main with selection…"
        disabled={!canReplace}
        onSelect={run(() => openReplaceMain(m3, id))}
      />
      <MenuRow
        label="Detach all instances"
        disabled={instances.length === 0}
        onSelect={run(() => {
          for (const i of instances)
            m3.run({ cmd: "detachInstance", id: i }, "Detach all instances")
        })}
      />
      <MenuDivider />
      <MenuRow
        label="Duplicate"
        meta="⌘D"
        onSelect={run(() => {
          m3.session.ui.getState().select([id])
          commandsFor(m3.session)?.duplicate()
        })}
      />
    </MenuDense>
  )
}

/** MenuItem/Dense without an icon (the design hides RmOTH in this menu). */
function MenuRow({
  label,
  meta,
  disabled,
  onSelect,
}: {
  label: string
  meta?: string
  disabled?: boolean
  onSelect(): void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      className={`kimo-menu-item-dense m3-menu-item${disabled ? " m3-menu-item--disabled" : ""}`}
      onPointerMove={(e) => {
        if (!disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus()
      }}
      onClick={() => {
        if (!disabled) onSelect()
      }}
    >
      <span className="kimo-menu-item-dense__label m3-menu-item__label">{label}</span>
      <span className="kimo-menu-item-dense__spacer" aria-hidden="true" />
      {meta != null && <span className="kimo-menu-item-dense__meta">{meta}</span>}
    </button>
  )
}
