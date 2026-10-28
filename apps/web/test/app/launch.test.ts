/**
 * The static launch loader in index.html runs before the app: it must stay CSP-safe (no inline
 * script) and read the same theme key as the app.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const web = join(import.meta.dir, "../..")
const html = readFileSync(join(web, "index.html"), "utf8")
const boot = readFileSync(join(web, "public/launch.js"), "utf8")

describe("index.html launch loader", () => {
  test("every script is an external file (CSP script-src 'self'), and the boot script runs before first paint", () => {
    for (const s of html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? []) {
      expect(s).toMatch(/ src="/)
      expect(s.replace(/<script[^>]*>|<\/script>/g, "").trim()).toBe("")
    }
    expect(html.indexOf('<script src="/launch.js"></script>')).toBeLessThan(html.indexOf("<body>"))
  })

  test("launch.js reads lib/theme's key and turns the loader off in the document host", () => {
    const theme = readFileSync(join(web, "src/lib/theme.ts"), "utf8")
    expect(theme).toContain('const KEY = "kimo.theme"')
    expect(boot).toContain('localStorage.getItem("kimo.theme")')
    expect(boot).toContain('location.hash.indexOf("#/host") === 0')
    expect(boot).toContain('root.dataset.launch = "off"')
  })
})
