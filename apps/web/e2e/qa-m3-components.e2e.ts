/**
 * Adversarial QA of M3 components (boards 11–13, 15): create component from a (multi)
 * selection, live propagation, every override kind + reset, args per prop type, swap, detach
 * (slot content kept), derived components, slots (suggested, expose as prop), nested
 * instances, cycles, undo granularity. Every scenario soft-asserts and reports all failures.
 */
import type { Page } from "playwright"
import { docJson, openEditor, settle } from "./qa-helpers"
import {
  apply,
  Checks,
  componentsFixture,
  doc,
  getNode,
  layoutBox,
  oneUndo,
  type QW,
  type Rec,
  run,
  select,
  selection,
  storeUndo,
  toasts,
  validDoc,
  viewChildren,
  viewNode,
} from "./qa-m3-helpers"
import type { E2EContext, Scenario } from "./run"

const ownedBy = (d: Rec, parent: string) =>
  Object.entries(d.nodes as Record<string, Rec>).filter(([, n]) => n.parent === parent)

async function createFromSelection({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await apply(page, [
    {
      op: "insert",
      id: "rectA00001",
      parent: null,
      node: { type: "rect", name: "A", x: 100, y: 100, w: 40, h: 40, fill: "#E2683A" },
    },
    {
      op: "insert",
      id: "rectB00001",
      parent: null,
      node: { type: "rect", name: "B", x: 200, y: 160, w: 40, h: 40, fill: "#2A9D8F" },
    },
  ])
  // Multi-selection ⌥⌘K → a wrapping frame becomes the main, children keep their world boxes.
  const before = await docJson(page)
  const worldA = await layoutBox(page, "rectA00001")
  await select(page, ["rectA00001", "rectB00001"])
  await page
    .locator(".editor__canvas")
    .hover({ position: { x: 700, y: 700 } })
    .catch(() => {})
  await page.keyboard.press("Alt+Meta+KeyK")
  await settle(page)
  const a = await getNode(page, "rectA00001")
  const wrap = a?.parent ? await getNode(page, a.parent as string) : null
  c.ok(
    wrap?.type === "frame" && wrap.component === true,
    `wrapped in a component frame: ${JSON.stringify(wrap)}`,
  )
  c.ok(
    wrap && wrap.x === 100 && wrap.y === 100 && wrap.w === 140 && wrap.h === 100,
    `wrap box = union of the selection (100,100,140,100): ${JSON.stringify(wrap && { x: wrap.x, y: wrap.y, w: wrap.w, h: wrap.h })}`,
  )
  const worldA2 = await layoutBox(page, "rectA00001")
  c.ok(
    worldA && worldA2 && worldA.x === worldA2.x && worldA.y === worldA2.y,
    `child keeps its world position: ${JSON.stringify([worldA, worldA2])}`,
  )
  c.ok((await selection(page))[0] === a?.parent, "the new main is selected")
  c.ok(
    (await toasts(page)).some((t) => t.text.startsWith("Created component")),
    "created-component toast",
  )
  await oneUndo(page, c, before, "create component (wrap)")
  // Children of instances cannot become components.
  await componentsFixture(page)
  await select(page, ["inst000001/title00001"])
  await page.keyboard.press("Alt+Meta+KeyK")
  await settle(page)
  c.ok(
    !(await doc(page)).nodes ||
      !Object.values((await doc(page)).nodes as Record<string, Rec>).some(
        (n) => n.name === "Title" && n.component === true,
      ),
    "instance content never becomes a component",
  )
  // Already-a-component: ⌥⌘K again is refused with a toast (no silent no-op, no error).
  await select(page, ["main000001"])
  const t0 = (await toasts(page)).length
  await page.keyboard.press("Alt+Meta+KeyK")
  await settle(page)
  c.ok((await toasts(page)).length > t0, "⌥⌘K on a main explains why nothing happened")
  c.done()
}

async function liveUpdates({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  // Main geometry and content changes reach the instance (view + layout).
  await apply(page, [
    { op: "update", id: "main000001", set: { w: 300 } },
    { op: "update", id: "badge00001", set: { fill: "#123456", w: 77 } },
    { op: "update", id: "title00001", set: { content: "Renamed in main" } },
  ])
  const root = await viewNode(page, "inst000001")
  c.ok(root?.w === 300, `instance root takes the main's width: ${root?.w}`)
  const badge = await viewNode(page, "inst000001/badge00001")
  c.ok(
    badge?.fill === "#123456" && badge?.w === 77,
    `badge follows the main: ${JSON.stringify(badge)}`,
  )
  const lb = await layoutBox(page, "inst000001/badge00001")
  c.ok(lb?.w === 77, `layout box of the instance badge updated: ${JSON.stringify(lb)}`)
  const li = await layoutBox(page, "inst000001")
  c.ok(li?.w === 300, `layout box of the instance root updated: ${JSON.stringify(li)}`)
  // Adding a child to the main adds it to every instance.
  await apply(page, [
    {
      op: "insert",
      id: "newchild01",
      parent: "main000001",
      node: { type: "rect", name: "Footer", w: 50, h: 10, fill: "#000000" },
    },
  ])
  c.ok(
    (await viewChildren(page, "inst000001")).includes("inst000001/newchild01"),
    "new main child appears in the instance",
  )
  c.ok(
    !!(await layoutBox(page, "inst000001/newchild01")),
    "new main child is laid out in the instance",
  )
  // Deleting a main child that an instance overrides: override left dangling must be reported,
  // not crash; the document must stay valid (or the delete must clean the override).
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "newchild01",
    change: { kind: "set", set: { fill: "#FF0000" } },
  })
  const deleted = await apply(page, [{ op: "delete", id: "newchild01" }], "Delete")
  const v = await validDoc(page)
  c.ok(
    !deleted || v.ok,
    `deleting an overridden main child leaves a valid document (deleted=${deleted}): ${v.errors.join("; ")}`,
  )
  c.done()
}

