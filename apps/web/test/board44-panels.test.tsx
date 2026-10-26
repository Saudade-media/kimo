/**
 * Board 44 "Workspace v2 · floating panels" (desing.kimo cGrsTxG4c8): the collapse state of the
 * floating cards (rule "Collapse": header button one card, ⌘\ both, kept per window) and the
 * left card header's attention-only library status.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import { LibrarySaveStatus } from "../src/editor/CardHeaders"
import {
  resetPanelsForTest,
  setPanels,
  toggleBothPanels,
  togglePanel,
  usePanels,
} from "../src/editor/panels"
import { matches, shortcut } from "../src/shortcuts/shortcuts"

const state = () => {
  let s: ReturnType<typeof usePanels> | null = null
  const Probe = () => {
    s = usePanels()
    return null
  }
  renderToString(h(Probe))
  return s as unknown as ReturnType<typeof usePanels>
}

afterEach(() => {
  setPanels({ left: false, right: false })
  resetPanelsForTest()
})

describe("§5 rule Collapse", () => {
  test("both cards start expanded", () => {
    expect(state()).toEqual({ left: false, right: false })
  })

  test("the header button collapses one card", () => {
    togglePanel("left")
    expect(state()).toEqual({ left: true, right: false })
    togglePanel("left")
    expect(state()).toEqual({ left: false, right: false })
    togglePanel("right")
    expect(state()).toEqual({ left: false, right: true })
  })

  test("⌘\\ collapses both while either is open, then opens both", () => {
    togglePanel("right")
    toggleBothPanels()
    expect(state()).toEqual({ left: true, right: true })
    toggleBothPanels()
    expect(state()).toEqual({ left: false, right: false })
  })

  test("⌘\\ is a global View shortcut on Backslash", () => {
    const s = shortcut("togglePanels")
    expect(s.scope).toBe("global")
    expect(s.group).toBe("view")
    const key = { key: "\\", code: "Backslash", shiftKey: false, altKey: false }
    expect(matches("togglePanels", { ...key, metaKey: true, ctrlKey: false })).toBe(true)
    expect(matches("togglePanels", { ...key, metaKey: false, ctrlKey: false })).toBe(false)
  })
})

describe("left card header status", () => {
  test("a library file shows only statuses that need attention", () => {
    expect(renderToString(h(LibrarySaveStatus, { status: "synced" }))).toBe("")
    expect(renderToString(h(LibrarySaveStatus, { status: "saving" }))).toBe("")
    expect(renderToString(h(LibrarySaveStatus, { status: "error" }))).toContain("Not saved")
    expect(renderToString(h(LibrarySaveStatus, { status: "read-only" }))).toContain("Read-only")
  })
})
