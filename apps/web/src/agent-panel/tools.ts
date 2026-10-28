/**
 * The in-window tool host (ADR 0014 §5): the built-in agent calls the same `@kimo/mcp-server`
 * tools in process, over the window's own `DocStore`, through M5 `dispatch` (validate →
 * authorize → approval → handler → envelope → activity). Scopes are enforced per op by
 * `checkScope` (`@kimo/ai-agent`) in `DispatchOptions.targets` — never by the prompt.
 *
 * Web windows and tests use this directly. A desktop window whose store is a document-host
 * replica can pass its own {@link ToolHostFactory} (the document host's handlers); see
 * INTEGRATION.md.
 */
import {
  type AgentTool,
  checkScope,
  createRegistryToolHost,
  type ScopeTree,
  type ToolHost,
} from "@kimo/ai-agent"
import { FORMAT_VERSION } from "@kimo/core-schema"
import type { DocStore } from "@kimo/editor-state"
import {
  type ActivityEntry,
  type ApprovalOutcome,
  type ApprovalRequest,
  type BackendDocument,
  type ClientPolicy,
  type CoreDocumentHost,
  createDocumentHost,
  createToolHandlers,
  type DispatchOptions,
  emptyAllowances,
  type HostFiles,
  type HostResult,
  type ToolHandlers,
  type WireOp,
} from "@kimo/mcp-server"

/** What one agent (lead or child) needs from the document. */
interface ToolHostSpec {
  /** `agent:kimo.<session>.<n>`. */
  origin: `agent:${string}`
  /** "Kimo", "Agent 2" (activity actor). */
  label: string
  session: string
  policy: ClientPolicy
  /** Spawned children: CHILD_EXCLUDED_TOOLS. */
  exclude?: readonly string[]
  /** Agent-only tools (kimo_spawn_agents for the lead in split mode). */
  extra?: readonly AgentTool[]
  /** In-app approvals: wait indefinitely (Stop answers deny). */
  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome>
  /** Activity rows (M5 activity log of this file). */
  onActivity?(entry: Omit<ActivityEntry, "seq">): void
}

export type ToolHostFactory = (spec: ToolHostSpec) => ToolHost

export interface InWindowToolsOptions {
  store: DocStore
  /** Canonical path or `untitled:<docId>`. */
  path: string
  /** The canvas selection (kimo_get_state). */
  selection?: () => string[]
  /** kimo_focus. */
  onFocus?: (ids: string[]) => void
  /** Kimo version for kimo_get_state. */
  version?: string
  now?: () => number
}

const noFiles: HostFiles = {
  readText: () => Promise.reject(new Error("No file access from the agent panel.")),
  readBytes: () => Promise.reject(new Error("No file access from the agent panel.")),
  writeTextAtomic: () => Promise.reject(new Error("No file access from the agent panel.")),
  writeBytesAtomic: () => Promise.reject(new Error("No file access from the agent panel.")),
  stat: async () => null,
}

/** A single-document `DocumentHost` over the window's store. */
function createWindowDocumentHost(o: InWindowToolsOptions): CoreDocumentHost {
  const doc: BackendDocument = {
    path: o.path,
    store: o.store,
    readOnlyReason: () => (o.store.readOnly ? String(o.store.readOnly) : null),
    format: () => FORMAT_VERSION,
    dirty: () => false,
    lastSavedRevision: () => undefined,
    shownInWindow: () => true,
    save: async () => ({
      ok: false,
      error: { code: "UNSUPPORTED", message: "Saving is the editor's job (autosave)." },
    }),
    close: async () => {},
  }
  return createDocumentHost({
    backend: {
      kind: "web",
      files: noFiles,
      list: () => [doc],
      open: async (path): Promise<HostResult<BackendDocument>> =>
        path === o.path
          ? { ok: true, value: doc }
          : {
              ok: false,
              error: { code: "DOCUMENT_NOT_OPEN", message: `${path} is not open here.` },
            },
      selection: () => o.selection?.() ?? [],
      focus: async (_p, ids) => {
        o.onFocus?.(ids)
        return true
      },
    },
  })
}

/** ScopeTree over a DocStore (parent links). */
function storeScopeTree(store: DocStore): ScopeTree {
  return {
    exists: (id) => store.hasNode(id),
    parentOf: (id) => {
      const n = store.getNode(id) as { parent?: string | null } | undefined
      return n?.parent ?? null
    },
  }
}

/**
 * Out-of-scope node ids of one call under a scoped policy (`checkScope`, ADR 0014 §8): the same
 * rules in the window (in-window tools) and in the document host (`agentCall`).
 */
export function scopeViolations(
  store: DocStore,
  policy: ClientPolicy,
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  if (!policy.nodes.length || toolName !== "kimo_apply_ops" || !Array.isArray(input.ops)) return []
  const violations = checkScope(input.ops as WireOp[], storeScopeTree(store), policy.nodes, {
    globalsGrant: policy.grants.includes("globals"),
  })
  return [...new Set(violations.map((v) => v.nodeId || `ops[${v.index}]`))]
}

/** The `targets` resolver: path of the doc + per-op scope check for scoped policies. */
function scopedTargets(
  host: CoreDocumentHost,
  store: DocStore,
  policy: ClientPolicy,
): DispatchOptions["targets"] {
  return async (def, input) => {
    const t: Awaited<ReturnType<DispatchOptions["targets"]>> = {}
    if (typeof input.docId === "string") {
      const r = host.get(input.docId)
      if (r.ok) {
        t.path = r.value.ref.path
        t.pathAlreadyOpen = true
      }
    }
    const out = scopeViolations(store, policy, def.name, input)
    if (out.length) t.outOfScope = out
    return t
  }
}

/** A {@link ToolHostFactory} over the window's store (one shared handler set). */
export function createInWindowTools(o: InWindowToolsOptions): {
  factory: ToolHostFactory
  host: CoreDocumentHost
  handlers: ToolHandlers
  docId(): string
} {
  const host = createWindowDocumentHost(o)
  const handlers = createToolHandlers(host, {
    ...(o.version ? { version: o.version } : {}),
    windows: () => 1,
  })
  const now = o.now ?? Date.now
  let seq = 0
  const factory: ToolHostFactory = (spec) =>
    createRegistryToolHost({
      context: {
        identity: {
          client: "kimo",
          label: spec.label,
          session: spec.session,
          transport: "in-process",
        },
        origin: spec.origin,
        policy: spec.policy,
        allowances: emptyAllowances(),
        host,
        requestApproval: spec.requestApproval,
        recordActivity: (e) => spec.onActivity?.(e),
        now,
        newId: () => `a${(++seq).toString(36)}${Math.floor(now()).toString(36).slice(-4)}`,
      },
      handlers,
      dispatch: { validate: () => [], targets: scopedTargets(host, o.store, spec.policy) },
      host: "web",
      ...(spec.exclude ? { exclude: spec.exclude } : {}),
      ...(spec.extra ? { extra: spec.extra } : {}),
    })
  return {
    factory,
    host,
    handlers,
    docId: () => host.list()[0]?.ref.id ?? "",
  }
}
