/**
 * The 20 tool handlers over a `DocumentHost` (ADR 0013 §2), one function per tool. Each one
 * returns exactly one envelope; nothing throws past the dispatcher. Mutations are single
 * `DocStore.apply` op groups with the caller's origin (`ctx.origin`), so undo, attribution and
 * revisions work the same for every surface (MCP, M6 agent, CLI).
 */
import {
  COMPOSITE_VARIABLE_TYPES,
  declaredProps,
  type Feature,
  featuresNeeded,
  instancesOf,
  isObject,
  isRef,
  isThemedValue,
  type KimoDocument,
  type Libraries,
  listPages,
  localComponents,
  resolveVariable,
  rootsByPage,
  serialize,
  usedFontFamilies,
  validate,
} from "@kimo/core-schema"
import type { DocStore, LocalOrigin, NodeData, Op } from "@kimo/editor-state"
import type { ExportResult, ExportTarget } from "@kimo/exporters"
import {
  type DocRef,
  failure,
  type RevisionToken,
  success,
  type ToolError,
  type ToolImage,
  type ToolResult,
  type ToolWarning,
} from "../envelope"
import { readGuide as builtinGuide } from "../guides"
import type { WireOp } from "../ops"
import { toolByName } from "../registry"
import {
  authorize,
  type HandlerOutput,
  type HostDocument,
  isRoomPath,
  type ToolContext,
  type ToolHandler,
  VIEW_ROOM_SUGGESTION,
} from "../runtime"
import {
  SCRIPT_COMPILER,
  SCRIPT_PLAN,
  type ScriptCompiler,
  type ScriptPlan,
  scriptLine,
} from "../script/plan"
import { defaultScriptRunner, type ScriptRunner } from "../script/runner"
import type { Carry, WorldData } from "../script/session"
import { ScriptStream } from "../script/stream"
import { snapshotWorld } from "../script/world"
import type { ToolDef } from "../tools/define"
import { CODE_EXPORT_TARGETS, M5_EXPORT_TARGETS } from "../tools/output"
import { AGENT_MAX_NEW_LAYERS, STREAM_MAX_NEW_LAYERS } from "../tools/write"
import { CHECK_MAX_LIST, type CheckProblem, checkDesign, formatProblems } from "./check"
import { compileWireOps, pointerTarget, touchedIds, wirePath } from "./compile"
import type { CoreDocumentHost } from "./core-host"
import { EXTENSION, imageSize, parseCssTokens, parseDtcg, sniffFont, sniffImage } from "./importers"
import { journalFor } from "./journal"
import { runQuery } from "./query"
import { approximateMeasurer, createSceneService, type ExportKit, type SceneService } from "./scene"
import { type LandedGroup, type LandedMeta, StreamEngine } from "./stream"
import {
  basename,
  dirname,
  errorMessage,
  joinPath,
  mapOpError,
  normalizePath,
  randomId,
  sameRev,
  sha256Hex,
  themeOf,
  toBase64,
  toToken,
  toWarnings,
} from "./util"

// --- Batch limit (board 31) --------------------------------------------------------------------

/**
 * Freshly authored layers of a kimo_apply_ops call: its `insert` ops (each inserts exactly one
 * node whose content the caller wrote out). Copies, instances, page duplicates and edits of
 * existing layers are never counted.
 */
export function newLayerCount(ops: readonly WireOp[]): number {
  let n = 0
  for (const op of ops) if (op.op === "insert") n++
  return n
}

/** BATCH_TOO_LARGE when a call authors more than {@link AGENT_MAX_NEW_LAYERS} new layers. */
export function batchTooLarge(
  ops: readonly WireOp[],
  limit: number = AGENT_MAX_NEW_LAYERS,
): ToolError | null {
  const newLayers = newLayerCount(ops)
  if (newLayers <= limit) return null
  return {
    code: "BATCH_TOO_LARGE",
    message: `This call creates ${newLayers} new layers; one call may create at most ${limit}. Nothing was applied.`,
    detail: { kind: "batch", limit, newLayers },
    suggestion: `Split into finished parts of ≤ ${limit} new layers: one complete section, or one complete sub-block of a large section (its heading row, then its card grid), per call, passing baseRevision from the previous result. Never leave empty frames to fill later. To reuse existing content, copy it (copy is never limited) instead of inserting it again.`,
  }
}

// --- Options -----------------------------------------------------------------------------------

/** An agent shown in kimo_get_state (from the host runtime's presence). */
export interface AgentSummary {
  origin: string
  label: string
  state: string
  docs: string[]
}

/** SVG → insert ops (supplied by the editor's svg-import in the app; absent headless). */
export type SvgImporter = (
  text: string,
  target: {
    parent: string | null
    index?: number
    x: number
    y: number
    name?: string
    newId: () => string
    colorVariables: Record<string, string>
  },
) => { ops: Op[]; rootId: string }

export interface StylePreset {
  name: string
  summary: string
  params: { name: string; choices: string[] }[]
  /** Guidance prose + tokens for the chosen params. */
  build(params: Record<string, string>): {
    markdown: string
    variables: { name: string; variable: Record<string, unknown> }[]
  }
}

export interface ToolHandlerOptions {
  /** Kimo version reported by kimo_get_state. */
  version?: string
  /** Layout + raster service (default: the host's, else a new one). */
  scene?: SceneService
  /** Guide text by path (builder 3's `readGuide` from `@kimo/mcp-server` guides). */
  readGuide?: (path: string) => string | null | undefined
  /** Connected agents (presence), for kimo_get_state. */
  agents?: () => AgentSummary[]
  /** Editor windows open (0 headless). */
  windows?: () => number
  svgImport?: SvgImporter
  /** Loaded libraries of a document (component/variable libraries). */
  libraries?: (docId: string) => Libraries
  styles?: readonly StylePreset[]
  /** Input validation (kimo_script validates the ops it compiles like a kimo_apply_ops call). */
  validate?: (def: ToolDef, input: unknown) => ToolError[]
  /** Where kimo_script runs (default: a worker in browsers, in-process headless). */
  scriptRunner?: ScriptRunner
}

type In = Record<string, unknown>
type Out = Promise<HandlerOutput>

// --- Helpers -----------------------------------------------------------------------------------

const fail = (
  e: ToolError | ToolError[],
  extra: Parameters<typeof failure>[1] = {},
): HandlerOutput => ({
  result: failure(e, extra),
})
const done = <T>(result: ToolResult<T>, images?: ToolImage[]): HandlerOutput =>
  images ? { result, images } : { result }

/** Undo-token registry (per handler set): token → the op group it names. */
interface UndoRecord {
  store: DocStore
  origin: LocalOrigin
  top: object | null
  revision: RevisionToken
  /**
   * The group is undone: `top` is then its entry on the redo stack. A redo moves it back onto
   * the undo stack and keeps the token valid, so the same token undoes it again.
   */
  undone?: boolean
}

const asLocal = (o: ToolContext["origin"]) => o as LocalOrigin

/** `Name (d_…)`, and for a room joined from a share link where it syncs and the role. */
function docLine(x: {
  name: string
  doc: { id: string }
  shared?: { relay?: string; role: string }
}): string {
  if (!x.shared) return `${x.name} (${x.doc.id})`
  const via = x.shared.relay ? ` via ${x.shared.relay}` : ""
  return `${x.name} (${x.doc.id}, shared room${via}, ${x.shared.role === "view" ? "view only" : "can edit"})`
}

function nameOf(d: HostDocument): string {
  const meta = d.store.toHeader().meta as Record<string, unknown> | undefined
  const name = typeof meta?.name === "string" ? meta.name : null
  // A room's path is `kimo-room:<room>`: like its tab, it is "Shared file" until named.
  if (isRoomPath(d.ref.path)) return name?.trim() || "Shared file"
  return name ?? basename(d.ref.path).replace(/\.kimo$/i, "")
}

function numberOr(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d
}

/** Top-level ancestor of a node (itself when top-level). */
function topLevelOf(store: DocStore, id: string): string | null {
  let cur: string | undefined = id
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = store.getNode(cur)
    if (!n) return null
    if (n.parent === null) return cur
    cur = n.parent
  }
  return null
}

function docOrFail(ctx: ToolContext, input: In): HostDocument | HandlerOutput {
  const r = ctx.host.get(String(input.docId))
  return r.ok ? r.value : fail(r.error)
}
const isOutput = (x: unknown): x is HandlerOutput =>
  typeof x === "object" && x !== null && "result" in x && !("store" in x)

function refreshRef(ctx: ToolContext, docId: string, fallback: DocRef): DocRef {
  const r = ctx.host.get(docId)
  return r.ok ? r.value.ref : fallback
}

function readOnlyError(d: HostDocument): ToolError {
  return {
    code: "READ_ONLY",
    message: `This document is read-only (${d.store.readOnly?.reason ?? "read-only"}).`,
    suggestion:
      d.shared?.role === "view"
        ? VIEW_ROOM_SUGGESTION
        : "Export a copy with kimo_export target=kimo, or open a writable document.",
  }
}

const RELATED: Record<string, string[]> = {
  index: ["schema", "ops", "errors"],
  schema: ["ops", "layout", "text"],
  ops: ["schema", "components", "errors"],
  components: ["ops", "tokens"],
  tokens: ["components", "ops"],
  layout: ["schema", "text"],
  text: ["layout", "schema"],
  errors: ["envelope", "ops"],
  envelope: ["errors"],
}

const FALLBACK_INDEX = `# Kimo agent guides

- **schema**: the .kimo node format (types, fields, layout, fills).
- **ops**: kimo_apply_ops examples (insert with key + @key, update, move, delete, components, variables).
- **components**, **tokens**, **layout**, **text**: topic guides.
- **errors**: every error code and what to do; **envelope**: the result shape.

Loop: kimo_get_state → kimo_open → kimo_query → kimo_apply_ops (baseRevision) → kimo_render.
`

// --- Handlers ----------------------------------------------------------------------------------

