# Saving and recovery

## Saving

In the desktop app, **autosave** is on by default: Kimo writes the file 2 seconds after you stop editing (1, 2, 5, 10 or 30 s in **Settings › Files & autosave**). `⌘S` saves now and `⇧⌘S` saves a copy elsewhere. Every write goes to a temporary file that replaces the original and is read back to check it.

The pill in the top bar tells you where the file stands: **Saved to disk**, **Saving…**, **Unsaved changes**, **Not saved** (an untitled file), **Autosave paused**, **Read-only**, **Locked by another app** or **Save failed**.

In the browser, files live in the browser's storage (**Saved locally**). **Save** and **Save as…** write a `.kimo` (or a `.kimoz` when the design has images) to disk.

The **File** menu has New file, Open…, Open recent, Save, Save as…, Reveal, **Clean up assets…** and Settings.

## Recovery

Independently of autosave, Kimo keeps a recovery snapshot of each file with unsaved changes every 30 seconds (15 s to 5 min in Settings; a new interval applies to open files at once). In the desktop app they are kept in `~/.kimo/recovery` for 30 days; in the browser, in its storage.

If Kimo quit without saving, it asks **Recover unsaved changes?** on the next start: **Restore all**, **Discard all** or **Decide later**. When a file's original can't take the restored copy (it was moved or deleted, or the folder is read-only), **Restore** asks where to save it instead. Snapshots older than 30 days are deleted before the dialog opens.

## When the file changes on disk

Kimo watches open files. If one changes on disk (a `git pull`, another editor, an agent writing the file):

- With no unsaved edits, Kimo reloads it: `<file> changed on disk and was reloaded`, with **Undo**.
- With unsaved edits, **Merge & tell me** (the default) merges both sides: `Merged N changes from disk with your M edits`. With **Ask first** (Settings › Files & autosave › When a file changes on disk), a banner says `<file> changed on disk` and nothing is merged or written until you choose: **Merge** merges both sides, **Keep mine** keeps your edits and saves them over the file. `⌘S` also keeps yours.
- When both sides changed the same thing, the **Conflicts** panel opens and autosave pauses until you resolve each conflict. `⌘'` and `⇧⌘'` move between conflicts.

## Git

- **Pause autosave during git operations** (on by default) stops writing while git rebases, merges, cherry-picks or checks out, so Kimo doesn't race git.
- **Git merge driver** (**Set up…**) configures the repository so `.kimo` files merge with the semantic [`kimo merge`](../../../packages/cli/README.md#kimo-merge-the-git-merge-driver) instead of line by line. Conflicts it can't resolve are stored in the file and open on the Conflicts panel.

## One writer per file

Only one Kimo window or process writes a file at a time. If another one holds it, the file opens with **Locked by another process**, showing which app and process: **Open read-only**, or **Retry** (which takes over a lock left by a process that is no longer running).

## Assets

Images live in the `assets/` folder next to the file and are never deleted while you edit, so undo always works. **File › Clean up assets…** removes the ones no layer uses (the same rules as [`kimo gc`](../../../packages/cli/README.md#kimo-gc)).
