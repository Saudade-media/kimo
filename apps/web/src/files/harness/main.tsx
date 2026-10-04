/**
 * M4 files harness (e2e only, not part of the app bundle): the board 16/17 hosts over a memory
 * platform, driven from Playwright through `window.__kimoFiles`. Built by
 * `apps/web/e2e/m4-files.e2e.ts` with its own Vite input so it needs no app route.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../fonts.css"
import { type KimoDocument, parse, serialize, type ThreeWayMerge } from "@kimo/core-schema"
import { createEmptyDocument } from "@kimo/editor-state"
import { createMemoryPlatform, type MemoryPlatform } from "@kimo/platform/memory"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  createSessionManager,
  defaultMerge,
  type FileDocumentSession,
} from "../../platform/session"
import {
  BannerHost,
  FailedLoadView,
  FileTopbar,
  LocalFolders,
  MigrationDialog,
  RecentFilesGrid,
  RecentFilesHeader,
  RecentFilesList,
  type RecentView,
  RecoveryDialog,
  ToastHost,
  TrafficLightInset,
  useNow,
  useRecents,
  useSessionState,
  useSessions,
} from "../index"
import "./harness.css"

const ROOT = "/Users/me/Projects/loom"

function doc(name: string, rects: string[]): string {
  const d = createEmptyDocument(name) as KimoDocument & { nodes: Record<string, unknown> }
  rects.forEach((id, i) => {
    d.nodes[id] = { type: "rect", parent: null, order: `a${i}`, name: id, w: 10, h: 10 }
  })
  return serialize(d)
}

const good = doc("Marketing", ["Rect000001", "Rect000002"])
const lines = good.split("\n")
const markers = [
  ...lines.slice(0, 3),
  "<<<<<<< HEAD",
  ...lines.slice(3, 4),
  "=======",
  ...lines.slice(3),
].join("\n")
const old = doc("Checkout", ["Rect000001"])
  .replace('"format": "1.0.0"', '"format": "0.1.0"')
  .replace("kimo-1.0.json", "kimo-0.1.json")
const newer = `{
"$schema": "https://kimo.design/schema/kimo-1.0.json",
"format": "1.0.0",
"features": ["layout/grid","layout/wrap"],
"nodes": {
"Frame00001": {"type":"frame","parent":null,"order":"a0","layout":{"dir":"row","wrap":true}}
}
}
`

/** Node-level merge when core-schema's `mergeDocuments` is not available. */
const nodeMerge: ThreeWayMerge = ({ base, ours, theirs }) => {
  const b = (base.nodes ?? {}) as Record<string, unknown>
  const o = (ours.nodes ?? {}) as Record<string, unknown>
  const t = (theirs.nodes ?? {}) as Record<string, unknown>
  const nodes: Record<string, never> = {}
  const conflicts: Record<string, unknown> = {}
  let changes = 0
  for (const id of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const [sb, so, st] = [b[id], o[id], t[id]].map((x) => JSON.stringify(x))
    let pick: unknown = o[id]
    if (so !== st && so === sb) {
      pick = t[id]
      changes++
    } else if (so !== st && st !== sb) {
      conflicts[`Cf${id.slice(0, 8)}`] = { kind: "node", node: id, applied: "ours" }
    }
    if (pick !== undefined) nodes[id] = pick as never
  }
  const out = { ...ours, nodes } as unknown as KimoDocument & Record<string, unknown>
  if (Object.keys(conflicts).length) {
    out.conflicts = conflicts as never
    out.merge = { ours: "main", theirs: "disk", changes }
  }
  return { doc: out, conflicts: conflicts as never, changes, repairs: [] }
}

function createHarness() {
  const platform: MemoryPlatform = createMemoryPlatform({
    os: "macos",
    files: {
      [`${ROOT}/marketing.kimo`]: good,
      [`${ROOT}/onboarding.kimo`]: doc("Onboarding", ["Rect000001"]),
      [`${ROOT}/checkout.kimo`]: markers,
      [`${ROOT}/legacy.kimo`]: old,
      [`${ROOT}/design-system/components.kimo`]: doc("Components", []),
      "/Users/me/Work/kimo-site/design/home.kimo": doc("Home", []),
      "/Users/me/Desktop/specs/brand-kit.kimo": newer,
    },
    settings: {
      "files.autosaveIntervalMs": 2000,
      "files.recoverySnapshotMs": 30_000,
      "general.appearance": "light",
    },
  })
  const manager = createSessionManager({
    platform,
    merge: defaultMerge() ?? nodeMerge,
    saveRetryMs: 30_000,
  })
  manager.install()
  const repo = (branch: string, changedCount: number) => ({
    branch,
    head: "4f1c2ab",
    operation: null,
    indexLocked: false,
    fileStatus: (changedCount > 0 ? "modified" : "clean") as "modified" | "clean",
    changedCount,
  })
  platform.control.setGit("/Users/me/Work/kimo-site", repo("main", 0), { kind: "status-changed" })
  platform.control.setGit(ROOT, repo("feat/onboarding", 3), { kind: "status-changed" })
  for (const f of ["/Users/me/Work/kimo-site", ROOT, "/Users/me/Desktop/specs"])
    void platform.recents.addFolder(f)
  return { platform, manager }
}

