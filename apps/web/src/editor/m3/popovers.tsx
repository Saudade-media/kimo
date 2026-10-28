/**
 * M3 popovers (Popover `xvOvm`: header 40, title sm 600, Close): Swap (board 13 `jFlfP`, 296),
 * Overrides (board 11 `P7Nxi`, 320), Library Manager (board 13 `KBZKl`, 600) and Library
 * Changes (board 13 `MuCtC`, 400).
 */
import { splitQualified } from "@kimo/core-schema"
import { relativeRefBetween } from "@kimo/platform"
import {
  AssetRow,
  Input,
  LibraryRow,
  type PlacementOptions,
  Popover,
  type PopoverAnchor,
  StatusPill,
} from "@kimo/ui"
import { Fragment, useMemo, useState } from "react"
import { Icon } from "../../lib/icons"
import { entriesOf, unlinkLibrary } from "./actions"
import { brokenOfLibrary } from "./ComponentDialogs"
import { type M3Controller, useLibraries } from "./controller"
import {
  aliasFor,
  parseLibrary,
  pickLibraryFile,
  readLibraryBytes,
  relativePath,
} from "./libraries"
import { type ComponentItem, listComponents, matches, nameOf } from "./model"
import { M3Button, M3IconButton } from "./ui"

/** Swap Popover: groups "This file" / "<Library> · alias"; pick → swapInstance (or `onPick`). */
export function SwapPopover({
  m3,
  instance,
  anchor,
  placement,
  title = "Swap instance",
  onPick,
  onClose,
}: {
  m3: M3Controller
  /** View id of the instance (or the replaced child, with `onPick`). */
  instance: string
  anchor: PopoverAnchor
  placement?: PlacementOptions
  title?: string
  onPick?: (of: string) => void
  onClose(): void
}) {
  const [query, setQuery] = useState("")
  const libs = useLibraries(m3)
  const doc = m3.doc()
  const current = String(m3.view().getNode(instance)?.of ?? "")
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of Object.values(doc.nodes as Record<string, { type?: string; of?: string }>))
      if (n.type === "instance" && n.of) m.set(n.of, (m.get(n.of) ?? 0) + 1)
    return m
  }, [doc])
  const groups: { title: string; meta: string; items: ComponentItem[] }[] = [
    { title: "This file", meta: "", items: listComponents(doc, m3.libraries(), null) },
    ...libs.map((l) => ({
      title: l.name,
      meta: l.alias,
      items: listComponents(doc, m3.libraries(), l.alias),
    })),
  ]
  const pick = (of: string) => {
    if (onPick) return onPick(of)
    onClose()
    const dry = m3.plan({ cmd: "swapInstance", instance, of })
    const dropped = dry.ok ? dry.notes.filter((n) => n.code !== "HIDDEN_INSTEAD") : []
    if (dropped.length)
      void m3
        .confirm({
          title: "Swap instance?",
          desc: "Overrides whose layers don't exist in the new component are dropped.",
          icon: "repeat",
          tone: "component",
          items: dropped.map((n) => ({ icon: "circle-dot", text: n.message })),
          confirm: "Swap",
        })
        .then((ok) => ok && m3.run({ cmd: "swapInstance", instance, of }, "Swap instance"))
    else m3.run({ cmd: "swapInstance", instance, of }, "Swap instance")
  }
  return (
    <Popover
      title={title}
      wide
      anchor={anchor}
      placement={placement}
      onClose={onClose}
      className="m3-swap-popover"
      data-testid="swap-popover"
      bodyProps={{ className: "m3-swap-popover__body" }}
    >
      <div className="m3-swap-popover__search">
        <Input
          icon={<Icon name="search" size={16} />}
          placeholder="Search components"
          aria-label="Search components"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.currentTarget.value)}
          frameProps={{ className: "m3-search-30" }}
        />
      </div>
      <div className="m3-swap-popover__list" role="listbox" aria-label="Components">
        {groups.map((g) => {
          const items = g.items.filter((i) => matches(i, query))
          if (!items.length) return null
          return (
            <Fragment key={g.title + g.meta}>
              <div className="m3-swap-popover__group">
                <span className="m3-swap-popover__group-title">{g.title}</span>
                <span className="m3-swap-popover__group-meta">{g.meta}</span>
              </div>
              {items.map((i) => (
                <AssetRow
                  key={i.qid}
                  name={i.alias ? `${i.alias}:${i.name}` : i.name}
                  meta={usage.get(i.qid) ? `${usage.get(i.qid)}×` : "—"}
                  selected={i.qid === current}
                  role="option"
                  aria-selected={i.qid === current}
                  tabIndex={-1}
                  data-asset={i.alias ? `${i.alias}:${i.name}` : i.name}
                  onClick={() => i.qid !== current && pick(i.qid)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && i.qid !== current) pick(i.qid)
                  }}
                />
              ))}
            </Fragment>
          )
        })}
      </div>
      <div className="m3-popover-footer">
        <span className="m3-popover-footer__icon">
          <Icon name="info" size={14} />
        </span>
        <span className="m3-popover-footer__hint">
          Overrides carry over to layers with matching ids.
        </span>
      </div>
    </Popover>
  )
}

