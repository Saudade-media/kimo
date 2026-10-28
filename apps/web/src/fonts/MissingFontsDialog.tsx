/**
 * Missing fonts dialog (board 19 `hQunF`, "Missing fonts dialog · on open"): a `Dialog` (bDVhS)
 * instance at width 640. Missing fonts never block opening: the canvas renders the fallback
 * (Inter) and this dialog opens once per file per session ({@link claimMissingFontsDialog}).
 *
 * Head: icon `type`, "3 fonts aren't available", "<file> uses fonts that aren't installed or
 * embedded. Affected layers render in Inter until you replace or install them — the file keeps
 * the original names."
 * Body (HWB8i): column, fill, top stroke 1 border; one FontRow per family:
 * - `FontRow/Missing` (Document · Missing · Select 148 "Replace with…", default suggestion);
 * - `FontRow/Offline` (Google · Not cached · Button/Ghost 28 `download` 14 "Fetch").
 * Footer: Footnote "Replacing is one undoable edit" · Open fonts folder · Keep for now ·
 * Replace N fonts.
 */
import type { MissingFont } from "@kimo/renderer"
import { Banner, Button, Dialog, FontRow, fontRowMeta } from "@kimo/ui"
import { Download, Type } from "lucide-react"
import { useState } from "react"
import { FontReplaceSelect, type ReplaceChoice } from "./ReplaceWithMenu"
import { suggestReplacement } from "./replace-fonts"
import "./fonts.css"

interface MissingFontsDialogProps {
  fileName: string
  fonts: readonly MissingFont[]
  /** Families offered by "Replace with…" (document, local, cached and bundled). */
  choices: readonly ReplaceChoice[]
  /** Google Fonts may be fetched now (allowed in Settings and online). */
  canFetch: boolean
  /**
   * Board 28 (c) X1mr3: Google is blocked by a setting — `ntpf` (No third-party fetch) or
   * `google-off` (Google Fonts off). The body then opens with Banner/Warning.
   */
  blocked?: "ntpf" | "google-off" | null
  /** Banner action "Open settings" (Settings › Fonts & privacy). */
  onOpenSettings?: () => void
  /** "Replace N fonts": one undoable edit. */
  onReplace: (mapping: Record<string, string>) => void
  /** "Keep for now" / Escape. */
  onKeep: () => void
  /** "Open fonts folder" (desktop). Hidden when absent. */
  onOpenFontsFolder?: () => void
  /** Fetch an offline Google family now. */
  onFetch?: (font: MissingFont) => Promise<unknown>
  /** "Install <family>…". */
  onInstall?: (family: string) => void
  /** "Choose font file…". */
  onChooseFile?: (family: string) => void
  /** Gallery specimen: no dismissal / focus. */
  inline?: boolean
  /** Initial replacements (defaults: {@link suggestReplacement} for every missing family). */
  initialReplacements?: Record<string, string | null>
  /**
   * Board 41 › 8 D: families a shared file's owner could only send by name (not open-licensed):
   * their FontRow/Missing source reads "Name only" (`OO0zZ`).
   */
  nameOnly?: readonly string[]
}

/** Board 28 (c) banner copy (zzcpD). */
const BLOCKED_BANNER_TITLE = "Google Fonts are blocked"
const BLOCKED_BANNER_BODY = "No third-party fetch is on. Install them or use the offline font pack."
const GOOGLE_OFF_BANNER_TITLE = "Google Fonts are off"
const GOOGLE_OFF_BANNER_BODY =
  "Turn them on in Settings, install them or use the offline font pack."

/** "3 fonts aren't available" / "1 font isn't available". */
function missingFontsTitle(n: number): string {
  return n === 1 ? "1 font isn't available" : `${n} fonts aren't available`
}

function missingFontsDescription(fileName: string): string {
  return `${fileName} uses fonts that aren't installed or embedded. Affected layers render in Inter until you replace or install them.`
}

