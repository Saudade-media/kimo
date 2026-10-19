/**
 * Board 41 join harness (e2e only, not part of the app bundle): the real `App` over a memory
 * platform and the real multiplayer view model with a fake relay, so the join route, the joined
 * editor and View only run in a plain browser. Driven through `window.__b41`:
 *
 * - `link({role, exp})` mints a join link (real token, random key);
 * - `behave({probe, join, role, delay})` picks what the fake relay does next;
 * - `?scene=card&state=...` renders one join card on its own (static measured scenes);
 * - `?theme=dark` switches the theme.
 */
import "@kimo/design-tokens/editor.css"
import "@kimo/ui/styles.css"
import "../../src/fonts.css"
import "../../src/app.css"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, importDocument } from "@kimo/editor-state"
import { createMemoryPlatform } from "@kimo/platform/memory"
import {
  deriveRoomId,
  exportPublicKey,
  formatJoinLink,
  generateRoomKey,
  generateSigningKeyPair,
  MultiplayerError,
  mintToken,
  type RelayInfo,
  randomBytes,
} from "@kimo/sync/mp"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "../../src/App"
import { errorCard } from "../../src/join/copy"
import { JoinErrorCardView, JoinProgressCard, JoinStage } from "../../src/join/JoinCard"
import { createAssetStore } from "../../src/lib/assets"
import { initTheme, setTheme } from "../../src/lib/theme"
import {
  emptySnapshot,
  roomKeyOf,
  type ShareBackend,
  type ShareSnapshot,
} from "../../src/multiplayer/backend"
import {
  createMultiplayerModel,
  type JoinErrorKind,
  type JoinState,
} from "../../src/multiplayer/model"
import type { SharedSession } from "../../src/multiplayer/share"
import { createAppSessionManager, RuntimeContext } from "../../src/platform/runtime"

const query = new URLSearchParams(location.search)
initTheme()
setTheme(query.get("theme") === "dark" ? "dark" : "light")

const container = document.getElementById("root") as HTMLElement

// --- Static card scenes ----------------------------------------------------------------------------

const baseState: JoinState = {
  phase: "decrypting",
  steps: { reachedRelay: true, linkValid: true, decrypted: false },
  showCard: true,
  relayHost: "relay.maya.studio",
  role: "edit",
  expiresAt: Date.now() + 6 * 86_400_000 + 3_600_000,
  progress: 0.41,
  room: null,
  key: null,
  session: null,
  error: null,
}

const errors: Record<string, { kind: JoinErrorKind; message: string; patch?: Partial<JoinState> }> =
  {
    expired: {
      kind: "expired",
      message: "expired",
      patch: { expiresAt: new Date(2026, 9, 12).getTime() },
    },
    revoked: { kind: "revoked", message: "revoked" },
    unreachable: { kind: "unreachable", message: "ECONNREFUSED · 5 s" },
    "not-a-relay": { kind: "not-a-relay", message: "404" },
    "decrypt-failed": { kind: "decrypt-failed", message: "AEAD tag mismatch" },
  }

function Card() {
  const name = query.get("state") ?? "progress"
  if (name === "progress" || name === "indeterminate")
    return (
      <JoinStage>
        <JoinProgressCard
          state={{ ...baseState, progress: name === "indeterminate" ? null : 0.41 }}
          now={Date.now()}
        />
      </JoinStage>
    )
  const e = errors[name] as (typeof errors)[string]
  const state: JoinState = {
    ...baseState,
    phase: "error",
    ...(e.patch ?? {}),
    error: { kind: e.kind, code: "CODE", message: e.message },
  }
  return (
    <JoinStage>
      <JoinErrorCardView card={errorCard(state)} onAction={() => {}} />
    </JoinStage>
  )
}

// --- The app over a fake relay ---------------------------------------------------------------------

const relayInfo: RelayInfo = {
  relayUrl: "https://relay.maya.studio",
  name: "kimo-relay",
  version: "1.2.0",
  protocol: "kimo-mp/1",
  limits: {} as RelayInfo["limits"],
  createSecretRequired: false,
}

type Behavior = {
  probe: "ok" | "unreachable" | "not-a-relay"
  join: "ok" | "revoked" | "decrypt-failed" | "hang"
  role: "edit" | "view"
  /** ms the fake join waits before answering. */
  delay: number
}
const behavior: Behavior = { probe: "ok", join: "ok", role: "edit", delay: 0 }

