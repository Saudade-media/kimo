/**
 * E2E harness for board 19 (builder 4): mounts the fonts / settings / assets-gc / svg-import /
 * updater pieces on the in-memory platform and exposes them as `window.__kimoM4` (the debug
 * hook the m4-fonts e2e scenarios drive). Built on its own by `m4-fonts.e2e.ts`, so the app's
 * integration files (App.tsx, router.ts) are not needed until integration.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import { createDocStore, createEmptyDocument, generateId, type Op } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import { DialogScrim } from "@kimo/ui"
import { type ReactNode, StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { CleanUpAssetsHost, platformAssetFolder } from "../../src/assets-gc"
import {
  createFontSystem,
  FontPicker,
  fontPickerEntries,
  googleState,
  MissingFontsHost,
} from "../../src/fonts"
import { SettingsDialog, SettingsRoute } from "../../src/settings"
import { prepareSvg, rememberSvgChoice, SvgImportPopover, svgImportOps } from "../../src/svg-import"
import { createUpdaterController, UpdateToastHost } from "../../src/updater"

const TTF_URL = new URL(
  "../../../../packages/renderer/assets/fonts/Inter-Regular.ttf",
  import.meta.url,
)
const CSS = (family: string) =>
  `@font-face { font-family: '${family}'; font-style: normal; font-weight: 500; src: url(https://fonts.gstatic.com/s/x/500.ttf) format('truetype'); }`

const platform = createMemoryPlatform({
  appVersion: "0.4.2",
  os: "macos",
  recoveryDir: "/Users/me/.kimo/recovery",
  files: {
    "/Users/me/loom/marketing.kimo": "{}",
    "/Users/me/loom/assets/9f2c41ab03d1e7a2.png": "x".repeat(6200),
    "/Users/me/loom/assets/1b77e0c9a4f25d13.jpg": "x".repeat(4800),
    "/Users/me/loom/assets/c30d8e1f6a9b2240.webp": "x".repeat(3100),
    "/Users/me/loom/assets/77aa10fe2b9c4d58.svg": "x".repeat(48),
    "/Users/me/loom/assets/e000000000000000.png": "x".repeat(2000),
    "/Users/me/loom/assets/f000000000000000.png": "x".repeat(1500),
    "/Users/me/loom/assets/0000000000000000.png": "x".repeat(800),
    "/Users/me/loom/assets/aaaaaaaaaaaaaaaa.png": "used",
  },
})

/** Every remote request the app made (must stay empty while No third-party fetch is on). */
const remote: string[] = []
const realFetch = platform.fonts.fetchRemote.bind(platform.fonts)
;(platform.fonts as { fetchRemote: (url: string) => Promise<Uint8Array> }).fetchRemote = async (
  url,
) => {
  remote.push(url)
  await realFetch(url) // BLOCKED + allowlist exactly as the platform enforces them
  if (url.includes("css2")) {
    const fam = /family=([^:&]+)/.exec(url)?.[1]?.replace(/\+/g, " ") ?? ""
    if (fam === "Space Grotesk" || fam === "DM Sans") return new TextEncoder().encode(CSS(fam))
    throw new Error("400")
  }
  return new Uint8Array(await (await fetch(TTF_URL)).arrayBuffer())
}

const store = createDocStore(createEmptyDocument("marketing"))
const node = (id: string, font: string, weight: number) => ({
  op: "insert" as const,
  id,
  parent: null,
  node: {
    type: "text",
    name: `${font} ${weight}`,
    x: 0,
    y: 0,
    content: "Aa",
    style: { font, weight },
  },
})
const seeded = store.apply(
  [
    {
      op: "setHeader",
      set: {
        assets: {
          "9f2c41ab03d1e7a2.png": { mime: "image/png" },
          "aaaaaaaaaaaaaaaa.png": { mime: "image/png" },
        },
      },
    },
    node("txt0000001", "Söhne", 400),
    node("txt0000002", "Söhne", 600),
    node("txt0000003", "GT America Mono", 400),
    node("txt0000004", "Space Grotesk", 500),
    node("txt0000005", "Inter", 600),
    {
      op: "insert",
      id: "rect000001",
      parent: null,
      node: {
        type: "rect",
        w: 10,
        h: 10,
        fill: [{ kind: "image", src: "./assets/aaaaaaaaaaaaaaaa.png" }],
      },
    },
  ] as Op[],
  { origin: "user" },
)
if (!seeded.ok) throw new Error(`harness seed rejected: ${JSON.stringify(seeded)}`)
const doc = () => store.toDocument() as unknown as Record<string, never>
const apply = (ops: Op[], label: string) => store.apply(ops, { origin: "user", label })

