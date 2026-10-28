/**
 * Board 46 4A "Studio on Home" (board 37 Home): workspaces sit above local folders.
 *
 * - Sidebar: Cloud Header "KIMO CLOUD" (the folders header) with its plus (uUoM1jPXvt, New
 *   workspace: 1F, then the new workspace opens) · one NavRow per workspace (users, name, file
 *   count; the active row is board 37's pill row).
 * - Main (`#/workspace/<id>`): the workspace's name as the title, Search files, Members (Settings ›
 *   Workspace) and New file (a new file shared into the workspace); "4 files" · "Everyone in Studio
 *   can edit these" · the view toggle; the list: NAME, LAST EDITED BY, MODIFIED, STATUS.
 *
 * Opening a file: desktop opens its local copy (made in the Kimo-managed folder when it is not on
 * this computer yet); web opens the room's replica at `#/cloud/<room>`. Lists come from the
 * device cache first, so they show offline.
 */
import type { KimoPlatform } from "@kimo/platform"
import { Button, FileCard, FileRow, FileRowHeader, IconButton } from "@kimo/ui"
import { useEffect, useMemo, useState } from "react"
import { RoomEditor } from "../editor/Editor"
import { failureText } from "../editor/errors"
import { RecentFilesHeader, type RecentView } from "../files"
import { createFile } from "../lib/files"
import { Icon } from "../lib/icons"
import { roomKeyOf } from "../multiplayer/backend"
import type { CloudFile } from "../multiplayer/cloud/types"
import { fileStatus, liveWorkspaces, personName } from "../multiplayer/cloud/workspace-view"
import { libraryKeyOf } from "../multiplayer/library"
import type { SharedSession } from "../multiplayer/share"
import { NewWorkspaceWizard } from "../multiplayer/ui/NewWorkspace"
import {
  useWorkspaceStore,
  useWorkspacesState,
  useWsToast,
} from "../multiplayer/ui/workspace-parts"
import { modifiedLabel } from "../platform/format"
import { useOpenSettings, useOptionalRuntime } from "../platform/runtime"
import { diskPath, type HomeSection, homeSectionPath, navigate } from "../router"
import { countLabel } from "./model"
import { NavRow } from "./parts"

// --- Sidebar -------------------------------------------------------------------------------------

/** "KIMO CLOUD" and its workspaces, while the account is in at least one. */
export function CloudGroup({ section }: { section: HomeSection }) {
  const store = useWorkspaceStore()
  const state = useWorkspacesState(store)
  const [making, setMaking] = useState(false)
  const list = state ? liveWorkspaces(state) : []
  if (!state || !list.length) return null
  return (
    <>
      {/* Cloud Header (FsfqvtpYQ1): the Folders Header's layout, padding [20, 4, 6, 10]. */}
      <div className="kimo-files-folders-header home-cloud-header" data-pen="FsfqvtpYQ1">
        <span className="kimo-files-folders-header__label">KIMO CLOUD</span>
        {/* Add (uUoM1jPXvt): Add Folder's 20 × 20, transparent, `plus` 14 text-tertiary. */}
        <IconButton
          className="kimo-files-folders-header__add"
          label="New workspace"
          icon={<Icon name="plus" size={14} />}
          tone="quiet"
          data-action="new-workspace"
          onClick={() => setMaking(true)}
        />
      </div>
      {making && (
        <NewWorkspaceWizard
          onClose={() => setMaking(false)}
          onCreated={(id) => {
            setMaking(false)
            navigate(homeSectionPath({ kind: "workspace", id }))
          }}
        />
      )}
      {list.map((w) => (
        <NavRow
          key={w.id}
          href={`#${homeSectionPath({ kind: "workspace", id: w.id })}`}
          icon={<Icon name="users" size={16} />}
          label={w.name}
          active={section.kind === "workspace" && section.id === w.id}
          count={state.files[w.id]?.files.length ?? null}
        />
      ))}
    </>
  )
}

// --- New file ------------------------------------------------------------------------------------

/** Web: library files to share into a workspace once their editor opens (by share key). */
const pendingShares = new Map<string, string>()

/**
 * The pending shares whose library file is now open (`lookup` answers its session), taken off
 * the list: the window's host shares each into its workspace.
 */
export function takeReadyShares<T>(
  lookup: (key: string) => T | null,
): { target: T; workspaceId: string }[] {
  const ready: { target: T; workspaceId: string }[] = []
  for (const [key, workspaceId] of [...pendingShares]) {
    const target = lookup(key)
    if (!target) continue
    pendingShares.delete(key)
    ready.push({ target, workspaceId })
  }
  return ready
}

// --- Main ----------------------------------------------------------------------------------------

/** The workspace's name for the title (null until the account lists it). */
export function useWorkspaceTitle(id: string): string | null {
  const state = useWorkspacesState(useWorkspaceStore())
  return state?.workspaces.find((w) => w.id === id)?.name ?? null
}