/** Overrides Popover (board 11 `P7Nxi`): one row per entry with its own reset. */
export function OverridesPopover({
  m3,
  instance,
  anchor,
  placement,
  onClose,
}: {
  m3: M3Controller
  instance: string
  anchor: PopoverAnchor
  placement?: PlacementOptions
  onClose(): void
}) {
  const entries = entriesOf(m3, instance)
  const name = nameOf(m3.session.store.getNode(instance))
  return (
    <Popover
      title={`Overrides · ${name}`}
      anchor={anchor}
      placement={placement}
      onClose={onClose}
      className="m3-overrides-popover"
      data-testid="overrides-popover"
      bodyProps={{ className: "m3-overrides-popover__body" }}
    >
      <div className="m3-overrides-popover__list">
        {entries.length === 0 && (
          <div className="m3-overrides-popover__empty">No overrides. It matches the main.</div>
        )}
        {entries.map((e) => (
          <div className="m3-override-entry" key={`${e.kind}:${e.path}`} data-entry={e.path}>
            <span className="m3-override-entry__kind">
              <span className="m3-override-entry__tag">
                {e.kind === "set" ? "overrides" : e.kind}
              </span>
            </span>
            <span className="m3-override-entry__path">{e.label}</span>
            <span className="m3-override-entry__spacer" />
            <span
              className={`m3-override-entry__value${e.kind === "args" || e.kind === "slot" || e.kind === "replace" ? " m3-override-entry__value--sans" : ""}`}
            >
              {e.value}
            </span>
            <M3IconButton
              icon="rotate-ccw"
              iconSize={12}
              label={`Reset ${e.label}`}
              onClick={() => {
                if (e.reset.cmd === "args")
                  m3.run(
                    { cmd: "setArgs", instance, args: { [e.reset.name]: undefined } },
                    `Reset ${e.label}`,
                  )
                else if (e.reset.cmd === "props")
                  m3.run(
                    {
                      cmd: "resetOverride",
                      instance,
                      path: "",
                      options: { fields: [e.reset.field] },
                    },
                    `Reset ${e.label}`,
                  )
                else
                  m3.run({ cmd: "resetOverride", instance, path: e.reset.path }, `Reset ${e.label}`)
              }}
            />
          </div>
        ))}
      </div>
      <div className="m3-overrides-popover__footer">
        <span className="m3-overrides-popover__hint">
          Reset removes one entry; the main's value shows again.
        </span>
        <M3Button
          variant="ghost"
          disabled={!entries.length}
          onClick={() => m3.run({ cmd: "resetAllOverrides", instance }, "Reset all overrides")}
        >
          Reset all
        </M3Button>
      </div>
    </Popover>
  )
}

/** A library picked through the platform (a file on disk): its ref, name and text. */
async function pickFromHost(m3: M3Controller) {
  const p = await m3.fileHost?.pick()
  if (!p) return null
  return { name: p.name, ref: p.ref, text: await readLibraryBytes(p.bytes, p.name) }
}

