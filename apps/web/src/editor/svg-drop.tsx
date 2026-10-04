/**
 * SVG drop / paste on the canvas (board 19 mevh8 "SVG import options · on drop / paste"): the
 * file is sanitized and analysed, the import popover opens at the drop point (⇧ skips it and
 * reuses the last choice), and the import is ONE `store.apply` (one undo step).
 */
import { generateId } from "@kimo/editor-state"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import type { CanvasHandle } from "../canvas/contract"
import type { AssetStore } from "../lib/assets"
import { isTyping } from "../lib/hooks"
import {
  lastSvgChoice,
  type PreparedSvg,
  prepareSvg,
  rememberSvgChoice,
  type SvgImportChoice,
  SvgImportPopover,
  SvgRejectedError,
  SvgRejectionToast,
  svgImportOps,
} from "../svg-import"
import type { FileSession } from "./session"

/** A rejected file (board 24 j): kept so "Import without these" can import it sanitized. */
interface Rejected {
  error: SvgRejectedError
  bytes: Uint8Array | string
  client: { x: number; y: number }
}

interface Pending {
  prepared: PreparedSvg
  /** Client point (popover anchor). */
  client: { x: number; y: number }
  /** World point (root frame position). */
  at: { x: number; y: number }
}

const isSvgFile = (f: { name?: string; type?: string }) =>
  f.type === "image/svg+xml" || /\.svg$/i.test(f.name ?? "")
const isSvgText = (t: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t)

/** Color variables as name → hex (the default / unconditional entry). */
function colorVariables(doc: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {}
  const vars = (doc.variables ?? {}) as Record<string, { type?: string; value?: unknown }>
  for (const [name, v] of Object.entries(vars)) {
    if (v?.type !== "color") continue
    let value = v.value
    if (Array.isArray(value)) {
      const entries = value as { value?: unknown; when?: unknown }[]
      value = (entries.find((e) => e && e.when === undefined) ?? entries[0])?.value
    }
    if (typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)) out[name] = value
  }
  return out
}

export function useSvgImport({
  session,
  assets,
  canvas,
  container,
  onError,
}: {
  session: FileSession
  assets: AssetStore
  canvas: { current: CanvasHandle | null }
  /** The canvas container (drop target; paste lands at its center). */
  container: { current: HTMLElement | null }
  /**
   * A file that could not be imported (not SVG, DOCTYPE, too large…). Unsafe SVGs no longer go
   * here: board 24 (j) shows them in {@link SvgRejectionToast} (part of the returned `popover`).
   */
  onError(message: string, details?: readonly string[]): void
}): {
  handlers: {
    onDragOver(e: React.DragEvent<HTMLElement>): void
    onDrop(e: React.DragEvent<HTMLElement>): void
  }
  popover: ReactNode
} {
  const [pending, setPending] = useState<Pending | null>(null)
  const [rejected, setRejected] = useState<Rejected | null>(null)
  const errorRef = useRef(onError)
  errorRef.current = onError

  const run = useCallback(
    async (p: Pending, choice: SvgImportChoice) => {
      const doc = session.store.toDocument() as unknown as Record<string, unknown>
      try {
        const { ops } = await svgImportOps(p.prepared, choice, {
          newId: generateId,
          at: p.at,
          parent: null,
          colorVariables: colorVariables(doc),
          manifest: (doc.assets as Record<string, unknown> | undefined) ?? null,
          putAsset: async (key, bytes, entry) => {
            await assets.putKey(key, bytes, entry)
          },
        })
        const r = session.store.apply(ops, {
          origin: "user",
          label: `Import ${p.prepared.fileName}`,
        })
        if (!r.ok) errorRef.current(r.errors.map((e) => e.message).join("; "))
      } catch (e) {
        errorRef.current(e instanceof Error ? e.message : String(e))
      }
    },
    [session, assets],
  )

  const start = useCallback(
    async (
      bytes: Uint8Array | string,
      name: string,
      client: { x: number; y: number },
      shift: boolean,
      allowRemoved = false,
    ) => {
      let prepared: PreparedSvg
      try {
        prepared = await prepareSvg(bytes, name, { allowRemoved })
      } catch (e) {
        if (e instanceof SvgRejectedError) setRejected({ error: e, bytes, client })
        else errorRef.current(e instanceof Error ? e.message : String(e))
        return
      }
      const el = container.current
      const r = el?.getBoundingClientRect()
      const local = r ? { x: client.x - r.left, y: client.y - r.top } : client
      const at = canvas.current?.screenToWorld(local) ?? { x: 0, y: 0 }
      const p: Pending = { prepared, client, at: { x: Math.round(at.x), y: Math.round(at.y) } }
      // Consent to the sanitized SVG imports right away with the last choice (as ⇧-drop does).
      if (shift || allowRemoved) void run(p, lastSvgChoice())
      else setPending(p)
    },
    [canvas, container, run],
  )

  // Paste: an .svg file or SVG markup on the clipboard lands at the canvas center.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const data = e.clipboardData
      if (!data) return
      const file = [...data.files].find(isSvgFile)
      const text = file ? null : data.getData("text/plain")
      if (!file && !(text && isSvgText(text))) return
      e.preventDefault()
      const r = container.current?.getBoundingClientRect()
      const client = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 }
      if (file)
        void file
          .arrayBuffer()
          .then((b) => start(new Uint8Array(b), file.name || "pasted.svg", client, false))
      else if (text) void start(text, "pasted.svg", client, false)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [container, start])

  const handlers = {
    onDragOver(e: React.DragEvent<HTMLElement>) {
      const items = [...e.dataTransfer.items]
      if (!items.some((i) => i.kind === "file" && (i.type === "image/svg+xml" || i.type === "")))
        return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    },
    onDrop(e: React.DragEvent<HTMLElement>) {
      const file = [...e.dataTransfer.files].find(isSvgFile)
      if (!file) return
      e.preventDefault()
      const client = { x: e.clientX, y: e.clientY }
      const shift = e.shiftKey
      void file.arrayBuffer().then((b) => start(new Uint8Array(b), file.name, client, shift))
    },
  }

  const dismissRejected = useCallback(() => setRejected(null), [])
  const rejection = rejected ? (
    <SvgRejectionToast
      key={`${rejected.error.fileName}-${rejected.client.x}-${rejected.client.y}`}
      error={rejected.error}
      onDismiss={dismissRejected}
      onImport={() => {
        const r = rejected
        setRejected(null)
        void start(r.bytes, r.error.fileName, r.client, false, true)
      }}
    />
  ) : null

  const popover = pending ? (
    <SvgImportPopover
      fileName={pending.prepared.fileName}
      vectorDescription={pending.prepared.vectorDescription}
      imageDescription={pending.prepared.imageDescription}
      initial={lastSvgChoice()}
      canOutline={false}
      anchor={{ x: pending.client.x, y: pending.client.y, width: 0, height: 0 }}
      onCancel={() => setPending(null)}
      onImport={(choice) => {
        rememberSvgChoice(choice)
        const p = pending
        setPending(null)
        void run(p, choice)
      }}
    />
  ) : null

  return {
    handlers,
    popover: (
      <>
        {popover}
        {rejection}
      </>
    ),
  }
}
