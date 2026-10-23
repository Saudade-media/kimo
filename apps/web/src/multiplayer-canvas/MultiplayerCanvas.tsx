/**
 * Board 41 on the editor canvas (desing.pen kCAYr, sections 1, 6, 7, 8): the editor mounts
 * {@link useEditorMultiplayer} once and renders its `canvasLayer` over the canvas (next to the
 * board 36 agent layers) and its `banner` under the topbar.
 *
 * - Publishes your pointer, selection, page and viewport ({@link usePublishPresence}, at most
 *   every 50 ms) while the file is shared.
 * - Presence: cursors, remote selections, idle and off-screen people, following.
 * - Agent claims: one outline and one tab per agent; `claimedOrigins` turn off board 36's section
 *   outline of those agents, `hiddenOrigins` hide the cursor of paused agents.
 * - Assets: placeholders while images fetch, are not available yet, or upload.
 * - Fonts shared by name only and not installed here: Banner/Warning with Fonts.
 * - `areaBusy`: what the agent thread's AREA_BUSY card reads.
 */
import { type ClaimView, claimsFor, type DocStore, type Origin } from "@kimo/editor-state"
import type { LayoutResult } from "@kimo/layout"
import type { TextGeometry } from "@kimo/renderer"
import { Banner } from "@kimo/ui"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { AreaBusyEnv } from "../agent-panel/AreaBusyCard"
import type { CanvasAgentPersona, UiStore } from "../canvas/contract"
import { currentTextSession, subscribeTextSession } from "../canvas/rich-text/session"
import type { FileSession } from "../editor/session"
import type { FontSystem } from "../fonts/font-system"
import type { AssetStore } from "../lib/assets"
import type { Bus } from "../lib/hooks"
import { type AgentPauseView, pausesFor } from "../multiplayer/agent-pause"
import { areaWaitsFor } from "../multiplayer/area-busy"
import { EMPTY_TRANSFERS } from "../multiplayer/backend"
import { claimOutlines, createThrottle } from "../multiplayer/canvas-model"
import { useMultiplayer } from "../multiplayer/hooks"
import type {
  DocumentShareModel,
  DocumentShareView,
  MultiplayerSettingsModel,
} from "../multiplayer/model"
import {
  type AgentTextCaret,
  type AgentTextCarets,
  createAgentTextCarets,
} from "../multiplayer/text-caret-view"
import { localTextPresence } from "../multiplayer/text-carets"
import { EditorCloudBanner } from "../multiplayer/ui/CloudPlanBanner"
import { AssetLayer } from "./AssetLayer"
import { ClaimLayer } from "./ClaimLayer"
import { PresenceLayer } from "./PresenceLayer"
import { TextCaretLayer } from "./TextCaretLayer"
import "./multiplayer-canvas.css"

const NONE: ReadonlySet<string> = new Set()
const noSub = () => () => {}

/** A member of the document view, or `fallback` without a model. */
function useDocMember<T>(
  doc: DocumentShareModel | null,
  select: (v: DocumentShareView) => T,
  fallback: T,
): T {
  const subscribe = useCallback((l: () => void) => (doc ? doc.subscribe(l) : () => {}), [doc])
  const get = useCallback(() => (doc ? select(doc.getState()) : fallback), [doc, select, fallback])
  return useSyncExternalStore(subscribe, get, get)
}

const selShare = (v: DocumentShareView) => v.share
const selClaims = (v: DocumentShareView) => v.claims
const selPaused = (v: DocumentShareView) => v.paused
const selAgents = (v: DocumentShareView) => v.agents
const selPeople = (v: DocumentShareView) => v.people
const selAssets = (v: DocumentShareView) => v.assets
const selFonts = (v: DocumentShareView) => v.fontsNameOnly
const NO_CLAIMS: readonly ClaimView[] = []
const NO_PAUSES: readonly AgentPauseView[] = []
const NO_LIST: readonly never[] = []

