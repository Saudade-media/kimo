import type { ThumbnailsApi } from "@kimo/platform"
import { FileCard, type FileCardProps } from "@kimo/ui"
import { useFileThumbnail } from "./hooks"

/**
 * A Home grid {@link FileCard} with the file's preview (board 37 §9 "Card · preview"), read
 * lazily from `store` under `fileKey`; the placeholder until a preview exists.
 */
export function PreviewFileCard({
  store,
  fileKey,
  version,
  ...props
}: Omit<FileCardProps, "image" | "ref"> & {
  store: ThumbnailsApi | null
  /** The file's path (disk) or id (browser library). */
  fileKey: string
  /** Changes when the file does (its modified time): the preview is read again. */
  version?: number
}) {
  const t = useFileThumbnail(store, fileKey, version)
  return <FileCard {...props} ref={t.ref} image={t.src} />
}
