/** Board 19 Settings (builder 4): validation, route, Select mapping, copy, panes bound to settings. */
import { describe, expect, test } from "bun:test"
import { isValidSetting, normalizeSettings, SETTING_KEYS, SETTINGS_DEFAULTS } from "@kimo/platform"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { createElement as h } from "react"
import { renderToString } from "react-dom/server"
import {
  autosaveDescription,
  bindAppearance,
  CHOICES,
  type ChoiceKey,
  displayPath,
  extraFoldersDescription,
  fontCacheLabel,
  formatSize,
  mergeDriverDescription,
  parseChoice,
  parseSettingsHash,
  resolveAppearance,
  SETTINGS_PANES,
  SettingsView,
  selectOptions,
  settingsHash,
  updaterDescription,
} from "../src/settings"

describe("settings validation", () => {
  test("every Select choice is a valid value for its key (and only those parse)", () => {
    for (const [key, list] of Object.entries(CHOICES) as [
      ChoiceKey,
      readonly { value: unknown }[],
    ][]) {
      for (const c of list) {
        expect(isValidSetting(key, c.value)).toBe(true)
        expect(parseChoice(key, String(c.value))).toBe(c.value as never)
      }
    }
    expect(parseChoice("files.autosaveIntervalMs", "abc")).toBeNull()
    expect(parseChoice("files.autosaveIntervalMs", "")).toBeNull()
    expect(parseChoice("files.autosaveIntervalMs", "100")).toBeNull() // < 250 ms
    expect(parseChoice("files.autosaveIntervalMs", "99999999")).toBeNull() // > 1 h
    expect(parseChoice("files.autosaveIntervalMs", "1500.5")).toBeNull() // not an integer
    expect(parseChoice("updates.channel", "nightly")).toBeNull()
    expect(parseChoice("general.appearance", "SYSTEM")).toBeNull()
    expect(parseChoice("files.onExternalChange", "ask")).toBe("ask")
  })

  test("the platform store rejects bad writes with INVALID and keeps the old value", async () => {
    const p = createMemoryPlatform()
    await p.settings.ready
    await expect(p.settings.set("files.autosaveIntervalMs", -1)).rejects.toMatchObject({
      code: "INVALID",
    })
    await expect(p.settings.set("updates.channel", "nightly" as never)).rejects.toMatchObject({
      code: "INVALID",
    })
    await expect(p.settings.set("fonts.extraFolders", [""])).rejects.toMatchObject({
      code: "INVALID",
    })
    expect(p.settings.get("files.autosaveIntervalMs")).toBe(2000)
    await p.settings.set("files.autosaveIntervalMs", 5000)
    expect(p.settings.get("files.autosaveIntervalMs")).toBe(5000)
  })

  test("normalize: unknown keys dropped, invalid values default, defaults as designed", () => {
    const s = normalizeSettings({ "files.autosave": "yes", "x.y": 1, "updates.channel": "beta" })
    expect(s["files.autosave"]).toBe(true)
    expect(s["updates.channel"]).toBe("beta")
    expect(Object.keys(s).sort()).toEqual([...SETTING_KEYS].sort())
    expect(SETTINGS_DEFAULTS["privacy.noThirdPartyFetch"]).toBe(false)
    expect(SETTINGS_DEFAULTS["files.autosaveIntervalMs"]).toBe(2000)
    expect(SETTINGS_DEFAULTS["files.recoverySnapshotMs"]).toBe(30_000)
  })

  test("a stored value outside the choices still shows as an option", () => {
    expect(selectOptions("files.autosaveIntervalMs", 3000).at(-1)).toEqual({
      value: "3000",
      label: "3 seconds",
    })
    expect(selectOptions("files.autosaveIntervalMs", 2000).length).toBe(5)
  })
})

