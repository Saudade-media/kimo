/**
 * One continuous gesture (drag-move, resize, draw, field scrub) = one undo step. Each step
 * undoes the previous step of the same gesture before applying the new op list, so the origin's
 * undo stack only ever holds the latest state (the stacks have `captureTimeout: 0`: one apply
 * that changes something is exactly one entry).
 *
 * A step is only undone when the entry it pushed is still on top of the stack
 * (`DocStore.topUndo`): a step that changed nothing pushes no entry, and an undo, nudge or other
 * edit made mid-gesture puts a different entry on top. Undoing blindly in those cases would
 * revert the user's unrelated edit.
 */
import type { DocStore, LocalOrigin, Op } from "@kimo/editor-state"

export interface Gesture {
  /** Replaces the gesture's previous ops with `ops`. Returns false when rejected. */
  set(ops: readonly Op[], label?: string): boolean
  /** True while the latest step's change is in the document (draw: the shape exists). */
  readonly applied: boolean
  /** Reverts what the gesture applied, when it is still the latest edit (Escape). */
  cancel(): void
  /** Ends the gesture (keeps the last applied state as one undo step). */
  end(): void
  /** True after `end` or `cancel`. */
  readonly done: boolean
}

export function startGesture(
  store: DocStore,
  origin: LocalOrigin,
  label: string,
  onReject?: (message: string) => void,
): Gesture {
  /** The undo entry the latest step pushed, while the gesture may still collapse it. */
  let mine: object | null = null
  let done = false
  const revert = () => {
    if (mine !== null && store.topUndo(origin) === mine) store.undo(origin)
    mine = null
  }
  return {
    get applied() {
      return mine !== null
    },
    get done() {
      return done
    },
    set(ops, stepLabel) {
      if (done) return false
      revert()
      if (!ops.length) return true
      const top = store.topUndo(origin)
      const r = store.apply(ops, { origin, label: stepLabel ?? label })
      if (!r.ok) {
        onReject?.(r.errors.map((e) => e.message).join("; "))
        return false
      }
      const now = store.topUndo(origin)
      if (now !== null && now !== top) mine = now
      return true
    },
    cancel() {
      if (!done) revert()
      done = true
    },
    end() {
      done = true
    },
  }
}
