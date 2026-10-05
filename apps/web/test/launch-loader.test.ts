/**
 * Board 29 "Launch loader" (desing.pen vIK2m): the static loader in index.html matches the
 * design's node values and the mark stays equal to packages/ui's KIMO_LOGO_PATH; the JS side
 * (src/launch-loader.ts) sets the status line and removes the layer after its fade.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { KIMO_LOGO_PATH, KIMO_LOGO_VIEWBOX } from "../../../packages/ui/src/kimo-logo/paths"

const web = join(import.meta.dir, "..")
const html = readFileSync(join(web, "index.html"), "utf8")
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ""
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? ""
const boot = readFileSync(join(web, "public/launch.js"), "utf8")

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): Record<string, string> {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const m = css.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`))
  expect(m, `rule ${sel}`).toBeTruthy()
  const out: Record<string, string> = {}
  for (const d of (m?.[1] ?? "").split(";")) {
    const i = d.indexOf(":")
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim()
  }
  return out
}

describe("index.html launch loader (board 29)", () => {
  test("mark path and viewBox equal KIMO_LOGO_PATH (KimoLogo bm1JR › Mark HTfes)", () => {
    const svg = body.match(/<svg class="kimo-launch__mark"[^>]*>/)?.[0] ?? ""
    expect(svg).toContain(`viewBox="${KIMO_LOGO_VIEWBOX}"`)
    expect(svg).toContain('width="64"')
    expect(svg).toContain('height="64"')
    expect(svg).toContain('fill="currentColor"')
    const d = body.match(/<path fill-rule="evenodd"[^>]* d="([^"]+)"/)?.[1]
    expect(d).toBe(KIMO_LOGO_PATH)
  })

  test("static sibling of #root, no inline script (CSP script-src 'self')", () => {
    expect(body.indexOf('<div id="root"></div>')).toBeLessThan(body.indexOf('id="kimo-launch"'))
    expect(body).toMatch(/<div id="kimo-launch" aria-hidden="true">/)
    for (const s of html.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? []) {
      expect(s).toMatch(/ src="/)
      expect(s.replace(/<script[^>]*>|<\/script>/g, "").trim()).toBe("")
    }
    // The boot script runs from <head>, before first paint.
    expect(html.indexOf('<script src="/launch.js"></script>')).toBeLessThan(html.indexOf("<body>"))
    expect(body).toContain('<p class="kimo-launch__status">Starting…</p>')
  })

  test("layout = the node values (Launch Screen › Center › Mark + Status)", () => {
    expect(rule("#kimo-launch")).toMatchObject({
      position: "fixed",
      inset: "0",
      display: "flex",
      "flex-direction": "column",
      "justify-content": "center",
      "align-items": "center",
      background: "#ffffff",
      color: "#0a0a0a",
      "pointer-events": "none",
      transition: "opacity 180ms ease-out",
    })
    expect(rule(".kimo-launch__center")).toMatchObject({
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: "16px",
      animation: "kimo-launch-enter 200ms ease-out both",
    })
    expect(rule(".kimo-launch__mark")).toMatchObject({
      width: "64px",
      height: "64px",
      "transform-origin": "50% 50%",
      animation: "kimo-launch-turn 1600ms infinite",
    })
    expect(rule(".kimo-launch__status")).toMatchObject({
      "font-size": "11px",
      "font-weight": "400",
      "line-height": "1.45",
      color: "#9a9da2",
      opacity: "0",
      animation: "kimo-launch-enter 200ms ease-out 3000ms both",
    })
    expect(rule("#kimo-launch.is-leaving")).toMatchObject({ opacity: "0" })
    expect(rule('html[data-launch="off"] #kimo-launch')).toMatchObject({ display: "none" })
  })

  test("dark: stored theme and prefers-color-scheme use the dark tokens", () => {
    expect(rule('html[data-theme="dark"] #kimo-launch')).toMatchObject({
      background: "#0a0a0a",
      color: "#f5f5f4",
    })
    expect(rule('html[data-theme="dark"] .kimo-launch__status')).toMatchObject({ color: "#6b6b6b" })
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*html:not\(\[data-theme="light"\]\) #kimo-launch \{\s*background: #0a0a0a;\s*color: #f5f5f4;/,
    )
  })

  test("motion: half turn with a pucker, reduced motion pulses opacity", () => {
    const turn = css.match(/@keyframes kimo-launch-turn \{([\s\S]*?)\n {6}\}/)?.[1] ?? ""
    const flat = turn.replace(/\s+/g, " ")
    expect(flat).toContain(
      "0% { transform: rotate(0deg) scale(1); animation-timing-function: cubic-bezier(0.32, 0, 0.67, 0); }",
    )
    expect(flat).toContain(
      "31.25% { transform: rotate(90deg) scale(0.88); animation-timing-function: cubic-bezier(0.33, 1, 0.68, 1); }",
    )
    expect(flat).toContain("62.5%, 100% { transform: rotate(180deg) scale(1); }")
    expect(css.replace(/\s+/g, " ")).toContain(
      "@media (prefers-reduced-motion: reduce) { .kimo-launch__mark { animation: kimo-launch-pulse 2400ms ease-in-out infinite; } }",
    )
    expect(css.replace(/\s+/g, " ")).toContain("50% { opacity: 0.6; }")
  })

  test("launch.js reads lib/theme's key and turns the loader off in the document host", () => {
    const theme = readFileSync(join(web, "src/lib/theme.ts"), "utf8")
    expect(theme).toContain('const KEY = "kimo.theme"')
    expect(boot).toContain('localStorage.getItem("kimo.theme")')
    expect(boot).toContain('location.hash.indexOf("#/host") === 0')
    expect(boot).toContain('root.dataset.launch = "off"')
  })
})

describe("src/launch-loader.ts", () => {
  const g = globalThis as Record<string, unknown>
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle }
  afterEach(() => {
    g.document = saved.document
    g.getComputedStyle = saved.getComputedStyle
  })

  /** A stand-in for #kimo-launch: classList, listeners, remove(), a status child. */
  function fakeLoader(display = "flex") {
    const classes = new Set<string>()
    const listeners = new Map<string, (e: unknown) => void>()
    const status = { textContent: "Starting…" }
    const el = {
      removed: false,
      classList: { add: (c: string) => classes.add(c), contains: (c: string) => classes.has(c) },
      addEventListener: (t: string, f: (e: unknown) => void) => listeners.set(t, f),
      removeEventListener: (t: string) => listeners.delete(t),
      remove() {
        el.removed = true
        present = false
      },
      querySelector: (s: string) => (s === ".kimo-launch__status" ? status : null),
    }
    let present = true
    g.document = { getElementById: (id: string) => (id === "kimo-launch" && present ? el : null) }
    g.getComputedStyle = () => ({ display })
    return { el, classes, listeners, status }
  }

  test("setLaunchStatus writes the status line; no-op without the loader", async () => {
    const { setLaunchStatus } = await import("../src/launch-loader")
    const f = fakeLoader()
    setLaunchStatus("Opening landing.kimo…")
    expect(f.status.textContent).toBe("Opening landing.kimo…")
    g.document = { getElementById: () => null }
    expect(() => setLaunchStatus("x")).not.toThrow()
  })

  test("hideLaunchLoader fades (is-leaving) then removes on the opacity transitionend", async () => {
    const { hideLaunchLoader } = await import("../src/launch-loader")
    const f = fakeLoader()
    const p = hideLaunchLoader()
    expect(f.classes.has("is-leaving")).toBe(true)
    expect(f.el.removed).toBe(false)
    // Idempotent while leaving.
    expect(hideLaunchLoader()).toBe(p)
    f.listeners.get("transitionend")?.({ target: f.el, propertyName: "opacity" })
    await p
    expect(f.el.removed).toBe(true)
  })

  test("not rendered (document host): removed at once", async () => {
    const { hideLaunchLoader } = await import("../src/launch-loader")
    const f = fakeLoader("none")
    await hideLaunchLoader()
    expect(f.el.removed).toBe(true)
    expect(f.classes.has("is-leaving")).toBe(false)
  })
})