export interface EditorMultiplayerOptions {
  session: FileSession
  /** The share key: a file's ref, `roomKeyOf(room)` for a joined room; null: not shareable. */
  shareKey: string | null
  layout: Bus<LayoutResult | null>
  /** The editor's asset store (which image keys are local). */
  assets: AssetStore
  /** The canvas element (pointer moves are published from it). */
  container: { current: HTMLElement | null }
  /** Local agents' persona hues (the agent panel's). */
  personaOf?(origin: string): CanvasAgentPersona | undefined
  fonts: FontSystem
  /** Banner › Fonts: the fonts list (FontRow/Missing). */
  onOpenFonts?(): void
  /** The renderer's layout of a text layer (live text carets on layers you are not editing). */
  textGeometry?(node: string): TextGeometry | null
}

export interface EditorMultiplayer {
  canvasLayer: ReactNode
  banner: ReactNode
  /** Agents with a claim outline (board 36's section outline gives way to it). */
  claimedOrigins: ReadonlySet<string>
  /** Paused agents (their cursor is hidden). */
  hiddenOrigins: ReadonlySet<string>
  /** Families shared by name only (for the fonts list's "Name only" source). */
  nameOnlyFonts: readonly string[]
  areaBusy: AreaBusyEnv
  /** Resume now / Stop of a paused agent. */
  resume(holder: string): void
  stop(holder: string): void
}

