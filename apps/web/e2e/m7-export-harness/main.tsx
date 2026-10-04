/**
 * M7 Export dialog harness (e2e only, not part of the app bundle): board 07 "Export Dialog"
 * (AsO2h) over the exporters' `layout-matrix` fixture, on a memory platform.
 *
 * `?platform=desktop` (default: output folder, writes with the no-overwrite plan) | `web`
 * (zip download). Driven through `window.__export`.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { parse } from "@kimo/core-schema"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import fixture from "../../../../packages/exporters/test/fixtures/layout-matrix.kimo?raw"
import { ExportDialog, type ExportOutcome, type ExportSource } from "../../src/export"

const q = new URLSearchParams(location.search)
const web = q.get("platform") === "web"
const doc = parse(fixture)
const memory = createMemoryPlatform({
  files: { "/Users/me/loom/site.kimo": "{}", "/Users/me/loom/tokens.css": "/* mine */\n" },
})
const platform = {
  kind: web ? ("browser" as const) : ("desktop" as const),
  files: memory.files,
  dialogs: memory.dialogs,
}
const source: ExportSource = {
  fileName: "Layout matrix",
  document: () => doc,
  selection: () => [],
}
const outcomes: ExportOutcome[] = []
const copied: string[] = []
const downloads: { name: string; size: number }[] = []

declare global {
  interface Window {
    __export: {
      outcomes: ExportOutcome[]
      copied: string[]
      downloads: { name: string; size: number }[]
      read(ref: string): Promise<string | null>
      open(): void
    }
  }
}

let reopen: () => void = () => {}
window.__export = {
  outcomes,
  copied,
  downloads,
  read: (ref) =>
    memory.files
      .readText(ref)
      .then((r) => r.text)
      .catch(() => null),
  open: () => reopen(),
}

function App() {
  const [open, setOpen] = useState(true)
  reopen = () => setOpen(true)
  return open ? (
    <ExportDialog
      platform={platform}
      source={source}
      fileRef="/Users/me/loom/site.kimo"
      onClose={() => setOpen(false)}
      onExported={(o) => outcomes.push(o)}
      copyText={(t) => {
        copied.push(t)
      }}
      download={(blob, name) => downloads.push({ name, size: blob.size })}
    />
  ) : null
}

const el = document.getElementById("root")
if (el)
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
