import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import pkg from "../package.json" with { type: "json" }
import {
  createServer,
  MULTIPLAYER_ADR,
  type NotImplementedBody,
  type VersionInfo,
} from "../src/index"

let server: ReturnType<typeof createServer>
let base: string

beforeAll(() => {
  server = createServer({ port: 0 })
  base = server.url.href.replace(/\/$/, "")
})

afterAll(async () => {
  await server.stop(true)
})

describe("@kimo/server stub", () => {
  test("listens on an ephemeral port", () => {
    expect(server.port).toBeGreaterThan(0)
  })

  test("GET /healthz returns ok", async () => {
    const res = await fetch(`${base}/healthz`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ ok: true })
  })

  test("GET /version returns name and version from package.json", async () => {
    const res = await fetch(`${base}/version`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as VersionInfo
    expect(body.name).toBe(pkg.name)
    expect(body.version).toBe(pkg.version)
  })

  test("/sync WebSocket upgrade responds 501 with an explanation", async () => {
    const res = await fetch(`${base}/sync`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    })
    expect(res.status).toBe(501)
    const body = (await res.json()) as NotImplementedBody
    expect(body.error).toBe("NOT_IMPLEMENTED")
    expect(body.message).toMatch(/multiplayer/i)
    expect(body.adr).toBe(MULTIPLAYER_ADR)
  })

  test("a real WebSocket client fails to connect to /sync", async () => {
    const ws = new WebSocket(`${base.replace(/^http/, "ws")}/sync`)
    const outcome = await new Promise<string>((resolve) => {
      ws.onopen = () => resolve("open")
      ws.onerror = () => resolve("error")
      ws.onclose = () => resolve("close")
    })
    expect(outcome).not.toBe("open")
  })

  test("non-GET on /healthz is 405", async () => {
    const res = await fetch(`${base}/healthz`, { method: "POST" })
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("GET, HEAD")
  })

  test("unknown routes are 404", async () => {
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
  })
})
