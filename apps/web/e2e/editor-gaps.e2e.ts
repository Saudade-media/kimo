/**
 * Board 37 / no-op audit, editor scope (E1–E13, A5): each scenario clicks the control the audit
 * found dead and asserts its effect, over the integrated desktop app (`e2e/m4-app-harness`, a
 * macOS memory platform with `.kimo` files on "disk").
 */
import type { Page } from "playwright"
import { disk, LOOM, open, SITE } from "./m4-app.e2e"
import { armFileChooser, nextFileChooser, openEditor } from "./qa-helpers"
import { type E2EContext, expect, type Scenario } from "./run"

type Hook = {
  session: {
    store: {
      getNode(id: string): Record<string, unknown> | undefined
      apply(op: unknown, o: { origin: string }): { ok: boolean }
      toHeader(): { pages?: Record<string, { name: string }> }
    }
    ui: { getState(): { selection: string[]; select(ids: string[]): void } }
    apply(op: unknown): boolean
  }
  canvas(): {
    layout(): { nodes: Map<string, unknown> } | null
    zoomToFit(ids: string[], p: number): void
  } | null
}
type App = {
  control: {
    editorMenu(a: string): void
    clipboardText(): string | null
    calls: string[]
    failNextWrite(code: string, errno?: string, ref?: string): void
  }
  platform: {
    files: { reveal(ref: string): Promise<void> }
  }
}
declare const window: Window & { __kimo: Hook; __kimoApp: App }

const HOME = `${SITE}/home.kimo`

async function editor(ctx: E2EContext, query = ""): Promise<Page> {
  await open(ctx, `${query}${disk(HOME)}`)
  const { page } = ctx
  await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await page.locator(".canvas-host canvas").first().waitFor({ timeout: 15_000 })
  await page.waitForFunction(() => !!window.__kimo?.canvas()?.layout())
  return page
}

async function insert(page: Page, nodes: Record<string, Record<string, unknown>>) {
  await page.evaluate((ns) => {
    const s = window.__kimo.session
    for (const [id, node] of Object.entries(ns))
      s.store.apply({ op: "insert", id, node }, { origin: "user" })
  }, nodes)
  await page.waitForFunction(
    (xs) => xs.every((id) => !!window.__kimo.canvas()?.layout()?.nodes.get(id)),
    Object.keys(nodes),
  )
}

const toastText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".m3-toast, [role=status], [role=alert]")]
      .map((e) => (e as HTMLElement).innerText)
      .join(" | "),
  )

async function waitToast(page: Page, re: RegExp, what: string) {
  for (let i = 0; i < 50; i++) {
    if (re.test(await toastText(page))) return
    await page.waitForTimeout(100)
  }
  throw new Error(`Expectation failed: ${what} (toasts: ${await toastText(page)})`)
}

const disabled = (page: Page, name: string) =>
  page
    .getByRole("menuitem", { name })
    .evaluate(
      (e) => (e as HTMLButtonElement).disabled || e.getAttribute("aria-disabled") === "true",
    )