async function overrideKinds({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  // --- set ---
  let before = await docJson(page)
  let r = await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "title00001",
    change: { kind: "set", set: { content: "Pro", fill: "#E2683A" } },
  })
  c.ok(r.ok, `set override applied: ${r.message}`)
  c.ok(
    (await viewNode(page, "inst000001/title00001"))?.content === "Pro",
    "set override visible in view",
  )
  c.ok((await getNode(page, "title00001"))?.content === "Plan name", "main untouched")
  await oneUndo(page, c, before, "set override")
  // Reset one field keeps the other.
  before = await docJson(page)
  r = await run(page, {
    cmd: "resetOverride",
    instance: "inst000001",
    path: "title00001",
    options: { fields: ["fill"] },
  })
  const ov = ((await getNode(page, "inst000001"))?.overrides as Rec | undefined)?.title00001 as
    | Rec
    | undefined
  c.ok(
    r.ok && (ov?.set as Rec)?.content === "Pro" && !(ov?.set as Rec)?.fill,
    `field reset keeps content: ${JSON.stringify(ov)}`,
  )
  await oneUndo(page, c, before, "field reset")
  // --- slot ---
  before = await docJson(page)
  r = await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "actions001",
    change: {
      kind: "slot",
      content: [
        { node: { type: "rect", name: "Btn1", w: 60, h: 28, fill: "#2A1E14" } },
        { node: { type: "rect", name: "Btn2", w: 60, h: 28, fill: "#2A1E14" } },
      ],
    },
  })
  c.ok(r.ok, `slot override: ${r.message}`)
  let d = await doc(page)
  const owned = ownedBy(d, "inst000001")
  c.ok(
    owned.length === 2 && owned.every(([, n]) => n.at === "actions001"),
    `slot content owned by the instance with at: ${JSON.stringify(owned)}`,
  )
  const slotKids = await page.evaluate(() => [
    ...(window as unknown as QW).__kimo.m3.view().children("inst000001/actions001"),
  ])
  c.ok(slotKids.length === 2, `expanded slot shows the 2 nodes: ${JSON.stringify(slotKids)}`)
  for (const id of slotKids) c.ok(!!(await layoutBox(page, id)), `slot child ${id} laid out`)
  c.ok((await validDoc(page)).ok, "slot override valid")
  await oneUndo(page, c, before, "slot override")
  // Slot override on a non-slot frame refused.
  r = await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: { kind: "slot", content: [] },
  })
  c.ok(!r.ok, "slot override on a non-slot target refused")
  // Reset slot deletes the owned content (no orphans).
  before = await docJson(page)
  r = await run(page, { cmd: "resetOverride", instance: "inst000001", path: "actions001" })
  d = await doc(page)
  c.ok(r.ok && ownedBy(d, "inst000001").length === 0, "slot reset removes the owned nodes")
  c.ok((await validDoc(page)).ok, "valid after slot reset")
  await oneUndo(page, c, before, "slot reset")
  // --- replace ---
  before = await docJson(page)
  r = await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: {
      kind: "replace",
      node: { type: "ellipse", name: "Dot", w: 16, h: 16, fill: "#06D6A0" },
    },
  })
  c.ok(r.ok, `replace override: ${r.message}`)
  const kids = await viewChildren(page, "inst000001")
  c.ok(!kids.includes("inst000001/badge00001"), `replaced target gone from the view: ${kids}`)
  const repl = ownedBy(await doc(page), "inst000001").find(([, n]) => n.at === "badge00001")
  c.ok(
    !!repl && kids.includes(repl[0]),
    `replacement in the target's place: ${JSON.stringify(kids)}`,
  )
  c.ok(
    repl && kids.indexOf(repl[0]) === 1,
    `replacement keeps the sibling position (index 1): ${kids.indexOf(repl?.[0] ?? "")}`,
  )
  c.ok((await validDoc(page)).ok, "replace valid")
  await oneUndo(page, c, before, "replace override")
  // Replace twice in a row: one replacement only.
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: { kind: "replace", node: { type: "ellipse", name: "Dot2", w: 16, h: 16 } },
  })
  const repls = ownedBy(await doc(page), "inst000001").filter(([, n]) => n.at === "badge00001")
  c.ok(repls.length === 1, `second replace swaps the replacement (count ${repls.length})`)
  c.ok((await validDoc(page)).ok, `valid after double replace: ${(await validDoc(page)).errors}`)
  // Changing kind replace → set clears the replacement node.
  r = await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: { kind: "set", set: { fill: "#000000" } },
  })
  const v = await validDoc(page)
  c.ok(
    v.ok &&
      (!r.ok || ownedBy(await doc(page), "inst000001").every(([, n]) => n.at !== "badge00001")),
    `replace → set refused or leaves no orphan replacement (ok=${r.ok}): ${v.errors.join("; ")}`,
  )
  // Reset all.
  before = await docJson(page)
  await run(page, { cmd: "resetAllOverrides", instance: "inst000001" })
  const inst = await getNode(page, "inst000001")
  c.ok(
    !inst?.overrides && ownedBy(await doc(page), "inst000001").length === 0,
    "reset all clears everything",
  )
  if (before !== (await docJson(page))) await oneUndo(page, c, before, "reset all")
  // Overrides on the root path are forbidden (props instead).
  r = await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "main000001",
    change: { kind: "set", set: { fill: "#000000" } },
  })
  c.ok(!r.ok || (await validDoc(page)).ok, "override keyed by the root id refused (spec §9.6)")
  c.done()
}

