import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { clientIp } from "../src/http"
import { type Harness, registered, startRelay } from "./helpers"

describe("clientIp (x-forwarded-for)", () => {
  const server = { requestIP: () => ({ address: "10.0.0.1" }) } as never
  const req = (xff: string) => new Request("http://x/", { headers: { "x-forwarded-for": xff } })
  const relayWith = (trustProxy: boolean, trustProxyHops: number) =>
    ({ config: { trustProxy, trustProxyHops } }) as never

  test("counts entries from the right, so spoofed left entries are ignored", () => {
    const chain = req("1.1.1.1, 2.2.2.2, 3.3.3.3")
    expect(clientIp(relayWith(true, 1), chain, server)).toBe("3.3.3.3")
    expect(clientIp(relayWith(true, 2), chain, server)).toBe("2.2.2.2")
  })

  test("falls back to the socket address when untrusted or too short", () => {
    expect(clientIp(relayWith(false, 1), req("1.1.1.1"), server)).toBe("10.0.0.1")
    expect(clientIp(relayWith(true, 3), req("1.1.1.1"), server)).toBe("10.0.0.1")
  })
})

describe("request bodies are read as a stream", () => {
  let h: Harness
  beforeAll(() => {
    h = startRelay()
  })
  afterAll(() => h.stop())

  test("an oversized chunked admin body is refused without reading all of it", async () => {
    const owner = await registered(h)
    const chunk = new Uint8Array(64 * 1024)
    const total = 40 * 1024 * 1024
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= total) return controller.close()
        pulled += chunk.length
        controller.enqueue(chunk)
      },
    })
    const res = await fetch(`${h.base}/room/${owner.room.id}/admin`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit)
    expect(res.status).toBe(413)
    expect(pulled).toBeLessThan(total / 2)
  })
})