const fonts = createFontSystem({ platform, online: () => true })

let flushResult: { ok: boolean; failed: string[] } = { ok: true, failed: [] }
const flushLog: string[] = []
const updater = createUpdaterController({
  platform,
  checkOnStart: false,
  flushAll: async () => {
    flushLog.push("flushAll")
    return flushResult
  },
})

type View =
  | { kind: "none" }
  | { kind: "settings"; pane?: "general" | "files" | "fonts" | "updates" | "about" }
  | { kind: "settings-window"; pane: string }
  | { kind: "missing" }
  | { kind: "picker" }
  | { kind: "gc" }
  | { kind: "svg"; text: string; name: string }

let setView: (v: View) => void = () => {}
let pickerEntries: Awaited<ReturnType<typeof fontPickerEntries>> = []
const picked: string[] = []
let lastGc = -1
const svgState: { description?: string; error?: string; imported?: number } = {}

function SvgView({ text, name }: { text: string; name: string }) {
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareSvg>> | null>(null)
  useEffect(() => {
    void prepareSvg(text, name).then(
      (p) => {
        svgState.description = p.vectorDescription
        setPrepared(p)
      },
      (e: unknown) => {
        svgState.error = e instanceof Error ? e.message : String(e)
      },
    )
  }, [text, name])
  if (!prepared) return null
  return (
    <div className="harness-anchor">
      <SvgImportPopover
        fileName={name}
        vectorDescription={prepared.vectorDescription}
        imageDescription={prepared.imageDescription}
        strokedPaths={prepared.stats.stroked ?? 0}
        onCancel={() => setView({ kind: "none" })}
        onImport={async (choice) => {
          rememberSvgChoice(choice)
          const r = await svgImportOps(prepared, choice, {
            newId: generateId,
            colorVariables: {},
            putAsset: async () => {},
            manifest: null,
          })
          apply(r.ops, `Import ${name}`)
          svgState.imported = r.ops.length
          setView({ kind: "none" })
        }}
      />
    </div>
  )
}

function Harness() {
  const [view, set] = useState<View>({ kind: "none" })
  setView = set
  let content: ReactNode = null
  switch (view.kind) {
    case "settings":
      content = (
        <SettingsDialog
          platform={platform}
          initialPane={view.pane ?? "files"}
          onClose={() => set({ kind: "none" })}
          onFontCacheCleared={() => fonts.invalidate()}
        />
      )
      break
    case "settings-window":
      content = <SettingsRoute platform={platform} hash={`#/settings/${view.pane}`} />
      break
    case "missing":
      content = (
        <MissingFontsHost
          platform={platform}
          system={fonts}
          fileKey="/Users/me/loom/marketing.kimo"
          fileName="marketing.kimo"
          doc={doc}
          apply={apply}
        />
      )
      break
    case "picker":
      content = (
        <div className="harness-anchor">
          <FontPicker
            value="Inter"
            entries={pickerEntries}
            google={googleState(platform, fonts)}
            onPick={(f) => picked.push(f)}
            onClose={() => set({ kind: "none" })}
          />
        </div>
      )
      break
    case "gc":
      content = (
        <CleanUpAssetsHost
          folder={platformAssetFolder(platform, "/Users/me/loom/marketing.kimo")}
          fileName="marketing.kimo"
          doc={doc}
          apply={apply}
          onDone={(n) => {
            lastGc = n
            set({ kind: "none" })
          }}
        />
      )
      break
    case "svg":
      content = (
        <DialogScrim className="harness-clear">
          <SvgView text={view.text} name={view.name} />
        </DialogScrim>
      )
      break
  }
  return (
    <>
      {content}
      <UpdateToastHost controller={updater} />
    </>
  )
}

const w = window as unknown as Record<string, unknown>
w.__kimoM4 = {
  platform,
  store,
  doc,
  remote,
  picked,
  svgState,
  flushLog,
  gcResult: () => lastGc,
  setFlush: (r: { ok: boolean; failed: string[] }) => {
    flushResult = r
  },
  updater,
  fonts,
  async show(v: View) {
    if (v.kind === "picker") pickerEntries = await fontPickerEntries(platform, fonts, doc())
    setView(v)
  },
  /** Learns that Space Grotesk is a Google family (CSS), as a first online open would. */
  async learnGoogle(family: string) {
    return fonts.availability({ family, weight: 500, style: "normal" })
  },
  undo: () => store.undo("user"),
}

const style = document.createElement("style")
style.textContent = `.harness-anchor{position:fixed;left:40px;top:40px}.harness-clear{background:transparent}`
document.head.append(style)

const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
