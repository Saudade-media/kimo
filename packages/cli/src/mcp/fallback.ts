/**
 * STOPGAP headless document host + minimal tool handlers for `kimo mcp --headless`.
 *
 * `kimo mcp` uses builder 2's `createMemoryDocumentHost` + `createToolHandlers` (ADR 0013 §12
 * item 2). This stopgap runs only with KIMO_MCP_HOST=fallback (debugging) and can be deleted.
 *
 * Implemented here: kimo_get_state, kimo_read_docs, kimo_open, kimo_apply_ops (low-level ops:
 * insert/update/move/delete/set_variables/set_theme_axes, with @key), kimo_save, kimo_close,
 * kimo_create. Every other tool answers UNSUPPORTED.
 */
import { createHash } from "node:crypto"
import {
  createEmptyDocument,
  type DocStore,
  generateId,
  importDocument,
  KimoParseError,
  type Op,
  openDocument,
  sameRevision,
  serialize,
} from "@kimo/editor-state"
import {
  type DocRef,
  type DocumentHost,
  decideOpen,
  failure,
  formatDocId,
  type HostDocument,
  type HostResult,
  type RevisionToken,
  readGuide,
  success,
  type ToolError,
  type ToolHandler,
  type ToolHandlers,
  toStoreOp,
  type WireOp,
} from "@kimo/mcp-server"
import type { KimoPlatform, Lease } from "@kimo/platform"
import { pathHash } from "../io"
import { canonical } from "./node-platform"

interface Entry {
  path: string
  store: DocStore
  epoch: string
  lease: Lease | null
  readOnlyReason?: string
  format: string
  lastSaved?: RevisionToken
}

const alnum = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 32) || "0"
const err = (code: ToolError["code"], message: string, extra: Partial<ToolError> = {}) => ({
  ok: false as const,
  error: { code, message, ...extra },
})

export interface FallbackHost extends DocumentHost {
  /** Paths and stores of documents with unsaved edits. */
  dirty(): HostDocument[]
  /** Releases every lease (process exit). */
  dispose(): Promise<void>
}