/**
 * Board 27 §8 rule gPEqc: the `imports` path relative to the open file (`../icons/icons.kimo`);
 * `./<name>` only when the file's location is unknown (browser library).
 */
function libraryPath(m3: M3Controller, name: string, ref: string | null): string {
  const at = m3.fileHost?.docRef()
  return (at && ref ? relativeRefBetween(at, ref) : null) ?? relativePath(name)
}

/** Links a picked library file under a fresh alias (one undo step: `imports` gains it). */
export async function linkLibraryFlow(m3: M3Controller): Promise<string | null> {
  let picked: Awaited<ReturnType<typeof pickLibraryFile>>
  let ref: string | null = null
  try {
    picked = m3.fileHost?.docRef() ? await pickFromHost(m3) : await pickLibraryFile()
    ref = picked && "ref" in picked ? (picked.ref as string) : null
  } catch (e) {
    m3.toast({
      tone: "danger",
      text: `Could not read the library: ${e instanceof Error ? e.message : e}`,
    })
    return null
  }
  if (!picked) return null
  let name = picked.name
  try {
    const n = parseLibrary(picked.text).meta?.name
    if (typeof n === "string" && n) name = n
  } catch (e) {
    m3.toast({
      tone: "danger",
      text: `${picked.name} is not a Kimo file: ${e instanceof Error ? e.message : e}`,
    })
    return null
  }
  const imports = (m3.doc().imports ?? {}) as Record<string, string>
  const alias = aliasFor(name, Object.keys(imports))
  const path = libraryPath(m3, picked.name, ref)
  await m3.libs.put(alias, path, picked)
  const r = m3.run({ cmd: "linkLibrary", alias, path }, "Link library")
  if (!r.ok) {
    await m3.libs.forget(alias)
    return null
  }
  return alias
}

/** Locate… a missing library: re-pick the file, keep alias, update the path if it moved. */
export async function locateLibrary(m3: M3Controller, alias: string): Promise<void> {
  const picked = await (m3.fileHost?.docRef() ? pickFromHost(m3) : pickLibraryFile()).catch(
    () => null,
  )
  if (!picked) return
  const path = libraryPath(m3, picked.name, "ref" in picked ? (picked.ref as string) : null)
  await m3.libs.put(alias, path, picked)
  const cur = ((m3.doc().imports ?? {}) as Record<string, string>)[alias]
  if (cur !== path) m3.run({ cmd: "relinkLibrary", alias, path }, "Relink library")
}

/** Library Manager (board 13 `KBZKl`, 600). */
export function LibraryManager({ m3, onClose }: { m3: M3Controller; onClose(): void }) {
  const libs = useLibraries(m3)
  const doc = m3.doc()
  return (
    <div
      className="m3-scrim m3-scrim--clear"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <Popover
        title="Libraries"
        onClose={onClose}
        className="m3-library-manager"
        data-testid="library-manager"
        bodyProps={{ className: "m3-library-manager__body" }}
      >
        <div className="m3-library-manager__intro">
          Linked libraries are read-only. Their components, variables and theme axes are referenced
          as alias:id.
        </div>
        <div className="m3-library-manager__list">
          {libs.map((l) => {
            const comps = l.doc ? listComponents(doc, m3.libraries(), l.alias).length : 0
            const vars = l.doc ? Object.keys(l.doc.variables ?? {}).length : 0
            const used = Object.values(
              doc.nodes as Record<string, { type?: string; of?: string }>,
            ).filter(
              (n) => n.type === "instance" && n.of && splitQualified(n.of).alias === l.alias,
            ).length
            const status = l.status === "loading" ? "linked" : l.status
            const count =
              status === "missing"
                ? `file not found · ${used} instance${used === 1 ? "" : "s"} use it`
                : status === "changed"
                  ? `${comps} components · ${l.changes.length} changed`
                  : `${comps} components · ${vars} variables`
            return (
              <LibraryRow
                key={l.alias}
                name={l.name}
                alias={l.alias}
                path={l.path}
                count={count}
                status={status}
                data-library={l.alias}
                actionLabel={
                  status === "changed" ? "Review" : status === "missing" ? "Locate…" : undefined
                }
                onAction={() =>
                  status === "changed"
                    ? m3.openPanel({ libraryManager: false, libraryChanges: l.alias })
                    : void locateLibrary(m3, l.alias)
                }
                onMenu={() => void unlinkLibrary(m3, l.alias)}
              />
            )
          })}
          {libs.length === 0 && (
            <div className="m3-library-manager__empty">No libraries linked yet.</div>
          )}
        </div>
        <div className="m3-popover-footer m3-popover-footer--12">
          <span className="m3-popover-footer__icon">
            <Icon name="info" size={14} />
          </span>
          <span className="m3-popover-footer__hint">
            Stored in imports · paths are relative to this file
          </span>
          <span className="m3-popover-footer__spacer" />
          <M3Button
            variant="primary"
            icon="link-2"
            className="m3-library-manager__link"
            onClick={() => void linkLibraryFlow(m3)}
          >
            Link library…
          </M3Button>
        </div>
      </Popover>
    </div>
  )
}

