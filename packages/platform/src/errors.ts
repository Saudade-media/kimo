/**
 * Errors raised by every platform implementation. Rejections always carry a
 * {@link PlatformErrorCode}; file errors also keep the OS `errno` (`ENOSPC`, `EACCES`, …) so
 * `@kimo/sync`'s `classifySaveError` can map them to board 17's save failures.
 */

export type PlatformErrorCode =
  /** The host cannot do this (browser without the API, web build without an updater, …). */
  | "UNSUPPORTED"
  /** The user dismissed a dialog or permission prompt. */
  | "CANCELLED"
  | "NOT_FOUND"
  /** EACCES / EPERM / EROFS, or a denied browser permission. */
  | "PERMISSION"
  /** ENOSPC / EDQUOT. */
  | "DISK_FULL"
  /** The file read back after an atomic write did not hash to what was written. */
  | "READ_BACK_MISMATCH"
  /** The per-file lease is held by another live process. */
  | "LOCKED"
  /** A remote fetch refused by the "No third-party fetch" setting or the host allowlist. */
  | "BLOCKED"
  /** Bad arguments (relative path where an absolute one is required, unknown setting, …). */
  | "INVALID"
  /** Any other I/O or host failure. */
  | "IO"

export class PlatformError extends Error {
  override readonly name = "PlatformError"
  /** The OS error code (`ENOSPC`, …) when there is one; else the platform code. */
  readonly errno: string | undefined
  constructor(
    readonly code: PlatformErrorCode,
    message: string,
    options: { errno?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.errno = options.errno
  }
}

/** Throws `UNSUPPORTED` for `what` on this host. */
export function unsupported(what: string, host: string): never {
  throw new PlatformError("UNSUPPORTED", `${what} is not available in ${host}`)
}

/** True when `e` is a {@link PlatformError} with `code`. */
export function isPlatformError(e: unknown, code?: PlatformErrorCode): e is PlatformError {
  return e instanceof PlatformError && (code === undefined || e.code === code)
}

/** Maps an OS errno to a platform code. */
export function codeForErrno(errno: string | undefined): PlatformErrorCode {
  switch (errno) {
    case "ENOENT":
      return "NOT_FOUND"
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "PERMISSION"
    case "ENOSPC":
    case "EDQUOT":
      return "DISK_FULL"
    default:
      return "IO"
  }
}