/** How `commit` / `landed` describe an edit. */
interface CommitMeta {
  label: string
  wireIndex?: number[]
  created?: { key: string; id: string }[]
  notes?: { code: string; message: string; nodeId?: string }[]
  data?: (r: { inserted: number; updated: number; deleted: number }) => Record<string, unknown>
  summary: (r: { inserted: number; updated: number; deleted: number; dryRun: boolean }) => string
  render?: boolean
  /** Board 31 "Check": list problems in the layers this edit changed (`data.problems`). */
  check?: boolean
}

export function createToolHandlerMap(
  hostScene: SceneService | undefined,
  options: ToolHandlerOptions,
): Record<string, ToolHandler> {
  const scene = options.scene ?? hostScene ?? createSceneService()
  const tokens = new Map<string, UndoRecord>()
  const libs = (docId: string): Libraries => options.libraries?.(docId) ?? {}
  /** Streamed edits (ADR 0013 §4.7): provisional apply while the model writes the call. */
  const streams = new StreamEngine({
    libs,
    featureOp: (store, ops) => featureOp(store, ops),
    landed: (ctx, d, input, group, meta) => landedStream(ctx, d, input, group, meta),
  })

  /** One committed (or dry-run) op group → success envelope pieces. */
  function recordUndo(store: DocStore, origin: LocalOrigin): string | undefined {
    const top = store.topUndo(origin)
    if (!top) return undefined
    const token = `u_${randomId(12)}`
    tokens.set(token, { store, origin, top, revision: toToken(store.revision) })
    if (tokens.size > 2000) tokens.delete(tokens.keys().next().value as string)
    return token
  }

  function conflict(d: HostDocument, base: RevisionToken): ToolError {
    const cur = d.store.revision
    const changed = journalFor(d.store).changedSince(base)
    return {
      code: "REVISION_CONFLICT",
      message:
        base.epoch !== cur.epoch
          ? `baseRevision is from another epoch (${base.epoch}); the document was reloaded.`
          : `Document is at ${cur.epoch}:${cur.seq}, not ${base.epoch}:${base.seq}.`,
      detail: { kind: "revision", current: toToken(cur), changed: changed?.nodes ?? [] },
      suggestion:
        "Re-read the changed nodes (kimo_query ids=detail.changed) and retry with detail.current.",
    }
  }

  /**
   * Applies compiled ops as one group (shared by apply_ops, import, styles, assets import).
   * Returns the envelope.
   */
  async function commit(
    ctx: ToolContext,
    d: HostDocument,
    input: In,
    ops: Op[],
    meta: CommitMeta,
  ): Promise<HandlerOutput> {
    const base = input.baseRevision as RevisionToken | undefined
    const dryRun = input.dryRun === true
    // An open streamed edit of this agent is rolled back first: two groups never merge.
    if (!dryRun) streams.interrupt(d.store, ctx.origin, ctx.stream)
    const r = d.store.apply(ops, {
      origin: asLocal(ctx.origin),
      label: typeof input.label === "string" ? input.label : meta.label,
      ...(base ? { baseRevision: base } : {}),
      dryRun,
    })
    if (!r.ok) {
      const errors = r.errors.map((e) =>
        e.code === "REVISION_CONFLICT" && base
          ? conflict(d, base)
          : mapOpError(
              e,
              meta.wireIndex ? (p) => wirePath(p, meta.wireIndex as number[]) : undefined,
            ),
      )
      // Board 31 token pass: the first few issues are enough to fix the call (the same slip
      // repeated on 20 nodes is one fix), so a failure stays short.
      const more = errors.length - MAX_ERRORS
      const first = errors[0]
      return fail(errors.slice(0, MAX_ERRORS), {
        revision: sameRev(r.revision),
        ...(more > 0 && first
          ? { summary: `${first.code}: ${first.message} (+${more} more issue(s))` }
          : {}),
      })
    }
    return landed(ctx, d, input, r, meta)
  }

  /** The success envelope of a landed op group (one `apply`, or a committed stream). */
  async function landed(
    ctx: ToolContext,
    d: HostDocument,
    input: In,
    r: LandedGroup & { dryRun?: boolean },
    meta: CommitMeta,
  ): Promise<HandlerOutput> {
    const before = r.before
    const dryRun = r.dryRun === true
    const inserted = r.created.length
    const deleted = r.deleted.length
    const updated = new Set(
      r.ops
        .filter((o) => o.op === "update" || o.op === "move")
        .map((o) => (o as { id: string }).id),
    ).size
    const counts = { inserted, updated, deleted }
    const undoToken = dryRun ? undefined : recordUndo(d.store, asLocal(ctx.origin))
    const warnings: ToolWarning[] = toWarnings(r.warnings)
    const changed = touchedIds(r.ops)
    const extra: Parameters<typeof success>[2] = {
      doc: refreshRef(ctx, d.ref.id, d.ref),
      revision: { before: toToken(before), after: toToken(r.revision) },
      ops: r.ops as unknown as Record<string, unknown>[],
      inverse: r.inverse as unknown as Record<string, unknown>[],
      opCount: r.ops.length,
      created: meta.created ?? r.created.map((id) => ({ key: id, id })),
      changed,
      warnings,
      dryRun,
    }
    if (undoToken) extra.undoToken = undoToken
    // Board 31 "Agent cursor": the layer the agent's pointer moves to (the last one it added).
    const pointer = dryRun ? undefined : pointerTarget(r.ops)
    if (pointer) extra.pointer = pointer
    // When the commit moved the epoch (never in practice), keep docId in doc.
    let images: ToolImage[] | undefined
    if (meta.render && !dryRun && changed.length) {
      const tops = [
        ...new Set(changed.map((id) => topLevelOf(d.store, id)).filter((x): x is string => !!x)),
      ].slice(0, 8)
      if (tops.length) {
        const rr = await ctx.host.render(d.ref.id, tops, { scale: 1, maxSize: 1600 })
        if (rr.ok) images = rr.value
        else warnings.push({ code: "RENDER_FAILED", message: rr.error.message })
      }
    }
    const data: Record<string, unknown> = meta.data ? meta.data(counts) : { ...counts }
    let summary = meta.summary({ ...counts, dryRun })
    if (meta.check && !dryRun && changed.length) {
      const problems = await checkEdit(d, r.ops, r.inverse)
      if (problems.length) {
        data.problems = formatProblems(problems)
        summary += ` ${problems.length} problem(s) to fix before moving on (data.problems).`
      }
    }
    return {
      ...done(success(data, summary, extra), images),
      label: typeof input.label === "string" ? input.label : meta.label,
    }
  }

  /**
   * Board 31 "Check" for one landed edit: the layers it inserted or changed, their parents and
   * the parents of what it deleted (an emptied or overflowing container), from the layout the
   * other tools share (cached per revision).
   */
  async function checkEdit(
    d: HostDocument,
    ops: readonly unknown[],
    inverse: readonly unknown[],
  ): Promise<CheckProblem[]> {
    const ids = new Set<string>()
    const parentOf = (id: string) => {
      const p = d.store.getNode(id)?.parent
      if (typeof p === "string") ids.add(p)
    }
    for (const o of ops as { op: string; id?: string }[])
      if (o.id && d.store.getNode(o.id)) {
        ids.add(o.id)
        parentOf(o.id)
      }
    for (const o of inverse as { op: string; node?: { parent?: unknown } }[])
      if (o.op === "insert" && typeof o.node?.parent === "string" && d.store.getNode(o.node.parent))
        ids.add(o.node.parent)
    if (!ids.size) return []
    let layout: Awaited<ReturnType<SceneService["layout"]>>
    try {
      layout = await scene.layout(d.store)
    } catch {
      return []
    }
    return checkDesign(d.store, layout, { ids })
  }

  // --- Session tools ---------------------------------------------------------------------------

  const getState: ToolHandler = async (input, ctx): Out => {
    let docs = ctx.host.list()
    if (typeof input.docId === "string") {
      const r = ctx.host.get(input.docId)
      if (!r.ok) return fail(r.error)
      docs = [r.value]
    }
    const agents = options.agents?.() ?? []
    const documents = await Promise.all(
      docs.map(async (d) => {
        const header = d.store.toHeader()
        const top = d.store.children(null)
        const layout = top.length ? await scene.layout(d.store) : null
        const doc = { nodes: {} as Record<string, unknown> }
        for (const id of d.store.nodeIds()) doc.nodes[id] = d.store.getNode(id)
        return {
          doc: d.ref,
          revision: toToken(d.store.revision),
          name: nameOf(d),
          ...(d.shared
            ? {
                shared: {
                  ...(d.shared.relay ? { relay: d.shared.relay } : {}),
                  role: d.shared.role,
                },
              }
            : {}),
          selection: ctx.host.selection(d.ref.id),
          topLevel: top.slice(0, 50).map((id) => {
            const n = d.store.getNode(id) as NodeData
            const s: Record<string, unknown> = { id, type: n.type }
            if (typeof n.name === "string") s.name = n.name
            if (n.visible === false) s.visible = false
            const w = layout?.nodes.get(id)?.world
            if (w) s.bounds = { x: w.x, y: w.y, w: w.w, h: w.h }
            return s
          }),
          topLevelCount: top.length,
          pages: (() => {
            const byPage = rootsByPage({ pages: header.pages, nodes: doc.nodes })
            return listPages({ pages: header.pages }).map((p) => ({
              ...(p.id !== null ? { id: p.id } : {}),
              name: p.name,
              topLevelCount: byPage.get(p.id ?? "")?.length ?? 0,
            }))
          })(),
          components: localComponents(doc as never)
            .slice(0, 100)
            .map((id) => ({ id, name: String(d.store.getNode(id)?.name ?? id) })),
          variables: {
            count: Object.keys(header.variables ?? {}).length,
            axes: Object.entries(header.themes ?? {}).map(([axis, values]) => ({
              axis,
              values: [...(values as string[])],
            })),
          },
          agents: agents
            .filter((a) => a.origin !== ctx.origin && a.docs.includes(d.ref.id))
            .map(({ origin, label, state }) => ({ origin, label, state })),
        }
      }),
    )
    const data = {
      app: {
        mode: ctx.host.kind,
        version: options.version ?? "0.0.0",
        windows: options.windows?.() ?? 0,
      },
      documents,
      you: {
        origin: ctx.origin,
        level: ctx.policy.level,
        files: [...ctx.policy.files],
        grants: [...ctx.policy.grants],
      },
    }
    const n = documents.length
    return done(
      success(
        data,
        n
          ? `${n} open document${n === 1 ? "" : "s"}: ${documents.map(docLine).join(", ")}.`
          : "No documents are open. Open a .kimo file with kimo_open or create one with kimo_create.",
      ),
    )
  }

  const readDocs: ToolHandler = async (input): Out => {
    const path = typeof input.path === "string" ? input.path : "index"
    let markdown: string | null | undefined
    let related: string[] | undefined
    try {
      if (options.readGuide) markdown = options.readGuide(path)
      else {
        const g = builtinGuide(path)
        markdown = g?.markdown
        related = g?.related
      }
    } catch {
      markdown = null
    }
    if (!markdown) {
      if (path !== "index")
        return fail({
          code: "UNSUPPORTED",
          message: `The guide "${path}" is not available in this build.`,
          suggestion: "Read the index (no path).",
        })
      markdown = FALLBACK_INDEX
    }
    return done(
      success(
        { path, markdown, related: related ?? RELATED[path] ?? ["index"] },
        `Guide ${path} (${markdown.length} chars).`,
      ),
    )
  }

  const open: ToolHandler = async (input, ctx): Out => {
    const r = await ctx.host.open(String(input.path), { readOnly: input.readOnly === true })
    if (!r.ok) return fail(r.error)
    const d = r.value
    const core = ctx.host as Partial<CoreDocumentHost>
    const format = core.formatOf?.(d.ref.id) ?? "1.0"
    const reason = core.readOnlyReasonOf?.(d.ref.id) ?? d.store.readOnly?.reason ?? null
    const data: Record<string, unknown> = {
      doc: d.ref,
      revision: toToken(d.store.revision),
      alreadyOpen: d.alreadyOpen,
      format,
    }
    if (reason) data.readOnlyReason = reason
    return done(
      success(
        data,
        `${d.alreadyOpen ? "Already open" : "Opened"} ${d.ref.path} as ${d.ref.id}${reason ? ` (read-only: ${reason})` : ""}.`,
        { doc: d.ref, revision: sameRev(d.store.revision) },
      ),
    )
  }

  const create: ToolHandler = async (input, ctx): Out => {
    const opts: { name?: string; template?: string } = {}
    if (typeof input.name === "string") opts.name = input.name
    if (typeof input.template === "string") opts.template = input.template
    const r = await ctx.host.create(String(input.path), opts)
    if (!r.ok) return fail(r.error)
    const d = r.value
    const bytes = await ctx.host.readFile(d.ref.path)
    if (!bytes.ok) return fail(bytes.error)
    return done(
      success(
        {
          doc: d.ref,
          revision: toToken(d.store.revision),
          bytes: bytes.value.length,
          sha256: sha256Hex(bytes.value),
        },
        `Created ${d.ref.path} (${d.ref.id}).`,
        { doc: d.ref, revision: sameRev(d.store.revision) },
      ),
    )
  }

  const close: ToolHandler = async (input, ctx): Out => {
    const r = await ctx.host.close(String(input.docId), {
      save: input.save === true,
      discard: input.discard === true,
    })
    if (!r.ok) return fail(r.error)
    return done(
      success(
        r.value,
        r.value.closed
          ? `Closed${r.value.saved ? " after saving" : ""}.`
          : "A window still shows this document; your reference was dropped.",
      ),
    )
  }

  const save: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const r = await ctx.host.save(d.ref.id, input.baseRevision as RevisionToken | undefined)
    if (!r.ok) return fail(r.error, { revision: sameRev(d.store.revision) })
    return done(
      success(r.value, `Saved ${r.value.path} (${r.value.bytes} bytes, verified).`, {
        doc: refreshRef(ctx, d.ref.id, d.ref),
        revision: sameRev(d.store.revision),
      }),
    )
  }

  const history: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const origin = asLocal(ctx.origin)
    const store = d.store
    const before = store.revision
    const action = String(input.action)
    if (action === "list") {
      const limit = numberOr(input.limit, 20)
      const mine = new Map<string, string>()
      for (const [t, rec] of tokens)
        if (rec.store === store && rec.origin === origin && !rec.undone)
          mine.set(`${rec.revision.epoch}:${rec.revision.seq}`, t)
      const entries = [...store.log()]
        .reverse()
        .slice(0, limit)
        .map((e) => {
          const out: Record<string, unknown> = {
            revision: toToken(e.revision),
            origin: "origin" in e ? e.origin : "system",
            kind: e.kind,
            time: e.time,
            opCount: e.kind === "ops" ? e.ops.length : 0,
          }
          if (e.kind === "ops" && e.label) out.label = e.label
          const t = mine.get(`${e.revision.epoch}:${e.revision.seq}`)
          if (t && e.kind === "ops" && e.origin === origin) out.undoToken = t
          return out
        })
      return done(
        success(
          { entries, canUndo: store.canUndo(origin), canRedo: store.canRedo(origin) },
          `${entries.length} history entries (newest first).`,
          { doc: d.ref, revision: sameRev(before) },
        ),
      )
    }
    if (store.readOnly) return fail(readOnlyError(d))
    const undoing = action === "undo"
    if ((undoing || action === "redo") && typeof input.token === "string") {
      const rec = tokens.get(input.token)
      if (!rec || rec.store !== store || rec.origin !== origin)
        return fail(
          {
            code: "INVALID_INPUT",
            message: "Unknown undo token for this document and connection.",
            path: "token",
          },
          { revision: sameRev(before) },
        )
      if (!!rec.undone === undoing)
        return fail(
          {
            code: "INVALID_INPUT",
            message: undoing
              ? "That edit is already undone; nothing was undone."
              : "That edit is not undone; nothing was redone.",
            path: "token",
          },
          { revision: sameRev(before) },
        )
      if ((undoing ? store.topUndo(origin) : store.topRedo(origin)) !== rec.top)
        return fail(
          {
            code: "REVISION_CONFLICT",
            message: undoing
              ? "That edit is no longer on top of your undo stack; nothing was undone."
              : "That edit is no longer on top of your redo stack; nothing was redone.",
            path: "token",
            detail: { kind: action, current: toToken(before) },
            suggestion: "Call kimo_history action=list to see your recent edits.",
          },
          { revision: sameRev(before) },
        )
    }
    streams.interrupt(store, origin)
    const topBefore = undoing ? store.topUndo(origin) : store.topRedo(origin)
    const moved = [...tokens].filter(
      ([, r]) =>
        r.store === store && r.origin === origin && r.top === topBefore && !!r.undone !== undoing,
    )
    const res = undoing ? store.undo(origin) : store.redo(origin)
    if (!res.ok && !res.stale)
      return fail(
        {
          code: "INVALID_INPUT",
          message: `Nothing to ${action} on your undo stack (other clients' and the user's edits are never undone).`,
        },
        { revision: sameRev(before) },
      )
    // Keep the group's token valid across undo/redo: it follows the group between the stacks.
    // A stale group is dropped from the stack, and its token with it.
    let undoToken: string | undefined
    for (const [t, r] of moved) {
      if (res.stale || !topBefore) {
        tokens.delete(t)
        continue
      }
      r.top = undoing ? store.topRedo(origin) : store.topUndo(origin)
      r.undone = undoing
      if (!undoing) undoToken = t
    }
    return done(
      success(
        {
          stale: res.stale,
          canUndo: store.canUndo(origin),
          canRedo: store.canRedo(origin),
          ...(undoToken ? { undoToken } : {}),
        },
        res.stale
          ? `Your last edit no longer had any effect (later edits by others changed the same nodes); it was dropped from your ${action} stack.`
          : `${action === "undo" ? "Undid" : "Redid"} your last edit.`,
        {
          doc: refreshRef(ctx, d.ref.id, d.ref),
          revision: { before: toToken(before), after: toToken(res.revision) },
        },
      ),
    )
  }

  const focus: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const r = await ctx.host.focus(d.ref.id, input.ids as string[], {
      select: input.select !== false,
      zoom: (input.zoom as "fit" | "keep" | "100") ?? "fit",
    })
    if (!r.ok) return fail(r.error)
    const warnings: ToolWarning[] = r.value.shown
      ? []
      : [{ code: "NO_WINDOW", message: "No editor window shows this document; nothing was shown." }]
    return done(
      success(r.value, r.value.shown ? "Shown in the editor." : "No window to show it in.", {
        doc: d.ref,
        warnings,
      }),
    )
  }

  // --- Read tools ------------------------------------------------------------------------------

  const query: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const include = (input.include as string[] | undefined) ?? []
    const needLayout = include.includes("bounds") || include.includes("problems")
    const layout = needLayout ? await scene.layout(d.store) : null
    let view = null
    if (
      input.resolveInstances === true ||
      include.includes("origin") ||
      input.resolveVariables === true
    ) {
      const { createInstanceView } = await import("@kimo/layout")
      view = createInstanceView(d.store, {
        header: () => d.store.toHeader() as never,
        libraries: libs(d.ref.id),
      })
    }
    const r = runQuery(d.store, input as never, { view, layout })
    if (!r.ok) return fail(r.error)
    const warnings: ToolWarning[] = []
    if (needLayout && !layout)
      warnings.push({
        code: "NO_LAYOUT",
        message: "Layout is unavailable; bounds/problems omitted.",
      })
    return done(
      success(
        r.value,
        `${r.value.matched} match${r.value.matched === 1 ? "" : "es"}, ${r.value.nodes.length} node(s) returned${r.value.nextCursor ? " (more: pass nextCursor)" : ""}.`,
        { doc: d.ref, revision: sameRev(d.store.revision), warnings },
      ),
    )
  }

  const getVariables: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const header = d.store.toHeader() as KimoDocument
    const vars = (header.variables ?? {}) as Record<string, Record<string, unknown>>
    const names = input.names as string[] | undefined
    const group = typeof input.group === "string" ? input.group : undefined
    const theme: Record<string, string> = {}
    for (const [a, v] of Object.entries(header.themes ?? {})) if (v[0]) theme[a] = v[0]
    Object.assign(theme, themeOf(input.theme as never) ?? {})
    let usage: Map<string, number> | null = null
    if (input.includeUsages === true) {
      usage = new Map()
      for (const id of d.store.nodeIds()) {
        const s = JSON.stringify(d.store.getNode(id))
        for (const m of s.matchAll(/"\$ref":"([^"]+)"/g))
          usage.set(m[1] as string, (usage.get(m[1] as string) ?? 0) + 1)
      }
    }
    const docLike = { ...header, nodes: {} } as KimoDocument
    const variables = Object.entries(vars)
      .filter(
        ([n, v]) =>
          (!names || names.includes(n)) && (!group || String(v.group ?? "").startsWith(group)),
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, v]) => {
        const kind = isThemedValue(v.value) ? "themed" : isRef(v.value) ? "alias" : "literal"
        const value: Record<string, unknown> = { kind, raw: v.value }
        if (input.resolve === true) {
          const r = resolveVariable(docLike, name, theme, libs(d.ref.id))
          if (r.ok) value.resolved = r.value
          else value.error = r.reason
        }
        const out: Record<string, unknown> = { name, type: String(v.type), value }
        if (typeof v.group === "string") out.group = v.group
        if (typeof v.description === "string") out.description = v.description
        if (usage) out.usages = usage.get(name) ?? 0
        return out
      })
    const axes = Object.entries(header.themes ?? {}).map(([axis, values]) => ({
      axis,
      values: [...values],
    }))
    return done(
      success(
        { variables, axes },
        `${variables.length} variable(s), ${axes.length} theme axis/axes.`,
        {
          doc: d.ref,
          revision: sameRev(d.store.revision),
        },
      ),
    )
  }

  const listComponents: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const doc = d.store.toDocument()
    const q = typeof input.query === "string" ? input.query.toLowerCase() : undefined
    const limit = numberOr(input.limit, 200)
    const scope = { doc, libraries: libs(d.ref.id) }
    const nodes = doc.nodes as Record<string, Record<string, unknown>>
    const components = localComponents(doc)
      .map((id) => {
        const n = nodes[id] as Record<string, unknown>
        const props = declaredProps(scope, { alias: null, id, node: n }).map((p) => {
          const def = p.def as unknown as Record<string, unknown>
          const out: Record<string, unknown> = { name: p.name, type: String(def.type) }
          if (isObject(def.options)) out.options = Object.keys(def.options)
          return out
        })
        const slots: string[] = []
        const walk = (pid: string) => {
          for (const c of d.store.children(pid)) {
            if (isObject(d.store.getNode(c)?.slot)) slots.push(c)
            walk(c)
          }
        }
        walk(id)
        const meta = n.meta as Record<string, unknown> | undefined
        const out: Record<string, unknown> = {
          id,
          name: String(n.name ?? id),
          props,
          slots,
          instances: instancesOf(doc, id).length,
        }
        const desc = meta?.["kimo.component.description"]
        if (typeof desc === "string") out.description = desc
        if (typeof n.w === "number" && typeof n.h === "number") out.size = { w: n.w, h: n.h }
        return out
      })
      .filter((c) => !q || String(c.name).toLowerCase().includes(q))
      .slice(0, limit)
    return done(
      success({ components }, `${components.length} component(s).`, {
        doc: d.ref,
        revision: sameRev(d.store.revision),
      }),
    )
  }

  const findSpace: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const w = Number(input.w)
    const h = Number(input.h)
    const pad = numberOr(input.padding, 80)
    const dir = (input.direction as string | undefined) ?? "right"
    const layout = await scene.layout(d.store)
    const boxOf = (id: string) => {
      const l = layout?.nodes.get(id)?.world
      if (l) return l
      const n = d.store.getNode(id)
      return n
        ? { x: numberOr(n.x, 0), y: numberOr(n.y, 0), w: numberOr(n.w, 0), h: numberOr(n.h, 0) }
        : null
    }
    const boxes = d.store
      .children(null)
      .map(boxOf)
      .filter((b): b is { x: number; y: number; w: number; h: number } => !!b)
    const hits = (x: number, y: number) =>
      boxes.find(
        (b) => x < b.x + b.w + pad && x + w + pad > b.x && y < b.y + b.h + pad && y + h + pad > b.y,
      )
    let start: { x: number; y: number; w: number; h: number }
    if (typeof input.near === "string") {
      const top = topLevelOf(d.store, input.near)
      const b = top ? boxOf(top) : null
      if (!b)
        return fail({
          code: "NODE_NOT_FOUND",
          message: `Node ${input.near} does not exist.`,
          nodeId: input.near,
        })
      start = b
    } else if (boxes.length) {
      start = boxes.reduce((u, b) => {
        const x = Math.min(u.x, b.x)
        const y = Math.min(u.y, b.y)
        return {
          x,
          y,
          w: Math.max(u.x + u.w, b.x + b.w) - x,
          h: Math.max(u.y + u.h, b.y + b.h) - y,
        }
      })
    } else {
      return done(
        success({ x: 0, y: 0, parent: "root" }, "The canvas is empty: use 0, 0.", { doc: d.ref }),
      )
    }
    let x = dir === "right" ? start.x + start.w + pad : dir === "left" ? start.x - pad - w : start.x
    let y =
      dir === "below" ? start.y + start.h + pad : dir === "above" ? start.y - pad - h : start.y
    for (let guard = 0; guard < 500; guard++) {
      const b = hits(x, y)
      if (!b) break
      if (dir === "right") x = b.x + b.w + pad
      else if (dir === "left") x = b.x - pad - w
      else if (dir === "below") y = b.y + b.h + pad
      else y = b.y - pad - h
    }
    return done(
      success(
        { x: Math.round(x), y: Math.round(y), parent: "root" },
        `Free ${w}×${h} at ${Math.round(x)}, ${Math.round(y)}.`,
        {
          doc: d.ref,
          revision: sameRev(d.store.revision),
        },
      ),
    )
  }

  const validateTool: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const r = validate(d.store.toDocument())
    let errors = toWarnings(r.errors)
    let warnings = input.lints === false ? [] : toWarnings(r.warnings)
    const ids = input.ids as string[] | undefined
    let scope: Set<string> | undefined
    if (ids?.length) {
      const inside = new Set<string>()
      const walk = (id: string) => {
        inside.add(id)
        for (const c of d.store.children(id)) walk(c)
      }
      for (const id of ids) walk(id)
      scope = inside
      const keep = (w: ToolWarning) => w.nodeId !== undefined && inside.has(w.nodeId)
      errors = errors.filter(keep)
      warnings = warnings.filter(keep)
    }
    const data: Record<string, unknown> = { valid: errors.length === 0, errors, warnings }
    let summary = `${errors.length} error(s), ${warnings.length} warning(s).`
    if (input.check === true) {
      // Board 31 "Check": the end-of-work pass, placeholders still set included.
      const layout = await scene.layout(d.store)
      const problems = checkDesign(d.store, layout, {
        ...(scope ? { ids: scope } : {}),
        placeholders: true,
      })
      data.problems = formatProblems(problems, CHECK_MAX_LIST)
      summary += ` ${problems.length} problem(s).`
    }
    return done(success(data, summary, { doc: d.ref, revision: sameRev(d.store.revision) }))
  }

  // --- Write tools -----------------------------------------------------------------------------

  /**
   * Spec §13: a gated construct and its feature go in the same edit. Agents reach gates through
   * plain field values (layout.align "stretch", text runs, size min/max, …), so the edit
   * declares what it writes (appended: wire indexes of the compiled ops stay unchanged).
   */
  function featureOp(store: DocStore, ops: readonly Op[]): Op | null {
    const features = (store.toHeader().features ?? []) as readonly string[]
    const missing = [...featuresWrittenBy(ops)].filter((f) => !features.includes(f))
    return missing.length
      ? ({ op: "setHeader", set: { features: [...features, ...missing].sort() } } as Op)
      : null
  }

  /** What kimo_apply_ops says about a landed edit (direct or streamed). */
  function applyMeta(
    input: In,
    wireCount: number,
    c: Pick<LandedMeta, "created" | "notes"> & { wireIndex?: number[] },
  ): CommitMeta {
    return {
      label: `${wireCount} op${wireCount === 1 ? "" : "s"}`,
      ...(c.wireIndex ? { wireIndex: c.wireIndex } : {}),
      created: c.created,
      notes: c.notes,
      render: input.render === true,
      check: true,
      data: (n) => ({ applied: wireCount, ...n, notes: c.notes }),
      summary: (n) =>
        `${n.dryRun ? "Dry run: would apply" : "Applied"} ${wireCount} op(s): ${n.inserted} inserted, ${n.updated} updated, ${n.deleted} deleted.`,
    }
  }

  /** A streamed edit committed (one undo step): the same result as a direct call. */
  function landedStream(
    ctx: ToolContext,
    d: HostDocument,
    input: In,
    group: LandedGroup,
    meta: LandedMeta,
  ): Promise<HandlerOutput> {
    return landed(ctx, d, input, group, applyMeta(input, meta.wireCount, meta))
  }

  const applyOps: ToolHandler = async (input, ctx): Out => {
    // A streamed call (ADR 0013 §4.7): commit what already landed, or roll it back and run
    // the call the normal way below.
    if (ctx.stream && input.dryRun !== true) {
      const out = await streams.finalize(ctx.stream, input, ctx)
      if (out) return out
    }
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    if (d.store.readOnly) return fail(readOnlyError(d), { revision: sameRev(d.store.revision) })
    const base = input.baseRevision as RevisionToken | undefined
    const cur = d.store.revision
    if (base && (base.epoch !== cur.epoch || base.seq !== cur.seq))
      return fail(conflict(d, base), { revision: sameRev(cur) })
    if (!Array.isArray(input.ops))
      return fail({
        code: "INVALID_INPUT",
        message: "Give ops (or retryId with edits to fix a failed call).",
        path: "ops",
      })
    const wire = input.ops as WireOp[]
    const limit = ctx.stream || ctx.streamed ? STREAM_MAX_NEW_LAYERS : AGENT_MAX_NEW_LAYERS
    const tooLarge = batchTooLarge(wire, limit)
    if (tooLarge) return fail(tooLarge, { revision: sameRev(cur) })
    const compiled = compileWireOps(d.store, wire, { libraries: libs(d.ref.id) })
    if (!compiled.ok) return fail(compiled.errors, { revision: sameRev(cur) })
    const ops = compiled.ops as unknown as Op[]
    const feature = featureOp(d.store, ops)
    if (feature) ops.push(feature)
    return commit(ctx, d, input, ops, applyMeta(input, wire.length, compiled))
  }

  const importTool: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    if (d.store.readOnly) return fail(readOnlyError(d))
    const base = input.baseRevision as RevisionToken | undefined
    const cur = d.store.revision
    if (base && (base.epoch !== cur.epoch || base.seq !== cur.seq)) return fail(conflict(d, base))
    const kind = String(input.kind)
    const hasPath = typeof input.path === "string"
    const hasText = typeof input.text === "string"
    if (hasPath === hasText)
      return fail({ code: "INVALID_INPUT", message: "Give exactly one of path or text." })
    let bytes: Uint8Array | null = null
    let text = hasText ? (input.text as string) : ""
    if (hasPath) {
      const r = await ctx.host.readFile(input.path as string)
      if (!r.ok) return fail(r.error)
      bytes = r.value
      if (kind !== "image") text = new TextDecoder().decode(bytes)
    }
    const parent = typeof input.parent === "string" && input.parent !== "root" ? input.parent : null
    if (parent && !d.store.getNode(parent))
      return fail({
        code: "NODE_NOT_FOUND",
        message: `Node ${parent} does not exist.`,
        nodeId: parent,
        path: "parent",
      })
    const label = typeof input.label === "string" ? input.label : `Import ${kind}`

    if (kind === "tokens-dtcg" || kind === "tokens-css") {
      let vars: { name: string; variable: Record<string, unknown> }[]
      try {
        vars = kind === "tokens-dtcg" ? parseDtcg(text) : parseCssTokens(text)
      } catch (e) {
        return fail({ code: "INVALID_INPUT", message: `Cannot parse tokens: ${errorMessage(e)}` })
      }
      if (!vars.length) return fail({ code: "INVALID_INPUT", message: "No tokens found." })
      const ops: Op[] = [
        {
          op: "setVariables",
          set: Object.fromEntries(vars.map((v) => [v.name, v.variable])) as never,
        },
      ]
      return commit(ctx, d, input, ops, {
        label,
        created: [],
        data: () => ({ variables: vars.length }),
        summary: (c) =>
          `${c.dryRun ? "Dry run: would write" : "Wrote"} ${vars.length} variable(s).`,
      })
    }
    const at = await placement(d, input, parent)
    if (kind === "svg") {
      if (!options.svgImport)
        return fail({
          code: "UNSUPPORTED",
          message: "SVG vector import is not available in this host.",
          suggestion: "Use the Kimo app, or import the SVG as kind=image after rasterizing it.",
        })
      const colors: Record<string, string> = {}
      for (const [n, v] of Object.entries(
        (d.store.toHeader().variables ?? {}) as Record<string, Record<string, unknown>>,
      ))
        if (v.type === "color" && typeof v.value === "string") colors[n] = v.value
      let r: { ops: Op[]; rootId: string }
      try {
        r = options.svgImport(text, {
          parent,
          ...(typeof input.index === "number" ? { index: input.index } : {}),
          x: at.x,
          y: at.y,
          ...(typeof input.name === "string" ? { name: input.name } : {}),
          newId: () => randomNodeId(),
          colorVariables: colors,
        })
      } catch (e) {
        return fail({ code: "INVALID_INPUT", message: `SVG rejected: ${errorMessage(e)}` })
      }
      return commit(ctx, d, input, r.ops, {
        label,
        created: [{ key: typeof input.name === "string" ? input.name : r.rootId, id: r.rootId }],
        render: false,
        data: () => ({ rootId: r.rootId }),
        summary: (c) =>
          `${c.dryRun ? "Dry run: would import" : "Imported"} SVG (${c.inserted} layers).`,
      })
    }
    // image
    if (!bytes) return fail({ code: "INVALID_INPUT", message: "kind=image needs a path." })
    const mime = sniffImage(bytes)
    if (!mime)
      return fail({ code: "INVALID_INPUT", message: "Not a PNG, JPEG, GIF, WebP or AVIF image." })
    const asset = await putAsset(ctx, d, bytes, mime, input.dryRun === true)
    if (!asset.ok) return fail(asset.error)
    const size = imageSize(bytes, mime) ?? { w: 100, h: 100 }
    const id = randomNodeId()
    const ops: Op[] = [
      {
        op: "insert",
        id,
        parent,
        ...(typeof input.index === "number" ? { index: input.index } : {}),
        node: {
          type: "rect",
          name: typeof input.name === "string" ? input.name : basename(String(input.path)),
          x: at.x,
          y: at.y,
          w: size.w,
          h: size.h,
          fill: [{ kind: "image", src: asset.ref, fit: "stretch" }],
        },
      },
      ...asset.headerOps,
    ]
    return commit(ctx, d, input, ops, {
      label,
      created: [{ key: typeof input.name === "string" ? input.name : id, id }],
      data: () => ({ rootId: id, asset: asset.ref }),
      summary: (c) => `${c.dryRun ? "Dry run: would place" : "Placed"} image ${asset.ref}.`,
    })
  }

  async function placement(d: HostDocument, input: In, parent: string | null) {
    if (typeof input.x === "number" || typeof input.y === "number")
      return { x: numberOr(input.x, 0), y: numberOr(input.y, 0) }
    if (parent) return { x: 0, y: 0 }
    const layout = await scene.layout(d.store)
    let maxX = 0
    let minY = 0
    let any = false
    for (const id of d.store.children(null)) {
      const b = layout?.nodes.get(id)?.world
      const n = d.store.getNode(id)
      const x = b ? b.x + b.w : numberOr(n?.x, 0) + numberOr(n?.w, 0)
      const y = b ? b.y : numberOr(n?.y, 0)
      maxX = any ? Math.max(maxX, x) : x
      minY = any ? Math.min(minY, y) : y
      any = true
    }
    return any ? { x: Math.round(maxX + 80), y: Math.round(minY) } : { x: 0, y: 0 }
  }

  /** Writes a content-addressed asset next to the document and returns its manifest op. */
  async function putAsset(
    ctx: ToolContext,
    d: HostDocument,
    bytes: Uint8Array,
    mime: string,
    dryRun: boolean,
  ): Promise<
    { ok: true; ref: string; key: string; headerOps: Op[] } | { ok: false; error: ToolError }
  > {
    const ext = EXTENSION[mime] ?? "bin"
    const key = `${sha256Hex(bytes).slice(0, 16)}.${ext}`
    const ref = `./assets/${key}`
    if (d.ref.path.startsWith("untitled:"))
      return {
        ok: false,
        error: { code: "UNSUPPORTED", message: "Save the document before importing assets." },
      }
    if (isRoomPath(d.ref.path))
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED",
          message: "Images can't be imported into a shared room yet.",
          suggestion: "Ask the person to add it in Kimo.",
        },
      }
    if (!dryRun) {
      const w = await ctx.host.writeFile(
        joinPath(joinPath(dirname(d.ref.path), "assets"), key),
        bytes,
        false,
      )
      if (!w.ok && w.error.code !== "FILE_EXISTS") return { ok: false, error: w.error }
    }
    const manifest = (d.store.toHeader().assets ?? {}) as Record<string, unknown>
    const headerOps: Op[] = []
    if (!Object.hasOwn(manifest, key)) {
      const entry: Record<string, unknown> = { mime, bytes: bytes.length }
      if (mime.startsWith("image/")) {
        const s = imageSize(bytes, mime)
        if (s) Object.assign(entry, { width: s.w, height: s.h })
      }
      headerOps.push({ op: "setHeader", set: { assets: { ...manifest, [key]: entry } } })
    }
    return { ok: true, ref, key, headerOps }
  }

  const assets: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const action = String(input.action)
    const header = d.store.toHeader()
    const manifest = (header.assets ?? {}) as Record<string, Record<string, unknown>>
    if (action === "list") {
      const used = new Map<string, number>()
      for (const id of d.store.nodeIds()) {
        const s = JSON.stringify(d.store.getNode(id))
        for (const m of s.matchAll(/\.\/assets\/([0-9a-f]{16}\.[a-z0-9]{1,8})/g))
          used.set(m[1] as string, (used.get(m[1] as string) ?? 0) + 1)
      }
      const keys = new Set([...Object.keys(manifest), ...used.keys()])
      const list = [...keys].sort().map((k) => ({
        ref: `./assets/${k}`,
        type: String(manifest[k]?.mime ?? "application/octet-stream"),
        bytes: numberOr(manifest[k]?.bytes, 0),
        usedBy: used.get(k) ?? 0,
      }))
      return done(success({ assets: list }, `${list.length} asset(s).`, { doc: d.ref }))
    }
    if (action === "import") {
      if (typeof input.path !== "string")
        return fail({ code: "INVALID_INPUT", message: "import needs path.", path: "path" })
      if (d.store.readOnly) return fail(readOnlyError(d))
      const r = await ctx.host.readFile(input.path)
      if (!r.ok) return fail(r.error)
      const mime = sniffImage(r.value) ?? sniffFont(r.value)
      if (!mime)
        return fail({ code: "INVALID_INPUT", message: "Not a supported image or font file." })
      const a = await putAsset(ctx, d, r.value, mime, false)
      if (!a.ok) return fail(a.error)
      const entry = { ref: a.ref, type: mime, bytes: r.value.length, usedBy: 0 }
      if (!a.headerOps.length)
        return done(success({ assets: [entry] }, `Already imported as ${a.ref}.`, { doc: d.ref }))
      return commit(ctx, d, input, a.headerOps, {
        label: `Import asset ${basename(input.path)}`,
        created: [],
        data: () => ({ assets: [entry] }),
        summary: () => `Imported ${a.ref}.`,
      })
    }
    if (action === "fonts") {
      const filter = typeof input.family === "string" ? input.family.toLowerCase() : undefined
      const families = new Map<
        string,
        { family: string; source: "document" | "cache" | "local" | "google"; weights: number[] }
      >()
      for (const f of ["Inter", "JetBrains Mono"])
        families.set(f.toLowerCase(), { family: f, source: "cache", weights: [400, 500, 600, 700] })
      for (const f of usedFontFamilies(d.store.toDocument() as never))
        if (!families.has(f)) families.set(f, { family: f, source: "document", weights: [400] })
      const fonts = [...families.values()].filter(
        (f) => !filter || f.family.toLowerCase().includes(filter),
      )
      return done(success({ fonts }, `${fonts.length} font family/families.`, { doc: d.ref }))
    }
    if (action === "check_font") {
      if (typeof input.family !== "string")
        return fail({ code: "INVALID_INPUT", message: "check_font needs family.", path: "family" })
      const loads = await scene.checkFont(
        input.family,
        numberOr(input.weight, 400),
        input.italic === true,
      )
      const warnings: ToolWarning[] =
        loads === null
          ? [{ code: "NO_RENDERER", message: "The font engine is unavailable here." }]
          : []
      return done(
        success(
          { loads: loads === true },
          loads
            ? `${input.family} loads.`
            : `${input.family} does not load; text would use the fallback font.`,
          {
            doc: d.ref,
            warnings,
          },
        ),
      )
    }
    return fail({ code: "UNSUPPORTED", message: `${action} is not available in this version.` })
  }

  const styles: ToolHandler = async (input, ctx): Out => {
    const presets = options.styles ?? BUILTIN_STYLES
    const name = typeof input.name === "string" ? input.name : undefined
    if (!name)
      return done(
        success(
          { presets: presets.map((p) => ({ name: p.name, summary: p.summary })) },
          `${presets.length} style preset(s).`,
        ),
      )
    const preset = presets.find((p) => p.name === name)
    if (!preset)
      return fail({ code: "INVALID_INPUT", message: `Unknown preset ${name}.`, path: "name" })
    const params = (input.params ?? {}) as Record<string, string>
    if (!input.params && input.apply !== true)
      return done(
        success(
          { params: preset.params },
          `${preset.name} takes ${preset.params.length} parameter(s).`,
        ),
      )
    for (const p of preset.params) {
      const v = params[p.name]
      if (v !== undefined && !p.choices.includes(v))
        return fail({
          code: "INVALID_INPUT",
          message: `${p.name} must be one of ${p.choices.join(", ")}.`,
          path: `params.${p.name}`,
        })
    }
    const built = preset.build(params)
    if (input.apply !== true)
      return done(
        success(
          { markdown: built.markdown },
          `${preset.name}: guidance and ${built.variables.length} token(s).`,
        ),
      )
    if (typeof input.docId !== "string")
      return fail({
        code: "INVALID_INPUT",
        message: "apply needs docId (no active-document fallback).",
        path: "docId",
      })
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    if (d.store.readOnly) return fail(readOnlyError(d))
    const base = input.baseRevision as RevisionToken | undefined
    const cur = d.store.revision
    if (base && (base.epoch !== cur.epoch || base.seq !== cur.seq)) return fail(conflict(d, base))
    return commit(
      ctx,
      d,
      input,
      [
        {
          op: "setVariables",
          set: Object.fromEntries(built.variables.map((v) => [v.name, v.variable])) as never,
        },
      ],
      {
        label: `Apply ${preset.name}`,
        created: [],
        data: () => ({ markdown: built.markdown, variables: built.variables.length }),
        summary: () => `Applied ${preset.name}: ${built.variables.length} variable(s).`,
      },
    )
  }

  // --- Output tools ----------------------------------------------------------------------------

  const render: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const ids = input.ids as string[]
    for (const id of ids)
      if (!d.store.getNode(id) && !id.includes("/"))
        return fail({ code: "NODE_NOT_FOUND", message: `Node ${id} does not exist.`, nodeId: id })
    if (input.format === "svg") return renderSvg(d, ids, input, ctx)
    const r = await ctx.host.render(d.ref.id, ids, {
      scale: numberOr(input.scale, 1),
      maxSize: numberOr(input.maxSize, 1600),
      ...(typeof input.background === "string" ? { background: input.background } : {}),
      ...(themeOf(input.theme as never)
        ? { theme: themeOf(input.theme as never) as Record<string, string> }
        : {}),
    })
    if (!r.ok) return fail(r.error)
    const images = r.value.map((img, i) => {
      const [w, h] = pngSize(img.data)
      return { nodeId: img.nodeId ?? (ids[i] as string), width: w, height: h, index: 2 + i }
    })
    return done(
      success(
        { images },
        `Rendered ${images.length} image(s) at revision ${d.store.revision.seq}.`,
        {
          doc: d.ref,
          revision: sameRev(d.store.revision),
        },
      ),
      r.value,
    )
  }

  /** `./assets/<name>` of a document, read through the host (null when unreadable). */
  const assetLoader =
    (d: HostDocument, ctx: ToolContext) =>
    async (src: string): Promise<Uint8Array | null> => {
      if (!/^\.\/assets\/[^\\/]+$/.test(src)) return null
      // A room has no folder: the window that joined it holds its assets.
      if (d.readAsset) return d.readAsset(src)
      if (!/^[\\/]|^[A-Za-z]:/.test(d.ref.path)) return null
      const r = await ctx.host.readFile(joinPath(dirname(d.ref.path), src.slice(2)))
      return r.ok ? r.value : null
    }

  /**
   * Layout + Paragraph measurer + font files for SVG / PDF (ADR 0015): text is laid out with the
   * faces the canvas uses (bundled, document font assets, host font sources), so line breaks
   * match. Falls back to the cached layout when the scene has no export kit.
   */
  async function exportKitFor(
    d: HostDocument,
    ctx: ToolContext,
    theme?: Record<string, string>,
  ): Promise<ExportKit | ToolError> {
    if (scene.exportKit) {
      const k = await scene.exportKit(d.store, assetLoader(d, ctx), theme ? { theme } : {})
      return k.ok ? k.value : k.error
    }
    const layout = await scene.layout(d.store)
    if (!layout)
      return {
        code: "INTERNAL",
        message: "The layout engine is unavailable.",
        retryable: true,
      }
    return {
      layout,
      measureText: approximateMeasurer,
      fonts: () => null,
      assets: () => null,
      exact: false,
    }
  }

  /** `kimo_render format=svg`: `@kimo/exporters` `svgOf` per node, returned as text in `data`. */
  async function renderSvg(d: HostDocument, ids: string[], input: In, ctx: ToolContext): Out {
    const theme = themeOf(input.theme as never) as Record<string, string> | undefined
    const kit = await exportKitFor(d, ctx, theme)
    if ("code" in kit) return fail(kit)
    let doc = d.store.toDocument() as KimoDocument
    if (theme) doc = withRootTheme(doc, theme)
    const ex = await import("@kimo/exporters")
    const ir = ex.buildIR(doc, { libraries: libs(d.ref.id), ids, layout: kit.layout })
    const icons = kit.icons ? await ex.loadIcons(ir, kit.icons as never) : undefined
    const images: { nodeId: string; width: number; height: number; svg: string }[] = []
    for (const id of ids) {
      const root = ir.roots.find((r) => r.id === id)
      const box = kit.layout.nodes.get(id)?.world
      let svg = root
        ? ex.svgOf(ir, root, {
            layout: kit.layout,
            measureText: kit.measureText,
            ...(icons ? { icons } : {}),
          })
        : null
      if (!svg || !box)
        return fail({
          code: "NODE_NOT_FOUND",
          message: `Node ${id} is not on the canvas (or not laid out).`,
          nodeId: id,
        })
      if (typeof input.background === "string" && /^#[0-9a-f]{3,8}$/i.test(input.background))
        svg = svg.replace(
          /(<svg\b[^>]*>)/,
          `$1<rect width="100%" height="100%" fill="${input.background}"/>`,
        )
      images.push({
        nodeId: id,
        width: Math.max(0, Math.ceil(box.w)),
        height: Math.max(0, Math.ceil(box.h)),
        svg,
      })
    }
    const issues = ir.issues.filter((i) => !i.nodeId || ids.includes(i.nodeId))
    return done(
      success({ images }, `Rendered ${images.length} SVG(s) at revision ${d.store.revision.seq}.`, {
        doc: d.ref,
        revision: sameRev(d.store.revision),
        warnings: [
          ...(kit.exact
            ? []
            : [
                {
                  code: "APPROXIMATE_TEXT",
                  message:
                    "CanvasKit is unavailable here: text was measured approximately; line breaks may differ from the canvas.",
                },
              ]),
          ...issues.slice(0, 20).map((i) => ({
            code: i.code,
            message: i.message,
            ...(i.nodeId ? { nodeId: i.nodeId } : {}),
          })),
        ],
      }),
    )
  }

  const exportTool: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const target = String(input.target)
    const code = (CODE_EXPORT_TARGETS as readonly string[]).includes(target)
    if (!code && !(M5_EXPORT_TARGETS as readonly string[]).includes(target))
      return fail({ code: "UNSUPPORTED", message: `Unknown export target ${target}.` })
    // A viewer may export but not duplicate the file (board 41).
    if (target === "kimo" && d.shared?.role === "view")
      return fail({
        code: "UNSUPPORTED",
        message: "A room joined with a view link can't be copied to a .kimo file.",
        suggestion: VIEW_ROOM_SUGGESTION,
      })
    const outDir = typeof input.outDir === "string" ? normalizePath(input.outDir) : null
    if (!outDir && !code)
      return fail({
        code: "INVALID_INPUT",
        message: `${target} export writes files: give outDir.`,
        path: "outDir",
      })
    const ids =
      (input.ids as string[] | undefined) ??
      d.store.children(null).filter((id) => d.store.getNode(id)?.type === "frame")
    if (!ids.length)
      return fail({
        code: "INVALID_INPUT",
        message: "Nothing to export (no ids and no top-level frames).",
      })
    for (const id of ids)
      if (!d.store.getNode(id))
        return fail({ code: "NODE_NOT_FOUND", message: `Node ${id} does not exist.`, nodeId: id })
    const overwrite = input.overwrite === true
    const planned: {
      /** Relative to outDir. */
      name: string
      nodeId?: string
      bytes: () => Promise<Uint8Array | ToolError>
    }[] = []
    let issues: { code: string; message: string; nodeId?: string }[] | undefined
    if (code) {
      // ADR 0015: one IR for every target; SVG/PDF read the committed layout, measured with the
      // canvas's Paragraph and fonts (document font assets, cached fonts), and PDF embeds them.
      let kit: ExportKit | undefined
      if (target === "svg" || target === "pdf") {
        const k = await exportKitFor(d, ctx)
        if ("code" in k)
          return fail({
            ...k,
            message: `${k.message} ${target} export needs the layout.`,
          })
        kit = k
      }
      let result: ExportResult
      try {
        // Lazy: the exporters (and pdf-lib) load on the first code export only.
        const { exportDocument } = await import("@kimo/exporters")
        result = await exportDocument(
          d.store.toDocument() as KimoDocument,
          target as ExportTarget,
          {
            libraries: libs(d.ref.id),
            ids,
            ...(typeof input.variables === "boolean" ? { variables: input.variables } : {}),
            ...(typeof input.components === "boolean" ? { components: input.components } : {}),
            ...(typeof input.layerNames === "boolean" ? { layerNames: input.layerNames } : {}),
            ...(kit
              ? {
                  layout: kit.layout,
                  measureText: kit.measureText,
                  fonts: kit.fonts,
                  assets: kit.assets,
                  ...(kit.icons ? { icons: kit.icons as never } : {}),
                }
              : {}),
          },
        )
      } catch (e) {
        return fail({ code: "INTERNAL", message: `Export failed: ${errorMessage(e)}` })
      }
      issues = result.issues.map((i) => ({
        code: i.code,
        message: i.message,
        ...(i.nodeId ? { nodeId: i.nodeId } : {}),
      }))
      for (const f of result.files) {
        const bytes =
          typeof f.contents === "string" ? new TextEncoder().encode(f.contents) : f.contents
        planned.push({ name: f.path, bytes: async () => bytes })
      }
      if (!outDir) {
        // Inline: nothing touches the disk.
        const files = await Promise.all(
          result.files.map(async (f) => {
            const text = typeof f.contents === "string"
            const bytes = text ? new TextEncoder().encode(f.contents as string) : f.contents
            return {
              path: f.path,
              bytes: (bytes as Uint8Array).byteLength,
              sha256: sha256Hex(bytes as Uint8Array),
              contents: text ? (f.contents as string) : toBase64(f.contents as Uint8Array),
              encoding: text ? ("utf8" as const) : ("base64" as const),
            }
          }),
        )
        return done(
          success({ files, issues }, `Exported ${files.length} ${target} file(s) inline.`, {
            doc: d.ref,
          }),
        )
      }
    } else if (target === "png") {
      const scale = numberOr(input.scale, 2)
      for (const id of ids)
        planned.push({
          name: `${id}.png`,
          nodeId: id,
          bytes: async () => {
            const r = await ctx.host.render(d.ref.id, [id], { scale, maxSize: 4096 * 4 })
            if (!r.ok) return r.error
            return Uint8Array.from(atob((r.value[0] as ToolImage).data), (c) => c.charCodeAt(0))
          },
        })
    } else {
      // A room's path is `kimo-room:<room>`: its file takes the room's name instead.
      const base = isRoomPath(d.ref.path)
        ? nameOf(d)
            .replace(/[\\/:*?"<>|]/g, "-")
            .replace(/\p{Cc}/gu, "")
            .trim() || "Shared file"
        : basename(d.ref.path).replace(/\.kimo$/i, "")
      const name = ids.length === 1 ? ids[0] : `${base}-export`
      planned.push({
        name: `${name}.kimo`,
        bytes: async () => new TextEncoder().encode(serialize(subtreeDocument(d.store, ids))),
      })
    }
    const dir = outDir as string
    // Produce every file first, then the no-overwrite check for the whole batch: a file that
    // already holds the same bytes is unchanged (skipped), a different one is a conflict and
    // nothing is written unless overwrite=true.
    const made: { path: string; nodeId?: string; bytes: Uint8Array; same: boolean }[] = []
    for (const p of planned) {
      const b = await p.bytes()
      if (!(b instanceof Uint8Array)) return fail(b)
      // Every file stays inside outDir, whatever its name says (`..`, absolute names).
      const path = normalizePath(joinPath(dir, p.name))
      if (!path.startsWith(`${dir.replace(/\/+$/, "")}/`))
        return fail({
          code: "INVALID_INPUT",
          message: `${p.name} would be written outside ${dir}; nothing was written.`,
          path: "outDir",
        })
      const existing = await ctx.host.readFile(path)
      const same = existing.ok && sha256Hex(existing.value) === sha256Hex(b)
      if (existing.ok && !same && !overwrite)
        return fail({
          code: "FILE_EXISTS",
          message: `${path} exists with other contents; nothing was written. Pass overwrite=true to replace it.`,
          path: "outDir",
        })
      made.push({ path, bytes: b, same, ...(p.nodeId ? { nodeId: p.nodeId } : {}) })
    }
    const files: {
      path: string
      bytes: number
      sha256: string
      nodeId?: string
      unchanged?: boolean
    }[] = []
    for (const m of made) {
      const node = m.nodeId ? { nodeId: m.nodeId } : {}
      if (m.same) {
        files.push({
          path: m.path,
          bytes: m.bytes.byteLength,
          sha256: sha256Hex(m.bytes),
          ...node,
          unchanged: true,
        })
        continue
      }
      const w = await ctx.host.writeFile(m.path, m.bytes, overwrite)
      if (!w.ok) return fail(w.error)
      files.push({ path: m.path, bytes: w.value.bytes, sha256: w.value.sha256, ...node })
    }
    return done(
      success(
        { files, ...(issues ? { issues } : {}) },
        `Exported ${files.length} file(s) to ${dir}.`,
        { doc: d.ref },
      ),
    )
  }

  // --- kimo_script (ADR 0013 addendum 7) -------------------------------------------------------

  /** The runner of this handler set (a worker in browsers and the desktop host). */
  let runner: ScriptRunner | null = null
  const scriptRunner = () => {
    runner ??= options.scriptRunner ?? defaultScriptRunner()
    return runner
  }
  /** Globals each agent's scripts left for its next ones, by origin (bounded). */
  const carries = new Map<string, { carry: Carry; names: string[] }>()
  const carryOf = (origin: string): Carry => carries.get(origin)?.carry ?? {}
  /** Keeps a landed script's top-level names for the origin's next script. */
  async function keepCarry(origin: string, plan: ScriptPlan, refs: Record<string, string>) {
    const carry = await plan.session.carry(plan.declared, refs)
    carries.delete(origin)
    carries.set(origin, { carry, names: Object.keys(carry) })
    while (carries.size > 32) carries.delete(carries.keys().next().value as string)
  }
  async function worldOf(d: HostDocument): Promise<WorldData> {
    return snapshotWorld(d.store, await scene.layout(d.store))
  }
  streams.deps.script = { runner: scriptRunner, world: worldOf, carry: carryOf }

  /**
   * Runs a script and returns the kimo_apply_ops call it compiles to (dispatch validates and
   * authorizes that call, so approvals, scopes and batch limits see the real ops). A streamed
   * call reuses its stream's world and carried globals, so it yields the ops already applied.
   */
  const compileScript: ScriptCompiler = async (input, ctx) => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return { ok: false, output: d }
    if (d.store.readOnly) return { ok: false, output: fail(readOnlyError(d)) }
    if (typeof input.code !== "string")
      return {
        ok: false,
        output: fail({
          code: "INVALID_INPUT",
          message: "Give code (or retryId with edits to fix a failed script).",
          path: "code",
        }),
      }
    const streamed = ctx.stream instanceof ScriptStream ? ctx.stream.scriptState() : null
    const own = streamed && streamed.docId === d.ref.id ? streamed : null
    const world = own?.world ?? (await worldOf(d))
    const carry = own?.carry ?? carryOf(String(ctx.origin))
    const page = typeof input.page === "string" ? input.page : undefined
    const session = await scriptRunner().open(world, carry, undefined, page)
    const out = await session.run(input.code)
    if (!out.result.ok) {
      session.dispose()
      const line = out.result.line
      return {
        ok: false,
        output: fail(
          {
            code: "INVALID_INPUT",
            message: `${line ? `line ${line}: ` : ""}${out.result.message}`,
            path: "code",
            ...(line ? { detail: { kind: "script", line, prints: out.prints.slice(-10) } } : {}),
            suggestion:
              "Fix the script: {docId, retryId, edits: [{find, replace}]} patches its code.",
          },
          { revision: sameRev(d.store.revision) },
        ),
      }
    }
    const call: In = {
      docId: input.docId,
      ops: out.ops,
      ...(input.baseRevision ? { baseRevision: input.baseRevision } : {}),
      ...(input.render === true ? { render: true } : {}),
      ...(input.dryRun === true ? { dryRun: true } : {}),
      ...(typeof input.label === "string" ? { label: input.label } : {}),
    }
    return {
      ok: true,
      plan: {
        call,
        lines: out.lines,
        prints: out.prints,
        names: out.names,
        declared: [
          ...(carries.get(String(ctx.origin))?.names ?? []),
          ...(await import("../script/statements")).topLevelNames(input.code),
        ],
        session,
        dispose: () => session.dispose(),
      },
    }
  }

  const script: ToolHandler = async (input, ctx): Out => {
    let plan = (input as { [SCRIPT_PLAN]?: ScriptPlan })[SCRIPT_PLAN]
    const own = !plan
    if (!plan) {
      // Called directly (not through dispatch): compile and check the ops here.
      const c = await compileScript(input, ctx)
      if (!c.ok) return c.output
      plan = c.plan
      const applyDef = toolByName("kimo_apply_ops") as ToolDef
      const invalid = options.validate?.(applyDef, plan.call) ?? []
      if (invalid.length) {
        plan.dispose()
        return fail(invalid.slice(0, MAX_ERRORS).map((e) => scriptLine(e, plan?.lines ?? [])))
      }
      // Without dispatch nobody asked or checked node scopes: only what needs neither runs.
      const auth = authorize(applyDef, plan.call, ctx, {})
      if (auth.kind !== "allow" || ctx.policy.nodes.length) {
        plan.dispose()
        return fail({
          code: "PERMISSION_DENIED",
          message: "These ops need approval or a scope check: run kimo_script through dispatch.",
        })
      }
    }
    try {
      const wire = plan.call.ops as WireOp[]
      const d = docOrFail(ctx, input)
      if (isOutput(d)) return d
      if (!wire.length && plan.call.dryRun !== true) {
        // Nothing to apply (a script that only read and printed): no op group, no undo step.
        if (ctx.stream) ctx.stream.close("The script made no ops.")
        await keepCarry(String(ctx.origin), plan, {})
        return done(
          success(
            {
              applied: 0,
              inserted: 0,
              updated: 0,
              deleted: 0,
              notes: [],
              names: [],
              prints: plan.prints,
            },
            `No ops. ${plan.prints.length} printed line(s).`,
            { doc: d.ref, revision: sameRev(d.store.revision) },
          ),
        )
      }
      const out = await applyOps(plan.call, ctx)
      const res = out.result
      const lines = plan.lines
      if (!res.ok)
        return { ...out, result: { ...res, errors: res.errors.map((e) => scriptLine(e, lines)) } }
      const created = (res as { created?: { key: string; id: string }[] }).created ?? []
      const refs: Record<string, string> = {}
      for (const c of created) refs[c.key] = c.id
      const names: { name: string; id: string }[] = []
      const seen = new Set<string>()
      for (const [key, name] of plan.names) {
        const id = refs[key]
        if (!id || seen.has(name)) continue
        seen.add(name)
        names.push({ name, id })
        if (names.length >= SCRIPT_MAX_NAMES) break
      }
      if (!res.dryRun) await keepCarry(String(ctx.origin), plan, refs)
      // The script's keys (s1, s2, …) mean nothing to the agent: names and ids instead.
      const { created: _c, ...rest } = res as typeof res & { created?: unknown }
      const data = {
        ...(res.data as object),
        names,
        ...(plan.prints.length ? { prints: plan.prints } : {}),
      }
      return {
        ...out,
        label: typeof input.label === "string" ? input.label : `Script (${wire.length} ops)`,
        result: {
          ...rest,
          data,
          summary: res.summary.replace(/^(Dry run: would apply|Applied)/, "$1 the script's"),
        },
      }
    } finally {
      if (own) plan.dispose()
    }
  }

  const map: Record<string, ToolHandler> & { [STREAM_ENGINE]?: StreamEngine } = {
    kimo_get_state: getState,
    kimo_read_docs: readDocs,
    kimo_open: open,
    kimo_query: query,
    kimo_apply_ops: applyOps,
    kimo_render: render,
    kimo_get_variables: getVariables,
    kimo_list_components: listComponents,
    kimo_find_space: findSpace,
    kimo_validate: validateTool,
    kimo_history: history,
    kimo_save: save,
    kimo_focus: focus,
    kimo_import: importTool,
    kimo_assets: assets,
    kimo_export: exportTool,
    kimo_create: create,
    kimo_close: close,
    kimo_styles: styles,
    kimo_script: script,
  }
  map[STREAM_ENGINE] = streams
  ;(map as { [SCRIPT_COMPILER]?: ScriptCompiler })[SCRIPT_COMPILER] = compileScript
  return map
}

