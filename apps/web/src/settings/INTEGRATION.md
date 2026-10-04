# Settings (board 19 XmeDB) — integration

Desktop: a separate window (⌘,) showing `#/settings/<pane>`. Web: an in-app dialog. All panes are
bound to `platform.settings` (validated on write, broadcast to every window), no Save button.

## Route (`router.ts` / `App.tsx`)

```ts
// router.ts: add  | { name: "settings"; pane: SettingsPane }
const pane = parseSettingsHash(hash)          // "#/settings" → "general", "#/settings/fonts" → "fonts"
if (pane) return { name: "settings", pane }
```

```tsx
// App.tsx (desktop Settings window, label "settings")
case "settings":
  return <SettingsRoute platform={platform} hash={location.hash}
           onFontCacheCleared={() => fonts?.invalidate()} />
```

## Opening (⌘, / menu)

```tsx
const [settingsPane, setSettingsPane] = useState<SettingsPane | null>(null)
useSettingsShortcut(platform, setSettingsPane)            // ⌘, / Ctrl+,
// menu item: openSettings(platform, "general").then((how) => how === "dialog" && setSettingsPane("general"))
{settingsPane && (
  <SettingsDialog platform={platform} initialPane={settingsPane}
    onClose={() => setSettingsPane(null)} onFontCacheCleared={() => fonts.invalidate()} />
)}
```

`openSettings` resolves `"window"` on desktop (the shell opened/focused the Settings window) and
`"dialog"` on the web.

## Appearance

`bindAppearance(platform.settings, setTheme)` (from `lib/theme`) once at startup; `system`
follows `prefers-color-scheme` live. The Topbar theme toggle should then write
`general.appearance` instead of `lib/theme` directly.

## Optional props

- `licenses={{ count, url }}`: "Kimo and the 214 packages it ships with." (count from the SBOM /
  NOTICE generation); without it the copy omits the number.

## Not designed (marked in code)

- Web: rows that need a native host are hidden (New files go to, Extra font folders, Git merge
  driver, Default app, Download updates, Channel); the version row says "The web app updates
  when you reload."
- Git merge driver with no watched folders: "Add a watched folder on Home to set up kimo merge in
  its repository."
- The web dialog draws the traffic lights from the board (red = close); desktop leaves the frame
  empty for the native lights at {16, 18}.

## Platform issue found

`createSettingsStore` (packages/platform, frozen contract): a `set()` issued before `ready`
resolves is overwritten when the initial load applies the persisted values (the load re-applies
every key that differs). Writes before `ready` are lost. Suggest: track keys written before load
and skip them when applying loaded values.

## M6: AI providers pane

`"ai-providers"` (board 23 g6AqH) sits right after Agents & MCP; `SettingsView` renders
`AiProvidersPane` from `../ai-settings` (see `apps/web/src/ai-settings/INTEGRATION.md`). The
active nav icon is `$agent` for this pane. Desktop Rust `SETTINGS_PANES` must include it.
