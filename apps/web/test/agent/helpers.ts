/** Shared setup for the agent tests: polling, a small page document and an Agent tab controller. */
import type { ProviderRequest, ToolHost } from "@kimo/ai-agent"
import type { KimoDocument } from "@kimo/core-schema"
import { createEmptyDocument, type DocStore, importDocument } from "@kimo/editor-state"
import {
  type AgentPanelControllerExt,
  createAgentPanelController,
  createInWindowTools,
} from "../../src/agent-panel"
import { createTestRuntime, type Script } from "../../src/agent-panel/testing"

export const tick = (ms = 5) => new Promise<void>((r) => setTimeout(r, ms))

export async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout")
    await tick()
  }
}

export const lastUserText = (req: ProviderRequest) => {
  const u = [...req.messages].reverse().find((m) => m.role === "user")
  return u?.role === "user" ? u.content.map((p) => (p.type === "text" ? p.text : "")).join("") : ""
}

export const nameOf = (store: DocStore, id: string) =>
  (store.getNode(id) as { name?: string } | undefined)?.name

/** Pricing page: Hero and Card inside Pricing, Navbar beside it. */
export function pricingDoc(): KimoDocument {
  const d = createEmptyDocument("Pricing page") as KimoDocument & {
    nodes: Record<string, unknown>
  }
  const frame = (id: string, name: string, parent: string | null, order: string, extra = {}) => {
    d.nodes[id] = { type: "frame", parent, order, name, x: 0, y: 0, w: 200, h: 120, ...extra }
  }
  frame("Pricing0001", "Pricing", null, "a0", { w: 640, h: 460 })
  frame("Hero000001", "Hero", "Pricing0001", "a0")
  frame("Card000001", "Card", "Pricing0001", "a1")
  frame("Navbar0001", "Navbar", null, "a1", { x: 900 })
  return d
}

/**
 * An Agent tab controller over a real DocStore, an in-window tool host and a scripted provider.
 * `refuseHistory` makes `kimo_history` answer with a refused undo while it returns true.
 */
export function setupPanel(
  script: Script,
  extra: Partial<Parameters<typeof createTestRuntime>[0]> = {},
  panel: Partial<Parameters<typeof createAgentPanelController>[0]> = {},
  refuseHistory?: () => boolean,
): {
  c: AgentPanelControllerExt
  store: DocStore
  docId: string
  rt: ReturnType<typeof createTestRuntime>
} {
  const store = importDocument(pricingDoc())
  const tools = createInWindowTools({ store, path: "/u/me/Pricing page.kimo" })
  const factory = (spec: Parameters<typeof tools.factory>[0]): ToolHost => {
    const t = tools.factory(spec)
    return {
      ...t,
      tools: () => t.tools(),
      ...(t.stream ? { stream: (c: { id: string; name: string }) => t.stream?.(c) } : {}),
      call: (c, s) =>
        c.name === "kimo_history" && refuseHistory?.()
          ? Promise.resolve({
              result: {
                ok: false,
                errors: [{ code: "INVALID_INPUT", message: "Unknown undo token." }],
              },
            } as never)
          : t.call(c, s),
    }
  }
  const rt = createTestRuntime({ tools: refuseHistory ? factory : tools.factory, script, ...extra })
  const c = createAgentPanelController({
    runtime: rt,
    fileId: "f-pricing",
    fileName: "Pricing page.kimo",
    docId: () => tools.docId(),
    nodeName: (id) => nameOf(store, id),
    parentOf: (id) => (store.getNode(id) as { parent?: string | null } | undefined)?.parent ?? null,
    frameBox: (id) => {
      const n = store.getNode(id) as
        | { name: string; x: number; y: number; w: number; h: number }
        | undefined
      return n ? { id, name: n.name, x: n.x, y: n.y, w: n.w, h: n.h } : null
    },
    ...panel,
  })
  return { c, store, docId: tools.docId(), rt }
}