export const scenarios: Scenario[] = [
  {
    name: "editor-gaps E1: the breadcrumb's page crumb names the active page (rename, switch)",
    async run(ctx) {
      const page = await editor(ctx)
      const crumb = page.locator(".kimo-desktop-breadcrumb__page")
      expect((await crumb.innerText()) === "Page 1", `implicit page: ${await crumb.innerText()}`)
      await page.locator(".pages-strip__add").click()
      const input = page.locator(".pages-strip input")
      await input.waitFor()
      await input.fill("Pricing")
      await input.press("Enter")
      await page.waitForFunction(
        () => document.querySelector(".kimo-desktop-breadcrumb__page")?.textContent === "Pricing",
      )
      // Switching back renames the crumb too.
      await page.locator(".pages-strip [data-page-id]").first().click()
      await page.waitForFunction(
        () => document.querySelector(".kimo-desktop-breadcrumb__page")?.textContent !== "Pricing",
      )
    },
  },
  {
    name: "editor-gaps E3: Back to files (File menu, native menu) and the folder crumb go Home",
    async run(ctx) {
      const page = await editor(ctx)
      expect(
        (await page.evaluate(() => window.__kimoApp.control.calls)).includes("menuContext editor"),
        "the native menu knows an editor is shown",
      )
      // File menu › Back to files (first item, then a divider).
      await page.locator(".kimo-desktop-breadcrumb__file").click()
      const first = page.locator('[data-testid="file-menu"] [role="menuitem"]').first()
      expect((await first.innerText()).includes("Back to files"), "Back to files leads the menu")
      await first.click()
      await page.waitForFunction(() => location.hash === "#/" || location.hash === "")
      await page.locator(".kimo-desktop-topbar").waitFor({ state: "detached", timeout: 10_000 })
      expect(
        (await page.evaluate(() => window.__kimoApp.control.calls)).includes("menuContext home"),
        "the native menu knows Home is shown",
      )

      // Native File › Back to files.
      await editor(ctx)
      await page.evaluate(() => window.__kimoApp.control.editorMenu("go-home"))
      await page.waitForFunction(() => location.hash === "#/" || location.hash === "")

      // The folder crumb opens Home on that folder's section.
      await editor(ctx)
      const folder = page.locator(".kimo-desktop-breadcrumb__folder--button")
      expect(
        /^Show .+ in Home$/.test((await folder.getAttribute("aria-label")) ?? ""),
        "folder crumb tooltip",
      )
      // Board 37 QsDq7: hover fill $bg-hover, radius $radius-sm (measured).
      await folder.hover()
      await page.waitForTimeout(200)
      const look = await folder.evaluate((el) => {
        const probe = document.createElement("div")
        probe.style.background = "var(--kimo-bg-hover)"
        probe.style.borderRadius = "var(--kimo-radius-sm)"
        document.body.append(probe)
        const want = getComputedStyle(probe)
        const got = getComputedStyle(el)
        const r = {
          bg: got.backgroundColor === want.backgroundColor,
          radius: got.borderTopLeftRadius === want.borderTopLeftRadius,
          got: [got.backgroundColor, got.borderTopLeftRadius],
          want: [want.backgroundColor, want.borderTopLeftRadius],
        }
        probe.remove()
        return r
      })
      expect(look.bg && look.radius, `folder crumb hover ${JSON.stringify(look)}`)
      await folder.click()
      await page.waitForFunction(() => location.hash.startsWith("#/folder/"))
      const hash = await page.evaluate(() => decodeURIComponent(location.hash))
      expect(hash.includes("kimo-site"), `folder route: ${hash}`)
    },
  },
  {
    name: "editor-gaps E5: native Edit › Undo / Redo / Select All act on the document",
    async run(ctx) {
      const page = await editor(ctx)
      const name = () =>
        page.evaluate(() => String(window.__kimo.session.store.getNode("Frame00001")?.name))
      await page.evaluate(() =>
        window.__kimo.session.apply({ op: "update", id: "Frame00001", set: { name: "Edited" } }),
      )
      expect((await name()) === "Edited", "edited")
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.evaluate(() => window.__kimoApp.control.editorMenu("undo"))
      await page.waitForFunction(
        () => window.__kimo.session.store.getNode("Frame00001")?.name !== "Edited",
      )
      await page.evaluate(() => window.__kimoApp.control.editorMenu("redo"))
      await page.waitForFunction(
        () => window.__kimo.session.store.getNode("Frame00001")?.name === "Edited",
      )
      await page.evaluate(() => window.__kimo.session.ui.getState().select([]))
      await page.evaluate(() => window.__kimoApp.control.editorMenu("select-all"))
      await page.waitForFunction(() =>
        window.__kimo.session.ui.getState().selection.includes("Frame00001"),
      )
    },
  },
  {
    name: "editor-gaps E9: Copy link to page copies a kimo:// link (toast); ⌫ on a page row asks to delete",
    async run(ctx) {
      const page = await editor(ctx)
      await page.locator(".pages-strip__add").click()
      const input = page.locator(".pages-strip input")
      await input.waitFor()
      await input.fill("Pricing")
      await input.press("Enter")
      const row = page.locator(".pages-strip [data-page-id]").filter({ hasText: "Pricing" })
      await row.click({ button: "right" })
      await page.getByRole("menuitem", { name: "Copy link to page" }).click()
      await waitToast(page, /Copied link to Pricing/, "copied toast")
      const link = await page.evaluate(() => window.__kimoApp.control.clipboardText())
      const id = await row.getAttribute("data-page-id")
      expect(
        !!link?.startsWith("kimo://open?path=") &&
          link.includes(encodeURIComponent(HOME)) &&
          link.includes(`page=${id}`),
        `deep link: ${link}`,
      )
      // The menu's ⌫ hint works on the focused row.
      await row.click()
      await row.focus()
      await page.keyboard.press("Backspace")
      await page.getByRole("dialog").filter({ hasText: "Delete “Pricing”?" }).waitFor()
      await page.getByRole("button", { name: "Delete page" }).click()
      await row.waitFor({ state: "detached", timeout: 5000 })
      // ⌫ while the page menu is open deletes too (the hint on Delete page…).
      await page.locator(".pages-strip__add").click()
      await page.locator(".pages-strip input").press("Enter")
      await page.locator(".pages-strip [data-page-id]").last().click({ button: "right" })
      await page.keyboard.press("Backspace")
      await page.getByRole("dialog").filter({ hasText: "Delete “" }).waitFor()
    },
  },
  {
    name: "editor-gaps E10: View › Preview is disabled with no frames",
    async run(ctx) {
      const page = await editor(ctx)
      await page.locator(".topbar__zoom").click()
      expect(!(await disabled(page, "Preview")), "Preview enabled with a frame")
      await page.keyboard.press("Escape")
      await page.evaluate(() =>
        window.__kimo.session.store.apply({ op: "delete", id: "Frame00001" }, { origin: "user" }),
      )
      await page.locator(".topbar__zoom").click()
      expect(await disabled(page, "Preview"), "Preview disabled without frames")
    },
  },
  {
    name: "editor-gaps E4: right-click a Note layer row opens the layer menu (not the WebView's)",
    async run(ctx) {
      const page = await editor(ctx)
      await insert(page, {
        NoteGap001: { type: "note", content: "Warmer palette", x: 1200, y: 0, w: 240 },
      })
      await page.locator('.left-panel [data-node-id="NoteGap001"]').click({ button: "right" })
      await page.getByTestId("canvas-context-menu").waitFor({ timeout: 5000 })
      expect(
        await page.evaluate(() =>
          window.__kimo.session.ui.getState().selection.includes("NoteGap001"),
        ),
        "the row is the menu's target",
      )
    },
  },
  {
    name: "editor-gaps E7: Add prop › Slot (mark a frame) marks the frame and declares the prop",
    async run(ctx) {
      const page = await editor(ctx)
      await insert(page, {
        CardGap001: {
          type: "frame",
          name: "Card",
          x: 1200,
          y: 0,
          w: 200,
          h: 120,
          component: {},
        },
        BodyGap001: { type: "frame", parent: "CardGap001", name: "Body", w: 120, h: 40 },
      })
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["CardGap001"]))
      const section = page.getByTestId("component-section")
      await section.waitFor()
      await section.getByRole("button", { name: "Add prop" }).click()
      await page.getByRole("menuitem", { name: "Slot (mark a frame)" }).click()
      await page.getByRole("menuitem", { name: /Body/ }).click()
      await page.waitForFunction(() => {
        const s = window.__kimo.session.store
        const props = (s.getNode("CardGap001")?.component as { props?: Record<string, unknown> })
          ?.props
        return !!s.getNode("BodyGap001")?.slot && !!props?.body
      })
      await section.locator('[data-prop="body"]').waitFor()
    },
  },
  {
    name: "editor-gaps E7: Replace with selection swaps an instance's layer for the selected component",
    async run(ctx) {
      const page = await editor(ctx)
      await insert(page, {
        CardGap002: {
          type: "frame",
          name: "Card",
          x: 1200,
          y: 0,
          w: 200,
          h: 120,
          component: {},
        },
        BodyGap002: { type: "frame", parent: "CardGap002", name: "Body", w: 120, h: 40 },
        ChipGap002: {
          type: "frame",
          name: "Chip",
          x: 1500,
          y: 0,
          w: 60,
          h: 24,
          component: {},
        },
        InstGap002: { type: "instance", of: "CardGap002", x: 1200, y: 300 },
      })
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["ChipGap002"]))
      await page
        .locator('.left-panel [data-node-id="InstGap002"]')
        .getByRole("button", { name: "Expand" })
        .click()
      const child = page.locator('.left-panel [data-node-id="InstGap002/BodyGap002"]')
      await child.waitFor({ timeout: 5000 })
      await child.click({ button: "right" })
      const item = page.getByRole("menuitem", { name: "Replace with selection" })
      expect(!(await disabled(page, "Replace with selection")), "enabled with Chip selected")
      await item.click()
      await page.waitForFunction(() => {
        // biome-ignore lint/suspicious/noExplicitAny: the store's full API is untyped here
        const store = window.__kimo.session.store as any
        const ov = store.getNode("InstGap002")?.overrides?.BodyGap002
        const nodes = Object.values(store.toDocument().nodes) as { type?: string; of?: string }[]
        return (
          ov?.replace === true && nodes.some((n) => n.type === "instance" && n.of === "ChipGap002")
        )
      })
    },
  },
  {
    name: "editor-gaps E8: Reveal recovery copy reveals it; Open as text that fails says why",
    async run(ctx) {
      const page = await editor(ctx)
      await page.evaluate((ref) => {
        // biome-ignore lint/suspicious/noExplicitAny: memory control
        ;(window.__kimoApp.control as any).corruptNextReadBack(ref)
        window.__kimo.session.apply({ op: "update", id: "Frame00001", set: { name: "Changed" } })
      }, HOME)
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("Meta+s")
      const reveal = page.getByRole("button", { name: "Reveal recovery copy" })
      await reveal.waitFor({ timeout: 10_000 })
      expect((await page.getByRole("button", { name: "Show diff" }).count()) === 0, "no Show diff")
      await reveal.click()
      await page.waitForFunction(() =>
        window.__kimoApp.control.calls.some(
          (c) => c.startsWith("reveal ") && c.includes("recovery"),
        ),
      )

      // A file that fails to load: Open as text that can't open says so.
      const broken = `${SITE}/broken.kimo`
      await page.evaluate((ref) => {
        // biome-ignore lint/suspicious/noExplicitAny: memory control
        ;(window.__kimoApp.control as any).writeExternal(ref, "{ not json")
      }, broken)
      await page.evaluate((h) => {
        location.hash = h
      }, disk(broken))
      const openText = page.getByRole("button", { name: "Open as text" })
      await openText.waitFor({ timeout: 10_000 })
      // The card replaces the canvas: it covers the whole canvas area and takes the clicks.
      const cover = await page.evaluate(() => {
        const c = document.querySelector(".editor__canvas") as HTMLElement
        const f = document.querySelector(".kimo-files-failed") as HTMLElement
        const a = c.getBoundingClientRect()
        const b = f.getBoundingClientRect()
        const btn = document.querySelector(".kimo-files-failed__open-text") as HTMLElement
        const r = btn.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return {
          same: a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height,
          display: getComputedStyle(f).display,
          hit: btn.contains(hit),
        }
      })
      expect(
        cover.same && cover.display === "flex" && cover.hit,
        `card cover ${JSON.stringify(cover)}`,
      )
      await page.evaluate(() => {
        // biome-ignore lint/suspicious/noExplicitAny: platform files
        ;(window.__kimoApp.platform.files as any).openWithDefaultApp = async () => {
          throw new Error("No app opens .kimo files")
        }
      })
      await openText.click()
      await waitToast(
        page,
        /Couldn't open broken\.kimo as text\. No app opens \.kimo files\./,
        "open as text toast",
      )
    },
  },
  {
    name: "editor-gaps A5: File › Reveal in Finder that fails shows Couldn't reveal …",
    async run(ctx) {
      const page = await editor(ctx)
      await page.evaluate(() => {
        window.__kimoApp.platform.files.reveal = async () => {
          throw new Error("Permission denied")
        }
      })
      await page.locator(".kimo-desktop-breadcrumb__file").click()
      await page.getByRole("menuitem", { name: "Reveal in Finder" }).click()
      await waitToast(page, /Couldn't reveal home\.kimo\. Permission denied\./, "reveal toast")
    },
  },
  {
    name: "editor-gaps E13: Mark resolved & save that can't write says so (no saved toast)",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, disk(`${LOOM}/marketing.kimo`))
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      await page.getByRole("button", { name: "Take all ours" }).click()
      const mark = page.locator(".conflicts-panel__mark")
      await page.waitForFunction(
        () => !(document.querySelector(".conflicts-panel__mark") as HTMLButtonElement)?.disabled,
      )
      await page.evaluate(
        (ref) => window.__kimoApp.control.failNextWrite("PERMISSION", "EACCES", ref),
        `${LOOM}/marketing.kimo`,
      )
      await mark.click()
      await waitToast(page, /Couldn't save marketing\.kimo\./, "save failure toast")
      expect(!/Resolved \d+ conflicts/.test(await toastText(page)), "no saved toast")
    },
  },
  {
    name: "editor-gaps E11: the I-key icon picker's Material weight goes on the inserted icon",
    async run(ctx) {
      const page = await editor(ctx)
      await page.locator(".canvas-host").click({ position: { x: 600, y: 600 } })
      await page.keyboard.press("i")
      const picker = page.locator(".kimo-icon-picker")
      await picker.waitFor({ timeout: 5000 })
      await picker.getByRole("radio", { name: "Material" }).click()
      const slider = picker.getByRole("slider", { name: "Weight" })
      await slider.focus()
      await page.keyboard.press("End")
      await page.waitForFunction(
        () =>
          document
            .querySelector('.kimo-icon-picker [role="slider"]')
            ?.getAttribute("aria-valuenow") === "700",
      )
      const search = picker.getByRole("searchbox").or(picker.getByRole("textbox")).first()
      await search.fill("home")
      await page.waitForTimeout(400)
      await search.press("ArrowDown")
      await page.keyboard.press("Enter")
      await picker.waitFor({ state: "detached" })
      const icon = await page.evaluate(() => {
        const id = window.__kimo.session.ui.getState().selection[0] as string
        return window.__kimo.session.store.getNode(id)
      })
      expect(
        icon?.type === "icon" && String(icon.set ?? icon.icon).includes("material"),
        `a Material icon: ${JSON.stringify(icon)}`,
      )
      expect(icon?.weight === 700, `weight 700: ${icon?.weight}`)
    },
  },
  {
    name: "editor-gaps E2: Library Changes › Fix broken overrides opens the fix dialog for that library",
    async run(ctx) {
      const page = await editor(ctx)
      const lib = {
        $schema: "https://kimo.design/schema/kimo-1.0.json",
        format: "1.0.0",
        meta: { name: "Kimo UI" },
        nodes: {
          button01: {
            type: "frame",
            name: "Button",
            parent: null,
            order: "a0",
            w: 80,
            h: 28,
            component: true,
          },
          label001: { type: "text", name: "Label", parent: "button01", order: "a0", content: "OK" },
        },
      }
      await page.evaluate((d) => {
        // biome-ignore lint/suspicious/noExplicitAny: the debug hook's m3 is untyped here
        const k = (window as any).__kimo
        k.m3.libs.inject("ui", "./ui.kimo", d)
        k.m3.run({ cmd: "linkLibrary", alias: "ui", path: "./ui.kimo" }, "Link library")
        k.m3.run(
          {
            cmd: "createInstance",
            of: "ui:button01",
            placement: { parent: null, x: 1200, y: 0, id: "libinst001" },
          },
          "insert",
        )
        // An override the library change left pointing at a layer that is gone.
        k.session.store.apply(
          {
            op: "update",
            id: "libinst001",
            set: {
              meta: {
                "kimo.overrides.broken": [
                  { key: "gone000001", override: { set: { content: "x" } }, path: "Badge/Label" },
                ],
              },
            },
          },
          { origin: "user" },
        )
        k.m3.openPanel({ libraryChanges: "ui" })
      }, lib)
      const fix = page.getByRole("button", { name: "Fix broken overrides" })
      await fix.waitFor({ timeout: 5000 })
      expect(!(await fix.isDisabled()), "enabled with a broken override")
      await fix.click()
      const dialog = page.getByRole("dialog").filter({ hasText: "Fix broken overrides" })
      await dialog.waitFor({ timeout: 5000 })
      expect((await dialog.innerText()).includes("Kimo UI"), "the dialog names the library")
    },
  },
  {
    name: "editor-gaps E6: an image fill that can't be imported says why (danger toast)",
    async run(ctx) {
      const { page } = ctx
      armFileChooser(page)
      await editor(ctx)
      await page.evaluate(() => window.__kimo.session.ui.getState().select(["Frame00001"]))
      await page.getByRole("button", { name: "Add fill" }).first().click()
      const chooser = nextFileChooser(page)
      await page.getByRole("menuitem", { name: "Image…" }).click()
      await (await chooser).setFiles({
        name: "notes.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      })
      await waitToast(page, /Couldn't add the image\. Unsupported image format/, "image toast")
    },
  },
  {
    name: "editor-gaps E12: shortcut hints spell Ctrl on Windows (Ask Kimo, Delete page)",
    async run(ctx) {
      const { page } = ctx
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" })
        Object.defineProperty(Navigator.prototype, "userAgent", {
          get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        })
      })
      await editor(ctx, "?os=windows")
      const ask = await page.locator(".floating-toolbar__ask").first().innerText()
      expect(ask.includes("Ctrl+K") && !ask.includes("⌘"), `Ask Kimo hint: ${ask}`)
      const footer = await page.locator(".pages-footer").innerText()
      expect(footer.includes("Ctrl+P"), `pages footer: ${footer}`)
    },
  },
  {
    name: "editor-gaps E12 (web): File and View menus spell Ctrl in a Windows browser",
    async run(ctx) {
      const { page } = ctx
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "platform", { get: () => "Win32" })
        Object.defineProperty(Navigator.prototype, "userAgent", {
          get: () => "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        })
      })
      await openEditor(page, ctx.url)
      const metas = (menu: string) =>
        page.locator(`${menu} .kimo-menu-item-dense__meta`).allInnerTexts()
      await page.locator(".topbar__file").click()
      const file = (await metas('[data-testid="file-menu"]')).join(" ")
      expect(
        !/[⌘⇧]/.test(file) &&
          ["Ctrl+N", "Ctrl+O", "Ctrl+S", "Shift+Ctrl+S", "Ctrl+,"].every((k) => file.includes(k)),
        `File menu shortcuts: ${file}`,
      )
      await page.keyboard.press("Escape")
      await page.locator(".topbar__zoom").click()
      const view = (await metas(".view-menu")).join(" ")
      expect(
        !/[⌘⇧]/.test(view) &&
          ["Ctrl++", "Ctrl+0", "Shift+1", "Shift+R", "Shift+Space"].every((k) => view.includes(k)),
        `View menu shortcuts: ${view}`,
      )
      // The floating toolbar on the same page agrees (one style per page).
      const ask = await page.locator(".floating-toolbar__ask").first().innerText()
      expect(!ask.includes("⌘"), `Ask Kimo hint: ${ask}`)
    },
  },
  {
    name: "editor-gaps A5: File › Save as… that can't write says Couldn't save …",
    async run(ctx) {
      const page = await editor(ctx)
      const copy = `${SITE}/copy.kimo`
      await page.evaluate((ref) => {
        // biome-ignore lint/suspicious/noExplicitAny: memory platform dialogs
        ;(window.__kimoApp.platform as any).dialogs.saveFile = async () => ref
        window.__kimoApp.control.failNextWrite("PERMISSION", "EACCES", ref)
      }, copy)
      const before = await page.evaluate(() => location.hash)
      await page.locator(".kimo-desktop-breadcrumb__file").click()
      await page.getByRole("menuitem", { name: "Save as…" }).click()
      await waitToast(page, /Couldn't save home\.kimo\./, "save as failure toast")
      expect((await page.evaluate(() => location.hash)) === before, "route unchanged")
    },
  },
  {
    name: "editor-gaps E10: Preview with no frames (native View › Preview, ⇧Space) says why",
    async run(ctx) {
      const page = await editor(ctx)
      await page.evaluate(() =>
        window.__kimo.session.store.apply({ op: "delete", id: "Frame00001" }, { origin: "user" }),
      )
      await page.evaluate(() => window.__kimoApp.control.editorMenu("preview"))
      await waitToast(page, /Nothing to preview\. Add a frame to this page\./, "native menu toast")
      expect((await page.locator(".preview").count()) === 0, "no overlay")
      // ⇧Space says the same (a second toast).
      const count = () => page.locator(".m3-toast", { hasText: "Nothing to preview" }).count()
      const before = await count()
      await page.locator(".canvas-host").click({ position: { x: 5, y: 5 } })
      await page.keyboard.press("Shift+Space")
      await page.waitForFunction(
        (n) =>
          [...document.querySelectorAll(".m3-toast")].filter((t) =>
            (t as HTMLElement).innerText.includes("Nothing to preview"),
          ).length > n,
        before,
      )
      expect((await count()) > before, "⇧Space toast")
      expect((await page.locator(".preview").count()) === 0, "no overlay after ⇧Space")
    },
  },
]
