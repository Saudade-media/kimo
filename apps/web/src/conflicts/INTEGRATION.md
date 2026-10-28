# Board 18 merge conflicts: integration

Everything here is exported from `apps/web/src/conflicts` (`index.ts`). This module never edits
the shared shell files. The mount points below are the only changes the owners of
`platform/session.ts`, `editor/Editor.tsx`, `LeftPanel.tsx` and `RightPanel.tsx` need to make.

## 1. Document session → conflict session (`platform/session.ts` owner)

Pass the factory when creating the session manager:

```ts
import { conflictSessionFactory } from "../conflicts"

createSessionManager({
  platform,
  createConflictSession: conflictSessionFactory({ onReject: (m) => m3.toastRejected?.(…) }),
})
```

`conflictSessionFactory` reads only `store`, `fileName`, `ref`, `save()`, `addToast()`,
`showMergeReady()` and `manager.platform.git.state(ref)` from `FileDocumentSession` (typed
structurally as `DocumentSessionLike`). The session it returns is an `EditorConflictSession`:
the contract's `ConflictSession` plus `focused()`, `openByNode()`, `fileName()`,
`bindView()` and `destroy()`. Cast `documentSession.conflicts` to `EditorConflictSession` in
the editor. When the file has no conflicts any more, call `destroy()` before dropping it.

- Picks (`choose`, `chooseAll`) and `markResolvedAndSave` are each ONE `store.apply` op group
  with origin `"user"`, so ⌘Z undoes them. This needs `"merge"` and `"conflicts"` in
  `HEADER_OP_KEYS` (`packages/editor-state/src/ops.ts`, already added).
- `markResolvedAndSave()` rejects with `ConflictError("OPEN_CONFLICTS")` while any row is open.
  Otherwise it applies `finishMerge`, awaits `save()`, adds the `merge-saved` toast and calls
  `showMergeReady(true)` when `git.state(ref).operation === "merge"`.
- `banner.runAction("next-conflict" | "previous-conflict")` already calls `next()` /
  `previous()` + `focus()`.

## 2. Editor shell (`editor/Editor.tsx` owner)

With `conflicts = documentSession?.conflicts as EditorConflictSession | null`:

```tsx
import { CanvasConflictOverlay, useNextConflictShortcut } from "../conflicts"

// once the canvas handle exists: Next conflict selects + reveals the node
useEffect(() => {
  conflicts?.bindView({
    select: (id) => session.ui.getState().select([id]),
    reveal: (id) => canvas.current?.zoomToFit([id], 96),
  })
  return () => conflicts?.bindView(null)
}, [conflicts, session])

useNextConflictShortcut(conflicts) // ⌘' (⇧⌘' = previous)

// inside <main className="editor__canvas">, right after <CanvasHost …/>:
{conflicts && <CanvasConflictOverlay session={conflicts} ui={session.ui} layout={layout} />}
```

`layout` is the existing `createBus<LayoutResult | null>` that `onLayout` feeds. The overlay is
`position: absolute; inset: 0; pointer-events: none`, and only the pills take clicks. Pills
are placed by the pure `canvasConflictMarkers(rows, layout, viewport, selection)`: 4px above the
node's top-left, plus a 1.5px `$danger` outline unless the node is selected.

## 3. Layers (`editor/LeftPanel.tsx` owner)

```tsx
import { LayerRowConflict } from "@kimo/ui"
import { useOpenConflictNodes } from "../conflicts"

const open = useOpenConflictNodes(conflicts) // Map<nodeId, rows>, empty without a session
// in the row renderer, before the LayerRowM3 / LayerRow branches:
if (open.has(id))
  return (
    <LayerRowConflict
      data-node-id={id}
      tabIndex={tabbable ? 0 : -1}
      name={nodeName(n)}
      icon={<Icon name={typeIcon(n)} size={14} />}
      depth={depth}
      expanded={open_}
      onToggleExpanded={() => actions.toggle(id, depth)}
      selected={selected}
      emphasized={depth === 0}
      onClick={(e) => actions.select(id, e)}
      onPointerEnter={() => actions.hover(id)}
    />
  )
```

This is `LayerRow/Conflict` (VpvIr): LayerRow geometry with the ConflictMarker in place of the
visibility eye. Only nodes that own an OPEN conflict get it (board 18 "Layers" rule).

## 4. Right panel tab (`editor/RightPanel.tsx` owner)

Add a fourth tab while `conflicts` is non-null, after Design / Code / Agent, using the
selected-tab style (`P3e7Mp`) when active. Hide it once the merge is finished (the session
becomes null):

```tsx
import { ConflictsPanel, conflictsTabLabel } from "../conflicts"

label: conflictsTabLabel(conflicts.counts().open) // "Conflicts 2"
body:  <ConflictsPanel session={conflicts} getNode={(id) => session.store.getNode(id)} />
```

Open the tab automatically when a document opens with open conflicts, and when the
`external-conflicts` toast's "Review" action runs. The panel fills the 280px column (it scrolls
as a whole and its footer stays pinned).

## 5. Saving rules (already in `platform/session.ts`)

Autosave stays paused while `counts().open > 0`. ⌘S writes the conflicts as they are. The
`merge-conflicts` banner reads `counts()` and `info`.

## Board 20 "Conflicts polish" (rTpad)

- Each ConflictRow head ends with a "base ›" toggle (`ConflictRow/Base` b3xOtr); open, the head
  shows the mono base line with the merge base's short commit (`ConflictRow/Base/Open` d4P5H).
  Per row, not persisted. A side that adds a node shows base "absent"; a deleted node shows
  "Legal · 600×24".
- Resolved rows are `ResolvedRow` (GawEa); clicking one expands it in place, one at a time, to
  `ResolvedRow/Expanded` (OPe5M): both sides (the applied one selected), the base line and
  Reopen (`ConflictSession.reopen`, one undo step; picking the other side re-resolves directly).
  `ConflictRow/Resolved` is hZKbc (rebuilt; formerly d9zpM).
- Groups: Document (`file-cog`), Variables (`variable`, every variable conflict), then nodes in
  layer order with their layer icon.
- Canvas pills: two overlapping pills stack (the later one moves up by pill height + 4); three or
  more show the first pill plus `CanvasMarker/Conflict/More` "+N", which opens a Menu/Dense of
  the hidden conflicts.

## Not designed (flagged)

- The "+N" menu's width (208, the Menu/Dense instance width) and its item copy (the hidden
  pills' labels).
- "Take all ours / theirs" is disabled when nothing is open.