/** "Replace 2 fonts" / "Replace 1 font". */
function replaceLabel(n: number): string {
  return `Replace ${n} font${n === 1 ? "" : "s"}`
}

export function MissingFontsDialog({
  fileName,
  fonts,
  choices,
  canFetch,
  blocked = null,
  onOpenSettings,
  onReplace,
  onKeep,
  onOpenFontsFolder,
  onFetch,
  onInstall,
  onChooseFile,
  inline = false,
  initialReplacements,
  nameOnly,
}: MissingFontsDialogProps) {
  const byName = new Set((nameOnly ?? []).map((f) => f.toLowerCase()))
  const [replacements, setReplacements] = useState<Record<string, string | null>>(() => {
    const out: Record<string, string | null> = {}
    for (const f of fonts)
      if (f.status === "missing")
        out[f.family] =
          initialReplacements && f.family in initialReplacements
            ? (initialReplacements[f.family] ?? null)
            : suggestReplacement(f.family)
    return out
  })
  const [fetching, setFetching] = useState<string | null>(null)
  const mapping = Object.fromEntries(
    Object.entries(replacements).filter((e): e is [string, string] => !!e[1]),
  )
  const count = Object.keys(mapping).length

  return (
    <Dialog
      width={640}
      inline={inline}
      icon={<Type />}
      title={missingFontsTitle(fonts.length)}
      description={missingFontsDescription(fileName)}
      footnote="Replacing is one undoable edit"
      {...(onOpenFontsFolder
        ? { tertiary: { label: "Open fonts folder", onClick: onOpenFontsFolder } }
        : {})}
      cancelLabel="Keep for now"
      confirmLabel={replaceLabel(count)}
      confirmDisabled={count === 0}
      onCancel={onKeep}
      onConfirm={() => onReplace(mapping)}
      data-pen="hQunF"
    >
      <div className="fonts-missing__body">
        {/* Blocked, Kimo can't even ask Google whether a missing family is a Google one. */}
        {blocked && fonts.length > 0 && (
          <Banner
            tone="warning"
            className="fonts-missing__banner"
            data-pen="zzcpD"
            title={blocked === "ntpf" ? BLOCKED_BANNER_TITLE : GOOGLE_OFF_BANNER_TITLE}
            body={blocked === "ntpf" ? BLOCKED_BANNER_BODY : GOOGLE_OFF_BANNER_BODY}
            actions={
              onOpenSettings ? [{ id: "settings", label: "Open settings", variant: "ghost" }] : []
            }
            onAction={() => onOpenSettings?.()}
          />
        )}
        {fonts.map((f) =>
          f.status === "missing" ? (
            <FontRow
              key={f.family}
              family={f.family}
              meta={fontRowMeta(f.weights, f.nodeIds.length)}
              source={byName.has(f.family.toLowerCase()) ? "Name only" : "Document"}
              status="missing"
              action={
                <FontReplaceSelect
                  family={f.family}
                  choices={choices}
                  value={replacements[f.family] ?? null}
                  onChoose={(to) => setReplacements((r) => ({ ...r, [f.family]: to }))}
                  {...(onInstall ? { onInstall: () => onInstall(f.family) } : {})}
                  {...(onChooseFile ? { onChooseFile: () => onChooseFile(f.family) } : {})}
                />
              }
            />
          ) : (
            <FontRow
              key={f.family}
              family={f.family}
              meta={fontRowMeta(f.weights, f.nodeIds.length)}
              source="Google"
              status="not-cached"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  className="fonts-fetch"
                  icon={<Download />}
                  disabled={!canFetch || fetching === f.family || !onFetch}
                  title={
                    canFetch
                      ? undefined
                      : "Google Fonts are off or you're offline. Change in Settings › Fonts & privacy."
                  }
                  onClick={async () => {
                    setFetching(f.family)
                    try {
                      await onFetch?.(f)
                    } finally {
                      setFetching(null)
                    }
                  }}
                >
                  Fetch
                </Button>
              }
            />
          ),
        )}
      </div>
    </Dialog>
  )
}