async function propsAndArgs({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  const decl = async (name: string, def: Rec) =>
    run(page, { cmd: "declareProp", component: "main000001", name, def })
  c.ok(
    (
      await decl("label", {
        type: "text",
        target: "title00001",
        field: "content",
        default: "Plan name",
      })
    ).ok,
    "text prop",
  )
  c.ok(
    (await decl("showBadge", { type: "boolean", target: "badge00001", field: "visible" })).ok,
    "boolean prop",
  )
  c.ok(
    (
      await decl("tone", {
        type: "enum",
        target: "badge00001",
        field: "fill",
        options: { warm: "#F6DFC6", cool: "#BDE0FE" },
      })
    ).ok,
    "enum prop",
  )
  c.ok(
    (await decl("icon", { type: "instance", target: "icon000001", default: "starmain01" })).ok,
    "instance prop",
  )
  c.ok((await decl("actions", { type: "slot", target: "actions001" })).ok, "slot prop")
  // Invalid declarations refused.
  c.ok(
    !(await decl("bad1", { type: "text", target: "badge00001", field: "content" })).ok,
    "text prop on a rect refused",
  )
  c.ok(
    !(await decl("bad2", { type: "instance", target: "badge00001" })).ok,
    "instance prop on a rect refused",
  )
  c.ok(
    !(await decl("label", { type: "text", target: "title00001", field: "content" })).ok,
    "duplicate prop name refused",
  )
  c.ok(
    !(await decl("bad3", { type: "enum", target: "badge00001", field: "fill", options: { x: 42 } }))
      .ok,
    "enum option invalid for the field refused",
  )
  const comp = (await getNode(page, "main000001"))?.component as Rec
  const props = (comp?.props ?? {}) as Record<string, Rec>
  c.ok(
    Object.values(props).every((p) => typeof p.order === "string"),
    `editor writes an order on every declaration (spec §9.6 SHOULD): ${JSON.stringify(props)}`,
  )
  // Properties section lists them in declaration order.
  await select(page, ["inst000001"])
  const rows = page.locator('[data-testid="properties-section"] [data-prop]')
  await rows.first().waitFor()
  const names = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-prop")))
  c.ok(
    JSON.stringify(names) === JSON.stringify(["label", "showBadge", "tone", "icon", "actions"]),
    `props listed in declaration order: ${JSON.stringify(names)}`,
  )
  // Args per type via commands; verify the expanded view.
  const before = await docJson(page)
  let r = await run(page, {
    cmd: "setArgs",
    instance: "inst000001",
    args: { label: "Team", showBadge: false, tone: "cool", icon: "heartmain1" },
  })
  c.ok(r.ok, `setArgs all types: ${r.message}`)
  c.ok((await viewNode(page, "inst000001/title00001"))?.content === "Team", "text arg → content")
  c.ok((await viewNode(page, "inst000001/badge00001"))?.visible === false, "boolean arg → visible")
  const bl = await layoutBox(page, "inst000001/badge00001")
  c.ok(!bl || bl.visible === false, `hidden badge not visible in layout: ${JSON.stringify(bl)}`)
  c.ok((await viewNode(page, "inst000001/badge00001"))?.fill === "#BDE0FE", "enum arg → fill")
  c.ok(
    (await viewNode(page, "inst000001/icon000001"))?.fill === "#EF476F",
    "instance arg swaps of (Heart root)",
  )
  const iconKids = await viewChildren(page, "inst000001/icon000001")
  c.ok(
    iconKids.length === 0,
    `swapped nested instance shows Heart content (no star glyph): ${JSON.stringify(iconKids)}`,
  )
  await oneUndo(page, c, before, "setArgs (4 props in one gesture)")
  // Bad arg values refused.
  r = await run(page, { cmd: "setArgs", instance: "inst000001", args: { tone: "nope" } })
  c.ok(!r.ok, "unknown enum option refused")
  r = await run(page, { cmd: "setArgs", instance: "inst000001", args: { showBadge: "yes" } })
  c.ok(!r.ok, "boolean arg with a string refused")
  r = await run(page, { cmd: "setArgs", instance: "inst000001", args: { actions: "x" } })
  c.ok(!r.ok, "slot props take no args")
  r = await run(page, { cmd: "setArgs", instance: "inst000001", args: { nope: 1 } })
  c.ok(!r.ok, "undeclared arg refused (ARG_UNKNOWN)")
  r = await run(page, { cmd: "setArgs", instance: "inst000001", args: { icon: "main000001" } })
  c.ok(!r.ok, "instance arg that would nest the card in itself refused (cycle)")
  // Args panel UI: boolean toggle + text field.
  await select(page, ["inst000001"])
  const label = page.locator(
    '[data-testid="properties-section"] [data-prop="label"] .kimo-instance-prop-row__value',
  )
  await label.fill("From panel")
  await label.press("Enter")
  await settle(page)
  c.ok(
    ((await getNode(page, "inst000001"))?.args as Rec)?.label === "From panel",
    "text row writes args",
  )
  // Rename a prop keeps the instance's arg.
  r = await run(page, {
    cmd: "updateProp",
    component: "main000001",
    name: "label",
    patch: { rename: "heading" },
  })
  const args = (await getNode(page, "inst000001"))?.args as Rec | undefined
  c.ok(
    r.ok && args?.heading === "From panel" && !("label" in (args ?? {})),
    `rename migrates args: ${JSON.stringify(args)}`,
  )
  // Remove a prop drops its args (note) and keeps the doc valid.
  r = await run(page, { cmd: "removeProp", component: "main000001", name: "heading" })
  const v = await validDoc(page)
  c.ok(r.ok && v.ok, `remove prop leaves a valid doc: ${v.errors.join("; ")}`)
  // Reorder prop.
  r = await run(page, {
    cmd: "reorderProp",
    component: "main000001",
    name: "icon",
    before: "showBadge",
  })
  await select(page, [])
  await select(page, ["inst000001"])
  const names2 = await page
    .locator('[data-testid="properties-section"] [data-prop]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-prop")))
  c.ok(names2[0] === "icon", `reorder moves icon first: ${JSON.stringify(names2)}`)
  c.done()
}

async function swapAndDetach({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  // Nested swap via swapInstance with path.
  let before = await docJson(page)
  let r = await run(page, {
    cmd: "swapInstance",
    instance: "inst000001",
    of: "heartmain1",
    path: "icon000001",
  })
  c.ok(
    r.ok && (await viewNode(page, "inst000001/icon000001"))?.fill === "#EF476F",
    `nested swap: ${r.message}`,
  )
  await oneUndo(page, c, before, "nested swap")
  await storeUndo(page)
  // Override on the nested star glyph, then swap → dropped override + warning toast.
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "icon000001/starglyph1",
    change: { kind: "set", set: { fill: "#000000" } },
  })
  c.ok(
    (await viewNode(page, "inst000001/icon000001/starglyph1"))?.fill === "#000000",
    "deep path override applies (outer wins)",
  )
  r = await run(page, {
    cmd: "swapInstance",
    instance: "inst000001",
    of: "heartmain1",
    path: "icon000001",
  })
  const v = await validDoc(page)
  c.ok(v.ok, `swap with now-unresolvable deep override stays valid: ${v.errors.join("; ")}`)
  c.ok(
    (await toasts(page)).some((t) => /override.*dropped/.test(t.text)),
    `dropped override announced: ${JSON.stringify(await toasts(page))}`,
  )
  // Root swap: card → star (a different component).
  before = await docJson(page)
  r = await run(page, { cmd: "swapInstance", instance: "inst000001", of: "starmain01" })
  c.ok(r.ok && (await getNode(page, "inst000001"))?.of === "starmain01", `root swap: ${r.message}`)
  c.ok((await validDoc(page)).ok, `root swap valid: ${(await validDoc(page)).errors}`)
  await storeUndo(page)
  // Swap UI: "Swap" action pill opens the popover listing components.
  await select(page, ["inst000001"])
  const swap = page.locator(".m3-action-pill", { hasText: "Swap" })
  if (await swap.count()) {
    await swap.click()
    await page
      .locator(".m3-swap-popover, [data-testid='swap-popover']")
      .first()
      .waitFor({ timeout: 3000 })
      .catch(() => {})
    c.ok(
      (await page.locator(".m3-swap-popover, [data-testid='swap-popover']").count()) > 0,
      "Swap pill opens the swap popover",
    )
    await page.keyboard.press("Escape")
  } else c.ok(false, "Instance section has a Swap action pill")
  // Detach must still work after a nested swap that left deep overrides behind.
  r = await run(page, { cmd: "detachInstance", id: "inst000001" })
  c.ok(r.ok, "detach succeeds after a nested swap (no stale deep override blocks it)")
  if (r.ok) await storeUndo(page)
  // --- Detach keeps slot content, nested instances, overrides baked ---
  await run(page, { cmd: "resetAllOverrides", instance: "inst000001" })
  await select(page, [])
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "actions001",
    change: {
      kind: "slot",
      content: [{ node: { type: "rect", name: "Btn", w: 60, h: 28, fill: "#111111" } }],
    },
  })
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "title00001",
    change: { kind: "set", set: { content: "Detached title" } },
  })
  before = await docJson(page)
  r = await run(page, { cmd: "detachInstance", id: "inst000001" })
  c.ok(r.ok, `detach: ${r.message}`)
  const d = await doc(page)
  const nodes = d.nodes as Record<string, Rec>
  const root = Object.entries(nodes).find(([, n]) => n.name === "Card · Pro")
  c.ok(
    root && root[1].type === "frame" && !root[1].component,
    `detached root frame: ${JSON.stringify(root)}`,
  )
  const kidsOf = (p: string) => Object.entries(nodes).filter(([, n]) => n.parent === p)
  const rootKids = root ? kidsOf(root[0]) : []
  const title = rootKids.find(([, n]) => n.name === "Title")
  c.ok(title?.[1].content === "Detached title", "override baked into the detached copy")
  const actions = rootKids.find(([, n]) => n.name === "Actions")
  const actionKids = actions ? kidsOf(actions[0]) : []
  c.ok(
    actionKids.length === 1 &&
      actionKids[0]?.[1].name === "Btn" &&
      actionKids[0]?.[1].at === undefined,
    `slot content kept as real children without at: ${JSON.stringify(actionKids)}`,
  )
  c.ok(actions?.[1].slot === undefined, "detached slot frame drops `slot`")
  const icon = rootKids.find(([, n]) => n.name === "Icon")
  c.ok(
    icon?.[1].type === "instance" && icon[1].of === "starmain01",
    "nested instance stays an instance",
  )
  c.ok(
    root && root[1].x === 320 && root[1].y === 40,
    `detached root keeps placement: ${JSON.stringify(root && { x: root[1].x, y: root[1].y })}`,
  )
  const vd = await validDoc(page)
  c.ok(vd.ok, `detached doc valid: ${vd.errors.join("; ")}`)
  c.ok(
    Object.keys(nodes).every((id) => !id.includes("/")),
    "detach never writes composite ids into the store",
  )
  await oneUndo(page, c, before, "detach")
  c.done()
}