/** Members (Button/Secondary, users) and New file (Button/Primary, plus). */
export function WorkspaceHeaderButtons({
  platform,
  workspaceId,
}: {
  platform: KimoPlatform
  workspaceId: string
}) {
  const store = useWorkspaceStore()
  const runtime = useOptionalRuntime()
  const openSettings = useOpenSettings()
  const toast = useWsToast()
  const [busy, setBusy] = useState(false)
  const newFile = async () => {
    if (!store || busy) return
    setBusy(true)
    try {
      if (platform.kind === "desktop" && runtime) {
        const s = await runtime.manager.newUntitled()
        await store.shareFile({ ref: s.ref, store: s.store }, { workspaceId })
        navigate(diskPath(s.ref))
      } else {
        const id = await createFile("Untitled")
        pendingShares.set(libraryKeyOf(id), workspaceId)
        navigate(`/file/${id}`)
      }
    } catch (e) {
      toast({ tone: "danger", text: failureText("create a file", e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        variant="secondary"
        icon={<Icon name="users" size={16} />}
        data-action="members"
        onClick={() => void openSettings("workspace", workspaceId)}
      >
        Members
      </Button>
      <Button
        variant="primary"
        icon={<Icon name="plus" size={16} />}
        data-action="new-file"
        disabled={busy}
        onClick={() => void newFile()}
      >
        New file
      </Button>
    </>
  )
}

const fileName = (f: CloudFile) => (/\.kimoz?$/i.test(f.name) ? f.name : `${f.name}.kimo`)

/** Files Header and the list (or grid) of a workspace's files. */
export function WorkspaceFiles({
  platform,
  workspaceId,
  query,
  now,
}: {
  platform: KimoPlatform
  workspaceId: string
  query: string
  now: number
}) {
  // Board 46 4A shows the list; the toggle keeps its own choice for workspaces.
  const [view, setView] = useState<RecentView>("list")
  const store = useWorkspaceStore()
  const state = useWorkspacesState(store)
  const runtime = useOptionalRuntime()
  const toast = useWsToast()
  const w = state?.workspaces.find((x) => x.id === workspaceId) ?? null
  // The list and its members, fresh on open (the cached list shows first).
  useEffect(() => {
    if (store && w && w.deletedAt === null)
      void store.refreshWorkspace(workspaceId).catch(() => undefined)
  }, [store, workspaceId, w])
  const files = state?.files[workspaceId]?.files ?? null
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = [...(files ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)
    return q ? all.filter((f) => f.name.toLowerCase().includes(q)) : all
  }, [files, query])
  if (!store || !state || !w) return null
  const members = state.details[workspaceId]?.members ?? []

  const editedBy = (f: CloudFile) => {
    const email = f.addedBy.includes("@")
      ? f.addedBy
      : (members.find((m) => m.account === f.addedBy)?.email ?? null)
    return email ? personName(email) : ""
  }
  const statusOf = (f: CloudFile) => {
    const binding = state.bindings[f.room]
    const local = !!binding && binding.ended === null
    const key = binding?.fileKey ?? roomKeyOf(f.room)
    const here = state.open[f.room]
      ? (runtime?.multiplayer
          ?.document(key)
          .getState()
          .people.filter((p) => !p.isYou)
          .map((p) => p.label) ?? [])
      : []
    return fileStatus(here, local, platform.os)
  }
  const open = async (f: CloudFile) => {
    try {
      const path = await store.localCopy(f.room)
      if (path) navigate(diskPath(path))
      else navigate(`/cloud/${f.room}`)
    } catch (e) {
      toast({ tone: "danger", text: failureText(`open ${f.name}`, e) })
    }
  }

  return (
    <>
      <RecentFilesHeader
        folderCount={0}
        title={countLabel(files?.length ?? 0)}
        note={`Everyone in ${w.name} can edit these`}
        view={view}
        onViewChange={setView}
      />
      {view === "grid" ? (
        <div className="kimo-files-grid">
          {rows(shown).map((row) => (
            <div key={row[0]?.room} className="kimo-files-grid__row">
              {row.map((f) => (
                <FileCard
                  key={f.room}
                  data-room={f.room}
                  className="kimo-files-grid__card"
                  name={fileName(f)}
                  info={[editedBy(f), modifiedLabel(f.updatedAt, now)].filter(Boolean).join(" · ")}
                  onClick={() => void open(f)}
                />
              ))}
              {["pad-a", "pad-b", "pad-c"].slice(0, 4 - row.length).map((k) => (
                <span key={k} className="kimo-files-grid__card" aria-hidden="true" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="kimo-files-list home-workspace-list" data-pen="Y5LYxVnagL">
          <FileRowHeader pathLabel="LAST EDITED BY" gitLabel="STATUS" />
          {shown.map((f) => {
            const status = statusOf(f)
            return (
              <FileRow
                key={f.room}
                data-room={f.room}
                name={fileName(f)}
                path={editedBy(f)}
                pathKind="person"
                modified={modifiedLabel(f.updatedAt, now)}
                gitLabel={status.label}
                gitTone={status.tone}
                onOpen={() => void open(f)}
              />
            )
          })}
        </div>
      )}
    </>
  )
}

const rows = <T,>(list: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += 4) out.push(list.slice(i, i + 4))
  return out
}

// --- Web: a workspace file's room replica ------------------------------------------------------

/** `#/cloud/<room>`: opens the room's replica (cached key and token first) as an editor. */
export function CloudFileRoute({ room }: { room: string }) {
  const store = useWorkspaceStore()
  const [state, setState] = useState<
    | { phase: "opening" }
    | { phase: "open"; session: SharedSession }
    | { phase: "failed"; text: string }
  >({ phase: "opening" })
  useEffect(() => {
    if (!store) return
    let live = true
    setState({ phase: "opening" })
    store
      .openFile(room)
      .then((session) => live && setState({ phase: "open", session }))
      .catch(
        (e: unknown) =>
          live && setState({ phase: "failed", text: failureText("open the file", e) }),
      )
    return () => {
      live = false
    }
  }, [store, room])
  if (state.phase === "open") return <RoomEditor shared={state.session} />
  return (
    <div className="editor-status">
      <span className="editor-status__label">
        {state.phase === "opening" ? "Opening file…" : state.text}
      </span>
    </div>
  )
}
