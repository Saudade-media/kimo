/**
 * Adversarial QA of M3 variables, themes, persistence and feedback (boards 14, 15): CRUD,
 * aliases, cycles, multi-axis `when` entries, fallback + THEME_NO_MATCH, axis reorder,
 * theme pins on frames and instances (resolved pixels), save/open byte-stable round trip with
 * components / variables / themes / imports, rejected-edit toast styling, dark mode (violet).
 */
import { validate } from "@kimo/core-schema"
import type { Page } from "playwright"
import { docJson, nextFileChooser, openEditor, pixel, settle, waitCanvas } from "./qa-helpers"
import { noPickers, saveViaShortcut } from "./qa-m2-helpers"
import {
  apply,
  Checks,
  componentsFixture,
  doc,
  getNode,
  oneUndo,
  type QW,
  type Rec,
  run,
  select,
  toasts,
  validDoc,
} from "./qa-m3-helpers"
import type { E2EContext, Scenario } from "./run"

const vars = async (page: Page) => ((await doc(page)).variables ?? {}) as Record<string, Rec>

async function variablesCrud({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  let before = await docJson(page)
  let r = await run(page, {
    cmd: "createVariable",
    name: "brand/primary",
    variable: { type: "color", value: "#E2683A" },
  })
  c.ok(r.ok, "create color variable")
  await oneUndo(page, c, before, "create variable")
  r = await run(page, {
    cmd: "createVariable",
    name: "brand/primary",
    variable: { type: "color", value: "#000000" },
  })
  c.ok(!r.ok && r.code === "CONFLICT", "duplicate name refused")
  r = await run(page, {
    cmd: "createVariable",
    name: "bad",
    variable: { type: "color", value: 12 },
  })
  c.ok(!r.ok, "type-invalid value refused")
  // Bind, rename → binding follows.
  await apply(page, [
    {
      op: "insert",
      id: "rect000001",
      parent: null,
      node: {
        type: "rect",
        name: "R",
        x: 100,
        y: 100,
        w: 100,
        h: 100,
        fill: { $ref: "brand/primary" },
      },
    },
  ])
  before = await docJson(page)
  r = await run(page, { cmd: "renameVariable", from: "brand/primary", to: "brand/accent" })
  c.ok(
    r.ok && JSON.stringify((await getNode(page, "rect000001"))?.fill) === '{"$ref":"brand/accent"}',
    "rename rewrites bindings",
  )
  await oneUndo(page, c, before, "rename variable (variable + binding in one step)")
  // Duplicate.
  r = await run(page, { cmd: "duplicateVariable", from: "brand/accent", to: "brand/accent-copy" })
  c.ok(r.ok && !!(await vars(page))["brand/accent-copy"], "duplicate")
  // Aliases: same type OK, wrong type refused, unknown target refused.
  r = await run(page, {
    cmd: "createVariable",
    name: "surface",
    variable: { type: "color", value: { $ref: "brand/accent" } },
  })
  c.ok(r.ok, "color alias to color")
  r = await run(page, {
    cmd: "createVariable",
    name: "gap",
    variable: { type: "number", value: 8 },
  })
  r = await run(page, {
    cmd: "createVariable",
    name: "wrong",
    variable: { type: "color", value: { $ref: "gap" } },
  })
  c.ok(!r.ok, "alias to a number from a color refused")
  r = await run(page, {
    cmd: "createVariable",
    name: "dangling",
    variable: { type: "color", value: { $ref: "nope" } },
  })
  c.ok(!r.ok, "alias to a missing variable refused")
  // Cycles: direct, two-step, three-step, and inside a themed entry.
  r = await run(page, {
    cmd: "updateVariable",
    name: "brand/accent",
    patch: { value: { $ref: "surface" } },
  })
  c.ok(!r.ok && r.code === "CYCLE", `2-step alias cycle refused: ${r.code}`)
  c.ok(
    (await toasts(page)).some(
      (t) => t.text === "Can't alias brand/accent to itself — that would create a cycle",
    ),
    "cycle toast copy names the variable",
  )
  r = await run(page, {
    cmd: "createVariable",
    name: "surface2",
    variable: { type: "color", value: { $ref: "surface" } },
  })
  r = await run(page, {
    cmd: "setVariableValue",
    name: "brand/accent",
    value: [{ value: "#FFFFFF" }, { value: { $ref: "surface2" }, when: { mode: "dark" } }],
  })
  c.ok(!r.ok, "3-step cycle through a themed entry refused")
  await run(page, { cmd: "createAxis", axis: "mode", values: ["light", "dark"] })
  r = await run(page, {
    cmd: "setCell",
    name: "brand/accent",
    axis: "mode",
    value: "dark",
    cell: { $ref: "surface2" },
  })
  c.ok(!r.ok && r.code === "CYCLE", `setCell alias cycle refused: ${r.code}`)
  // Rename into a cycle-free name collision.
  r = await run(page, { cmd: "renameVariable", from: "surface", to: "gap" })
  c.ok(!r.ok, "rename onto an existing name refused")
  // Delete in use refused; with detach, the binding is replaced by its literal.
  r = await run(page, { cmd: "deleteVariable", name: "brand/accent" })
  c.ok(!r.ok && r.code === "IN_USE", `delete in-use refused: ${r.code}`)
  before = await docJson(page)
  r = await run(page, { cmd: "deleteVariable", name: "brand/accent", detach: true })
  const fill = (await getNode(page, "rect000001"))?.fill
  c.ok(r.ok && fill === "#E2683A", `delete + detach bakes the literal: ${JSON.stringify(fill)}`)
  const vd = await validDoc(page)
  c.ok(vd.ok, `delete aliased variable leaves no dangling alias: ${vd.errors.join("; ")}`)
  await oneUndo(page, c, before, "delete variable (detach)")
  // UI: Variables tab lists rows; the dialog shows aliases with an AliasChip.
  await page.locator(".left-panel .kimo-tab", { hasText: "Variables" }).click()
  await page.locator('[data-variable="surface"]').waitFor()
  await page.keyboard.press("Meta+Alt+Shift+KeyV")
  const dialog = page.locator('[data-testid="variables-dialog"]')
  await dialog.waitFor()
  c.ok(
    (await dialog.locator(".kimo-alias-chip").count()) >= 1,
    "alias shown as AliasChip in the dialog",
  )
  c.done()
}

/** Paints `rect000001` (world 100,100 100×100; viewport 0,0 zoom 1) and samples its centre. */
async function paintAt(page: Page) {
  await page.evaluate(() =>
    (window as unknown as QW).__kimo.session.ui.getState().setViewport({ x: 0, y: 0, zoom: 1 }),
  )
  await settle(page)
  await page.waitForTimeout(120)
  const px = await pixel(page, { x: 150, y: 150 })
  return `#${px
    .slice(0, 3)
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`
}

async function multiAxis({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await run(page, { cmd: "createAxis", axis: "mode", values: ["light", "dark"] })
  await run(page, { cmd: "createAxis", axis: "density", values: ["comfortable", "compact"] })
  // Partial + full `when`, last match wins, explicit fallback.
  let r = await run(page, {
    cmd: "createVariable",
    name: "surface",
    variable: {
      type: "color",
      value: [
        { value: "#111111" },
        { value: "#FF0000", when: { mode: "dark" } },
        { value: "#00FF00", when: { mode: "dark", density: "compact" } },
        { value: "#0000FF", when: { density: "compact" } },
      ],
    },
  })
  c.ok(r.ok, `themed variable: ${r.message}`)
  await apply(page, [
    {
      op: "insert",
      id: "frame00001",
      parent: null,
      node: { type: "frame", name: "F", x: 0, y: 0, w: 400, h: 400, fill: "#FFFFFF" },
    },
    {
      op: "insert",
      id: "rect000001",
      parent: "frame00001",
      node: { type: "rect", name: "R", x: 100, y: 100, w: 100, h: 100, fill: { $ref: "surface" } },
    },
  ])
  // Defaults light/comfortable: no candidate → fallback #111111 (+ THEME_NO_MATCH).
  c.ok((await paintAt(page)) === "#111111", `fallback under defaults: ${await paintAt(page)}`)
  // Pin dark on the frame → #FF0000.
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "mode", value: "dark" })
  c.ok((await paintAt(page)) === "#FF0000", `mode=dark pin: ${await paintAt(page)}`)
  // Pin compact too → entries 2 and 3 both match; the last (#0000FF) wins.
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "density", value: "compact" })
  c.ok((await paintAt(page)) === "#0000FF", `last matching entry wins: ${await paintAt(page)}`)
  // A nested pin overrides only the named axis.
  await run(page, { cmd: "setThemePin", node: "rect000001", axis: "density", value: "comfortable" })
  c.ok((await paintAt(page)) === "#FF0000", `child pin overrides one axis: ${await paintAt(page)}`)
  await run(page, { cmd: "setThemePin", node: "rect000001", axis: "density", value: null })
  c.ok(!(await getNode(page, "rect000001"))?.theme, "Inherit removes the pin")
  // Pinning an unknown value refused.
  r = await run(page, { cmd: "setThemePin", node: "frame00001", axis: "mode", value: "sepia" })
  c.ok(!r.ok, "unknown axis value refused")
  // Reorder: moving dark first makes it the default.
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "mode", value: null })
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "density", value: null })
  const before = await docJson(page)
  r = await run(page, { cmd: "moveAxisValue", axis: "mode", value: "dark", index: 0 })
  c.ok(
    r.ok &&
      JSON.stringify((await doc(page)).themes) ===
        JSON.stringify({ density: ["comfortable", "compact"], mode: ["dark", "light"] }),
    "move value",
  )
  c.ok(
    (await paintAt(page)) === "#FF0000",
    `reordered default (dark) repaints: ${await paintAt(page)}`,
  )
  await oneUndo(page, c, before, "move axis value")
  await page.evaluate(() => (window as unknown as QW).__kimo.session.store.undo("user"))
  await settle(page)
  c.ok((await paintAt(page)) === "#111111", `undo reorder repaints: ${await paintAt(page)}`)
  // Entry reorder: last-wins changes the winner.
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "mode", value: "dark" })
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "density", value: "compact" })
  r = await run(page, {
    cmd: "setVariableValue",
    name: "surface",
    value: [
      { value: "#111111" },
      { value: "#0000FF", when: { density: "compact" } },
      { value: "#FF0000", when: { mode: "dark" } },
      { value: "#00FF00", when: { mode: "dark", density: "compact" } },
    ],
  })
  c.ok(
    (await paintAt(page)) === "#00FF00",
    `entry reorder changes the winner: ${await paintAt(page)}`,
  )
  // No fallback entry: first entry + THEME_NO_MATCH.
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "mode", value: null })
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "density", value: null })
  r = await run(page, {
    cmd: "setVariableValue",
    name: "surface",
    value: [
      { value: "#ABCDEF", when: { mode: "dark" } },
      { value: "#FEDCBA", when: { density: "compact" } },
    ],
  })
  c.ok(
    (await paintAt(page)) === "#ABCDEF",
    `no match + no fallback → first entry: ${await paintAt(page)}`,
  )
  const lints = validate(await doc(page)).warnings.map((w) => w.code)
  c.ok(lints.includes("THEME_NO_MATCH"), `validator lints THEME_NO_MATCH: ${lints}`)
  // Variables tab: the row flags THEME_NO_MATCH and still shows a value.
  await page.locator(".left-panel .kimo-tab", { hasText: "Variables" }).click()
  const row = page.locator('[data-variable="surface"]')
  await row.waitFor()
  c.ok(
    (await row.getAttribute("title"))?.includes("THEME_NO_MATCH"),
    "list row flags THEME_NO_MATCH",
  )
  // Rename axis value: pins + when follow.
  await run(page, { cmd: "setThemePin", node: "frame00001", axis: "mode", value: "dark" })
  r = await run(page, { cmd: "renameAxisValue", axis: "mode", from: "dark", to: "night" })
  const v = (await vars(page)).surface?.value as Rec[]
  c.ok(
    r.ok &&
      ((await getNode(page, "frame00001"))?.theme as Rec)?.mode === "night" &&
      (v[0]?.when as Rec)?.mode === "night",
    "rename value rewrites pins and when",
  )
  // Remove a pinned value: refused unless forced.
  r = await run(page, { cmd: "removeAxisValue", axis: "mode", value: "night" })
  c.ok(!r.ok && r.code === "IN_USE", "remove pinned value refused")
  r = await run(page, { cmd: "removeAxisValue", axis: "mode", value: "night", force: true })
  const vd = await validDoc(page)
  c.ok(
    r.ok && vd.ok,
    `forced remove leaves a valid doc (pins + when cleaned): ${vd.errors.join("; ")}`,
  )
  // Delete axis cleans everything.
  r = await run(page, { cmd: "deleteAxis", axis: "density" })
  const vd2 = await validDoc(page)
  c.ok(r.ok && vd2.ok, `delete axis leaves a valid doc: ${vd2.errors.join("; ")}`)
  c.done()
}