const h = createHarness()
const listeners = new Set<() => void>()
let ui: { view: "editor" | "home"; ref: string | null; recovery: boolean; homeView: RecentView } = {
  view: "home",
  ref: null,
  recovery: false,
  homeView: "list",
}
const setUi = (patch: Partial<typeof ui>) => {
  ui = { ...ui, ...patch }
  for (const l of listeners) l()
}

declare global {
  interface Window {
    __kimoFiles: typeof api
  }
}

const api = {
  platform: h.platform,
  control: h.platform.control,
  manager: h.manager,
  ROOT,
  parse,
  serialize,
  /** Opens a file and shows the editor view. */
  async open(ref: string, options: { readOnly?: boolean } = {}) {
    const s = await h.manager.open(ref, options)
    setUi({ view: "editor", ref: s.ref })
    return s.state()
  },
  session(ref?: string): FileDocumentSession | undefined {
    return h.manager.get(ref ?? ui.ref ?? "")
  },
  state(ref?: string) {
    return api.session(ref)?.state() ?? null
  },
  home(view: RecentView = "list") {
    setUi({ view: "home", homeView: view })
  },
  showRecovery() {
    setUi({ recovery: true })
  },
  /** Inserts a rect as the user in the current session. */
  edit(id: string) {
    const s = api.session()
    const r = s?.store.apply(
      { op: "insert", id, node: { type: "rect", name: id, w: 10, h: 10 } },
      { origin: "user" },
    )
    return r?.ok ?? false
  },
  rename(id: string, name: string) {
    const s = api.session()
    return s?.store.apply({ op: "update", id, set: { name } }, { origin: "user" }).ok ?? false
  },
}
window.__kimoFiles = api

function useUi() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return ui
}

function Editor({ session }: { session: FileDocumentSession }) {
  const { phase } = useSessionState(session)
  return (
    <div className="harness-editor">
      <FileTopbar session={session} page={phase === "ready" ? "Home" : null} />
      <BannerHost session={session} />
      <FailedLoadView session={session} />
      {phase !== "failed-load" && (
        <div className="harness-canvas" data-testid="canvas">
          <div className="harness-artboard" />
          <ToastHost session={session} autoDismissMs={0} />
        </div>
      )}
      <MigrationDialog session={session} />
    </div>
  )
}

function Home({ view }: { view: RecentView }) {
  const { files, folders } = useRecents(h.platform)
  const now = useNow()
  return (
    <div className="harness-home">
      <nav className="harness-sidebar">
        <TrafficLightInset platform={h.platform} leading={4} />
        <LocalFolders folders={folders ?? []} />
      </nav>
      <main className="harness-main">
        <RecentFilesHeader
          folderCount={folders?.length ?? 0}
          view={view}
          onViewChange={(v) => setUi({ homeView: v })}
        />
        {view === "list" ? (
          <RecentFilesList files={files ?? []} now={now} onOpen={(f) => void api.open(f.ref)} />
        ) : (
          <RecentFilesGrid
            files={files ?? []}
            folders={folders ?? []}
            now={now}
            onOpen={(f) => void api.open(f.ref)}
          />
        )}
      </main>
    </div>
  )
}

function App() {
  const state = useUi()
  const sessions = useSessions(h.manager)
  const session = sessions.find((s) => s.ref === state.ref)
  return (
    <>
      {state.view === "editor" && session ? (
        <Editor key={session.ref} session={session} />
      ) : (
        <Home view={state.homeView} />
      )}
      {state.recovery && (
        <RecoveryDialog
          manager={h.manager}
          onOpened={(s) => setUi({ view: "editor", ref: s.ref })}
          onClose={() => setUi({ recovery: false })}
        />
      )}
    </>
  )
}

document.documentElement.dataset.theme = "light"
const container = document.getElementById("root")
if (container)
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
