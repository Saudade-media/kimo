/**
 * The 20 tool handlers over a `DocumentHost` (ADR 0013 §2), one function per tool. Each one
 * returns exactly one envelope; nothing throws past the dispatcher. Mutations are single
 * `DocStore.apply` op groups with the caller's origin (`ctx.origin`), so undo, attribution and
 * revisions work the same for every surface (MCP, M6 agent, CLI).
 */
import {
  declaredProps,
  instancesOf,
  isObject,
  isRef,
  isThemedValue,
  type KimoDocument,
  type Libraries,
  localComponents,
  resolveVariable,
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
import type { HandlerOutput, HostDocument, ToolContext, ToolHandler } from "../runtime"
import { CODE_EXPORT_TARGETS, M5_EXPORT_TARGETS } from "../tools/output"
import { compileWireOps, touchedIds, wirePath } from "./compile"
import type { CoreDocumentHost } from "./core-host"
import { EXTENSION, imageSize, parseCssTokens, parseDtcg, sniffFont, sniffImage } from "./importers"
import { journalFor } from "./journal"
import { runQuery } from "./query"
import { createSceneService, type SceneService } from "./scene"
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
}

const asLocal = (o: ToolContext["origin"]) => o as LocalOrigin

function nameOf(d: HostDocument): string {
  const meta = d.store.toHeader().meta as Record<string, unknown> | undefined
  return typeof meta?.name === "string" ? meta.name : basename(d.ref.path).replace(/\.kimo$/i, "")
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
    suggestion: "Export a copy with kimo_export target=kimo, or open a writable document.",
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

export function createToolHandlerMap(
  hostScene: SceneService | undefined,
  options: ToolHandlerOptions,
): Record<string, ToolHandler> {
  const scene = options.scene ?? hostScene ?? createSceneService()
  const tokens = new Map<string, UndoRecord>()
  const libs = (docId: string): Libraries => options.libraries?.(docId) ?? {}

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
    meta: {
      label: string
      wireIndex?: number[]
      created?: { key: string; id: string }[]
      notes?: { code: string; message: string; nodeId?: string }[]
      data?: (r: { inserted: number; updated: number; deleted: number }) => Record<string, unknown>
      summary: (r: {
        inserted: number
        updated: number
        deleted: number
        dryRun: boolean
      }) => string
      render?: boolean
    },
  ): Promise<HandlerOutput> {
    const before = d.store.revision
    const base = input.baseRevision as RevisionToken | undefined
    const dryRun = input.dryRun === true
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
      return fail(errors, { revision: sameRev(r.revision) })
    }
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
      created: meta.created ?? r.created.map((id) => ({ key: id, id })),
      changed,
      warnings,
      dryRun,
    }
    if (undoToken) extra.undoToken = undoToken
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
    const data = meta.data ? meta.data(counts) : { ...counts }
    return {
      ...done(success(data, meta.summary({ ...counts, dryRun }), extra), images),
      label: typeof input.label === "string" ? input.label : meta.label,
    }
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
          ? `${n} open document${n === 1 ? "" : "s"}: ${documents.map((x) => `${x.name} (${x.doc.id})`).join(", ")}.`
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
    const format = core.formatOf?.(d.ref.id) ?? "0.1"
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
        if (rec.store === store && rec.origin === origin)
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
    if (action === "undo" && typeof input.token === "string") {
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
      if (store.topUndo(origin) !== rec.top)
        return fail(
          {
            code: "REVISION_CONFLICT",
            message: "That edit is no longer on top of your undo stack; nothing was undone.",
            path: "token",
            detail: { kind: "undo", current: toToken(before) },
            suggestion: "Call kimo_history action=list to see your recent edits.",
          },
          { revision: sameRev(before) },
        )
    }
    const res = action === "undo" ? store.undo(origin) : store.redo(origin)
    if (!res.ok && !res.stale)
      return fail(
        {
          code: "INVALID_INPUT",
          message: `Nothing to ${action} on your undo stack (other clients' and the user's edits are never undone).`,
        },
        { revision: sameRev(before) },
      )
    if (action === "undo" && typeof input.token === "string") tokens.delete(input.token)
    return done(
      success(
        { stale: res.stale, canUndo: store.canUndo(origin), canRedo: store.canRedo(origin) },
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
    if (ids?.length) {
      const scope = new Set<string>()
      const walk = (id: string) => {
        scope.add(id)
        for (const c of d.store.children(id)) walk(c)
      }
      for (const id of ids) walk(id)
      const keep = (w: ToolWarning) => w.nodeId !== undefined && scope.has(w.nodeId)
      errors = errors.filter(keep)
      warnings = warnings.filter(keep)
    }
    return done(
      success(
        { valid: errors.length === 0, errors, warnings },
        `${errors.length} error(s), ${warnings.length} warning(s).`,
        { doc: d.ref, revision: sameRev(d.store.revision) },
      ),
    )
  }

  // --- Write tools -----------------------------------------------------------------------------

  const applyOps: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    if (d.store.readOnly) return fail(readOnlyError(d), { revision: sameRev(d.store.revision) })
    const base = input.baseRevision as RevisionToken | undefined
    const cur = d.store.revision
    if (base && (base.epoch !== cur.epoch || base.seq !== cur.seq))
      return fail(conflict(d, base), { revision: sameRev(cur) })
    const wire = input.ops as WireOp[]
    const compiled = compileWireOps(d.store, wire, { libraries: libs(d.ref.id) })
    if (!compiled.ok) return fail(compiled.errors, { revision: sameRev(cur) })
    return commit(ctx, d, input, compiled.ops as unknown as Op[], {
      label: `${wire.length} op${wire.length === 1 ? "" : "s"}`,
      wireIndex: compiled.wireIndex,
      created: compiled.created,
      notes: compiled.notes,
      render: input.render === true,
      data: (c) => ({ applied: wire.length, ...c, notes: compiled.notes }),
      summary: (c) =>
        `${c.dryRun ? "Dry run: would apply" : "Applied"} ${wire.length} op(s): ${c.inserted} inserted, ${c.updated} updated, ${c.deleted} deleted.`,
    })
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
    if (input.format === "svg")
      return fail({
        code: "UNSUPPORTED",
        message: "SVG renders arrive with code export (M7).",
        suggestion: "Use format png.",
      })
    const ids = input.ids as string[]
    for (const id of ids)
      if (!d.store.getNode(id) && !id.includes("/"))
        return fail({ code: "NODE_NOT_FOUND", message: `Node ${id} does not exist.`, nodeId: id })
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

  const exportTool: ToolHandler = async (input, ctx): Out => {
    const d = docOrFail(ctx, input)
    if (isOutput(d)) return d
    const target = String(input.target)
    const code = (CODE_EXPORT_TARGETS as readonly string[]).includes(target)
    if (!code && !(M5_EXPORT_TARGETS as readonly string[]).includes(target))
      return fail({ code: "UNSUPPORTED", message: `Unknown export target ${target}.` })
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
      // ADR 0015: one IR for every target; SVG/PDF read the committed layout.
      const layout = target === "svg" || target === "pdf" ? await scene.layout(d.store) : undefined
      if (layout === null)
        return fail({
          code: "INTERNAL",
          message: `The layout engine is unavailable; ${target} export needs it.`,
          retryable: true,
        })
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
            ...(layout ? { layout } : {}),
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
      const name =
        ids.length === 1 ? ids[0] : `${basename(d.ref.path).replace(/\.kimo$/i, "")}-export`
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
      const path = joinPath(dir, p.name)
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

  const script: ToolHandler = async () =>
    fail({
      code: "UNSUPPORTED",
      message: "kimo_script is not available in this version.",
      suggestion: "Use kimo_apply_ops (up to 500 ops per call with @key references).",
    })

  return {
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