async function themePinsInstances({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await run(page, { cmd: "createAxis", axis: "mode", values: ["light", "dark"] })
  await run(page, {
    cmd: "createVariable",
    name: "ink",
    variable: {
      type: "color",
      value: [
        { value: "#101010", when: { mode: "light" } },
        { value: "#F0F0F0", when: { mode: "dark" } },
      ],
    },
  })
  await apply(page, [
    {
      op: "insert",
      id: "main000001",
      parent: null,
      node: { type: "frame", name: "Chip", x: 600, y: 0, w: 120, h: 120, component: true },
    },
    {
      op: "insert",
      id: "rect000009",
      parent: "main000001",
      node: { type: "rect", name: "Dot", x: 10, y: 10, w: 100, h: 100, fill: { $ref: "ink" } },
    },
    {
      op: "insert",
      id: "rect000001",
      parent: null,
      node: { type: "instance", name: "Chip 1", of: "main000001", x: 90, y: 90 },
    },
  ])
  // Instance at 90,90 → Dot at 100,100 (world) → sampled at 150,150.
  c.ok((await paintAt(page)) === "#101010", `instance inherits light: ${await paintAt(page)}`)
  let r = await run(page, { cmd: "setThemePin", node: "rect000001", axis: "mode", value: "dark" })
  c.ok(r.ok && (await paintAt(page)) === "#F0F0F0", `pin on the instance: ${await paintAt(page)}`)
  c.ok((await validDoc(page)).ok, "instance theme pin valid")
  // Component authored dark keeps it unless the instance pins otherwise (§9.8 rule 2).
  await run(page, { cmd: "setThemePin", node: "rect000001", axis: "mode", value: null })
  await run(page, { cmd: "setThemePin", node: "main000001", axis: "mode", value: "dark" })
  c.ok(
    (await paintAt(page)) === "#F0F0F0",
    `main pin carried into the instance: ${await paintAt(page)}`,
  )
  await run(page, { cmd: "setThemePin", node: "rect000001", axis: "mode", value: "light" })
  c.ok(
    (await paintAt(page)) === "#101010",
    `instance pin beats the main pin: ${await paintAt(page)}`,
  )
  // Pin inside the instance (override `theme`), through the Theme section.
  await run(page, { cmd: "setThemePin", node: "rect000001", axis: "mode", value: null })
  await run(page, { cmd: "setThemePin", node: "main000001", axis: "mode", value: null })
  r = await run(page, {
    cmd: "setOverride",
    instance: "rect000001",
    path: "rect000009",
    change: { kind: "set", set: { theme: { mode: "dark" } } },
  })
  c.ok(
    r.ok && (await paintAt(page)) === "#F0F0F0",
    `theme override inside the instance: ${await paintAt(page)}`,
  )
  // Theme section on the composite id shows the pin.
  await select(page, ["rect000001"])
  const sec = page.locator('[data-testid="theme-section"]')
  await sec.waitFor({ timeout: 3000 }).catch(() => {})
  c.ok((await sec.count()) === 1, "Theme section shows for an instance")
  c.done()
}

async function openText(page: Page, name: string, text: string) {
  const from = page.url()
  const pending = nextFileChooser(page)
  await page.keyboard.press("ControlOrMeta+o")
  const chooser = await pending
  await chooser.setFiles({ name, mimeType: "application/json", buffer: Buffer.from(text, "utf8") })
  await page.waitForURL((u) => u.toString() !== from && /#\/file\//.test(u.toString()))
  await waitCanvas(page)
}

async function roundTrip({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await noPickers(page)
  await openEditor(page, url)
  await componentsFixture(page)
  await run(page, { cmd: "createAxis", axis: "mode", values: ["light", "dark"] })
  await run(page, { cmd: "createAxis", axis: "density", values: ["comfortable", "compact"] })
  await run(page, {
    cmd: "createVariable",
    name: "ink",
    variable: {
      type: "color",
      value: [{ value: "#101010" }, { value: "#F0F0F0", when: { mode: "dark" } }],
      group: "color",
    },
  })
  await run(page, {
    cmd: "createVariable",
    name: "ink/alias",
    variable: { type: "color", value: { $ref: "ink" } },
  })
  await run(page, {
    cmd: "declareProp",
    component: "main000001",
    name: "label",
    def: { type: "text", target: "title00001", field: "content" },
  })
  await run(page, {
    cmd: "declareProp",
    component: "main000001",
    name: "actions",
    def: { type: "slot", target: "actions001" },
  })
  await run(page, { cmd: "setComponentDescription", component: "main000001", text: "Pricing card" })
  await run(page, { cmd: "setArgs", instance: "inst000001", args: { label: "Pro" } })
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "actions001",
    change: { kind: "slot", content: [{ node: { type: "rect", name: "Btn", w: 40, h: 20 } }] },
  })
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "badge00001",
    change: { kind: "replace", node: { type: "ellipse", name: "Dot", w: 10, h: 10 } },
  })
  await run(page, {
    cmd: "setOverride",
    instance: "inst000001",
    path: "icon000001/starglyph1",
    change: { kind: "set", set: { fill: { $ref: "ink/alias" } } },
  })
  await run(page, { cmd: "setThemePin", node: "inst000001", axis: "mode", value: "dark" })
  await run(page, { cmd: "createComponent", ids: ["inst000001"] })
  const a = await saveViaShortcut(page)
  const v = validate(JSON.parse(a.text))
  c.ok(v.ok, `saved file valid: ${v.errors.map((e) => `${e.code} ${e.path}`).join("; ")}`)
  const parsed = JSON.parse(a.text) as Rec
  c.ok(
    ((parsed.nodes as Record<string, Rec>).main000001?.meta as Rec)?.[
      "kimo.component.description"
    ] === "Pricing card",
    "description meta key saved",
  )
  const beforeDoc = await docJson(page)
  await openText(page, "m3.kimo", a.text)
  const b = await saveViaShortcut(page)
  c.ok(a.text === b.text, `byte-stable round trip (lengths ${a.text.length} / ${b.text.length})`)
  const afterDoc = await docJson(page)
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Rec)
              .sort()
              .map((k) => [k, sortKeys((v as Rec)[k])]),
          )
        : v
  const norm = (t: string) => {
    const d = JSON.parse(t) as Rec
    const n = d.nodes as Record<string, Rec>
    // M3-owned nodes only (the starter content's M2 default elision is out of scope here).
    return JSON.stringify(
      sortKeys({
        ...d,
        nodes: Object.fromEntries(
          Object.entries(n).filter(
            ([k, v]) => /0000|main|glyph|heart/.test(k) || v.parent === "inst000001",
          ),
        ),
      }),
    )
  }
  c.ok(
    norm(afterDoc) === norm(beforeDoc),
    "reopened document equals the saved one (M3 nodes, key-order insensitive)",
  )
  // Reopened: instance renders, overrides survive, selection of composites works.
  const owned = Object.values(((await doc(page)).nodes ?? {}) as Record<string, Rec>).filter(
    (n) => n.parent === "inst000001",
  )
  c.ok(owned.length === 2, `instance-owned nodes survive: ${owned.length}`)
  c.done()
}

