/**
 * Clean up assets flow (File menu "Clean up assets…"): plans with the same rules as `kimo gc`,
 * shows the dialog, removes the files and drops their manifest entries in one undoable edit
 * (the files themselves are not undoable; git history keeps them, as the dialog says).
 */
import type { Op } from "@kimo/editor-state"
import { readFontInfo } from "@kimo/renderer"
import { DialogScrim } from "@kimo/ui"
import { useEffect, useState } from "react"
import { CleanUpAssetsDialog, CleanUpNothingDialog } from "./CleanUpAssetsDialog"
import type { AssetFolder } from "./folders"
import { type GcPlan, planAssetGc, prunedManifest } from "./logic"

/** Lists the folder, reads font families, and plans. */
export async function planFolderGc(
  folder: AssetFolder,
  doc: Readonly<Record<string, unknown>>,
): Promise<GcPlan> {
  const files = await folder.list()
  const families = new Map<string, string>()
  for (const f of files) {
    if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) continue
    const bytes = await folder.read(f.name)
    const info = bytes ? await readFontInfo(bytes) : null
    if (info) families.set(f.name, info.family)
  }
  return planAssetGc(doc, files, (name) => families.get(name))
}

/** Removes the plan's files and returns the manifest op (or none). */
export async function applyAssetGc(
  folder: AssetFolder,
  plan: GcPlan,
  doc: Readonly<Record<string, unknown>>,
): Promise<Op[]> {
  const names = plan.unused.map((f) => f.name)
  await folder.remove(names)
  const manifest = prunedManifest(doc.assets, names)
  return manifest ? [{ op: "setHeader", set: { assets: manifest } }] : []
}

interface CleanUpAssetsHostProps {
  folder: AssetFolder
  fileName: string
  doc: () => Readonly<Record<string, unknown>>
  apply: (ops: Op[], label: string) => void
  onDone: (removed: number) => void
}

/**
 * Mount to run the flow. Nothing to remove shows board 20's "Nothing to clean up" dialog (Done
 * calls `onDone(0)`); a folder that cannot be read closes silently with `onDone(0)`.
 */
export function CleanUpAssetsHost({
  folder,
  fileName,
  doc,
  apply,
  onDone,
}: CleanUpAssetsHostProps) {
  const [plan, setPlan] = useState<GcPlan | null>(null)
  const [nothing, setNothing] = useState<{ count: number; bytes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: plans once per mount
  useEffect(() => {
    let live = true
    void planFolderGc(folder, doc()).then(
      async (p) => {
        if (!live) return
        if (p.unused.length) {
          setPlan(p)
          return
        }
        const files = await folder.list().catch(() => [])
        if (live) setNothing({ count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) })
      },
      () => live && onDone(0),
    )
    return () => {
      live = false
    }
  }, [folder])
  if (nothing)
    return (
      <DialogScrim>
        <CleanUpNothingDialog
          fileName={fileName}
          count={nothing.count}
          bytes={nothing.bytes}
          onDone={() => onDone(0)}
        />
      </DialogScrim>
    )
  if (!plan) return null
  return (
    <DialogScrim>
      <CleanUpAssetsDialog
        fileName={fileName}
        unused={plan.unused}
        busy={busy}
        onCancel={() => onDone(0)}
        onConfirm={async () => {
          setBusy(true)
          try {
            const ops = await applyAssetGc(folder, plan, doc())
            if (ops.length) apply(ops, "Clean up assets")
            onDone(plan.unused.length)
          } finally {
            setBusy(false)
          }
        }}
      />
    </DialogScrim>
  )
}
