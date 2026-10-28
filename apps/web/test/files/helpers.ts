/**
 * Helpers for the file/session tests, on top of `../session-helpers` (memory platform + session
 * manager).
 */
import type { SettingKey } from "@kimo/platform"
import { setup } from "../session-helpers"

type SetupArgs = Parameters<typeof setup>

/**
 * `setup` with short timers. The settings store floors both intervals at 250 ms, but a session
 * reads them through `settings.get`, so the tests substitute their own (a later `settings.set`
 * still reaches the provider as usual). Tests that need an edit to stay dirty until a change on
 * disk is seen use `setup` from `session-helpers` with a long interval instead.
 */
export function fastSetup(
  files?: SetupArgs[0],
  options: NonNullable<SetupArgs[1]> & { autosaveMs?: number; snapshotMs?: number } = {},
) {
  const { autosaveMs = 30, snapshotMs = 250, ...rest } = options
  return setup(files, {
    ...rest,
    platform: (p) => {
      const get = p.settings.get.bind(p.settings)
      p.settings.get = ((key: SettingKey) =>
        key === "files.autosaveIntervalMs"
          ? autosaveMs
          : key === "files.recoverySnapshotMs"
            ? snapshotMs
            : get(key)) as typeof p.settings.get
      return rest.platform ? rest.platform(p) : p
    },
  })
}

/** Nothing pending and no write in flight (`dirty` drops when a write starts). */
export const settled = (s: { provider: { dirty: boolean; writingSince: number | null } | null }) =>
  !!s.provider && !s.provider.dirty && s.provider.writingSince === null

/** A git state for `platform.control.setGit(ROOT, ...)`. */
export const gitState = (operation: "rebase" | "merge" | null) => ({
  branch: "feat/onboarding",
  head: "abc",
  operation,
  indexLocked: false,
  fileStatus: "modified" as const,
  changedCount: 3,
})
