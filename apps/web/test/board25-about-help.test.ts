/** Board 25 §7 (a) About & licenses and (b) Help menu: version string, links, Help items, licences. */
import { describe, expect, test } from "bun:test"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  aboutLinks,
  archLabel,
  diagnosticsBlock,
  helpItems,
  logsLabel,
  onHelpAction,
  releaseLine,
  releaseNotesUrl,
  reportIssueUrl,
  runHelpAction,
  SettingsView,
  versionInfo,
  versionLine,
  versionString,
  webOsLabel,
} from "../src/settings"
import { filterNotices, NOTICES, noticeCount, noticeText } from "../src/settings/notices"

describe("version string (rule j7zcn)", () => {
  test("Kimo <semver> (<build>) · <os> · <arch>", () => {
    const i = { version: "1.0.0", build: "412", os: "macOS", arch: "arm64" }
    expect(versionLine(i)).toBe("1.0.0 (412) · macOS · arm64")
    expect(versionString(i)).toBe("Kimo 1.0.0 (412) · macOS · arm64")
    expect(versionString({ ...i, os: "Windows (web)", arch: null })).toBe(
      "Kimo 1.0.0 (412) · Windows (web)",
    )
  })
  test("arch and OS names", () => {
    expect(archLabel("aarch64")).toBe("arm64")
    expect(archLabel("x86_64")).toBe("x64")
    expect(archLabel(undefined)).toBeNull()
    expect(webOsLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS")
    expect(webOsLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows")
    expect(webOsLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux")
  })
  test("versionInfo reads the platform (real version, desktop arch)", () => {
    const p = { os: "macos" as const, appVersion: "1.2.3", arch: "aarch64" }
    const i = versionInfo(p)
    expect(i.version).toBe("1.2.3")
    expect(i.os).toBe("macOS")
    expect(i.arch).toBe("arm64")
    expect(i.build.length).toBeGreaterThan(0)
    expect(releaseLine("1.2.3")).toBe("1.2")
  })
})

describe("Help menu (A0qRF, rule oKY0y)", () => {
  test("items, icons, dividers; logs only on desktop", () => {
    const desktop = helpItems({ version: "1.0.0", os: "windows", logs: true })
    expect(desktop.map((i) => [i.label, i.icon, !!i.divider])).toEqual([
      ["Kimo documentation", "book-open", false],
      ["Keyboard shortcuts", "keyboard", false],
      ["What's new in 1.0", "scroll-text", false],
      ["Report an issue…", "bug", true],
      ["Copy diagnostics", "clipboard-copy", false],
      ["Show logs in Explorer", "folder-open", true],
    ])
    expect(helpItems({ version: "1.0.0", os: "web", logs: false }).map((i) => i.id)).toEqual([
      "docs",
      "shortcuts",
      "whats-new",
      "report-issue",
      "copy-diagnostics",
    ])
    expect(logsLabel("macos")).toBe("Show logs in Finder")
  })
  test("diagnostics + issue URL carry the version block and nothing else", () => {
    const block = diagnosticsBlock(
      { version: "1.0.0", build: "412", os: "macOS", arch: "arm64" },
      { host: "desktop", renderer: "CanvasKit · WebGL 2", locale: "en-US" },
    )
    expect(block).toBe(
      "Kimo 1.0.0 (412) · macOS · arm64\nHost: desktop\nRenderer: CanvasKit · WebGL 2\nLocale: en-US",
    )
    const url = new URL(reportIssueUrl(block))
    expect(url.origin + url.pathname).toBe("https://github.com/kimo-design/kimo/issues/new")
    expect(url.searchParams.get("body")).toContain(block)
    expect([...url.searchParams.keys()]).toEqual(["body"])
  })
  test("the bus reaches every subscriber", () => {
    const got: string[] = []
    const off = onHelpAction((a) => got.push(a))
    runHelpAction("shortcuts")
    off()
    runHelpAction("docs")
    expect(got).toEqual(["shortcuts"])
  })
  test("About links (t4H8L)", () => {
    expect(aboutLinks("1.0.0").map((l) => [l.label, l.meta, l.icon])).toEqual([
      ["Documentation", "kimo.dev/docs", "book-open"],
      ["Source code", "github.com/kimo-design/kimo", "git-branch"],
      ["Release notes", "1.0.0", "scroll-text"],
      ["Privacy", "No telemetry · keys stay in your keychain", "shield"],
    ])
    expect(releaseNotesUrl("1.0.0")).toBe("https://github.com/kimo-design/kimo/releases/tag/v1.0.0")
  })
})

describe("licences (rule zxfSv: generated, not sample data)", () => {
  test("the list holds npm packages, crates and the bundled fonts", () => {
    expect(NOTICES.length).toBeGreaterThan(100)
    const by = (name: string) => NOTICES.find((n) => n.name === name)
    expect(by("react")?.source).toBe("npm")
    expect(by("react")?.license).toBe("MIT")
    expect(by("tauri")?.source).toBe("cargo")
    expect(by("Inter (font)")?.license).toBe("OFL-1.1")
    expect(by("JetBrains Mono (font)")?.source).toBe("font")
    // Kimo's own packages are not third-party; dev tools don't ship.
    expect(NOTICES.some((n) => n.name.startsWith("@kimo/"))).toBe(false)
    expect(NOTICES.some((n) => n.name === "typescript" || n.name === "@biomejs/biome")).toBe(false)
    expect(noticeCount(214)).toBe("214 packages")
    expect(noticeCount(1)).toBe("1 package")
  })
  test("filter matches names and licences", () => {
    expect(filterNotices(NOTICES, "react-dom").map((n) => n.name)).toEqual(["react-dom"])
    expect(filterNotices(NOTICES, "OFL").every((n) => n.license.includes("OFL"))).toBe(true)
    expect(filterNotices(NOTICES, "  ")).toBe(NOTICES)
  })
  test("a row's licence text loads lazily", async () => {
    const react = NOTICES.find((n) => n.name === "react")
    expect(react).toBeDefined()
    expect(await noticeText(react as (typeof NOTICES)[number])).toContain("MIT License")
  })
})

describe("About pane render", () => {
  test("About pane: identity, links, real licence count", async () => {
    const p = createMemoryPlatform({ appVersion: "1.0.0" })
    await p.settings.ready
    const html = renderToString(
      h(SettingsView, {
        platform: p,
        pane: "about",
        onPaneChange: () => {},
        variant: "dialog",
        onClose: () => {},
      }),
    )
    for (const s of [
      "Version 1.0.0 (",
      "Open-source, local-first, agent-native design canvas · MIT",
      "Copy version info",
      "Documentation",
      "kimo.dev/docs",
      "Release notes",
      `${NOTICES.length} packages`,
      "Filter packages",
      "Full texts ship with the app as THIRD_PARTY_NOTICES.txt",
      "Open file",
    ])
      expect(html).toContain(s)
  })
})