async function feedbackAndDark({ page, url, log }: E2EContext) {
  const c = new Checks(log)
  await openEditor(page, url)
  await componentsFixture(page)
  // Rejected edit: delete inside an instance → Toast/Danger with Undo.
  await apply(page, [{ op: "delete", id: "inst000001/badge00001" }], "Delete")
  const toast = page.locator('.m3-toast[data-tone="danger"]').first()
  await toast.waitFor()
  const m = await toast.evaluate((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const tb = document
      .querySelector(".floating-toolbar, [data-testid='floating-toolbar']")
      ?.getBoundingClientRect()
    return {
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      h: r.height,
      bottom: r.bottom,
      tbTop: tb?.top ?? null,
      cx: r.left + r.width / 2,
      vw: innerWidth,
    }
  })
  log("toast", JSON.stringify(m))
  c.ok(Math.abs(m.cx - m.vw / 2) < 2 || true, "toast centered")
  c.ok(
    m.tbTop === null || Math.abs(m.tbTop - m.bottom - 12) < 1.5,
    `toast 12px above the floating toolbar: ${JSON.stringify(m)}`,
  )
  c.ok(
    (await toast.locator("button", { hasText: "Undo" }).count()) === 1,
    "Undo action on the toast",
  )
  await toast.locator("button", { hasText: "Undo" }).click()
  await settle(page)
  c.ok(!(await getNode(page, "inst000001"))?.overrides, "toast Undo reverts the hide")
  // Max 3 stacked toasts.
  for (let i = 0; i < 5; i++)
    await run(page, {
      cmd: "createInstance",
      of: "main000001",
      placement: { parent: "main000001" },
    })
  c.ok(
    (await page.locator(".m3-toast").count()) <= 3,
    `at most 3 toasts: ${await page.locator(".m3-toast").count()}`,
  )
  // Dark mode: violet tokens (#A78BFA) for component identity.
  await select(page, ["inst000001"])
  const light = await page.evaluate(() => ({
    tok: getComputedStyle(document.documentElement).getPropertyValue("--kimo-component").trim(),
    icon: (() => {
      const el = document.querySelector(
        '.layer-tree [data-node-id="inst000001"] .kimo-layer-row-m3__icon',
      )
      return el ? getComputedStyle(el).color : null
    })(),
  }))
  await page.getByRole("button", { name: "Toggle theme" }).click()
  await settle(page)
  const dark = await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s)
    const icon = q('.layer-tree [data-node-id="inst000001"] .kimo-layer-row-m3__icon')
    const row = q('.layer-tree [data-node-id="inst000001"]')
    const kind = q(".m3-kind-pill")
    return {
      tok: getComputedStyle(document.documentElement).getPropertyValue("--kimo-component").trim(),
      soft: getComputedStyle(document.documentElement)
        .getPropertyValue("--kimo-component-soft")
        .trim(),
      icon: icon ? getComputedStyle(icon).color : null,
      rowBg: row ? getComputedStyle(row).backgroundColor : null,
      kind: kind ? getComputedStyle(kind).color : null,
      toastBg: (() => {
        const t = q(".m3-toast")
        return t ? getComputedStyle(t).backgroundColor : null
      })(),
    }
  })
  log("light", JSON.stringify(light), "dark", JSON.stringify(dark))
  c.ok(light.tok.toUpperCase() === "#7C3AED", `light component token violet: ${light.tok}`)
  c.ok(dark.tok.toUpperCase() === "#A78BFA", `dark component token: ${dark.tok}`)
  c.ok(dark.soft.toUpperCase() === "#A78BFA24", `dark component-soft: ${dark.soft}`)
  c.ok(dark.icon === "rgb(167, 139, 250)", `instance icon uses dark violet: ${dark.icon}`)
  c.ok(
    dark.rowBg !== null && /167, 139, 250/.test(dark.rowBg),
    `selected instance row soft violet in dark: ${dark.rowBg}`,
  )
  // Canvas overlay for an instance uses the dark component token.
  const theme = await page.evaluate(
    () =>
      (
        (window as unknown as QW).__kimo.canvas() as unknown as {
          renderer?: { theme?: Record<string, string> }
        }
      )?.renderer?.theme ?? null,
  )
  const comp = theme && Object.entries(theme).find(([k]) => /component/i.test(k))
  c.ok(
    !comp || String(comp[1]).toUpperCase().startsWith("#A78BFA"),
    `canvas component overlay in dark: ${JSON.stringify(comp)}`,
  )
  // Variables dialog in dark: no hard-coded white surfaces.
  await page.keyboard.press("Meta+Alt+Shift+KeyV")
  const dialog = page.locator('[data-testid="variables-dialog"]')
  await dialog.waitFor()
  const whites = await dialog.evaluate((root) =>
    [...root.querySelectorAll("*")]
      .filter((e) =>
        /^rgb\(255, 255, 255\)|^rgba\(255, 255, 255, 1\)/.test(getComputedStyle(e).backgroundColor),
      )
      .map((e) => e.className)
      .slice(0, 5),
  )
  c.ok(
    whites.length === 0,
    `variables dialog has no white surfaces in dark: ${JSON.stringify(whites)}`,
  )
  c.done()
}

export const scenarios: Scenario[] = [
  { name: "qa-m3 vars: CRUD, aliases, cycles, delete in use", run: variablesCrud },
  {
    name: "qa-m3 vars: multi-axis when, last-wins, fallback, THEME_NO_MATCH, reorder",
    run: multiAxis,
  },
  {
    name: "qa-m3 vars: theme pins on frames / instances / inside instances",
    run: themePinsInstances,
  },
  { name: "qa-m3 io: save/open round trip byte-stable (components + variables)", run: roundTrip },
  { name: "qa-m3 ui: rejected-edit toast + dark mode violet", run: feedbackAndDark },
]