export function createFallbackHost(platform: KimoPlatform): FallbackHost {
  const docs = new Map<string, Entry>()
  const docIdOf = (e: Entry) => formatDocId(pathHash(e.path), alnum(e.store.revision.epoch))
  const refOf = (e: Entry): DocRef => ({
    id: docIdOf(e),
    path: e.path,
    dirty: !e.lastSaved || !sameRevision(e.lastSaved, e.store.revision),
    readOnly: e.store.readOnly !== null,
    ...(e.lastSaved ? { lastSavedRevision: { ...e.lastSaved } } : {}),
  })
  const view = (e: Entry): HostDocument => ({ ref: refOf(e), store: e.store, shownInWindow: false })
  const find = (docId: string): Entry | null => {
    for (const e of docs.values()) if (docIdOf(e) === docId) return e
    return null
  }
  const byPath = (path: string) => docs.get(path) ?? null

  const load = async (
    path: string,
    readOnly: boolean,
  ): Promise<HostResult<HostDocument & { alreadyOpen: boolean }>> => {
    const open = byPath(path)
    if (open) return { ok: true, value: { ...view(open), alreadyOpen: true } }
    const st = await platform.files.stat(path)
    if (!st) return err("FILE_NOT_FOUND", `${path} does not exist.`)
    let text: string
    try {
      text = (await platform.files.readText(path)).text
    } catch (e) {
      return err("LOAD_FAILED", (e as Error).message)
    }
    let opened: ReturnType<typeof openDocument>
    try {
      opened = openDocument(text)
    } catch (e) {
      const msg = e instanceof KimoParseError ? e.message : String(e)
      return err("LOAD_FAILED", `${path} is not a valid .kimo file: ${msg}`, {
        suggestion: "The file was not changed. Fix it by hand or restore it from git.",
      })
    }
    const formatReason = opened.readOnly
      ? opened.readOnlyReasons.map((r) => r.message).join("; ")
      : undefined
    const holder = readOnly ? null : await platform.leases.inspect(path)
    const decision = decideOpen({
      host: "headless",
      alreadyOpen: false,
      readOnly: readOnly || opened.readOnly,
      holder: holder && {
        pid: holder.pid,
        app: holder.app,
        appLabel: holder.appLabel,
        alive: holder.alive,
        self: holder.self,
      },
    })
    if (decision.action === "refuse")
      return err(
        decision.code,
        `${path} is locked by ${decision.holder?.appLabel ?? "another app"}.`,
        {
          suggestion: decision.suggestion,
          detail: { kind: "lock", holder: decision.holder },
        },
      )
    let lease: Lease | null = null
    if (decision.action === "open-writable") {
      const r = await platform.leases.acquire(path, { reclaimStale: true })
      if (!r.ok)
        return err("DOCUMENT_LOCKED", `${path} is locked by ${r.holder.appLabel}.`, {
          detail: { kind: "lock", holder: r.holder },
        })
      lease = r.lease
    }
    let store: DocStore
    try {
      store = importDocument(opened.doc, { load: { validate: false } })
    } catch (e) {
      if (lease) await platform.leases.release(lease)
      return err("LOAD_FAILED", (e as Error).message)
    }
    const reason = formatReason ?? (lease ? undefined : readOnly ? "opened read-only" : undefined)
    if (reason) store.setReadOnly(reason)
    const entry: Entry = {
      path,
      store,
      epoch: store.revision.epoch,
      lease,
      format: opened.sourceFormat ?? "unknown",
      lastSaved: { ...store.revision },
      ...(reason ? { readOnlyReason: reason } : {}),
    }
    docs.set(path, entry)
    return { ok: true, value: { ...view(entry), alreadyOpen: false } }
  }

  const host: FallbackHost = {
    kind: "headless",
    list: () => [...docs.values()].map(view),
    get(docId) {
      const e = find(docId)
      if (e) return { ok: true, value: view(e) }
      return err("DOCUMENT_NOT_OPEN", `No open document ${docId}.`, {
        suggestion: "Call kimo_get_state for open docIds, or kimo_open the file.",
      })
    },
    open: (path, o) => load(canonical(path), o.readOnly),
    async create(path, o) {
      const p = canonical(path)
      if (await platform.files.stat(p)) return err("FILE_EXISTS", `${p} already exists.`)
      const text = serialize(createEmptyDocument(o.name))
      await platform.files.writeTextAtomic(p, text, { mkdirs: true })
      const r = await load(p, false)
      return r.ok ? { ok: true, value: r.value } : r
    },
    async close(docId, o) {
      const e = find(docId)
      if (!e) return err("DOCUMENT_NOT_OPEN", `No open document ${docId}.`)
      let saved = false
      if (refOf(e).dirty && !o.discard) {
        if (!o.save)
          return err("INVALID_INPUT", "The document has unsaved edits.", {
            suggestion: "Pass save: true or discard: true.",
          })
        const s = await host.save(docId)
        if (!s.ok) return s
        saved = true
      }
      docs.delete(e.path)
      if (e.lease) await platform.leases.release(e.lease)
      e.store.destroy()
      return { ok: true, value: { closed: true, saved } }
    },
    async save(docId, baseRevision) {
      const e = find(docId)
      if (!e) return err("DOCUMENT_NOT_OPEN", `No open document ${docId}.`)
      if (e.store.readOnly || !e.lease)
        return err("READ_ONLY", `${e.path} is read-only (${e.readOnlyReason ?? "no lease"}).`)
      if (baseRevision && !sameRevision(baseRevision, e.store.revision))
        return err("REVISION_CONFLICT", "The document changed since baseRevision.", {
          detail: { kind: "revision", current: { ...e.store.revision }, changed: [] },
        })
      const revision = { ...e.store.revision }
      const text = serialize(e.store.toDocument())
      try {
        const w = await platform.files.writeTextAtomic(e.path, text)
        const st = await platform.files.stat(e.path)
        e.lastSaved = revision
        return {
          ok: true,
          value: {
            path: e.path,
            bytes: w.bytes,
            sha256: w.hash,
            mtimeMs: st?.mtimeMs ?? Date.now(),
            savedRevision: revision,
          },
        }
      } catch (x) {
        return err("INTERNAL", `Save failed: ${(x as Error).message}`, { retryable: true })
      }
    },
    async render() {
      return err("UNSUPPORTED", "Rendering is not available in this headless build yet.", {
        suggestion: "Open the file in the Kimo app and connect through it to render.",
      })
    },
    async focus() {
      return { ok: true, value: { shown: false } }
    },
    selection: () => [],
    async readFile(path) {
      try {
        return { ok: true, value: await platform.files.readBytes(path) }
      } catch (e) {
        return err("FILE_NOT_FOUND", (e as Error).message)
      }
    },
    async writeFile(path, bytes, overwrite) {
      if (!overwrite && (await platform.files.stat(path)))
        return err("FILE_EXISTS", `${path} already exists.`)
      const w = await platform.files.writeBytesAtomic(path, bytes, { mkdirs: true })
      return { ok: true, value: { bytes: w.bytes, sha256: w.hash } }
    },
    canonicalPath: async (path) => canonical(path),
    dirty: () => [...docs.values()].filter((e) => refOf(e).dirty && e.lease).map(view),
    async dispose() {
      for (const e of docs.values()) if (e.lease) await platform.leases.release(e.lease)
      docs.clear()
    },
  }
  return host
}

