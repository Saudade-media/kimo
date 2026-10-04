/**
 * M7 Export dialog harness (e2e only, not part of the app bundle): board 07 "Export Dialog"
 * (AsO2h) over the exporters' `layout-matrix` fixture, on a memory platform.
 *
 * `?platform=desktop` (default: output folder, writes with the no-overwrite plan) | `web`
 * (zip download). Board 25: `&untitled=1` (never-saved desktop file: no folder), `&renderer=1`
 * (a fake renderer: PNG preview / PNG + PDF export), `&preset=<format>` (Code tab "Open
 * export…"). Driven through `window.__export` (`memory` = failure injection, `nextFolder` = the
 * folder picker's answer, `toasts` = `exportToastOf` of each outcome).
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { parse } from "@kimo/core-schema"
import type { TextMeasurer } from "@kimo/layout"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import fixture from "../../../../packages/exporters/test/fixtures/layout-matrix.kimo?raw"
import {
  ExportDialog,
  type ExportFormat,
  type ExportOutcome,
  type ExportSource,
  exportToastOf,
} from "../../src/export"

const q = new URLSearchParams(location.search)
const web = q.get("platform") === "web"
const untitled = q.get("untitled") === "1"
const withRenderer = q.get("renderer") === "1"
const presetFormat = q.get("preset") as ExportFormat | null
const doc = parse(fixture)
const memory = createMemoryPlatform({
  files: { "/Users/me/loom/site.kimo": "{}", "/Users/me/loom/tokens.css": "/* mine */\n" },
})
const platform = {
  kind: web ? ("browser" as const) : ("desktop" as const),
  // `__export.delay` slows every write (the progress state stays on screen to be measured).
  files: {
    ...memory.files,
    writeTextAtomic: async (...a: Parameters<typeof memory.files.writeTextAtomic>) => {
      await new Promise((r) => setTimeout(r, window.__export.delay))
      return memory.files.writeTextAtomic(...a)
    },
    writeBytesAtomic: async (...a: Parameters<typeof memory.files.writeBytesAtomic>) => {
      await new Promise((r) => setTimeout(r, window.__export.delay))
      return memory.files.writeBytesAtomic(...a)
    },
  },
  dialogs: {
    ...memory.dialogs,
    pickFolder: async () => window.__export.nextFolder,
  },
}

/** A fake renderer: a canvas-drawn PNG of the root's size × scale, a fixed-width measurer. */
const renderer = {
  async exportRaster(_id: string, o?: { scale?: number }) {
    const s = o?.scale ?? 1
    const c = document.createElement("canvas")
    c.width = 900 * s
    c.height = 300 * s
    const g = c.getContext("2d")
    if (g) {
      g.fillStyle = "#E2E8F0"
      g.fillRect(0, 0, c.width, c.height)
      g.fillStyle = "#6366F1"
      g.fillRect(20 * s, 20 * s, 200 * s, 80 * s)
    }
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"))
    return new Uint8Array(await (blob as Blob).arrayBuffer())
  },
  // The exporters' test measurer: glyph 0.5 × size, line 1.25 × size, no wrap.
  textMeasurer: (): TextMeasurer => ({
    measure(t) {
      const size = t.style.fontSize
      const text = t.runs.map((r) => r.text).join("")
      const lines = text.split("\n")
      return {
        w: Math.max(0, ...lines.map((l) => [...l].length * size * 0.5)),
        h: lines.length * size * 1.25,
        lines: lines.length,
        baseline: size * 0.8,
      }
    },
  }),
}
const source: ExportSource = {
  fileName: "Layout matrix",
  document: () => doc,
  selection: () => [],
  ...(withRenderer ? { renderer: () => renderer as never } : {}),
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
      memory: typeof memory
      nextFolder: string | null
      toasts: string[]
      delay: number
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
  memory,
  nextFolder: null,
  toasts: [],
  delay: 0,
}

function App() {
  const [open, setOpen] = useState(true)
  reopen = () => setOpen(true)
  return open ? (
    <ExportDialog
      platform={platform}
      source={source}
      fileRef={untitled ? null : "/Users/me/loom/site.kimo"}
      preset={presetFormat ? { format: presetFormat } : null}
      onClose={() => setOpen(false)}
      onExported={(o) => {
        outcomes.push(o)
        window.__export.toasts.push(exportToastOf(o).text)
      }}
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
