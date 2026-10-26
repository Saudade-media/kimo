import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveWebDir } from "../src/web"
import { type Harness, startRelay } from "./helpers"

// Board 45: share links are https://<relay>/join#..., so the relay serves the web app.

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

describe("resolveWebDir", () => {
  test("KIMO_WEB_DIR wins, off disables, else the first candidate with an index.html", () => {
    expect(resolveWebDir(dist, [])).toBe(dist)
    expect(resolveWebDir("off", [dist])).toBeNull()
    expect(resolveWebDir(undefined, [join(root, "missing"), dist])).toBe(dist)
    expect(resolveWebDir(root, [dist])).toBeNull()
  })
})

describe("with a web build", () => {
  let h: Harness
  beforeAll(() => {
    h = startRelay({ webDir: dist })
  })
  afterAll(() => h.stop())

  test("/, /join and /pair serve index.html, uncached and without a referrer", async () => {
    for (const path of ["/", "/join", "/pair"]) {
      const res = await fetch(`${h.base}${path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get("content-type")).toContain("text/html")
      expect(res.headers.get("cache-control")).toBe("no-cache")
      expect(res.headers.get("referrer-policy")).toBe("no-referrer")
      expect(await res.text()).toContain("<title>Kimo</title>")
    }
  })

  test("built assets are served and cached for good", async () => {
    const res = await fetch(`${h.base}/assets/app-1a2b.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("immutable")
    expect(await res.text()).toBe("console.log(1)")
  })

  test("paths outside the build, unknown files and writes are 404", async () => {
    for (const path of ["/%2e%2e/secret.txt", "/assets/missing.js", "/..%2fsecret.txt"])
      expect((await fetch(`${h.base}${path}`)).status).toBe(404)
    expect((await fetch(`${h.base}/join`, { method: "POST" })).status).toBe(404)
  })

  test("relay routes still answer", async () => {
    const res = await fetch(`${h.base}/healthz`)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe("without a web build", () => {
  let h: Harness
  beforeAll(() => {
    h = startRelay()
  })
  afterAll(() => h.stop())

  test("/join and /pair hand the link to the app", async () => {
    for (const route of ["join", "pair"]) {
      const res = await fetch(`${h.base}/${route}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain(`"kimo://${route}"+location.hash`)
      expect(html).toContain("Open in Kimo")
    }
  })

  test("the app root is not served", async () => {
    expect((await fetch(`${h.base}/`)).status).toBe(404)
  })
})