describe("route and copy", () => {
  test("#/settings/<pane>", () => {
    expect(parseSettingsHash("#/settings")).toBe("general")
    expect(parseSettingsHash("#/settings/fonts")).toBe("fonts")
    expect(parseSettingsHash("#/settings/agents-mcp")).toBe("agents-mcp")
    expect(parseSettingsHash("#/settings/nope")).toBe("general")
    expect(parseSettingsHash("#/file/abc")).toBeNull()
    expect(settingsHash("about")).toBe("#/settings/about")
    expect(SETTINGS_PANES.map((p) => p.label)).toEqual([
      "General",
      "Canvas",
      "Files & autosave",
      "Fonts & privacy",
      "Agents & MCP",
      "AI providers",
      "Updates",
      "About & licenses",
    ])
  })

  test("copy helpers match the board", () => {
    expect(autosaveDescription(2000)).toBe(
      "Writes 2 s after you stop editing. Every write is atomic (temp file → rename) and read back.",
    )
    expect(fontCacheLabel(38, 21_000_000)).toBe("38 fonts · 21 MB")
    expect(formatSize(18_400_000)).toBe("18.4 MB")
    expect(formatSize(48_000)).toBe("48 KB")
    expect(displayPath("/Users/me/Documents/Kimo", "/Users/me")).toBe("~/Documents/Kimo")
    expect(extraFoldersDescription("macos", [], null)).toBe(
      "Also scanned: ~/Library/Fonts and /Library/Fonts.",
    )
    expect(mergeDriverDescription(2, 4)).toBe(
      "kimo merge is set up in 2 of 4 watched repositories (.gitattributes + git config).",
    )
    const nine = new Date(2026, 9, 3, 9, 14).getTime()
    expect(
      updaterDescription({ state: "up-to-date", checkedAt: nine }, (ms) => {
        const d = new Date(ms)
        return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
      }),
    ).toBe("Up to date · checked 9:14")
  })

  test("appearance follows the setting (system → prefers-color-scheme)", async () => {
    expect(resolveAppearance("system", true)).toBe("dark")
    expect(resolveAppearance("light", true)).toBe("light")
    const p = createMemoryPlatform()
    await p.settings.ready
    const seen: string[] = []
    const off = bindAppearance(p.settings, (m) => seen.push(m))
    await p.settings.set("general.appearance", "dark")
    await p.settings.set("general.appearance", "light")
    off()
    await p.settings.set("general.appearance", "dark")
    expect(seen.slice(-2)).toEqual(["dark", "light"])
  })
})

describe("SettingsView renders every pane bound to platform.settings", () => {
  const render = async (
    pane: (typeof SETTINGS_PANES)[number]["id"],
    settings: Record<string, unknown> = {},
  ) => {
    const p = createMemoryPlatform({ settings, appVersion: "0.4.2" })
    await p.settings.ready
    return renderToString(
      h(SettingsView, {
        platform: p,
        pane,
        onPaneChange: () => {},
        variant: "dialog",
        onClose: () => {},
      }),
    )
  }
  test("files", async () => {
    const html = await render("files")
    for (const s of [
      "Files &amp; autosave",
      "Autosave interval",
      "2 seconds",
      "Every 30 s",
      "Merge &amp; tell me",
      "Pause autosave during git operations",
      "New files go to",
      "Change…",
      "Git merge driver",
      "Set up…",
      "Default app for .kimo and .kimoz",
      "Kimo ✓",
    ])
      expect(html).toContain(s)
  })
  test("fonts (No third-party fetch on dims Google Fonts)", async () => {
    const html = await render("fonts", { "privacy.noThirdPartyFetch": true })
    expect(html).toContain("No third-party fetch")
    expect(html).toContain("kimo-setting-row--dimmed")
    expect(html).toContain("Embed fonts in .kimoz packages")
  })
  test("general, updates, about", async () => {
    expect(await render("general")).toContain("Trackpad")
    expect(await render("updates")).toContain("Kimo 0.4.2")
    expect(await render("updates")).toContain("Check now")
    const about = await render("about")
    // Board 25 §7 (a) replaced the board 19 About pane (see board25-about-help.test.ts).
    expect(about).toContain("Version 0.4.2 (")
    expect(about).toContain("Open-source licenses")
  })
})
