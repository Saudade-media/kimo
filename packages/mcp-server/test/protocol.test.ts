/** Socket protocol framing and handshake (ADR 0013 §7, docs/spec/socket.md). */
import { describe, expect, test } from "bun:test"
import {
  checkHello,
  decideMode,
  decideOpen,
  encodeFrame,
  FrameDecoder,
  formatDocId,
  isControlMessage,
  parseDocId,
  SOCKET_ERRORS,
  SOCKET_PROTOCOL,
} from "../src/index"

describe("framing", () => {
  test("round trip across chunk boundaries", () => {
    const d = new FrameDecoder()
    const a = encodeFrame({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    const b = encodeFrame({ jsonrpc: "2.0", method: "kimo/ping" })
    const all = a + b
    const r1 = d.push(all.slice(0, 10))
    const r2 = d.push(all.slice(10))
    expect(r1.messages).toEqual([])
    expect(r2.messages.length).toBe(2)
    expect(isControlMessage(r2.messages[1])).toBe(true)
    expect(isControlMessage(r2.messages[0])).toBe(false)
  })

  test("bad lines are reported", () => {
    expect(new FrameDecoder().push("{nope\n").errors.length).toBe(1)
  })
})

describe("hello", () => {
  const base = {
    protocol: SOCKET_PROTOCOL,
    token: "t0k",
    relay: { name: "kimo-mcp" as const, version: "0.5.0" },
    pid: 1,
    ppid: 0,
  }
  test("accepts the right token and version", () => expect(checkHello(base, "t0k")).toBeNull())
  test("rejects a bad token", () =>
    expect(checkHello({ ...base, token: "x" }, "t0k")?.code).toBe(SOCKET_ERRORS.UNAUTHORIZED))
  test("rejects a future protocol", () =>
    expect(checkHello({ ...base, protocol: "kimo-socket/9" }, "t0k")?.code).toBe(
      SOCKET_ERRORS.PROTOCOL_MISMATCH,
    ))
})

describe("topology", () => {
  test("attach vs headless", () => {
    expect(decideMode("auto", { appReachable: true })).toEqual({ mode: "attach" })
    expect(decideMode("auto", { appReachable: false })).toEqual({ mode: "headless" })
    expect(decideMode("attach", { appReachable: false }).mode).toBe("unavailable")
    expect(decideMode("headless", { appReachable: true })).toEqual({ mode: "headless" })
  })

  test("DOCUMENT_LOCKED when another live process holds the lease", () => {
    const holder = { pid: 9, app: "kimo-desktop", appLabel: "Kimo", alive: true, self: false }
    const d = decideOpen({ host: "headless", alreadyOpen: false, readOnly: false, holder })
    expect(d.action).toBe("refuse")
    if (d.action === "refuse") expect(d.suggestion).toContain("Kimo app")
    expect(
      decideOpen({ host: "headless", alreadyOpen: false, readOnly: true, holder }).action,
    ).toBe("open-read-only")
    expect(
      decideOpen({
        host: "desktop",
        alreadyOpen: false,
        readOnly: false,
        holder: { ...holder, alive: false },
      }).action,
    ).toBe("open-writable")
  })

  test("docId format", () => {
    expect(parseDocId(formatDocId("3f00aa11bb22cc33", "k9"))).toEqual({
      pathHash: "3f00aa11bb22cc33",
      epoch: "k9",
    })
    expect(parseDocId("active")).toBeNull()
  })
})