// --- Minimal handlers --------------------------------------------------------------------------

const LOW_LEVEL = new Set(["insert", "update", "move", "delete", "set_variables", "set_theme_axes"])

export function createFallbackHandlers(host: DocumentHost): ToolHandlers {
  const unsupported: ToolHandler = async (input) => {
    if (typeof input.docId === "string") {
      const g = host.get(input.docId)
      if (!g.ok) return { result: failure(g.error) }
    }
    return {
      result: failure({
        code: "UNSUPPORTED",
        message: "Not available in this headless build yet.",
        suggestion:
          "Connect through the Kimo app (kimo mcp without --headless) for the full tool set.",
      }),
    }
  }
  const rev = (d: HostDocument) => ({ ...d.store.revision })
  const handlers: Partial<Record<string, ToolHandler>> = {
    async kimo_get_state(input, ctx) {
      const docs = typeof input.docId === "string" ? [host.get(input.docId)] : null
      if (docs?.[0] && !docs[0].ok) return { result: failure(docs[0].error) }
      const list = docs ? [(docs[0] as { value: HostDocument }).value] : host.list()
      const documents = list.map((d) => {
        const top = d.store.children(null)
        const header = d.store.toHeader()
        return {
          doc: d.ref,
          revision: rev(d),
          ...(header.meta?.name ? { name: header.meta.name } : {}),
          selection: [],
          topLevel: top.slice(0, 50).map((id) => {
            const n = d.store.getNode(id) as unknown as Record<string, unknown>
            return {
              id,
              type: String(n.type),
              ...(typeof n.name === "string" ? { name: n.name } : {}),
              ...(n.visible === false ? { visible: false } : {}),
            }
          }),
          topLevelCount: top.length,
          components: d.store
            .nodeIds()
            .filter((id) => (d.store.getNode(id) as { component?: unknown }).component)
            .slice(0, 100)
            .map((id) => ({
              id,
              name: String((d.store.getNode(id) as { name?: string }).name ?? id),
            })),
          variables: {
            count: Object.keys(header.variables ?? {}).length,
            axes: Object.entries(header.themes ?? {}).map(([axis, values]) => ({ axis, values })),
          },
          agents: [],
        }
      })
      return {
        result: success(
          {
            app: { mode: "headless" as const, version: "0.0.0", windows: 0 },
            documents,
            you: {
              origin: ctx.origin,
              level: ctx.policy.level,
              files: ctx.policy.files,
              grants: ctx.policy.grants,
            },
          },
          `${documents.length} open document(s), headless.`,
        ),
      }
    },
    async kimo_read_docs(input) {
      const g = readGuide(typeof input.path === "string" ? input.path : undefined)
      if (!g) return { result: failure({ code: "INVALID_INPUT", message: "Unknown guide." }) }
      return {
        result: success({ path: g.path, markdown: g.markdown, related: g.related }, g.title),
      }
    },
    async kimo_open(input) {
      const r = await host.open(String(input.path), { readOnly: input.readOnly === true })
      if (!r.ok) return { result: failure(r.error) }
      const d = r.value
      return {
        result: success(
          {
            doc: d.ref,
            revision: rev(d),
            alreadyOpen: d.alreadyOpen,
            format: String(d.store.toHeader().format ?? ""),
            ...(d.ref.readOnly ? { readOnlyReason: d.store.readOnly?.reason ?? "read-only" } : {}),
          },
          `${d.alreadyOpen ? "Already open" : "Opened"} ${d.ref.path} as ${d.ref.id}.`,
          { doc: d.ref, revision: { before: rev(d), after: rev(d) } },
        ),
      }
    },
    async kimo_apply_ops(input, ctx) {
      const g = host.get(String(input.docId))
      if (!g.ok) return { result: failure(g.error) }
      const d = g.value
      const wire = input.ops as WireOp[]
      const keys = new Map<string, string>()
      const created: { key: string; id: string }[] = []
      const ops: Op[] = []
      try {
        for (const [i, w] of wire.entries()) {
          if (!LOW_LEVEL.has(w.op))
            return {
              result: failure({
                code: "UNSUPPORTED",
                message: `${w.op} is not available in this headless build yet.`,
                path: `ops[${i}]`,
              }),
            }
          const resolve = (ref: string) => {
            if (!ref.startsWith("@")) return ref
            const id = keys.get(ref.slice(1))
            if (!id) throw Object.assign(new Error(`Unknown key ${ref}`), { at: i, ref })
            return id
          }
          let fresh: string | null = null
          const op = toStoreOp(w as never, resolve, () => {
            fresh = generateId()
            return fresh
          })
          if (fresh && "key" in w && typeof w.key === "string") {
            keys.set(w.key, fresh)
            created.push({ key: w.key, id: fresh })
          } else if (fresh) {
            created.push({
              key: String((w as { node?: { name?: string } }).node?.name ?? fresh),
              id: fresh,
            })
          }
          ops.push(op)
        }
      } catch (e) {
        const x = e as { at?: number; ref?: string; message: string }
        return {
          result: failure({
            code: "NODE_NOT_FOUND",
            message: x.message,
            ...(x.at !== undefined ? { path: `ops[${x.at}]` } : {}),
          }),
        }
      }
      const before = rev(d)
      const r = d.store.apply(ops, {
        origin: ctx.origin as never,
        ...(typeof input.label === "string" ? { label: input.label } : {}),
        ...(input.baseRevision ? { baseRevision: input.baseRevision as RevisionToken } : {}),
        ...(input.dryRun === true ? { dryRun: true } : {}),
      })
      if (!r.ok)
        return {
          result: failure(
            r.errors.map((e) => ({
              code: e.code === "INVALID_OP" || e.code === "INVALID_ID" ? "INVALID_INPUT" : e.code,
              message: e.message,
              ...(e.path ? { path: e.path } : {}),
              ...(e.nodeId ? { nodeId: e.nodeId } : {}),
              ...(e.code === "REVISION_CONFLICT"
                ? { detail: { kind: "revision", current: { ...r.revision }, changed: [] } }
                : {}),
            })),
            { revision: { before, after: { ...r.revision } } },
          ),
        }
      const ref = host.get(String(input.docId))
      const docRef = ref.ok ? ref.value.ref : d.ref
      return {
        result: success(
          {
            applied: ops.length,
            inserted: r.created.length,
            updated: r.ops.filter((o) => o.op === "update" || o.op === "move").length,
            deleted: r.deleted.length,
            notes: [] as string[],
          },
          `${r.dryRun ? "Dry run: " : ""}${ops.length} op(s) applied.`,
          {
            doc: docRef,
            revision: { before: { ...r.before }, after: { ...r.revision } },
            ops: r.ops as unknown as Record<string, unknown>[],
            inverse: r.inverse as unknown as Record<string, unknown>[],
            created,
            changed: [
              ...new Set(r.ops.map((o) => (o as { id?: string }).id).filter(Boolean)),
            ] as string[],
            dryRun: r.dryRun,
            warnings: r.warnings.map((w) => ({ code: w.code, message: w.message })),
          },
        ),
      }
    },
    async kimo_save(input) {
      const r = await host.save(
        String(input.docId),
        input.baseRevision as RevisionToken | undefined,
      )
      if (!r.ok) return { result: failure(r.error) }
      const g = host.get(String(input.docId))
      return {
        result: success(r.value, `Saved ${r.value.path} (${r.value.bytes} bytes, verified).`, {
          ...(g.ok ? { doc: g.value.ref } : {}),
        }),
      }
    },
    async kimo_close(input) {
      const r = await host.close(String(input.docId), {
        save: input.save === true,
        discard: input.discard === true,
      })
      if (!r.ok) return { result: failure(r.error) }
      return { result: success(r.value, r.value.saved ? "Saved and closed." : "Closed.") }
    },
    async kimo_create(input) {
      const r = await host.create(String(input.path), {
        ...(typeof input.name === "string" ? { name: input.name } : {}),
      })
      if (!r.ok) return { result: failure(r.error) }
      const text = serialize(r.value.store.toDocument())
      return {
        result: success(
          {
            doc: r.value.ref,
            revision: rev(r.value),
            bytes: Buffer.byteLength(text, "utf8"),
            sha256: sha256Hex(text),
          },
          `Created ${r.value.ref.path}.`,
          { doc: r.value.ref },
        ),
      }
    },
  }
  return new Proxy({} as ToolHandlers, {
    get: (_t, name: string) => handlers[name] ?? unsupported,
  })
}

/** sha256 hex (kept here so callers need no crypto import). */
export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex")