/** Where a handler set keeps its {@link StreamEngine} (see {@link streamEngineOf}). */
export const STREAM_ENGINE: unique symbol = Symbol.for("kimo.streamEngine")

/** The streamed-edit engine of a handler set (undefined for hand-made handler sets). */
export function streamEngineOf(handlers: object): StreamEngine | undefined {
  return (handlers as { [STREAM_ENGINE]?: StreamEngine })[STREAM_ENGINE]
}

// --- Misc --------------------------------------------------------------------------------------

function randomNodeId(): string {
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const b = new Uint8Array(10)
  globalThis.crypto.getRandomValues(b)
  let s = ""
  for (const x of b) s += A[x % 62]
  return s
}

/** Width/height from a base64 PNG's IHDR. */
function pngSize(b64: string): [number, number] {
  const head = atob(b64.slice(0, 44))
  const u = (i: number) =>
    ((head.charCodeAt(i) << 24) |
      (head.charCodeAt(i + 1) << 16) |
      (head.charCodeAt(i + 2) << 8) |
      head.charCodeAt(i + 3)) >>>
    0
  return [u(16), u(20)]
}

/** A standalone document holding the subtrees `ids` and the variables/axes they use. */
export function subtreeDocument(store: DocStore, ids: readonly string[]): KimoDocument {
  const full = store.toDocument()
  const nodes: Record<string, unknown> = {}
  const add = (id: string, root: boolean) => {
    const n = store.getNode(id)
    if (!n || nodes[id]) return
    nodes[id] = root ? { ...n, parent: null } : { ...n }
    for (const c of store.nodeIds()) if (store.getNode(c)?.parent === id) add(c, false)
  }
  for (const id of ids) add(id, true)
  const used = new Set<string>()
  const text = JSON.stringify(nodes)
  for (const m of text.matchAll(/"\$ref":"([^"]+)"/g)) used.add(m[1] as string)
  const vars = (full.variables ?? {}) as Record<string, unknown>
  // Follow aliases.
  const queue = [...used]
  while (queue.length) {
    const n = queue.pop() as string
    const s = JSON.stringify(vars[n] ?? null)
    for (const m of s.matchAll(/"\$ref":"([^"]+)"/g))
      if (!used.has(m[1] as string)) {
        used.add(m[1] as string)
        queue.push(m[1] as string)
      }
  }
  const out: KimoDocument = { $schema: full.$schema, format: full.format, nodes: nodes as never }
  const picked = Object.fromEntries(Object.entries(vars).filter(([k]) => used.has(k)))
  if (Object.keys(picked).length) out.variables = picked as never
  if (full.themes) out.themes = full.themes
  if (full.features) out.features = full.features
  if (full.meta) out.meta = full.meta
  return out
}