const snapshots = new Map<string, ShareSnapshot>()
const listeners = new Map<string, Set<() => void>>()
const backend: ShareBackend = {
  snapshot: (key) => snapshots.get(key) ?? emptySnapshot(key),
  subscribe(key, l) {
    const set = listeners.get(key) ?? new Set()
    set.add(l)
    listeners.set(key, set)
    return () => set.delete(l)
  },
  async start() {},
  async stop() {
    return { relayNotified: true }
  },
  links: async () => [],
  async mintLink() {
    throw new Error("not in this harness")
  },
  async revokeLink() {},
  async resetAllLinks() {
    return { kid: 2 }
  },
  setPresence() {},
  ensureAsset: async () => true,
  resumeAgent() {},
  stopAgent() {},
}

function sampleDocument(): KimoDocument {
  const d = createEmptyDocument("Marketing site") as KimoDocument & {
    nodes: Record<string, unknown>
  }
  ;(d as { meta?: Record<string, unknown> }).meta = { name: "Marketing site" }
  d.nodes.Hero000001 = {
    type: "frame",
    parent: null,
    order: "a0",
    name: "Hero",
    x: 0,
    y: 0,
    w: 720,
    h: 360,
    fill: "#FFF7EE",
  }
  d.nodes.Headline01 = {
    type: "text",
    parent: "Hero000001",
    order: "a0",
    name: "Headline",
    x: 36,
    y: 64,
    w: 272,
    grow: "fixed-width",
    content: "Plan less. Ship more together.",
    style: { font: "Inter", weight: 600, size: 28 },
  }
  return d
}

function fakeSession(room: string, role: "edit" | "view"): SharedSession {
  const store = importDocument(sampleDocument())
  if (role === "view") store.setReadOnly("view-only link")
  return {
    room,
    role,
    store,
    provider: { role, connected: true },
    assets: createAssetStore(`b41-${room}`),
    onEvent: () => () => {},
    leave: async () => {},
  } as unknown as SharedSession
}

const minted = new Map<string, string>()

const model = createMultiplayerModel({
  backend,
  probe: async () => {
    if (behavior.probe === "unreachable")
      throw new MultiplayerError("RELAY_UNREACHABLE", "ECONNREFUSED · 5 s")
    if (behavior.probe === "not-a-relay") throw new MultiplayerError("NOT_A_RELAY", "404")
    return relayInfo
  },
  join: async (text) => {
    if (behavior.delay) await new Promise((r) => setTimeout(r, behavior.delay))
    if (behavior.join === "hang") return new Promise<SharedSession>(() => {})
    if (behavior.join === "revoked") throw new MultiplayerError("TOKEN_REVOKED", "revoked")
    if (behavior.join === "decrypt-failed")
      throw new MultiplayerError("DECRYPT_FAILED", "AEAD tag mismatch")
    const session = fakeSession(minted.get(text.trim()) ?? "room", behavior.role)
    const key = roomKeyOf(session.room)
    snapshots.set(key, {
      ...emptySnapshot(key),
      room: session.room,
      relayUrl: "https://relay.maya.studio",
      owner: false,
      role: behavior.role,
      status: "synced",
    })
    for (const l of listeners.get(key) ?? []) l()
    return session
  },
})

async function link(options: { role?: "view" | "edit"; exp?: number } = {}): Promise<string> {
  const root = await generateSigningKeyPair(true)
  const room = await deriveRoomId(await exportPublicKey(root.publicKey))
  const keys = await generateSigningKeyPair(true)
  const token = await mintToken(keys.privateKey, {
    room,
    role: options.role ?? "edit",
    kid: 1,
    iat: Math.floor(Date.now() / 1000) - 60,
    exp: options.exp ?? 0,
    jti: randomBytes(16),
    origin: "user",
  })
  const text = formatJoinLink({
    webOrigin: "https://kimo.test",
    relayUrl: "https://relay.maya.studio",
    room: room.id,
    token,
    roomKey: generateRoomKey(),
  })
  minted.set(text, room.id)
  return text
}

const platform = createMemoryPlatform({ os: "macos", settings: { "general.appearance": "light" } })
const manager = createAppSessionManager(platform)
Object.assign(window, {
  __b41: {
    model,
    link,
    behave: (patch: Partial<Behavior>) => Object.assign(behavior, patch),
  },
})

void platform.settings.ready.then(() => {
  createRoot(container).render(
    <StrictMode>
      {query.get("scene") === "card" ? (
        <Card />
      ) : (
        <RuntimeContext.Provider value={{ platform, manager, multiplayer: model }}>
          <App />
        </RuntimeContext.Provider>
      )}
    </StrictMode>,
  )
})
