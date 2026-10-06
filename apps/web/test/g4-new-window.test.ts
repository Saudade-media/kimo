/**
 * Audit G4: File › New window off macOS (board 20 r3ukd). Windows and Linux desktop builds have
 * no native menu bar, so the in-app File menu carries the item; macOS keeps it in the native menu
 * and the browser has its own.
 */
import { describe, expect, test } from "bun:test"
import { newWindowAction } from "../src/editor/FileMenu"

describe("New window (G4)", () => {
  const noFail = () => {
    throw new Error("unexpected failure")
  }

  test("Windows and Linux get the item; it opens a window", async () => {
    for (const os of ["windows", "linux"] as const) {
      let opened = 0
      const run = newWindowAction(os, async () => void opened++, noFail)
      expect(run).toBeDefined()
      run?.()
      await Promise.resolve()
      expect(opened).toBe(1)
    }
  })

  test("macOS, the web build and a host without the command get none", () => {
    const open = async () => {}
    expect(newWindowAction("macos", open, noFail)).toBeUndefined()
    expect(newWindowAction("web", open, noFail)).toBeUndefined()
    expect(newWindowAction("windows", undefined, noFail)).toBeUndefined()
  })

  test("a refused open is reported", async () => {
    const failures: string[] = []
    const run = newWindowAction(
      "linux",
      () => Promise.reject(new Error("no window")),
      (action, e) => failures.push(`${action}: ${(e as Error).message}`),
    )
    run?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(failures).toEqual(["open a new window: no window"])
  })
})