/** A small built-in preset (more presets arrive with the styles content). */
export const BUILTIN_STYLES: readonly StylePreset[] = [
  {
    name: "kimo-basic",
    summary: "Neutral surfaces, one accent color, 4 px spacing scale and two radii.",
    params: [
      { name: "palette", choices: ["indigo", "emerald", "rose", "slate"] },
      { name: "mode", choices: ["light", "dark"] },
    ],
    build(p) {
      const accent = { indigo: "#4F46E5", emerald: "#059669", rose: "#E11D48", slate: "#334155" }[
        p.palette ?? "indigo"
      ] as string
      const dark = p.mode === "dark"
      const variables = [
        { name: "color/accent", variable: { type: "color", value: accent, group: "color" } },
        {
          name: "color/surface",
          variable: { type: "color", value: dark ? "#0B0B0F" : "#FFFFFF", group: "color" },
        },
        {
          name: "color/text",
          variable: { type: "color", value: dark ? "#F5F5F5" : "#111111", group: "color" },
        },
        {
          name: "color/muted",
          variable: { type: "color", value: dark ? "#A1A1AA" : "#6B7280", group: "color" },
        },
        { name: "space/1", variable: { type: "number", value: 4, group: "space" } },
        { name: "space/2", variable: { type: "number", value: 8, group: "space" } },
        { name: "space/4", variable: { type: "number", value: 16, group: "space" } },
        { name: "radius/sm", variable: { type: "number", value: 4, group: "radius" } },
        { name: "radius/md", variable: { type: "number", value: 8, group: "radius" } },
      ]
      return {
        markdown: `# kimo-basic (${p.palette ?? "indigo"}, ${dark ? "dark" : "light"})\n\nUse color/surface for frames, color/text for text, color/accent for one primary action per screen. Spacing steps space/1–4; radius/md for cards and buttons.`,
        variables,
      }
    },
  },
]