async function derivedAndNested({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  await run(page, {
    cmd: "declareProp",
    component: "main000001",
    name: "label",
    def: { type: "text", target: "title00001", field: "content" },
  })
  // A second instance with overrides becomes a derived component (⌥⌘K on an instance).
  await apply(page, [
    {
      op: "insert",
      id: "inst000002",
      parent: null,
      node: { type: "instance", name: "Card/Ghost", of: "main000001", x: 40, y: 400 },
    },
  ])
  await run(page, {
    cmd: "setOverride",
    instance: "inst000002",
    path: "badge00001",
    change: { kind: "set", set: { fill: "#BDE0FE" } },
  })
  const before = await docJson(page)
  let r = await run(page, { cmd: "createComponent", ids: ["inst000002"] })
  c.ok(
    r.ok && (await getNode(page, "inst000002"))?.component === true,
    `derived component: ${r.message}`,
  )
  await oneUndo(page, c, before, "derive component")
  // Instance of the derived component: inherits the override and the prop API.
  r = await run(page, {
    cmd: "createInstance",
    of: "inst000002",
    placement: { parent: null, x: 400, y: 400, id: "inst000003" },
  })
  c.ok(r.ok, `instance of derived: ${r.message}`)
  c.ok(
    (await viewNode(page, "inst000003/badge00001"))?.fill === "#BDE0FE",
    "derived override inherited",
  )
  r = await run(page, { cmd: "setArgs", instance: "inst000003", args: { label: "Ghost" } })
  c.ok(
    r.ok && (await viewNode(page, "inst000003/title00001"))?.content === "Ghost",
    `inherited prop API: ${r.message}`,
  )
  c.ok((await validDoc(page)).ok, `derived valid: ${(await validDoc(page)).errors}`)
  // Base change still flows through the derived component.
  await apply(page, [{ op: "update", id: "title00001", set: { fill: "#00FF00" } }])
  c.ok(
    (await viewNode(page, "inst000003/title00001"))?.fill === "#00FF00",
    "base edit flows through derived",
  )
  // Derived component panel: "Instance of" row.
  await select(page, ["inst000002"])
  await page.locator(".selection-header").waitFor()
  c.ok(
    (await page.locator(".selection-header .m3-kind-pill__label").textContent()) === "Derived",
    `derived component Kind pill reads Derived: ${await page.locator(".selection-header .m3-kind-pill__label").textContent()}`,
  )
  c.ok(
    (await page.locator(".m3-derived-row").count()) === 1,
    "Component section shows 'Instance of' for derived",
  )
  const rowKind = await page
    .locator('.layer-tree [data-node-id="inst000002"]')
    .getAttribute("data-kind")
  c.ok(rowKind === "derived", `layers row uses LayerRow/Derived (x5xNG): ${rowKind}`)
  // --- Cycles ---
  r = await run(page, {
    cmd: "createInstance",
    of: "main000001",
    placement: { parent: "main000001" },
  })
  c.ok(!r.ok && r.code === "CYCLE", `instance of A inside A refused: ${r.code}`)
  c.ok(
    (await toasts(page)).some(
      (t) => t.text === "Can't nest a main component inside its own instance",
    ),
    "cycle toast copy",
  )
  r = await run(page, {
    cmd: "createInstance",
    of: "inst000002",
    placement: { parent: "main000001" },
  })
  c.ok(!r.ok, "instance of a derived (of A) inside A refused")
  // Drag/move an instance of A into A via a plain move op.
  const moved = await apply(page, [{ op: "move", id: "inst000003", parent: "main000001" }], "Move")
  c.ok(!moved, "moving an instance of A into A is refused")
  // Swap nested icon to the card itself → cycle.
  r = await run(page, {
    cmd: "swapInstance",
    instance: "inst000001",
    of: "main000001",
    path: "icon000001",
  })
  c.ok(!r.ok, "nested swap that would self-nest refused")
  if (r.ok) await storeUndo(page)
  // --- Nested instances: composite ids & edits ---
  const deep = await viewNode(page, "inst000001/icon000001/starglyph1")
  c.ok(!!deep, "deep composite id resolves")
  const ok = await apply(
    page,
    [{ op: "update", id: "inst000001/icon000001/starglyph1", set: { fill: "#123123" } }],
    "Fill",
  )
  const inst = await getNode(page, "inst000001")
  c.ok(
    ok &&
      ((inst?.overrides as Rec)?.["icon000001/starglyph1"] as Rec | undefined)?.set !== undefined,
    `deep edit becomes override at the outer instance: ${JSON.stringify(inst?.overrides)}`,
  )
  c.ok((await getNode(page, "starglyph1"))?.fill === "#E2683A", "star main untouched by deep edit")
  // Deep layers row exists.
  const layoutDeep = await layoutBox(page, "inst000001/icon000001/starglyph1")
  c.ok(!!layoutDeep, "deep node laid out")
  c.done()
}

async function slots({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  // Suggested components.
  let r = await run(page, {
    cmd: "setSlot",
    frame: "actions001",
    slot: { suggested: ["starmain01", "heartmain1"] },
  })
  c.ok(r.ok, `suggested: ${r.message}`)
  await select(page, ["actions001"])
  const sec = page.locator('[data-testid="slot-section"]')
  await sec.waitFor()
  c.ok((await sec.locator(".m3-suggested-row").count()) === 2, "suggested rows listed")
  c.ok((await sec.locator(".m3-suggested-header__count").textContent()) === "2", "suggested count")
  // Suggestion that is not a component refused.
  r = await run(page, { cmd: "setSlot", frame: "actions001", slot: { suggested: ["badge00001"] } })
  c.ok(!r.ok, "suggesting a non-component refused")
  // Expose as prop via the toggle.
  const before = await docJson(page)
  await sec
    .getByRole("switch", { name: "Expose as prop" })
    .click()
    .catch(async () => {
      await sec.locator(".m3-expose-row .kimo-toggle").click()
    })
  await settle(page)
  const props = (((await getNode(page, "main000001"))?.component as Rec)?.props ?? {}) as Record<
    string,
    Rec
  >
  const slotProp = Object.entries(props).find(([, p]) => p.type === "slot")
  c.ok(
    !!slotProp && slotProp[1].target === "actions001",
    `expose creates a slot prop: ${JSON.stringify(props)}`,
  )
  c.ok(slotProp?.[0] === "actions", `prop name derived from the layer name: ${slotProp?.[0]}`)
  if (slotProp) await oneUndo(page, c, before, "expose slot")
  // Slot quick insert: instance's empty slot shows SlotQuickInsert of suggestions?
  // Fill the instance slot with a suggested component via route (insert into composite slot).
  const ok = await apply(
    page,
    [
      {
        op: "insert",
        id: "slotins001",
        parent: "inst000001/actions001",
        node: { type: "instance", of: "starmain01" },
      },
    ],
    "Insert",
  )
  const n = await getNode(page, "slotins001")
  c.ok(
    ok && n?.parent === "inst000001" && n.at === "actions001",
    `insert into a composite slot becomes instance-owned: ${JSON.stringify(n)}`,
  )
  // Inserting into a non-slot composite frame is refused with a toast.
  const t0 = (await toasts(page)).length
  const bad = await apply(
    page,
    [
      {
        op: "insert",
        id: "slotins002",
        parent: "inst000001/badge00001",
        node: { type: "rect", w: 1, h: 1 },
      },
    ],
    "Insert",
  )
  c.ok(
    !bad && (await toasts(page)).length > t0,
    "insert into non-slot instance child refused with toast",
  )
  // Turning the slot off with content → confirm; confirming deletes the content (noted) validly.
  await select(page, ["actions001"])
  await sec.locator(".m3-slot-header .kimo-toggle").first().click()
  const confirm = page.locator(".m3-confirm")
  await confirm.waitFor()
  await confirm.locator(".kimo-confirm-dialog__confirm").click()
  await settle(page)
  const v = await validDoc(page)
  c.ok(!(await getNode(page, "actions001"))?.slot, "slot off")
  c.ok(v.ok, `slot off with content leaves a valid doc: ${v.errors.join("; ")}`)
  c.ok(!(await getNode(page, "slotins001")), "slot content removed on slot off")
  c.done()
}

async function undoGranularity({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  // Panel: Fill hex edit on an instance child is one step; typing a name too.
  await select(page, ["inst000001/badge00001"])
  const before = await docJson(page)
  const nameField = page.locator(".selection-header__name").first()
  c.ok((await nameField.count()) === 1, "selection header for composite id")
  // Keyboard ⌘Z after an override reverts exactly that override.
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: { kind: "set", set: { w: 99 } },
  })
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: { kind: "set", set: { h: 33 } },
  })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press("ControlOrMeta+z")
  await settle(page)
  const set = (
    ((await getNode(page, "inst000001"))?.overrides as Rec)?.badge00001 as Rec | undefined
  )?.set as Rec | undefined
  c.ok(
    set?.w === 99 && set?.h === undefined,
    `⌘Z reverts only the last override: ${JSON.stringify(set)}`,
  )
  await page.keyboard.press("ControlOrMeta+z")
  await settle(page)
  c.ok((await docJson(page)) === before, "second ⌘Z back to the fixture")
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await settle(page)
  const set2 = (
    ((await getNode(page, "inst000001"))?.overrides as Rec)?.badge00001 as Rec | undefined
  )?.set as Rec | undefined
  c.ok(set2?.w === 99, "⇧⌘Z redoes the override")
  // Selection of a composite id survives undo/redo of the override.
  await select(page, ["inst000001/badge00001"])
  await page.keyboard.press("ControlOrMeta+z")
  await settle(page)
  c.ok(
    (await selection(page))[0] === "inst000001/badge00001",
    "composite selection kept across undo",
  )
  // Undo of a create-instance clears the selection of the gone instance.
  const r = await run(page, {
    cmd: "createInstance",
    of: "starmain01",
    placement: { parent: null, x: 900, y: 0, id: "newinst001" },
  })
  c.ok(r.ok, "createInstance")
  await select(page, ["newinst001/starglyph1"])
  await storeUndo(page)
  c.ok(
    !(await selection(page)).includes("newinst001/starglyph1"),
    "selection drops composite ids of an undone instance",
  )
  c.done()
}