export function useEditorMultiplayer(o: EditorMultiplayerOptions): EditorMultiplayer {
  const { session, shareKey, layout } = o
  const model = useMultiplayer()
  const doc = model && shareKey ? model.document(shareKey) : null
  const share = useDocMember(doc, selShare, null)
  const shared = !!share?.room
  const settingsModel = model?.settings ?? FALLBACK_SETTINGS_MODEL
  const settings = useSyncExternalStore(
    useCallback((l: () => void) => settingsModel.subscribe(l), [settingsModel]),
    () => settingsModel.getState(),
  )

  // Claims and pauses: the backend's (desktop windows read the host's), else this store's.
  const registry = claimsFor(session.store)
  const localClaims = useSyncExternalStore(
    useCallback((l: () => void) => registry.subscribe(l), [registry]),
    () => registry.list(),
  )
  const pauses = pausesFor(registry)
  const localPaused = useSyncExternalStore(
    useCallback((l: () => void) => pauses.subscribe(l), [pauses]),
    () => pauses.list(),
  )
  const modelClaims = useDocMember(doc, selClaims, NO_CLAIMS)
  const modelPaused = useDocMember(doc, selPaused, NO_PAUSES)
  const claims = modelClaims.length ? modelClaims : localClaims
  const paused = modelPaused.length ? modelPaused : localPaused
  const agents = useDocMember(doc, selAgents, NO_LIST)
  const people = useDocMember(doc, selPeople, NO_LIST)
  const transfers = useDocMember(doc, selAssets, EMPTY_TRANSFERS)
  const nameOnly = useDocMember(doc, selFonts, NO_LIST as readonly string[])

  // The AREA_BUSY card reads the claims the canvas shows.
  const waits = areaWaitsFor(session.store)
  useEffect(() => {
    waits.setClaims(modelClaims.length ? modelClaims : null)
  }, [waits, modelClaims])

  const lay = useSyncExternalStore(layout.subscribe, layout.get)
  const personaOf = o.personaOf
  const outlines = useMemo(
    () =>
      claimOutlines(claims, {
        box: (id) => {
          const l = lay?.nodes.get(id)
          return l?.visible ? l.world : null
        },
        name: (id) => {
          const n = session.store.getNode(id) as { name?: unknown } | undefined
          return typeof n?.name === "string" && n.name ? n.name : undefined
        },
        parentOf: (id) => {
          const n = session.store.getNode(id) as { parent?: unknown } | undefined
          return typeof n?.parent === "string" && n.parent ? n.parent : null
        },
        agents,
        people,
        paused,
        ...(personaOf ? { persona: personaOf } : {}),
      }),
    [claims, lay, session.store, agents, people, paused, personaOf],
  )
  const claimedOrigins = useStableSet(outlines.map((x) => x.holder))

  // Live text (section 11 D): an agent's caret after its writes, inside its claim; its pointer
  // hides while the caret shows (one cursor per agent).
  const attribution = useRef({ claims, people, store: session.store })
  attribution.current = { claims, people, store: session.store }
  const agentCarets = useAgentTextCarets(session.store, attribution)
  const typingAgents = useStableSet(agentCarets.map((c) => c.holder))
  const hiddenOrigins = useStableSet([
    ...paused.map((p) => p.holder),
    ...agentCarets
      .filter((c) => outlines.some((o) => o.holder === c.holder && o.local))
      .map((c) => c.holder),
  ])

  const resume = useCallback(
    (holder: string) => {
      if (doc && modelPaused.some((p) => p.holder === holder)) doc.resumeAgent(holder)
      else pauses.resumeNow(holder)
    },
    [doc, modelPaused, pauses],
  )
  const stop = useCallback(
    (holder: string) => {
      if (doc && modelPaused.some((p) => p.holder === holder)) doc.stopAgent(holder)
      else pauses.stop(holder)
    },
    [doc, modelPaused, pauses],
  )

  usePublishPresence(shared ? doc : null, session.ui, o.container, session.store)

  // Local image keys (asset placeholders), only while shared.
  const localKeys = useLocalKeys(shared ? o.assets : null)
  const ensure = useCallback((key: string) => void doc?.ensureAsset(key).catch(() => false), [doc])

  const canvasLayer = (
    <>
      {shared && (
        <AssetLayer
          store={session.store}
          ui={session.ui}
          layout={layout}
          transfers={transfers}
          localKeys={localKeys}
          fetchAssets={settings.fetchAssets}
          ensure={ensure}
        />
      )}
      <ClaimLayer
        outlines={outlines}
        ui={session.ui}
        onResume={resume}
        onStop={stop}
        hideCursors={typingAgents}
      />
      <TextCaretLayer
        doc={shared ? doc : null}
        store={session.store}
        ui={session.ui}
        layout={layout}
        geometry={o.textGeometry ?? noGeometry}
        agentCarets={agentCarets}
        outlines={outlines}
      />
      {shared && doc && (
        <PresenceLayer
          doc={doc}
          ui={session.ui}
          layout={layout}
          showCursors={settings.showCursors}
        />
      )}
    </>
  )

  const areaBusy = useMemo<AreaBusyEnv>(
    () => ({
      waits,
      nodeName: (id) => {
        const n = session.store.getNode(id) as { name?: unknown } | undefined
        return typeof n?.name === "string" && n.name ? n.name : undefined
      },
      ownerOf: (holder) => {
        const a = agents.find((x) => x.holder === holder)
        return a && !a.isYours ? a.ownerLabel : null
      },
      workingOn: (origin, busy) => {
        const set = new Set(busy)
        const mine = claims
          .filter((c) => c.holder === origin && !c.ids.some((id) => set.has(id)))
          .sort((a, b) => b.since - a.since)[0]
        const id = mine?.ids[0]
        const n = id ? (session.store.getNode(id) as { name?: unknown } | undefined) : undefined
        return typeof n?.name === "string" && n.name ? n.name : undefined
      },
    }),
    [waits, session.store, agents, claims],
  )

  const banner = (
    <>
      {/* Board 43 6 B and C: the owner's Kimo Cloud plan, before the fonts banner. */}
      {model && shareKey && shared && <EditorCloudBanner model={model} docKey={shareKey} />}
      <NameOnlyFontBanner
        families={shared ? nameOnly : NO_LIST}
        fonts={o.fonts}
        doc={() => session.store.toDocument()}
        {...(o.onOpenFonts ? { onOpen: o.onOpenFonts } : {})}
      />
    </>
  )

  return {
    canvasLayer,
    banner,
    claimedOrigins,
    hiddenOrigins,
    nameOnlyFonts: shared ? nameOnly : NO_LIST,
    areaBusy,
    resume,
    stop,
  }
}

const noGeometry = () => null
const NO_AGENT_CARETS: readonly AgentTextCaret[] = []

