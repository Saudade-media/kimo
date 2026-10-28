import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PROTOCOL, toBase64Url } from "@kimo/sync/mp"
import { clientIp } from "../src/http"
import type { VersionInfo } from "../src/index"
import { resolveWebDir } from "../src/web"
import { type Harness, registered, startRelay } from "./helpers"

let h: Harness
beforeAll(() => {
  h = startRelay()
})
afterAll(() => h.stop())

describe("routes", () => {
  test("/healthz answers ok", async () => {
    const res = await fetch(`${h.base}/healthz`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test("/version reports the protocol, the relay id and whether the relay is claimed", async () => {
    const body = (await (await fetch(`${h.base}/version`)).json()) as VersionInfo
    expect(body.protocol).toBe(PROTOCOL)
    expect(body.relayId).toBe(toBase64Url(h.relay.relayId))
    expect(body.owner).toBe("claimed")

    const empty = startRelay({ ownerKeys: [] })
    const unclaimed = (await (await fetch(`${empty.base}/version`)).json()) as VersionInfo
    expect(unclaimed.owner).toBe("unclaimed")
    expect(unclaimed.relayId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    await empty.stop()
  })

  test("/sync without an upgrade is 400", async () => {
    const res = await fetch(`${h.base}/sync/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe("BAD_REQUEST")
  })

  test("CORS preflight is 204; an allow list answers only listed origins and the desktop webviews", async () => {
    const pre = await fetch(`${h.base}/room/x`, { method: "OPTIONS" })
    expect(pre.status).toBe(204)
    expect(pre.headers.get("access-control-allow-origin")).toBe("*")

    const strict = startRelay({ allowedOrigins: ["https://app.example"] })
    const allowOrigin = async (origin: string) =>
      (await fetch(`${strict.base}/version`, { headers: { origin } })).headers.get(
        "access-control-allow-origin",
      )
    expect(await allowOrigin("https://app.example")).toBe("https://app.example")
    expect(await allowOrigin("tauri://localhost")).toBe("tauri://localhost")
    expect(await allowOrigin("https://tauri.localhost")).toBe("https://tauri.localhost")
    expect(await allowOrigin("https://evil.example")).toBeNull()
    await strict.stop()
  })
})

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

describe("web app", () => {
  let root: string
  let dist: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "kimo-web-"))
    dist = join(root, "dist")
    mkdirSync(join(dist, "assets"), { recursive: true })
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Kimo</title>")
    writeFileSync(join(dist, "assets", "app-1a2b.js"), "console.log(1)")
    writeFileSync(join(root, "secret.txt"), "nope")
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  test("KIMO_WEB_DIR wins, off disables, else the first candidate with an index.html", () => {
    expect(resolveWebDir(dist, [])).toBe(dist)
    expect(resolveWebDir("off", [dist])).toBeNull()
    expect(resolveWebDir(undefined, [join(root, "missing"), dist])).toBe(dist)
    expect(resolveWebDir(root, [dist])).toBeNull()
  })

  test("with a build, share-link routes serve index.html uncached and without a referrer", async () => {
    const web = startRelay({ webDir: dist })
    for (const path of ["/", "/join", "/pair"]) {
      const res = await fetch(`${web.base}${path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get("cache-control")).toBe("no-cache")
      expect(res.headers.get("referrer-policy")).toBe("no-referrer")
      expect(await res.text()).toContain("<title>Kimo</title>")
    }
    expect(await (await fetch(`${web.base}/assets/app-1a2b.js`)).text()).toBe("console.log(1)")
    await web.stop()
  })

  test("paths outside the build, unknown files and writes are 404", async () => {
    const web = startRelay({ webDir: dist })
    for (const path of ["/%2e%2e/secret.txt", "/assets/missing.js", "/..%2fsecret.txt"])
      expect((await fetch(`${web.base}${path}`)).status).toBe(404)
    expect((await fetch(`${web.base}/join`, { method: "POST" })).status).toBe(404)
    await web.stop()
  })

  test("without a build, /join and /pair hand the link to the desktop app", async () => {
    for (const route of ["join", "pair"]) {
      const res = await fetch(`${h.base}/${route}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain(`"kimo://${route}"+location.hash`)
    }
    expect((await fetch(`${h.base}/`)).status).toBe(404)
  })
})