/** The document with `theme` merged into every top-level node's pinned theme (themed renders). */
function withRootTheme(doc: KimoDocument, theme: Record<string, string>): KimoDocument {
  const nodes = (doc as unknown as { nodes: Record<string, Record<string, unknown>> }).nodes
  const out: Record<string, Record<string, unknown>> = {}
  for (const [id, n] of Object.entries(nodes))
    out[id] =
      n.parent == null
        ? { ...n, theme: { ...((n.theme as Record<string, string> | undefined) ?? {}), ...theme } }
        : n
  return { ...doc, nodes: out } as unknown as KimoDocument
}

/** At most this many errors in a failed commit (the rest are counted in the summary). */
const MAX_ERRORS = 5
/** Max entries of a script result's name table (it reaches the model's next call). */
const SCRIPT_MAX_NAMES = 80

/** Features `kimo_apply_ops` declares on its own: every gate but stored merge conflicts. */
const AUTO_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  "layout/wrap",
  "layout/stretch-baseline",
  "size/min-max",
  "text/runs",
  "tokens/composite",
  "fill/mesh",
  "fill/shader",
])

/**
 * The gated features compiled store ops write (spec §13): node bodies of inserts, field values
 * of updates (walked with their field as key), composite variable types. Same gate table as the
 * validator (`featuresNeeded`), so an edit never fails with FEATURE_NOT_DECLARED for a gate it
 * can declare itself.
 */
export function featuresWrittenBy(ops: readonly unknown[]): Set<Feature> {
  const out = new Set<Feature>()
  const add = (s: Iterable<Feature>) => {
    for (const f of s) if (AUTO_FEATURES.has(f)) out.add(f)
  }
  for (const raw of ops) {
    const o = raw as { op?: string; node?: unknown; set?: Record<string, unknown> }
    if (o.op === "insert") add(featuresNeeded(o.node))
    else if (o.op === "update" && o.set)
      for (const [k, v] of Object.entries(o.set)) add(featuresNeeded(v, k))
    else if (o.op === "setVariables" && o.set)
      for (const v of Object.values(o.set))
        if (COMPOSITE_VARIABLE_TYPES.has((v as { type?: never })?.type as never))
          out.add("tokens/composite")
  }
  return out
}
