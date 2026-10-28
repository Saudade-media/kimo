/** Closing an untitled file with edits asks first, and never loses the work on Cancel. */
import { describe, expect, test } from "bun:test"
import { FILE, ROOT, setup, waitFor } from "../session-helpers"

const frame = (id: string) => ({
  op: "insert" as const,
  id,
  node: { type: "frame", name: id, w: 100, h: 100 },
})

describe("untitled close prompt", () => {
  test("no edits closes silently; Cancel keeps it open; Don't save discards the recovery entry", async () => {
    const { platform, manager } = await setup()
    const empty = await manager.newUntitled()
    expect(empty.needsClosePrompt).toBe(false)
    expect(await empty.requestClose()).toBe(true)
    // A file saved before never asks.
    const saved = await manager.open(FILE)
    saved.store.apply(frame("Frame00001"), { origin: "user" })
    expect(saved.needsClosePrompt).toBe(false)
    expect(await saved.requestClose()).toBe(true)

    const s = await manager.newUntitled()
    s.store.apply(frame("Frame00001"), { origin: "user" })
    s.store.apply(frame("Frame00002"), { origin: "user" })
    expect(s.needsClosePrompt).toBe(true)
    const first = s.requestClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    expect(s.state().closePrompt).toMatchObject({ frames: 2 })
    s.respondToClose("cancel")
    expect(await first).toBe(false)
    expect(s.state().closePrompt).toBeNull()
    await s.writeUntitledSnapshot()
    const id = s.untitledRecoveryId as string
    expect((await platform.recovery.list()).some((e) => e.id === id)).toBe(true)

    const second = s.requestClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt again")
    s.respondToClose("discard")
    expect(await second).toBe(true)
    expect((await platform.recovery.list()).some((e) => e.id === id)).toBe(false)
  })

  test("Save opens the save panel; a cancelled panel keeps the window open", async () => {
    const { platform, manager } = await setup({})
    const s = await manager.newUntitled()
    s.store.apply(frame("Frame00001"), { origin: "user" })
    let answer: string | null = null
    platform.dialogs.saveFile = async () => answer
    const cancelled = s.confirmClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("save")
    expect(await cancelled).toBe(false)
    expect(s.untitled).toBe(true)
    answer = `${ROOT}/landing.kimo`
    const saved = s.confirmClose()
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("save")
    expect(await saved).toBe(true)
    expect(s.untitled).toBe(false)
    expect(platform.control.readFile(`${ROOT}/landing.kimo`)).toContain('"Frame00001"')
    await s.dispose()
  })

  test("the window's close request asks; Cancel answers false so the window stays", async () => {
    const { platform, manager } = await setup({})
    const handlers: ((info: { quitting: boolean }) => Promise<boolean> | boolean)[] = []
    platform.window.onCloseRequested = (h) => {
      handlers.push(h)
      return () => {}
    }
    manager.install()
    const s = await manager.newUntitled()
    s.store.apply(frame("Frame00001"), { origin: "user" })
    const r = handlers[0]?.({ quitting: false }) as Promise<boolean>
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("cancel")
    expect(await r).toBe(false)
    const r2 = handlers[0]?.({ quitting: false }) as Promise<boolean>
    await waitFor(() => !!s.state().closePrompt, 1000, "prompt")
    s.respondToClose("discard")
    expect(await r2).toBe(true)
  })
})
