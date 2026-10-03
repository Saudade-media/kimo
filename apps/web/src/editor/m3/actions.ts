/**
 * Component / instance gestures shared by the panels, menus and shortcuts (boards 11–13, 15).
 * Each runs ONE M3 command through the controller (one undo step); destructive ones confirm
 * first (board 15 `i8PfIC` Detach, `ysXyK` slot off, `fmB2B` Unlink).
 */
import { instancesOf, type KimoDocument, libraryUsage, splitQualified } from "@kimo/core-schema"
import type { LayoutResult } from "@kimo/layout"
import type { M3Controller } from "./controller"
import { componentName, nameOf, overrideEntries } from "./model"

const nodeOf = (m3: M3Controller, id: string) => m3.view().getNode(id)

/** Instance override entries with layer names (Overrides popover, Detach confirm). */
export function entriesOf(m3: M3Controller, instance: string) {
  const store = m3.session.store
  const n = store.getNode(instance)
  if (!n) return []
  const view = m3.view()
  return overrideEntries(
    n,
    (path) => nameOf(view.getNode(`${instance}/${path}`), path.split("/").pop() ?? path),
    (path) => store.children(instance, path).length,
    (path) => {
      const first = store.children(instance, path)[0]
      return first ? nameOf(store.getNode(first)) : null
    },
  )
}

/** Detach (⌥⌘B): confirm with the override counts, then `detachInstance`. */
export async function detachInstance(m3: M3Controller, id: string): Promise<boolean> {
  const n = m3.session.store.getNode(id)
  if (n?.type !== "instance") return false
  const entries = entriesOf(m3, id)
  const of = String(n.of ?? "")
  const main = componentName(m3.doc(), m3.libraries(), of)
  const count = (k: string) => entries.filter((e) => e.kind === k).length
  const parts = [
    ["props", count("props")],
    ["args", count("args")],
    ["slot", count("slot")],
    ["replace", count("replace")],
    ["set", count("set")],
  ].filter(([, c]) => (c as number) > 0)
  const slots = entries.filter((e) => e.kind === "slot" || e.kind === "replace")
  const ok = await m3.confirm({
    title: `Detach ${nameOf(n)}?`,
    desc: `It becomes a plain frame and stops receiving changes from ${main}.`,
    icon: "unlink",
    tone: "component",
    items: [
      {
        icon: "circle-dot",
        accent: true,
        text: `${entries.length} override${entries.length === 1 ? "" : "s"} become local values${
          parts.length ? ` (${parts.map(([k, c]) => `${k} ${c}`).join(" · ")})` : ""
        }`,
      },
      ...(slots.length
        ? [
            {
              icon: "square-dashed",
              text: `${slots.map((s) => s.label).join(", ")} stay as regular children`,
            },
          ]
        : []),
      ...(count("args") ? [{ icon: "list", text: "Props are dropped — values stay" }] : []),
    ],
    confirm: "Detach",
    dontAskKey: "detach",
  })
  if (!ok) return false
  return m3.run({ cmd: "detachInstance", id }, "Detach instance").ok
}

/** ⌥⏎ Go to main component: selects the local main and zooms to it. */
export function goToMain(m3: M3Controller, id: string): void {
  const canvas = m3.canvas()
  if (canvas?.goToMain) {
    canvas.goToMain(id)
    return
  }
  const n = nodeOf(m3, id)
  const of =
    typeof m3.view().origin(id)?.instance?.of === "string"
      ? (m3.view().origin(id)?.instance?.of as string)
      : String(n?.of ?? "")
  const { alias, name } = splitQualified(of)
  if (alias !== null) {
    m3.toast({
      tone: "warning",
      text: `${componentName(m3.doc(), m3.libraries(), of)} is from a linked library — edit it in its source file`,
    })
    return
  }
  if (!m3.session.store.getNode(name)) return
  m3.session.ui.getState().select([name])
  canvas?.zoomToFit([name])
}

/** Select all instances of the same component. */
export function selectAllInstances(m3: M3Controller, id: string): void {
  const of = String(nodeOf(m3, id)?.of ?? "")
  if (!of) return
  m3.session.ui.getState().select(instancesOf(m3.doc(), of))
}

/** Board 12 `VexIX`: "Created component <name>" + Undo, 4 s, `component` icon. */
function toastCreated(m3: M3Controller, id: string) {
  m3.toast({
    tone: "component",
    text: `Created component ${nameOf(m3.session.store.getNode(id))}`,
    action: { label: "Undo", run: () => m3.session.store.undo("user") },
    duration: 4000,
  })
}

/**
 * Create component (⌥⌘K): one node becomes a main in place (an instance → a derived
 * component); several siblings are wrapped in a new frame (box from the layout).
 */
