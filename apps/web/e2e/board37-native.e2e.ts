/**
 * Board 37 audit, native scope, over the m4-app harness (macOS memory platform): the menu bar's
 * File / Edit items reach Home and the editor (A6, B9, E3, E5, G2), Home's ⌘N / ⌘O (B9), and
 * Help › Copy diagnostics confirms the copy (G3). The memory platform stands in for menu.rs:
 * `control.editorMenu(action)` is what a click on the native item emits (`kimo://editor-menu`).
 */
import type { Page } from "playwright"
import { disk, open, SITE } from "./m4-app.e2e"
import { expect, type Scenario } from "./run"

type AppWindow = {
  __kimoApp: {
    control: {
      editorMenu(a: string): void
      helpMenu(a: string): void
      clipboardText(): string | null
      calls: string[]
    }
  }
  __kimo?: {
    session: {
      ui: { getState(): { selection: string[] } }
      store: { getNode(id: string): { name?: string } | undefined }
      apply(op: unknown): boolean
    }
  }
}

const menu = (page: Page, action: string) =>
  page.evaluate((a) => (window as unknown as AppWindow).__kimoApp.control.editorMenu(a), action)
const calls = (page: Page) =>
  page.evaluate(() => [...(window as unknown as AppWindow).__kimoApp.control.calls])
const hash = (page: Page) => page.evaluate(() => location.hash)

async function lastContext(page: Page): Promise<string | undefined> {
  return (await calls(page)).filter((c) => c.startsWith("menuContext ")).at(-1)
}

export const scenarios: Scenario[] = [
  {
    name: "board37-native: File › New file and Back to files switch Home ↔ editor and the menu context",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "#/")
      await page.getByPlaceholder("Search files").waitFor({ timeout: 15_000 })
      expect((await lastContext(page)) === "menuContext home", "Home reports the home context")

      // File › New file on Home: an untitled document opens right away.
      await menu(page, "new-file")
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      expect((await hash(page)).startsWith("#/disk/"), `untitled opened: ${await hash(page)}`)
      await page.waitForFunction(() =>
        (window as unknown as AppWindow).__kimoApp.control.calls.includes("menuContext editor"),
      )

      // File › Back to files: an untitled, unedited document closes without asking.
      await menu(page, "go-home")
      await page.getByPlaceholder("Search files").waitFor({ timeout: 15_000 })
      expect((await hash(page)) === "#/" || (await hash(page)) === "", "back on Home")
      expect((await lastContext(page)) === "menuContext home", "editor left: home context")
    },
  },
  {
    name: "board37-native: ⌘N on Home creates a file; ⌘O opens the picker",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "#/")
      const search = page.getByPlaceholder("Search files")
      await search.waitFor({ timeout: 15_000 })
      // From the search box too: ⌘O / ⌘N mean nothing in a text field.
      await search.click()
      await page.keyboard.press("Meta+o")
      await page.waitForFunction(() =>
        (window as unknown as AppWindow).__kimoApp.control.calls.some(
          (c) => c === "dialog openFile",
        ),
      )
      await page.keyboard.press("Meta+n")
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      expect((await hash(page)).startsWith("#/disk/"), "⌘N opened an untitled document")
    },
  },
  {
    name: "board37-native: Edit › Select all / Undo act on Home's search field",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "#/")
      const search = page.getByPlaceholder("Search files")
      await search.waitFor({ timeout: 15_000 })
      await search.click()
      await page.keyboard.type("pricing")
      await menu(page, "select-all")
      const sel = await search.evaluate((el) => {
        const i = el as HTMLInputElement
        return [i.selectionStart, i.selectionEnd]
      })
      expect(sel[0] === 0 && sel[1] === 7, `Select all selected the field: ${sel}`)
      await page.keyboard.type("x")
      expect((await search.inputValue()) === "x", "typing replaced the selection")
      await menu(page, "undo")
      expect(
        (await search.inputValue()) === "pricing",
        `Undo in the field: ${await search.inputValue()}`,
      )
      await menu(page, "redo")
      expect((await search.inputValue()) === "x", "Redo in the field")
    },
  },
  {
    name: "board37-native: Edit › Select all / Undo / Redo act on the document in the editor",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, disk(`${SITE}/home.kimo`))
      await page.locator(".canvas-host canvas").first().waitFor({ timeout: 15_000 })
      await page.waitForFunction(() => !!(window as unknown as AppWindow).__kimo?.session)
      await page.locator(".canvas-host").click({ position: { x: 20, y: 20 } })
      await menu(page, "select-all")
      const selected = await page.evaluate(
        () => (window as unknown as AppWindow).__kimo?.session.ui.getState().selection ?? [],
      )
      expect(selected.includes("Frame00001"), `Select all selected the frame: ${selected}`)

      const name = () =>
        page.evaluate(
          () => (window as unknown as AppWindow).__kimo?.session.store.getNode("Frame00001")?.name,
        )
      const before = await name()
      await page.evaluate(() =>
        (window as unknown as AppWindow).__kimo?.session.apply({
          op: "update",
          id: "Frame00001",
          set: { name: "Renamed" },
        }),
      )
      expect((await name()) === "Renamed", "edit applied")
      await menu(page, "undo")
      expect((await name()) === before, `Edit › Undo reverted: ${await name()}`)
      await menu(page, "redo")
      expect((await name()) === "Renamed", "Edit › Redo reapplied")
    },
  },
  {
    name: "board37-native: Help › Copy diagnostics copies and says so",
    async run(ctx) {
      const { page } = ctx
      await open(ctx, "#/")
      await page.getByPlaceholder("Search files").waitFor({ timeout: 15_000 })
      await page.evaluate(() =>
        (window as unknown as AppWindow).__kimoApp.control.helpMenu("copy-diagnostics"),
      )
      await page.getByTestId("help-toast").filter({ hasText: "Copied diagnostics" }).waitFor()
      const text = await page.evaluate(() =>
        (window as unknown as AppWindow).__kimoApp.control.clipboardText(),
      )
      expect(!!text && text.includes("Kimo"), `diagnostics on the clipboard: ${text}`)
    },
  },
]