/** Library Changes (board 13 `MuCtC`, 400): snapshot vs the fresh read. */
export function LibraryChanges({
  m3,
  alias,
  onClose,
}: {
  m3: M3Controller
  alias: string
  onClose(): void
}) {
  const l = m3.libs.get(alias)
  const doc = m3.doc()
  if (!l) return null
  const used = (id: string) =>
    Object.values(doc.nodes as Record<string, { type?: string; of?: string }>).filter(
      (n) => n.type === "instance" && n.of === `${alias}:${id}`,
    ).length
  // The same rows the Fix broken overrides dialog lists (this library's instances).
  const broken = brokenOfLibrary(m3, alias).length
  return (
    <div
      className="m3-scrim m3-scrim--clear"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <Popover
        title={`${l.name}`}
        headerLeading={
          <span className="m3-changes__head">
            <M3IconButton
              icon="arrow-left"
              label="Back to libraries"
              onClick={() => m3.openPanel({ libraryChanges: null, libraryManager: true })}
            />
            <span className="m3-changes__title">{l.name}</span>
            <span className="m3-changes__sub">changed since last open</span>
          </span>
        }
        onClose={onClose}
        className="m3-library-changes"
        data-testid="library-changes"
        bodyProps={{ className: "m3-library-changes__body" }}
      >
        <div className="m3-changes__summary">
          <StatusPill status="changed" />
          <span className="m3-changes__summary-text">
            {alias} · {l.changes.length} change{l.changes.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="m3-changes__list">
          {l.changes.map((c) => (
            <div className="m3-change-row" key={`${c.kind}:${c.id}`}>
              <span className="m3-change-row__glyph">
                <Icon name={c.kind === "component" ? "component" : "variable"} size={14} />
              </span>
              <span className="m3-change-row__name">{c.name}</span>
              <span className={`m3-change-row__tag m3-change-row__tag--${c.change}`}>
                {c.change}
              </span>
              <span className="m3-change-row__spacer" />
              <span className="m3-change-row__usage">
                {c.kind === "component" ? `${used(c.id)}×` : ""}
              </span>
            </div>
          ))}
        </div>
        {broken > 0 && (
          <div className="m3-changes__warning">
            <Icon name="triangle-alert" size={14} />
            <span>
              {broken} override{broken === 1 ? "" : "s"} no longer resolve
            </span>
          </div>
        )}
        <div className="m3-changes__footer">
          <M3Button
            variant="ghost"
            icon="wrench"
            disabled={broken === 0}
            onClick={() => {
              m3.componentDialog.set({ kind: "fixOverrides", library: alias })
              onClose()
            }}
          >
            Fix broken overrides
          </M3Button>
          <span className="m3-popover-footer__spacer" />
          <M3Button
            variant="primary"
            icon="check"
            onClick={() => {
              void m3.libs.acknowledge(alias)
              onClose()
            }}
          >
            Got it
          </M3Button>
        </div>
      </Popover>
    </div>
  )
}
