/**
 * Board 37 "Home & gaps" (desing.pen H7PHrz): every Home control acts.
 *
 * Desktop (the real App over the macOS memory platform, `e2e/m4-app-harness`):
 * - sidebar sections: All files, a folder, Templates, Design systems, Trash and back to Recents;
 *   the clicked row is `aria-current=page`, the h1 and the list follow it (A1, B3, B5);
 * - the file row ⋯ opens the menu without opening the row; Rename (inline, collision toast),
 *   Duplicate, Move to Trash + Undo, Remove from Recents (B6);
 * - Trash: Restore, Restore as copy, Delete forever, Empty trash (B2);
 * - Templates: Use template writes the file (and the imported library) and opens it; a failed
 *   write shows Toast/Danger with Choose folder… (B1);
 * - missing files, folder menu (Remove from Kimo → All files), empty states (B10, B11);
 * - one measured pass of the board 37 values.
 * Web (the real app over IndexedDB): template, Move to Trash / Restore / Delete forever, Rename,
 * Duplicate, Design systems count (B4, B7).
 */
import type { Page } from "playwright"
import { disk, LOOM, open, readFile, SITE } from "./m4-app.e2e"
import { type E2EContext, expect, type Scenario } from "./run"

const KIMO_SITE = "/Users/me/Work/kimo-site"
const NEW_DIR = "/home/test/Documents/Kimo"

type App = {
  __kimoApp: {
    platform: {
      files: { stat(r: string): Promise<unknown> }
      trash: { list(): Promise<{ id: string; name: string }[]> }
      recents: { listFiles(): Promise<{ ref: string; missing: boolean }[]> }
      dialogs: Record<string, unknown>
    }
    control: {
      calls: string[]
      removeExternal(r: string): void
      setFocused(f: boolean): void
      writeExternal(r: string, t: string): void
      failNextWrite(code: string, errno?: string, ref?: string): void
    }
  }
}

const hash = (page: Page) => page.evaluate(() => location.hash)
const waitH1 = (page: Page, text: string) =>
  page.waitForFunction(
    (t) => document.querySelector(".home-header__title")?.textContent === t,
    text,
    { timeout: 10_000 },
  )
const exists = (page: Page, ref: string) =>
  page.evaluate(
    async (r) => (await (window as unknown as App).__kimoApp.platform.files.stat(r)) !== null,
    ref,
  )
const toast = (page: Page, kind: string) => page.locator(`[data-toast="${kind}"]`)

async function home(ctx: E2EContext, h = "#/") {
  await open(ctx, h)
  await ctx.page.locator(".home-sidebar").waitFor({ timeout: 15_000 })
}

/** Opens `home.kimo` once so it is a recent file, then returns to Home. */
async function seedRecent(ctx: E2EContext) {
  const { page } = ctx
  await open(ctx, disk(`${SITE}/home.kimo`))
  await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
  await page.evaluate(() => {
    location.hash = "#/all"
  })
  await page.locator('[data-file$="/home.kimo"]').first().waitFor({ timeout: 10_000 })
}

async function rowMenu(page: Page, ref: string) {
  await page.locator(`[data-file="${ref}"] .kimo-file-row__menu`).click()
  await page.locator(".home-menu").waitFor()
}