/** True when `node` is `id` or inside it. */
function within(store: DocStore, node: string, id: string): boolean {
  let at: string | null = node
  for (let depth = 0; at && depth < 256; depth++) {
    if (at === id) return true
    const n = store.getNode(at) as { parent?: unknown } | undefined
    at = typeof n?.parent === "string" && n.parent ? n.parent : null
  }
  return false
}

/**
 * Which agent wrote a text change, for its caret (section 11 D): a local agent's own origin (or
 * one relayed by the desktop host, `remote:agent:…`), else a change from the room into a text
 * inside another client's agent claim that no person is typing in live. Only inside the agent's
 * claim.
 */
export function agentOfTextChange(
  origin: Origin,
  node: string,
  o: {
    claims: readonly ClaimView[]
    people: readonly { isYou: boolean; text?: { node: string } | null }[]
    store: DocStore
  },
): string | null {
  const bare = origin.startsWith("remote:") ? origin.slice(7) : origin
  const claimsNode = (c: ClaimView) => c.ids.some((id) => within(o.store, node, id))
  if (bare.startsWith("agent:") || bare.startsWith("mcp:"))
    return o.claims.some((c) => c.holder === bare && claimsNode(c)) ? bare : null
  if (origin !== "remote" && !origin.startsWith("remote:")) return null
  if (o.people.some((p) => !p.isYou && p.text?.node === node)) return null
  const c = [...o.claims].sort((a, b) => b.since - a.since).find((x) => !x.local && claimsNode(x))
  return c?.holder ?? null
}

/** Agents' carets after their writes (see `createAgentTextCarets`). */
function useAgentTextCarets(
  store: DocStore,
  attribution: {
    current: Parameters<typeof agentOfTextChange>[2]
  },
): readonly AgentTextCaret[] {
  const [tracker, setTracker] = useState<AgentTextCarets | null>(null)
  useEffect(() => {
    const t = createAgentTextCarets(store, (origin, node) =>
      agentOfTextChange(origin, node, attribution.current),
    )
    setTracker(t)
    return () => t.dispose()
  }, [store, attribution])
  return useSyncExternalStore(
    useCallback((l: () => void) => (tracker ? tracker.subscribe(l) : () => {}), [tracker]),
    () => tracker?.list() ?? NO_AGENT_CARETS,
  )
}

/** The same Set while its members do not change. */
function useStableSet(items: readonly string[]): ReadonlySet<string> {
  const ref = useRef<{ key: string; set: ReadonlySet<string> }>({ key: "", set: NONE })
  const key = [...items].sort().join("\n")
  if (ref.current.key !== key) ref.current = { key, set: items.length ? new Set(items) : NONE }
  return ref.current.set
}

/** Keys of the images held locally (refreshed when the store changes). */
function useLocalKeys(assets: AssetStore | null): ReadonlySet<string> {
  const [keys, setKeys] = useState<ReadonlySet<string>>(NONE)
  useEffect(() => {
    if (!assets) return
    let live = true
    const load = () =>
      void assets
        .keys()
        .then((k) => {
          if (live) setKeys(new Set(k))
        })
        .catch(() => {})
    load()
    const off = assets.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [assets])
  return keys
}

/**
 * Publishes your pointer (world), selection, page and viewport (world rectangle + zoom) at most
 * every 50 ms, the last value always. Off while the file is not shared (`doc` null). With a
 * `store`, also your caret and selection inside the text layer you edit live (`text`, positions
 * that follow edits; see `multiplayer/text-carets.ts`).
 */
export function usePublishPresence(
  doc: DocumentShareModel | null,
  ui: UiStore,
  container: { current: HTMLElement | null },
  store?: DocStore,
) {
  useEffect(() => {
    if (!doc) return
    const el = container.current
    let cursor: { x: number; y: number } | null = null
    const fields = () => {
      const s = ui.getState()
      const v = s.viewport
      const w = el?.clientWidth ?? 0
      const h = el?.clientHeight ?? 0
      return {
        ...(cursor ? { cursor } : {}),
        selection: [...s.selection],
        ...(s.page ? { page: s.page } : {}),
        viewport: { x: v.x, y: v.y, w: w / v.zoom, h: h / v.zoom, zoom: v.zoom },
      }
    }
    // The text caret is read when the frame goes out (encoding it writes pending typing).
    const withText = (f: ReturnType<typeof fields>) => {
      const text = store ? localTextPresence(currentTextSession(ui), store) : null
      return text ? { ...f, text } : f
    }
    const throttle = createThrottle((f: ReturnType<typeof fields>) =>
      doc.setLocalPresence(withText(f)),
    )
    const push = () => throttle.push(fields())
    const onMove = (e: PointerEvent) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      const v = ui.getState().viewport
      cursor = { x: v.x + (e.clientX - r.left) / v.zoom, y: v.y + (e.clientY - r.top) / v.zoom }
      push()
    }
    const onLeave = () => {
      cursor = null
      push()
    }
    el?.addEventListener("pointermove", onMove)
    el?.addEventListener("pointerleave", onLeave)
    const off = ui.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.page !== prev.page || s.viewport !== prev.viewport)
        push()
    })
    // The live text edit: its caret, selection and text changes (and its start and end).
    let offSession: (() => void) | null = null
    const watchSession = () => {
      offSession?.()
      offSession = currentTextSession(ui)?.subscribe(push) ?? null
      push()
    }
    const offBus = store ? subscribeTextSession(ui, watchSession) : () => {}
    if (store) watchSession()
    push()
    return () => {
      el?.removeEventListener("pointermove", onMove)
      el?.removeEventListener("pointerleave", onLeave)
      off()
      offBus()
      offSession?.()
      throttle.cancel()
    }
  }, [doc, ui, container, store])
}