export function createComponent(
  m3: M3Controller,
  ids: readonly string[],
  layout: LayoutResult | null,
): boolean {
  const real = ids.filter((id) => !id.includes("/"))
  if (real.length === 0) {
    m3.toast({ tone: "danger", text: "Select layers to make a component" })
    return false
  }
  let options: { wrap?: { x: number; y: number; w: number; h: number } } | undefined
  if (real.length > 1) {
    const boxes = real.map((id) => layout?.nodes.get(id)?.local).filter((b) => !!b)
    if (boxes.length !== real.length) {
      m3.toast({ tone: "danger", text: "Can't measure the selection yet — try again" })
      return false
    }
    const x = Math.min(...boxes.map((b) => b.x))
    const y = Math.min(...boxes.map((b) => b.y))
    const r = Math.max(...boxes.map((b) => b.x + b.w))
    const btm = Math.max(...boxes.map((b) => b.y + b.h))
    options = { wrap: { x, y, w: r - x, h: btm - y } }
  }
  const derived =
    real.length === 1 && m3.session.store.getNode(real[0] as string)?.type === "instance"
  const r = m3.run(
    { cmd: "createComponent", ids: real, ...(options ? { options } : {}) },
    derived ? "Create derived component" : "Create component",
  )
  if (r.ok) toastCreated(m3, r.select?.[0] ?? (real[0] as string))
  return r.ok
}

/** Board 15 `ysXyK`: turning a slot off while instances fill it asks first. */
export async function setSlotOff(m3: M3Controller, frame: string): Promise<boolean> {
  const dry = m3.plan({ cmd: "setSlot", frame, slot: null })
  if (dry.ok) return m3.run({ cmd: "setSlot", frame, slot: null }, "Turn off slot").ok
  if (dry.error.code !== "IN_USE") {
    m3.toastRefusal(dry.error)
    return false
  }
  const name = nameOf(m3.session.store.getNode(frame))
  const ok = await m3.confirm({
    title: `Turn off slot on ${name}?`,
    desc: "Instances fill this slot with their own layers. Turning it off deletes that content.",
    icon: "square-dashed",
    tone: "danger",
    items: [{ icon: "circle-dot", text: dry.error.message }],
    confirm: "Turn off & delete content",
  })
  if (!ok) return false
  return m3.run({ cmd: "setSlot", frame, slot: null, deleteContent: true }, "Turn off slot").ok
}

/** Board 15 `fmB2B` Unlink confirm (detach all & unlink; needs the cached library). */
export async function unlinkLibrary(m3: M3Controller, alias: string): Promise<boolean> {
  const usage = libraryUsage(m3.doc() as KimoDocument, alias)
  const entry = m3.libs.get(alias)
  const cached = !!entry?.doc
  const n = usage.instances.length
  const ok = await m3.confirm({
    title: `Unlink the ${entry?.name ?? alias} library?`,
    desc: `Removes ${alias} from imports.${
      n
        ? ` ${n} instance${n === 1 ? "" : "s"} still reference ${alias}: components and would fail validation (ALIAS_UNKNOWN).`
        : ""
    }`,
    icon: "unlink",
    tone: "danger",
    items: [
      {
        icon: "circle-dot",
        accent: true,
        text: `Detach all: ${n} instance${n === 1 ? "" : "s"} become plain layers${cached ? " from the cached preview" : ""}`,
      },
      {
        icon: "square-dashed",
        text: "Without a cache (fresh clone) detach is unavailable — locate the file instead",
      },
      { icon: "list", text: "Undo restores the import and the instances" },
    ],
    confirm: n || usage.bindings ? "Detach all & unlink" : "Unlink",
  })
  if (!ok) return false
  const r = m3.run({ cmd: "unlinkLibrary", alias }, "Unlink library")
  if (r.ok) void m3.libs.forget(alias)
  return r.ok
}

/** Replace an instance descendant (composite id) with an instance of `of` (board 13 drop rule). */
export function replaceWithComponent(m3: M3Controller, viewId: string, of: string): boolean {
  const loc = m3.view().locate(viewId)
  if (!loc?.instance || loc.path === undefined) return false
  return m3.run(
    {
      cmd: "setOverride",
      instance: loc.instance,
      path: loc.path,
      change: {
        kind: "replace",
        node: { type: "instance", of, name: componentName(m3.doc(), m3.libraries(), of) },
      },
    },
    "Replace layer",
  ).ok
}

/** Insert an instance of `of` into an instance slot (composite slot frame id). */
export function insertIntoSlot(m3: M3Controller, viewId: string, of: string): boolean {
  const loc = m3.view().locate(viewId)
  if (!loc?.instance || loc.path === undefined) return false
  return m3.run(
    {
      cmd: "setOverride",
      instance: loc.instance,
      path: loc.path,
      change: {
        kind: "slot",
        content: [
          { node: { type: "instance", of, name: componentName(m3.doc(), m3.libraries(), of) } },
        ],
      },
    },
    "Insert into slot",
  ).ok
}
