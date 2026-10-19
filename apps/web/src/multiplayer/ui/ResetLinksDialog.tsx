/**
 * Board 41 section 3 D (aaSGr): "Reset all links?" on Dialog (bDVhS) with the danger icon wrap
 * (rotate-ccw) and a danger confirm. The description names who is disconnected now: people by
 * name (Guest N when unnamed, "and N more" past three) and agents by count (`resetConfirmCopy`).
 * Escape and Cancel keep everything. Body slot hidden; footnote "A new key is made for this file."
 */
import { Dialog, DialogScrim } from "@kimo/ui"
import { useState } from "react"
import { createPortal } from "react-dom"
import { failureText } from "../../editor/errors"
import { Icon } from "../../lib/icons"
import { useShareLinks } from "../hooks"
import { type MultiplayerModel, resetConfirmCopy } from "../model"
import { resetDescription } from "./copy"
import { useShareToast } from "./shared"
import "./share-ui.css"

export interface ResetLinksDialogProps {
  model: MultiplayerModel
  docKey: string
  onCancel(): void
  onDone(): void
  /** Render in place (harness specimens) instead of over a scrim in a portal. */
  inline?: boolean
}

export function ResetLinksDialog({
  model,
  docKey,
  onCancel,
  onDone,
  inline,
}: ResetLinksDialogProps) {
  const doc = model.document(docKey)
  const links = useShareLinks(model, docKey)
  const toast = useShareToast()
  const [busy, setBusy] = useState(false)
  // Who is connected right now: read when the dialog opens (it re-renders with the links).
  const impact = doc.resetImpact()
  const confirm = async () => {
    setBusy(true)
    try {
      await doc.resetAllLinks()
      toast({
        tone: "component",
        icon: "rotate-ccw",
        text: "All links reset · a new key is in use",
      })
      onDone()
    } catch (e) {
      setBusy(false)
      toast({ tone: "danger", text: failureText("reset the links", e) })
    }
  }
  const dialog = (
    <Dialog
      className="mp-reset-dialog"
      tone="danger"
      icon={<Icon name="rotate-ccw" size={16} />}
      title="Reset all links?"
      description={resetDescription(links.items.length, resetConfirmCopy(impact))}
      footnote="A new key is made for this file."
      confirmLabel="Reset all links"
      confirmTone="danger"
      confirmDisabled={busy}
      inline={inline ?? false}
      onCancel={onCancel}
      onConfirm={() => void confirm()}
    />
  )
  if (inline) return dialog
  return createPortal(<DialogScrim>{dialog}</DialogScrim>, document.body)
}
