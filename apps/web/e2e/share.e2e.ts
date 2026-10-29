/**
 * Share and join smoke, against a real local relay (`apps/server`): start sharing from the Share
 * popover, join the view link and the edit link in two more browsers, and see edits arrive. The
 * relay is blind and everything is end to end encrypted, so this goes through the real client,
 * crypto and WebSocket. Assertions are on each browser's document.
 */
import type { Page } from "playwright"
import {
  clearStage,
  drag,
  draw,
  expect,
  focusCanvas,
  nodeIds,
  openEditor,
  type Scenario,
  settle,
  stage,
  toPage,
  waitCanvas,
  waitFor,
} from "./helpers"
import { startRelay } from "./relay"

/** Share popover: set the relay, start sharing, copy the view and the edit link. */
async function startSharing(page: Page, relayUrl: string) {
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin })
  await page.getByRole("button", { name: "Share" }).click()
  const dialog = page.getByRole("dialog", { name: "Share" })
  const field = dialog.getByRole("textbox", { name: "Relay URL" })
  await field.fill(relayUrl)
  await field.blur()
  // Enabled once the relay answers as a Kimo relay that is ours to claim.
  await dialog.getByRole("button", { name: "Start sharing" }).click()
  await dialog.getByText("Live", { exact: true }).waitFor()
  const link = async (role: "view" | "edit") => {
    await dialog.getByRole("button", { name: `Copy ${role} link` }).click()
    return page.evaluate(() => navigator.clipboard.readText())
  }
  const view = await link("view")
  const edit = await link("edit")
  expect(view !== edit, "view and edit links differ")
  await page.keyboard.press("Escape")
  return { view, edit }
}

/** Opens a share link the way the app does (its in-app join route) and waits for the document. */
async function join(page: Page, appUrl: string, link: string) {
  await page.goto(`${appUrl}#/join/${encodeURIComponent(link)}`)
  await waitCanvas(page)
}

/** Waits until `page` holds every id in `ids`. */
const hasNodes = (page: Page, ids: string[]) =>
  waitFor(
    page,
    `the document to hold ${ids.length} nodes`,
    (want) =>
      want.every((i) =>
        (
          window as unknown as { __kimo: { session: { store: { getNode(i: string): unknown } } } }
        ).__kimo.session.store.getNode(i),
      ),
    ids,
  )

export const scenarios: Scenario[] = [
  {
    name: "share: start sharing, join as viewer and as editor, edits arrive",
    async run({ page, url, newPage }) {
      const relay = await startRelay()
      try {
        await openEditor(page, url)
        await clearStage(page)
        const { view, edit } = await startSharing(page, relay.url)
        await page.locator(".mp-share-button[data-shared]").waitFor()

        // The viewer sees the owner's document, read only.
        const viewer = await newPage()
        await join(viewer, url, view)
        await viewer.getByRole("button", { name: "View only" }).waitFor()
        await hasNodes(viewer, await nodeIds(page))

        // The editor sees it too.
        const editor = await newPage()
        await join(editor, url, edit)
        await hasNodes(editor, await nodeIds(page))

        // An edit by the owner arrives on both.
        const fromOwner = await draw(page, "r", { x: 300, y: 150 }, { x: 460, y: 250 })
        await hasNodes(viewer, [fromOwner])
        await hasNodes(editor, [fromOwner])

        // An edit by the editor arrives on the owner and the viewer.
        await clearStage(editor)
        const fromEditor = await draw(editor, "r", { x: 600, y: 150 }, { x: 760, y: 250 })
        await hasNodes(page, [fromEditor])
        await hasNodes(viewer, [fromEditor])

        // The viewer can't edit: its attempt to draw changes nothing, here or on the others.
        await clearStage(viewer)
        const viewerBefore = await nodeIds(viewer)
        await focusCanvas(viewer)
        await viewer.keyboard.press("r")
        const from = await toPage(viewer, stage(300, 400))
        await drag(viewer, from, { x: from.x + 120, y: from.y + 80 })
        await settle(viewer)
        expect(
          JSON.stringify(await nodeIds(viewer)) === JSON.stringify(viewerBefore),
          "a view link cannot draw",
        )
        // A later edit from the editor reaches the owner after anything the viewer might have
        // sent, so the owner holding exactly the editor's nodes shows the viewer sent nothing.
        const later = await draw(editor, "r", { x: 600, y: 350 }, { x: 760, y: 450 })
        await hasNodes(page, [later])
        expect(
          JSON.stringify([...(await nodeIds(page))].sort()) ===
            JSON.stringify([...(await nodeIds(editor))].sort()),
          "the owner and the editor hold the same document",
        )
      } finally {
        await relay.stop()
      }
    },
  },
]