/**
 * Board 41 › 8 D (`A97iv` Banner/Warning): a font the file uses that its owner could only share
 * by name (not open-licensed) and that is not installed here. Title "<family> is not installed",
 * body "It is not open-licensed, so Kimo shares its name only. Showing Inter until you install
 * it.", action Fonts (Button/Primary, no icon).
 */
function NameOnlyFontBanner({
  families,
  fonts,
  doc,
  onOpen,
}: {
  families: readonly string[]
  fonts: FontSystem
  doc: () => ReturnType<FileSession["store"]["toDocument"]>
  onOpen?: () => void
}) {
  const [missing, setMissing] = useState<string[]>([])
  // Fonts that resolve differently now (installed, fetched): ask again.
  const [version, bump] = useState(0)
  useEffect(() => fonts.subscribe(() => bump((n) => n + 1)), [fonts])
  const docRef = useRef(doc)
  docRef.current = doc
  const key = families.join("\n")
  useEffect(() => {
    void version
    if (!key) {
      setMissing([])
      return
    }
    let live = true
    const wanted = new Set(key.split("\n").map((f) => f.toLowerCase()))
    void fonts
      .missingFonts(docRef.current() as never)
      .then((list) => {
        if (!live) return
        setMissing(
          list
            .filter((m) => m.status === "missing" && wanted.has(m.family.toLowerCase()))
            .map((m) => m.family),
        )
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [key, fonts, version])
  if (!missing.length) return null
  const first = missing[0] as string
  const more = missing.length - 1
  return (
    <Banner
      tone="warning"
      data-testid="mp-font-name-only"
      data-pen="A97iv"
      title={more ? `${first} and ${more} more are not installed` : `${first} is not installed`}
      body={
        more
          ? "They are not open-licensed, so Kimo shares their names only. Showing Inter until you install them."
          : "It is not open-licensed, so Kimo shares its name only. Showing Inter until you install it."
      }
      actions={onOpen ? [{ id: "fonts", label: "Fonts", variant: "primary" }] : []}
      onAction={() => onOpen?.()}
    />
  )
}

/** Settings without a model (harnesses, the browser library): defaults. */
const FALLBACK_SETTINGS_MODEL: MultiplayerSettingsModel = {
  subscribe: noSub,
  getState: (() => {
    const s = { displayName: "", relayUrl: null, showCursors: true, fetchAssets: true }
    // Stable: `useSyncExternalStore` compares snapshots by identity.
    return () => s
  })(),
  setDisplayName: async () => {},
  setRelayUrl: async () => null,
  setShowCursors: async () => {},
  setFetchAssets: async () => {},
}
