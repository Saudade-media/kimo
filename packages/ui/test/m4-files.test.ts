/** 02d files components: SaveStatus, Banner, Dialog, FileRow, RecoveryItem, window chrome. */
import { describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  Banner,
  BranchChip,
  DesktopBreadcrumb,
  Dialog,
  FileRow,
  FileRowHeader,
  middleTruncate,
  RecoveryItem,
  SAVE_STATUS_LABEL,
  SaveStatus,
  TrafficLights,
} from "../src/index"

describe("SaveStatus", () => {
  test("seven states, default labels, one modifier each", () => {
    for (const kind of Object.keys(SAVE_STATUS_LABEL) as (keyof typeof SAVE_STATUS_LABEL)[]) {
      const html = renderToString(h(SaveStatus, { kind }))
      expect(html).toContain(`kimo-save-status--${kind}`)
      expect(html).toContain(`>${SAVE_STATUS_LABEL[kind]}<`)
    }
    expect(
      renderToString(h(SaveStatus, { kind: "paused", label: "2 conflicts · autosave paused" })),
    ).toContain(">2 conflicts · autosave paused<")
  })
})

describe("Banner", () => {
  test("tone, actions (ghost/secondary → ghost instance, primary), optional dismiss", () => {
    const html = renderToString(
      h(Banner, {
        tone: "warning",
        title: "Rebase in progress · autosave paused",
        body: "Your 6 unsaved edits are kept in memory.",
        actions: [
          { id: "git-discard", label: "Discard", variant: "ghost" },
          { id: "git-stash", label: "Stash as recovery file", variant: "secondary" },
          { id: "git-keep", label: "Keep my edits", variant: "primary" },
        ],
      }),
    )
    expect(html).toContain("kimo-banner--warning")
    expect(html.match(/kimo-banner__action--ghost/g)?.length).toBe(2)
    expect(html).toContain("kimo-button--primary")
    expect(html).not.toContain("kimo-banner__dismiss")
    expect(renderToString(h(Banner, { title: "Ready to commit", onDismiss: () => {} }))).toContain(
      "kimo-banner__dismiss",
    )
  })
})

describe("Dialog", () => {
  test("footnote, tertiary, cancel, confirm in order", () => {
    const html = renderToString(
      h(Dialog, {
        inline: true,
        icon: null,
        title: "Recover unsaved changes?",
        description: "…",
        footnote: "Kept for 30 days",
        tertiary: { label: "Discard all", onClick: () => {} },
        cancelLabel: "Decide later",
        confirmLabel: "Restore all",
        onCancel: () => {},
        onConfirm: () => {},
        width: 600,
      }),
    )
    const order = ["Kept for 30 days", "Discard all", "Decide later", "Restore all"].map((t) =>
      html.indexOf(t),
    )
    expect(order.every((i, n) => i > 0 && (n === 0 || i > (order[n - 1] as number)))).toBe(true)
    expect(html).toContain("width:600px")
  })
})

describe("FileRow", () => {
  test("header labels and git tone", () => {
    const header = renderToString(h(FileRowHeader))
    for (const l of ["NAME", "LOCATION", "MODIFIED", "GIT"]) expect(header).toContain(`>${l}<`)
    const row = renderToString(
      h(FileRow, {
        name: "checkout.kimo",
        path: "~/Projects/loom",
        modified: "Mon",
        gitLabel: "merge · 3 conflicts",
        gitTone: "conflict",
      }),
    )
    expect(row).toContain('data-git="conflict"')
    expect(row).toContain(">merge · 3 conflicts<")
  })

  test("middleTruncate keeps both ends", () => {
    const measure = (s: string) => s.length
    expect(middleTruncate("~/Work/kimo-site/design", 100, measure)).toBe("~/Work/kimo-site/design")
    const cut = middleTruncate("~/Work/kimo-site/design/shared", 12, measure)
    expect(cut.length).toBeLessThanOrEqual(12)
    expect(cut.startsWith("~/W")).toBe(true)
    expect(cut.endsWith("ed")).toBe(true)
    expect(cut).toContain("…")
  })
})

describe("RecoveryItem", () => {
  test("untitled: no Save as ghost, Restore slot reads Save as…", () => {
    const html = renderToString(
      h(RecoveryItem, {
        untitled: true,
        name: "Untitled 2",
        badge: "never saved",
        path: "not on disk yet",
        meta: "Created 10:12 · 22 layers",
      }),
    )
    expect(html.match(/kimo-recovery-item__ghost/g)?.length).toBe(1)
    expect(html).toContain("lucide-file-plus")
    expect(html).toMatch(/kimo-recovery-item__restore[^>]*>(<[^>]+>)*Save as…/)
  })
})

describe("window chrome", () => {
  test("inset 68 draws lights, 4 collapses, 0 renders nothing; inactive modifier", () => {
    expect(renderToString(h(TrafficLights, {})).match(/kimo-traffic-lights__light /g)?.length).toBe(
      3,
    )
    expect(renderToString(h(TrafficLights, { inset: 4 }))).not.toContain("__light")
    expect(renderToString(h(TrafficLights, { inset: 0 }))).toBe("")
    expect(renderToString(h(TrafficLights, { focused: false }))).toContain(
      "kimo-traffic-lights--inactive",
    )
    expect(renderToString(h(TrafficLights, { drawLights: false }))).not.toContain("__light")
  })

  test("breadcrumb folder/file/page and branch chip", () => {
    const html = renderToString(
      h(DesktopBreadcrumb, {
        folder: "loom",
        file: "marketing.kimo",
        page: "Home",
        focused: false,
      }),
    )
    expect(html).toContain("lucide-folder-git-2")
    expect(html).toContain("kimo-desktop-breadcrumb--inactive")
    expect(html).toContain(">Home<")
    expect(renderToString(h(BranchChip, { branch: "main" }))).toContain(">main<")
  })
})
