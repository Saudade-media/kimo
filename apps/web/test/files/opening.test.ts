/**
 * Opening a file: who else holds it, files from a newer or older Kimo, and a file that cannot be
 * parsed.
 */
import { describe, expect, test } from "bun:test"
import { parse } from "@kimo/core-schema"
import {
  docText,
  edit,
  FILE,
  fixture,
  migrations,
  OLD_FORMAT,
  setup,
  sleep,
  waitFor,
} from "../session-helpers"
import { fastSetup } from "./helpers"

describe("file locks", () => {
  test("a file held by a live process opens locked and read-only until the lock is freed", async () => {
    const { platform, manager } = await setup()
    platform.control.setForeignLease(FILE, { pid: 48213 })
    const s = await manager.open(FILE)
    let st = s.state()
    expect(st.phase).toBe("read-only")
    expect(st.saveStatus.kind).toBe("locked")
    expect(st.banner?.kind).toBe("locked")
    expect(s.store.readOnly).not.toBeNull()
    expect(s.store.hasNode("Rect000001")).toBe(true)
    await s.runAction("open-read-only")
    st = s.state()
    expect(st.banner).toBeNull()
    expect(st.saveStatus).toEqual({ kind: "read-only", cause: "user-choice" })
    platform.control.clearForeignLease(FILE)
    await s.runAction("retry-lease")
    st = s.state()
    expect(st.phase).toBe("ready")
    expect(st.saveStatus.kind).toBe("saved")
    expect(s.store.readOnly).toBeNull()
    await s.close()
  })

  test("a stale lease (dead pid) is reclaimed on open", async () => {
    const { platform, manager } = await setup()
    platform.control.setForeignLease(FILE, { pid: 777 })
    platform.control.killPid(777)
    const s = await manager.open(FILE)
    expect(s.state().phase).toBe("ready")
    expect((await platform.leases.inspect(FILE))?.self).toBe(true)
    await s.close()
    expect(await platform.leases.inspect(FILE)).toBeNull()
  })

  test("one writer per file: opening twice returns the same session", async () => {
    const { manager } = await setup()
    const [a, b] = await Promise.all([manager.open(FILE), manager.open(FILE)])
    expect(a).toBe(b)
    expect(manager.sessions().length).toBe(1)
    await a.close()
    expect(manager.sessions().length).toBe(0)
  })
})

describe("file formats", () => {
  test("a newer format opens read-only and nothing is written", async () => {
    const text = fixture("forward/unknown-feature.kimo")
    const { platform, manager } = await setup({ [FILE]: text })
    const s = await manager.open(FILE)
    const st = s.state()
    expect(st.phase).toBe("read-only")
    expect(st.saveStatus).toEqual({ kind: "read-only", cause: "newer-format" })
    expect(st.banner).toMatchObject({ kind: "newer-format", features: ["layout/grid"] })
    await s.save()
    expect(platform.control.readFile(FILE)).toBe(text)
    await s.close()
  })

  test("an older format asks before upgrading; edits go to recovery until Upgrade and save", async () => {
    const { platform, manager } = await fastSetup(
      { [FILE]: OLD_FORMAT },
      { openOptions: { migrations }, snapshotMs: 30 },
    )
    const s = await manager.open(FILE)
    let st = s.state()
    expect(st.phase).toBe("needs-consent")
    expect(st.consent).toMatchObject({ fromFormat: "0.1", toFormat: "1.0" })
    edit(s.store, "Pending001")
    await waitFor(() => (s.provider?.hasRecoveryCopy ?? false) === true, 2000, "recovery autosave")
    expect(platform.control.readFile(FILE)).toBe(OLD_FORMAT)
    expect((await platform.recovery.list())[0]?.reason).toBe("upgrade-pending")
    expect(s.state().saveStatus).toMatchObject({ kind: "unsaved", target: "recovery" })
    await s.respondToConsent("upgrade")
    st = s.state()
    expect(st.phase).toBe("ready")
    expect(parse(platform.control.readFile(FILE) as string).format).toBe("1.0.0")
    expect(await platform.recovery.list()).toEqual([])
    await s.close()
  })

  test("an older format opened read-only is never written", async () => {
    const { platform, manager } = await setup(
      { [FILE]: OLD_FORMAT },
      { openOptions: { migrations } },
    )
    const s = await manager.open(FILE)
    await s.respondToConsent("read-only")
    expect(s.state().saveStatus).toEqual({ kind: "read-only", cause: "user-choice" })
    expect(s.store.readOnly).not.toBeNull()
    await s.save()
    expect(platform.control.readFile(FILE)).toBe(OLD_FORMAT)
    await s.close()
  })
})

describe("failed load", () => {
  test("a file with git conflict markers is terminal: no save, no autosave, no recovery writes", async () => {
    const good = docText().split("\n")
    const broken = [...good.slice(0, 3), "<<<<<<< HEAD", ...good.slice(3)].join("\n")
    const { platform, manager } = await fastSetup({ [FILE]: broken })
    const s = await manager.open(FILE)
    const st = s.state()
    expect(st.phase).toBe("failed-load")
    expect(st.banner?.kind).toBe("failed-load")
    const detail = (st.banner as { detail: { gitConflictMarkers: boolean; error: string } }).detail
    expect(detail.gitConflictMarkers).toBe(true)
    expect(detail.error).toMatch(/^SyntaxError · line 4/)
    expect(() => edit(s.store, "Never00001")).toThrow()
    await s.save()
    await s.flush()
    platform.control.writeExternal(FILE, docText())
    await sleep(250) // past the watcher's 150 ms debounce
    expect(s.state().phase).toBe("failed-load")
    expect(await platform.recovery.list()).toEqual([])
    await s.close()
  })
})