async function libraryReadOnly({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  const lib = {
    format: "0.1.0",
    meta: { name: "Kimo UI" },
    themes: { mode: ["light", "dark"] },
    variables: {
      "brand/fill": {
        type: "color",
        value: [
          { value: "#111111", when: { mode: "light" } },
          { value: "#EEEEEE", when: { mode: "dark" } },
        ],
      },
    },
    nodes: {
      button01: {
        type: "frame",
        name: "Button",
        parent: null,
        order: "a0",
        w: 80,
        h: 28,
        component: true,
        fill: { $ref: "brand/fill" },
      },
      label001: { type: "text", name: "Label", parent: "button01", order: "a0", content: "OK" },
    },
  }
  await page.evaluate((d) => {
    const k = (window as unknown as QW).__kimo
    k.m3.libs.inject("ui", "./ui.kimo", d)
    k.m3.run({ cmd: "linkLibrary", alias: "ui", path: "./ui.kimo" }, "Link library")
    k.m3.run(
      {
        cmd: "createInstance",
        of: "ui:button01",
        placement: { parent: null, x: 0, y: 0, id: "libinst001" },
      },
      "insert",
    )
  }, lib)
  await settle(page)
  c.ok(!!(await getNode(page, "libinst001")), "library instance inserted")
  const v = await validDoc(page, { ui: lib })
  c.ok(v.ok, `doc with library instance valid: ${v.errors.join("; ")}`)
  // Library content edits become overrides on the local instance (allowed), but editing the
  // library main itself is impossible: the view node of the root resolves the library fill.
  const root = await viewNode(page, "libinst001")
  c.ok(
    JSON.stringify(root?.fill) === JSON.stringify({ $ref: "ui:brand/fill" }),
    `library binding qualified: ${JSON.stringify(root?.fill)}`,
  )
  const label = await viewNode(page, "libinst001/ui:label001")
  c.ok(
    label?.content === "OK",
    `library child composite id uses alias:id: ${JSON.stringify(label)}`,
  )
  const ok = await apply(
    page,
    [{ op: "update", id: "libinst001/ui:label001", set: { content: "Go" } }],
    "Text",
  )
  c.ok(ok, "overriding library content on a local instance is allowed")
  // declareProp on a library component → LIBRARY_READ_ONLY toast copy.
  const r = await run(page, {
    cmd: "declareProp",
    component: "ui:button01",
    name: "x",
    def: { type: "text", target: "ui:label001", field: "content" },
  })
  c.ok(!r.ok && r.code === "LIBRARY_READ_ONLY", `library prop declaration refused: ${r.code}`)
  c.ok(
    (await toasts(page)).some((t) =>
      / is from a linked library — edit it in its source file$/.test(t.text),
    ),
    `read-only toast copy: ${JSON.stringify(await toasts(page))}`,
  )
  // Library axis default: the library fill resolves under ui:mode light.
  const theme = await page.evaluate(() =>
    (window as unknown as QW).__kimo.m3.view().theme("libinst001"),
  )
  c.ok(
    theme["ui:mode"] === "light",
    `library axis defaults from the library: ${JSON.stringify(theme)}`,
  )
  // Pin the library axis on the instance.
  const r2 = await run(page, {
    cmd: "setThemePin",
    node: "libinst001",
    axis: "ui:mode",
    value: "dark",
  })
  c.ok(r2.ok, `library axis pin: ${r2.message}`)
  c.ok((await validDoc(page, { ui: lib })).ok, "library pin valid")
  // Changed-since-last-open: warning toast with Review.
  await page.evaluate(
    (d) => (window as unknown as QW).__kimo.m3.libs.inject("ui", "./ui.kimo", d, "changed"),
    lib,
  )
  await settle(page)
  const t = (await toasts(page)).find((x) => x.tone === "warning")
  c.ok(!!t && /changed since last open/.test(t.text), `changed toast: ${JSON.stringify(t)}`)
  c.done()
}

export const scenarios: Scenario[] = [
  { name: "qa-m3: create component from (multi) selection", run: createFromSelection },
  { name: "qa-m3: main edits propagate live to instances", run: liveUpdates },
  { name: "qa-m3: override kinds set / slot / replace + reset", run: overrideKinds },
  { name: "qa-m3: declared props + args per type", run: propsAndArgs },
  { name: "qa-m3: swap + detach (slot content kept)", run: swapAndDetach },
  { name: "qa-m3: derived components, cycles, nested instances", run: derivedAndNested },
  { name: "qa-m3: slots (suggested, expose as prop, insert, off)", run: slots },
  { name: "qa-m3: undo granularity + selection", run: undoGranularity },
  { name: "qa-m3: library read-only, axes, changed notice", run: libraryReadOnly },
]

export type { Page }
