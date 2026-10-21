import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { PROTOCOL, toBase64Url } from "@kimo/sync/mp"
import pkg from "../package.json" with { type: "json" }
import { handleRequest, type VersionInfo } from "../src/index"
import { type Harness, startRelay } from "./helpers"

let h: Harness

beforeAll(() => {
  h = startRelay()
})

afterAll(async () => {
  await h.stop()
})

describe("@kimo/server", () => {
  test("listens on an ephemeral port", () => {
    expect(h.server.port).toBeGreaterThan(0)
  })

  test("GET /healthz returns ok", async () => {
    const res = await fetch(`${h.base}/healthz`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ ok: true })
  })

  test("GET /version reports protocol and limits", async () => {
    const res = await fetch(`${h.base}/version`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as VersionInfo
    expect(body.name).toBe(pkg.name)
    expect(body.version).toBe(pkg.version)
    expect(body.protocol).toBe(PROTOCOL)
    expect(body.limits.maxBlobBytes).toBe(20 * 1024 * 1024)
    expect(body.relayId).toBe(toBase64Url(h.relay.relayId))
    expect(body.owner).toBe("claimed")
  })

  test("/version reports an unclaimed relay; /create-secret/check is gone", async () => {
    const empty = startRelay({ ownerKeys: [] })
    const body = (await (await fetch(`${empty.base}/version`)).json()) as VersionInfo
    expect(body.owner).toBe("unclaimed")
    expect(body.relayId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(body).not.toHaveProperty("createSecretRequired")
    expect((await fetch(`${empty.base}/create-secret/check`, { method: "POST" })).status).toBe(404)
    await empty.stop()
  })

  test("handleRequest serves the static routes without a socket", async () => {
    expect(handleRequest(new Request("http://x/healthz")).status).toBe(200)
    const version = (await handleRequest(new Request("http://x/version")).json()) as VersionInfo
    expect(version.protocol).toBe(PROTOCOL)
    expect(version.owner).toBe("unclaimed")
    expect(handleRequest(new Request("http://x/nope")).status).toBe(404)
  })

  test("/sync without an upgrade is 400", async () => {
    const res = await fetch(`${h.base}/sync/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe("BAD_REQUEST")
    expect((await fetch(`${h.base}/sync`)).status).toBe(400)
  })

  test("non-GET on /healthz is 405", async () => {
    const res = await fetch(`${h.base}/healthz`, { method: "POST" })
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("GET, HEAD")
  })

  test("unknown routes are 404", async () => {
    expect((await fetch(`${h.base}/nope`)).status).toBe(404)
  })

  test("CORS preflight is 204 and responses carry CORS headers", async () => {
    const pre = await fetch(`${h.base}/room/x`, { method: "OPTIONS" })
    expect(pre.status).toBe(204)
    expect(pre.headers.get("access-control-allow-origin")).toBe("*")
    expect(pre.headers.get("access-control-allow-headers")).toBe("authorization, content-type")
  })

  test("an allow list answers only listed origins", async () => {
    const strict = startRelay({ allowedOrigins: ["https://app.example"] })
    const ok = await fetch(`${strict.base}/healthz`, { headers: { origin: "https://app.example" } })
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example")
    const other = await fetch(`${strict.base}/healthz`, {
      headers: { origin: "https://evil.example" },
    })
    expect(other.headers.get("access-control-allow-origin")).toBeNull()
    await strict.stop()
  })

  test("an allow list also answers the desktop app's webview origins", async () => {
    const strict = startRelay({ allowedOrigins: ["https://app.example"] })
    for (const origin of [
      "tauri://localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ]) {
      const res = await fetch(`${strict.base}/version`, { headers: { origin } })
      expect(res.headers.get("access-control-allow-origin")).toBe(origin)
    }
    const random = await fetch(`${strict.base}/version`, {
      headers: { origin: "https://random.example" },
    })
    expect(random.headers.get("access-control-allow-origin")).toBeNull()
    await strict.stop()
  })
})