export const scenarios: Scenario[] = [
  {
    name: "board37: sidebar rows switch Home's section (active row, h1, list)",
    async run(ctx) {
      const { page } = ctx
      await home(ctx)
      const active = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('.home-sidebar [aria-current="page"]')].map(
            (e) => (e as HTMLElement).innerText.split("\n")[0],
          ),
        )
      expect((await active()).join() === "Recents", `Recents active: ${await active()}`)
      expect(await page.locator(".home-ai").isVisible(), "Start With AI on Recents")

      await page.locator('a.home-nav[href="#/all"]').click()
      await page.waitForFunction(() => location.hash === "#/all")
      await waitH1(page, "All files")
      expect((await active()).join() === "All files", `All files active: ${await active()}`)
      expect((await page.locator(".home-ai").count()) === 0, "no Start With AI on All files")
      await page.waitForFunction(() =>
        /^2 files/.test(document.querySelector(".kimo-files-recent-header")?.textContent ?? ""),
      )
      const header = await page.locator(".kimo-files-recent-header").innerText()
      expect(/^2 files/.test(header) && header.includes("in 2 folders and Recents"), header)
      const count = await page.locator('a.home-nav[href="#/all"] .home-nav__count').innerText()
      expect(count === "2", `All files count ${count}`)

      // A folder: h1 = label, its path and branch in mono after it, the row active.
      await page.locator(`.kimo-files-folder[data-folder="${KIMO_SITE}"]`).click()
      await page.waitForFunction(() => location.hash.startsWith("#/folder/"))
      await waitH1(page, "kimo-site")
      const path = await page.locator(".home-header__path").innerText()
      expect(path === "~/Work/kimo-site · main", `path ${path}`)
      expect(
        (await page
          .locator(`.kimo-files-folder[data-folder="${KIMO_SITE}"]`)
          .getAttribute("aria-current")) === "page",
        "folder row active",
      )
      expect((await page.locator("[data-file]").count()) === 1, "one file in kimo-site")

      // Templates, Design systems, Trash.
      await page.locator('a.home-nav[href="#/templates"]').click()
      await page.locator(".home-template-card").first().waitFor()
      expect((await page.locator(".home-template-card").count()) === 5, "5 templates")
      const names = await page.locator(".home-template-card__name").allInnerTexts()
      expect(
        names.join() === "Landing page,Habit tracker,Dashboard,Design system,Settings page",
        `templates ${names}`,
      )
      await page.getByRole("searchbox", { name: "Search templates" }).fill("dash")
      expect((await page.locator(".home-template-card").count()) === 1, "search scope")

      await page.locator('a.home-nav[href="#/libraries"]').click()
      await page.waitForFunction(() => location.hash === "#/libraries")
      await waitH1(page, "Design systems")
      // board18's marketing.kimo publishes components.
      await page.locator(`.kimo-file-card[data-file="${LOOM}/marketing.kimo"]`).waitFor()
      expect(
        (await page.getByRole("searchbox").inputValue()) === "",
        "a new section starts with an empty search",
      )

      await page.locator('a.home-nav[href="#/trash"]').click()
      await page.locator('[data-empty="trash"]').waitFor()
      await waitH1(page, "Trash")

      await page.locator('a.home-nav[href="#/"]').click()
      await page.waitForFunction(() => location.hash === "#/")
      await waitH1(page, "Recents")
      // The gallery has no sidebar row.
      expect((await page.locator('a[href="#/gallery"]').count()) === 0, "no gallery row")
      // A folder route outside every added folder lands on All files.
      await page.evaluate(() => {
        location.hash = `#/folder/${encodeURIComponent("/nowhere")}`
      })
      await page.waitForFunction(() => location.hash === "#/all")
    },
  },
  {
    name: "board37: file row menu: ⋯ never opens the row; Rename, Duplicate, Trash + Undo",
    async run(ctx) {
      const { page } = ctx
      await seedRecent(ctx)
      const ref = `${SITE}/home.kimo`
      await rowMenu(page, ref)
      expect((await hash(page)) === "#/all", "⋯ did not open the file")
      const items = await page.locator(".home-menu .kimo-menu-item-dense__label").allInnerTexts()
      expect(
        items.join() === "Open,Reveal in Finder,Rename,Duplicate,Remove from Recents,Move to Trash",
        `items ${items}`,
      )
      expect(
        (await page
          .locator(`[data-file="${ref}"] .kimo-file-row__menu`)
          .getAttribute("aria-expanded")) === "true",
        "⋯ pressed while open",
      )
      // Reveal in Finder.
      await page.locator('.home-menu [data-item="reveal"]').click()
      await page.waitForFunction(() =>
        (window as unknown as App).__kimoApp.control.calls.some((c) => c.startsWith("reveal")),
      )

      // Rename: inline field with the stem selected; a taken name → toast; then a free name.
      await page.evaluate(
        (r) => (window as unknown as App).__kimoApp.control.writeExternal(r, "{}"),
        `${SITE}/pricing.kimo`,
      )
      await rowMenu(page, ref)
      await page.locator('.home-menu [data-item="rename"]').click()
      const field = page.locator(".home-rename-field")
      await field.waitFor()
      const sel = await field.evaluate((el) => {
        const i = el as HTMLInputElement
        return i.value.slice(i.selectionStart ?? 0, i.selectionEnd ?? 0)
      })
      expect(sel === "home", `stem selected: ${sel}`)
      await field.fill("pricing")
      await field.press("Enter")
      await toast(page, "rename").waitFor()
      const t = await toast(page, "rename").innerText()
      expect(
        t.includes("Couldn't rename home.kimo. pricing.kimo already exists."),
        `collision toast: ${t}`,
      )
      expect(await exists(page, ref), "home.kimo untouched")
      await rowMenu(page, ref)
      await page.locator('.home-menu [data-item="rename"]').click()
      await field.fill("landing")
      await field.press("Enter")
      await page.locator(`[data-file="${SITE}/landing.kimo"]`).waitFor({ timeout: 10_000 })
      expect(!(await exists(page, ref)) && (await exists(page, `${SITE}/landing.kimo`)), "renamed")

      // Duplicate → "landing copy.kimo".
      await rowMenu(page, `${SITE}/landing.kimo`)
      await page.locator('.home-menu [data-item="duplicate"]').click()
      await page.locator(`[data-file="${SITE}/landing copy.kimo"]`).waitFor({ timeout: 10_000 })

      // Move to Trash (no confirm) → toast with Undo, which restores.
      await rowMenu(page, `${SITE}/landing copy.kimo`)
      await page.locator('.home-menu [data-item="trash"]').click()
      await toast(page, "trashed").waitFor()
      expect(
        (await toast(page, "trashed").innerText()).includes("Moved landing copy.kimo to the Trash"),
        "trash toast",
      )
      expect(!(await exists(page, `${SITE}/landing copy.kimo`)), "moved out")
      await toast(page, "trashed").getByRole("button", { name: "Undo" }).click()
      await page.waitForFunction(
        async (r) => (await (window as unknown as App).__kimoApp.platform.files.stat(r)) !== null,
        `${SITE}/landing copy.kimo`,
      )

      // Right-click opens the same menu at the cursor; Remove from Recents.
      await page.locator(`[data-file="${SITE}/landing.kimo"]`).click({ button: "right" })
      await page.locator(".home-menu").waitFor()
      await page.locator('.home-menu [data-item="remove-recent"]').click()
      await page.locator('a.home-nav[href="#/"]').click()
      await page.waitForFunction(
        (r) => !document.querySelector(`[data-file="${r}"]`),
        `${SITE}/landing.kimo`,
      )
    },
  },
  {
    name: "board37: Trash restores, restores as copy, deletes forever and empties",
    async run(ctx) {
      const { page } = ctx
      await home(ctx, "#/all")
      await page.locator(`[data-file="${SITE}/home.kimo"]`).waitFor({ timeout: 10_000 })
      for (const ref of [`${SITE}/home.kimo`, `${LOOM}/marketing.kimo`]) {
        await rowMenu(page, ref)
        await page.locator('.home-menu [data-item="trash"]').click()
        await page.waitForFunction((r) => !document.querySelector(`[data-file="${r}"]`), ref)
      }
      await page.locator('a.home-nav[href="#/trash"]').click()
      await page.locator(".home-trash-row[data-trash]").first().waitFor()
      expect((await page.locator(".home-trash-row[data-trash]").count()) === 2, "two in Trash")
      const note = await page.locator(".kimo-files-recent-header").innerText()
      expect(note.includes("in the macOS Trash · Restore puts a file back where it was"), note)

      // Restore puts it back; a taken name offers Restore as copy.
      await page
        .locator('[data-trash="home.kimo"]')
        .getByRole("button", { name: /^Restore/ })
        .click()
      await page.waitForFunction(() => !document.querySelector('[data-trash="home.kimo"]'))
      expect(await exists(page, `${SITE}/home.kimo`), "home.kimo restored")
      await page.evaluate(
        (r) => (window as unknown as App).__kimoApp.control.writeExternal(r, "{}"),
        `${LOOM}/marketing.kimo`,
      )
      await page
        .locator('[data-trash="marketing.kimo"]')
        .getByRole("button", { name: /^Restore/ })
        .click()
      await toast(page, "restore").waitFor()
      expect(
        (await toast(page, "restore").innerText()).includes(
          "Couldn't restore marketing.kimo. A file with that name exists.",
        ),
        "restore collision",
      )
      await toast(page, "restore").getByRole("button", { name: "Restore as copy" }).click()
      await page.waitForFunction(
        async (r) => (await (window as unknown as App).__kimoApp.platform.files.stat(r)) !== null,
        `${LOOM}/marketing copy.kimo`,
      )

      // Delete forever and Empty trash confirm first (Esc cancels).
      for (const ref of [`${SITE}/home.kimo`, `${LOOM}/marketing.kimo`]) {
        await page.locator('a.home-nav[href="#/all"]').click()
        await rowMenu(page, ref)
        await page.locator('.home-menu [data-item="trash"]').click()
        await page.waitForFunction((r) => !document.querySelector(`[data-file="${r}"]`), ref)
      }
      await page.locator('a.home-nav[href="#/trash"]').click()
      await page
        .locator('[data-trash="home.kimo"]')
        .getByRole("button", { name: /forever/ })
        .click()
      const dialog = page.getByRole("dialog", { name: "Delete “home.kimo” forever?" })
      await dialog.waitFor()
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "detached" })
      expect((await page.locator(".home-trash-row[data-trash]").count()) === 2, "Esc cancels")
      await page
        .locator('[data-trash="home.kimo"]')
        .getByRole("button", { name: /forever/ })
        .click()
      await dialog.getByRole("button", { name: "Delete forever" }).click()
      await page.waitForFunction(() => !document.querySelector('[data-trash="home.kimo"]'))
      await page.getByRole("button", { name: "Empty trash…" }).click()
      const empty = page.getByRole("dialog", { name: "Empty the Trash?" })
      await empty.waitFor()
      const desc = await empty.innerText()
      expect(desc.includes("Kimo deletes the 1 file it moved to the macOS Trash"), desc)
      await empty.getByRole("button", { name: "Empty trash" }).click()
      await page.locator('[data-empty="trash"]').waitFor()
      const left = await page.evaluate(async () =>
        (await (window as unknown as App).__kimoApp.platform.trash.list()).map((t) => t.name),
      )
      expect(left.length === 0, `trash index empty: ${left}`)
    },
  },
  {
    name: "board37: Templates create the file (and its library) and open it; failure → Choose folder…",
    async run(ctx) {
      const { page } = ctx
      await home(ctx, "#/templates")
      await page
        .locator('[data-template="landing-page"]')
        .getByRole("button", { name: /Use the/ })
        .click()
      await page.locator(".kimo-desktop-topbar").waitFor({ timeout: 15_000 })
      expect((await hash(page)) === disk(`${NEW_DIR}/landing.kimo`), `opened ${await hash(page)}`)
      // A taken name gets " 2"; a card click works too.
      await page.evaluate(() => {
        location.hash = "#/templates"
      })
      await page.locator('[data-template="landing-page"] .home-template-card__thumbnail').click()
      await page.waitForFunction((h) => location.hash === h, disk(`${NEW_DIR}/landing 2.kimo`), {
        timeout: 15_000,
      })
      // Settings page copies the library next to it and points its import at the copy.
      await page.evaluate(() => {
        location.hash = "#/templates"
      })
      await page
        .locator('[data-template="library-consumer"]')
        .getByRole("button", { name: /Use the/ })
        .click()
      await page.waitForFunction((h) => location.hash === h, disk(`${NEW_DIR}/settings.kimo`), {
        timeout: 15_000,
      })
      const settings = (await readFile(page, `${NEW_DIR}/settings.kimo`)) ?? ""
      expect(settings.includes('"ds":"kimo-ds.lib.kimo"'), "import rewritten")
      expect((await readFile(page, `${NEW_DIR}/kimo-ds.lib.kimo`)) !== null, "library copied")

      // Failure: Toast/Danger with Choose folder… (Save as…).
      await page.evaluate(() => {
        location.hash = "#/templates"
      })
      await page.locator('[data-template="dashboard"]').waitFor()
      await page.evaluate((r) => {
        const a = (window as unknown as App).__kimoApp
        a.control.failNextWrite("PERMISSION", "EACCES", r)
        a.platform.dialogs.saveFile = async () => "/Users/me/Work/kimo-site/dash.kimo"
      }, `${NEW_DIR}/dashboard.kimo`)
      await page
        .locator('[data-template="dashboard"]')
        .getByRole("button", { name: /Use the/ })
        .click()
      await toast(page, "template").waitFor()
      const t = await toast(page, "template").innerText()
      expect(t.includes("Couldn't create dashboard.kimo. Permission denied."), t)
      await toast(page, "template").getByRole("button", { name: "Choose folder…" }).click()
      await page.waitForFunction(
        (h) => location.hash === h,
        disk("/Users/me/Work/kimo-site/dash.kimo"),
        { timeout: 15_000 },
      )
    },
  },
  {
    name: "board37: missing file, folder menu, empty states and Design systems",
    async run(ctx) {
      const { page } = ctx
      await seedRecent(ctx)
      // Missing: dimmed row with StatusPill/Missing; a click never opens the editor.
      await page.evaluate((r) => {
        const c = (window as unknown as App).__kimoApp.control
        c.removeExternal(r)
        // Home re-lists when the window comes back to the front.
        c.setFocused(false)
        c.setFocused(true)
      }, `${SITE}/home.kimo`)
      await page.locator('a.home-nav[href="#/"]').click()
      const row = page.locator(`[data-file="${SITE}/home.kimo"]`)
      await page.waitForFunction(
        (r) => !!document.querySelector(`[data-file="${r}"].kimo-file-row--missing`),
        `${SITE}/home.kimo`,
        { timeout: 10_000 },
      )
      expect((await row.locator(".kimo-status-pill--missing").count()) === 1, "Missing pill")
      await row.click()
      await toast(page, "missing").waitFor()
      expect((await hash(page)) === "#/", "never opens the editor")
      await toast(page, "missing").getByRole("button", { name: "Remove from Recents" }).click()
      await row.waitFor({ state: "detached" })

      // Folder menu: right-click → Remove from Kimo on the active folder → All files, Undo.
      await page.locator(`.kimo-files-folder[data-folder="${LOOM}"]`).click()
      await page.waitForFunction(() => location.hash.startsWith("#/folder/"))
      await page.locator(`.kimo-files-folder[data-folder="${LOOM}"]`).click({ button: "right" })
      await page.locator('.home-menu [data-item="remove-folder"]').click()
      await page.waitForFunction(() => location.hash === "#/all")
      await toast(page, "folder-removed").getByRole("button", { name: "Undo" }).click()
      await page.locator(`.kimo-files-folder[data-folder="${LOOM}"]`).waitFor()
      // ⋯ on hover opens the same menu.
      await page.locator(`.kimo-files-folder[data-folder="${LOOM}"]`).hover()
      await page
        .locator(`.kimo-files-folder[data-folder="${LOOM}"] .kimo-files-folder__menu`)
        .click()
      await page.locator('.home-menu [data-item="reveal"]').waitFor()
      await page.keyboard.press("Escape")

      // No search match → Clear search.
      await page.getByRole("searchbox", { name: "Search files" }).fill("zzz")
      await page.locator('[data-empty="no-match"]').waitFor()
      await page.getByRole("button", { name: "Clear search" }).click()
      await page.locator('[data-empty="no-match"]').waitFor({ state: "detached" })

      // Design systems: a published component makes a library ("N components · used by M files").
      await page.evaluate(
        ([lib, app]) => {
          const c = (window as unknown as App).__kimoApp.control
          c.writeExternal(
            lib as string,
            JSON.stringify({
              format: "1.0.0",
              meta: { name: "UI", library: true },
              nodes: { B1: { type: "frame", parent: null, order: "a0", component: true } },
            }),
          )
          c.writeExternal(
            app as string,
            JSON.stringify({ format: "1.0.0", imports: { ui: "./ui.kimo" }, nodes: {} }),
          )
          c.setFocused(false)
          c.setFocused(true)
        },
        [`${LOOM}/ui.kimo`, `${LOOM}/app.kimo`],
      )
      await page.locator('a.home-nav[href="#/libraries"]').click()
      await page
        .locator(`.kimo-file-card[data-file="${LOOM}/ui.kimo"]`)
        .waitFor({ timeout: 10_000 })
      const info = await page
        .locator(`.kimo-file-card[data-file="${LOOM}/ui.kimo"] .kimo-file-card__info`)
        .innerText()
      expect(info === "1 component · used by 1 file", `library info ${info}`)
      const n = await page.locator('a.home-nav[href="#/libraries"] .home-nav__count').innerText()
      const cards = await page.locator(".kimo-file-card").count()
      expect(n === String(cards) && cards >= 2, `Design systems count ${n} = ${cards} cards`)
    },
  },
  {
    name: "board37: measured pass (active row, folder path, empty state, TemplateCard, TrashRow)",
    async run(ctx) {
      const { page } = ctx
      await home(ctx, `#/folder/${encodeURIComponent(KIMO_SITE)}`)
      await page.locator(".home-header__path").waitFor()
      const m = await page.evaluate(() => {
        const cs = (q: string) => getComputedStyle(document.querySelector(q) as Element)
        const r = (q: string) => (document.querySelector(q) as Element).getBoundingClientRect()
        const row = cs('.kimo-files-folder[aria-current="page"]')
        const label = cs('.kimo-files-folder[aria-current="page"] .kimo-files-folder__label')
        const title = r(".home-header__title")
        const path = r(".home-header__path")
        return {
          rowRadius: row.borderTopLeftRadius,
          rowH: r('.kimo-files-folder[aria-current="page"]').height,
          rowBg: row.backgroundColor,
          labelWeight: label.fontWeight,
          pathGap: Math.round(path.x - (title.x + title.width)),
          pathFont: cs(".home-header__path").fontSize,
          pathFamily: cs(".home-header__path").fontFamily,
          muted: getComputedStyle(document.documentElement).getPropertyValue("--kimo-bg-muted"),
        }
      })
      expect(m.rowH === 32, `row 32 high (${m.rowH})`)
      expect(
        Number.parseFloat(m.rowRadius) >= 999 || m.rowRadius === "9999px",
        `pill ${m.rowRadius}`,
      )
      expect(m.labelWeight === "600", `active label 600 (${m.labelWeight})`)
      expect(m.pathGap === 12, `path 12px after the h1 (${m.pathGap})`)
      expect(m.pathFont === "11px" && /mono/i.test(m.pathFamily), `path mono 11 (${m.pathFont})`)

      // Empty state 64px under the Files Header, 300 wide, actions 16 below (a folder with no files).
      await page.evaluate((r) => {
        const c = (window as unknown as App).__kimoApp.control
        c.removeExternal(r)
        // Home re-lists when the window comes back to the front.
        c.setFocused(false)
        c.setFocused(true)
      }, `${SITE}/home.kimo`)
      await page.locator('[data-empty="folder"]').waitFor({ timeout: 10_000 })
      const e = await page.evaluate(() => {
        const r = (q: string) => (document.querySelector(q) as Element).getBoundingClientRect()
        const header = r(".kimo-files-recent-header")
        const state = r(".home-empty-area__state")
        const actions = r(".home-empty-area__actions")
        const area = document.querySelector(".home-empty-area") as HTMLElement
        return {
          gap: Math.round(state.y - (header.y + header.height)),
          width: state.width,
          actionsGap: Math.round(actions.y - (state.y + state.height)),
          display: getComputedStyle(area).display,
          buttonH: r(".home-empty-area__button").height,
        }
      })
      expect(e.gap === 64, `EmptyState 64px under the header (${e.gap})`)
      expect(e.width === 300, `EmptyState 300 wide (${e.width})`)
      expect(e.actionsGap === 16, `actions 16px below (${e.actionsGap})`)
      expect(e.buttonH === 30, `action buttons h30 (${e.buttonH})`)

      await page.locator('a.home-nav[href="#/templates"]').click()
      await page.locator(".home-template-card").first().waitFor()
      const t = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s) as Element
        const r = (s: string) => q(s).getBoundingClientRect()
        const card = r(".home-template-card")
        const thumb = r(".home-template-card__thumbnail")
        const meta = r(".home-template-card__meta")
        const use = r(".home-template-card__use")
        const row = r(".home-template-grid__row")
        const cards = [...document.querySelectorAll(".home-template-card")].map((c) =>
          c.getBoundingClientRect(),
        )
        const img = q(".home-template-card__image") as HTMLImageElement
        return {
          thumbH: thumb.height,
          metaGap: Math.round(meta.y - (thumb.y + thumb.height)),
          useH: use.height,
          colGap: Math.round((cards[1]?.x ?? 0) - ((cards[0]?.x ?? 0) + card.width)),
          rowGap: Math.round((cards[4]?.y ?? 0) - (row.y + row.height)),
          border: getComputedStyle(q(".home-template-card__thumbnail")).borderTopWidth,
          img: img.complete && img.naturalWidth > 0,
          cardW: card.width,
        }
      })
      expect(t.thumbH === 164, `thumbnail 164 (${t.thumbH})`)
      expect(t.metaGap === 10, `card gap 10 (${t.metaGap})`)
      expect(t.useH === 28, `Use template h28 (${t.useH})`)
      expect(t.colGap === 20, `card gap 20 (${t.colGap})`)
      expect(t.rowGap === 24, `row gap 24 (${t.rowGap})`)
      expect(t.border === "1px", `thumbnail border 1px (${t.border})`)
      expect(t.img, "preview.png loaded")

      // TrashRow (LVJiO) / header (Vm6RF).
      await page.evaluate(
        (r) =>
          (
            window as unknown as {
              __kimoApp: { platform: { trash: { move(r: string): unknown } } }
            }
          ).__kimoApp.platform.trash.move(r),
        `${LOOM}/marketing.kimo`,
      )
      await page.locator('a.home-nav[href="#/trash"]').click()
      await page.locator(".home-trash-row[data-trash]").waitFor()
      const tr = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s) as Element
        const r = (s: string) => q(s).getBoundingClientRect()
        return {
          rowH: r(".home-trash-row[data-trash]").height,
          headH: r(".home-trash-row--header").height,
          name: r(".home-trash-row[data-trash] .home-trash-row__name-cell").width,
          deleted: r(".home-trash-row[data-trash] .home-trash-row__deleted-cell").width,
          actions: r(".home-trash-row[data-trash] .home-trash-row__actions-cell").width,
          restoreH: r(".home-trash-row__restore").height,
          deleteColor: getComputedStyle(q(".home-trash-row__delete")).color,
          danger: getComputedStyle(q(".home-trash-row__delete")).getPropertyValue("--kimo-danger"),
          tile: r(".home-trash-row__icon-tile").width,
        }
      })
      expect(tr.rowH === 48 && tr.headH === 32, `rows 48 / 32 (${tr.rowH} / ${tr.headH})`)
      expect(tr.name === 200 && tr.deleted === 112 && tr.actions === 228, JSON.stringify(tr))
      expect(tr.restoreH === 28 && tr.tile === 28, `buttons h28, tile 28 (${JSON.stringify(tr)})`)
    },
  },
  {
    name: "board37 web: template, Rename, Duplicate, Trash with Restore / Delete forever",
    async run(ctx) {
      const { page, url } = ctx
      await page.goto(`${url}#/templates`)
      await page.locator('[data-template="design-system"]').waitFor({ timeout: 15_000 })
      await page
        .locator('[data-template="design-system"]')
        .getByRole("button", { name: /Use the/ })
        .click()
      await page.waitForFunction(() => location.hash.startsWith("#/file/"), undefined, {
        timeout: 15_000,
      })
      await page.goto(`${url}#/all`)
      const card = page.locator(".kimo-file-card", { hasText: "Design system" }).first()
      await card.waitFor({ timeout: 15_000 })
      // Design systems lists it (meta.library) with its component count.
      const libCount = await page
        .locator('a.home-nav[href="#/libraries"] .home-nav__count')
        .innerText()
      expect(libCount === "1", `libraries ${libCount}`)

      // Rename through the card menu.
      await card.click({ button: "right" })
      await page.locator('.home-menu [data-item="rename"]').click()
      const field = page.locator(".home-rename-field")
      await field.fill("Kimo DS")
      await field.press("Enter")
      const renamed = page.locator(".kimo-file-card", { hasText: "Kimo DS" }).first()
      await renamed.waitFor()
      // Duplicate → "Kimo DS copy".
      await renamed.click({ button: "right" })
      const items = await page.locator(".home-menu .kimo-menu-item-dense__label").allInnerTexts()
      expect(items.join() === "Open,Rename,Duplicate,Download .kimo,Move to Trash", `${items}`)
      await page.locator('.home-menu [data-item="duplicate"]').click()
      await page.locator(".kimo-file-card", { hasText: "Kimo DS copy" }).waitFor()

      // Move to Trash → Undo → Trash again → Trash view → Restore → Delete forever.
      const copy = page.locator(".kimo-file-card", { hasText: "Kimo DS copy" })
      await copy.click({ button: "right" })
      await page.locator('.home-menu [data-item="trash"]').click()
      await copy.waitFor({ state: "detached" })
      await toast(page, "trashed").getByRole("button", { name: "Undo" }).click()
      await copy.waitFor()
      await copy.click({ button: "right" })
      await page.locator('.home-menu [data-item="trash"]').click()
      await copy.waitFor({ state: "detached" })
      await page.locator('a.home-nav[href="#/trash"]').click()
      const row = page.locator('[data-trash="Kimo DS copy"]')
      await row.waitFor()
      expect((await row.locator(".home-trash-row__location").innerText()) === "30 days", "30 days")
      await row.getByRole("button", { name: /^Restore/ }).click()
      await row.waitFor({ state: "detached" })
      await page.locator('a.home-nav[href="#/all"]').click()
      await copy.waitFor()
      await copy.click({ button: "right" })
      await page.locator('.home-menu [data-item="trash"]').click()
      await page.locator('a.home-nav[href="#/trash"]').click()
      await row.getByRole("button", { name: /forever/ }).click()
      await page.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click()
      await page.locator('[data-empty="trash"]').waitFor()
    },
  },
]
