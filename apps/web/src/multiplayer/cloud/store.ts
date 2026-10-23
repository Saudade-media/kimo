/**
 * Kimo Cloud in the app (board 43, ADR 0018), one store per window: the account and its plan as
 * Kimo Cloud last answered them, the email-link sign-in (section 2) and the checkout (section 3).
 *
 * - The plan always comes from Kimo Cloud, never from the payment provider (rule "Subscribe").
 * - Going offline keeps the last known account: no plan error, nothing blocked (rule "Offline").
 * - Sign-in polls every 2 s while "Check your inbox" shows, until the link's 15 minutes are up;
 *   the checkout polls every 3 s until it succeeds, fails or expires, and both refresh on window
 *   focus. Every loop is bounded by the expiry the service gave.
 */
import { type Clock, realClock } from "../relay-setup/runner"
import type { CloudClient } from "./client"
import {
  type BillingInterval,
  type CloudAccount,
  CloudError,
  type CloudErrorCode,
  type CloudPlans,
  type CloudRelay,
  isUnreachable,
} from "./types"

export const SIGN_IN_POLL_MS = 2000
export const CHECKOUT_POLL_MS = 3000

/** The plans until `GET /v1/plans` answers (placeholders until launch, like the board's copy). */
export const FALLBACK_PLANS: CloudPlans = {
  plans: [
    { interval: "month", amountCents: 800, currency: "usd" },
    { interval: "year", amountCents: 8000, currency: "usd" },
  ],
  storageLimitBytes: 10_000_000_000,
  taxIncluded: false,
}

export type CloudSession = "unknown" | "signed-out" | "signed-in"

export type SignInState =
  /** 2A: enter email. `error` from the last try (rate limited, email down, offline). */
  | { phase: "email"; email: string; busy: boolean; error: CloudErrorCode | null }
  /** 2B: check your inbox, polling. */
  | {
      phase: "sent"
      email: string
      requestId: string
      expiresAt: number
      resendAfter: number
      busy: boolean
      error: CloudErrorCode | null
    }
  /** 2C: signed in. */
  | { phase: "signed-in"; email: string }
  /** 2E: that link no longer works (expired, used or superseded). */
  | { phase: "expired"; email: string; busy: boolean; error: CloudErrorCode | null }

export type CheckoutState =
  /** 3A: choose billing. */
  | { phase: "choose"; interval: BillingInterval; busy: boolean; error: CloudErrorCode | null }
  /** 3B: finish in your browser, polling. */
  | {
      phase: "waiting"
      interval: BillingInterval
      checkoutId: string
      url: string
      expiresAt: number
    }
  /** 3C: the plan allows sharing. */
  | { phase: "ready" }
  /** 3D: payment did not go through. */
  | { phase: "failed"; interval: BillingInterval; busy: boolean; error: CloudErrorCode | null }

export interface CloudState {
  apiUrl: string
  session: CloudSession
  /** The last account Kimo Cloud answered (kept while offline). */
  account: CloudAccount | null
  plans: CloudPlans
  relay: CloudRelay | null
  /** The last call got no answer, or the service failed (6E). */
  offline: boolean
  refreshing: boolean
  signIn: SignInState
  checkout: CheckoutState
}

export interface CloudStoreDeps {
  client: CloudClient
  /** "Mac", "Chrome on Windows": the platform only (§2.4). */
  deviceName(): string
  clientKind: "web" | "desktop"
  /** Opens checkout, the billing portal: the system browser on desktop, a new tab on web. */
  openUrl(url: string): Promise<void>
  clock?: Clock
  /** Window focus (after checkout or the portal): default `window` focus. */
  onFocus?(fn: () => void): () => void
}

export interface CloudStore {
  subscribe(listener: () => void): () => void
  getState(): CloudState
  /** `GET /v1/account`: signed in or out, the plan, usage and devices; offline keeps the last. */
  refresh(): Promise<CloudState>
  /**
   * `GET /v1/plans` (public prices), asked only by a surface that shows Kimo Cloud. Once per store
   * when it answers; after a failure (offline) not again for {@link PLANS_RETRY_MS} unless
   * `force`. Never rejects.
   */
  loadPlans(options?: { force?: boolean }): Promise<void>
  /** Section 2. */
  setEmail(email: string): void
  startSignIn(email?: string): Promise<void>
  resend(): Promise<void>
  changeEmail(): void
  signOut(): Promise<void>
  /** Section 5: rename or sign out a device of the account (another one or this one). */
  renameDevice(pub: string, name: string): Promise<void>
  signOutDevice(pub: string): Promise<void>
  /** Section 3. */
  chooseInterval(interval: BillingInterval): void
  startCheckout(): Promise<void>
  reopenCheckout(): Promise<void>
  backToChoose(): void
  /** Manage billing, Update payment: the provider's customer portal. */
  openPortal(): Promise<void>
  /** `GET /v1/relay` (cached): the hosted relay's URL. */
  relay(): Promise<CloudRelay>
  dispose(): void
}

/** After a plans request that got no answer, surfaces opening again wait this long to ask. */
export const PLANS_RETRY_MS = 60_000

/** Email me a link is enabled once the field looks like an email (2A). */
export function looksLikeEmail(text: string): boolean {
  const t = text.trim()
  if (t.length > 254 || /\s/.test(t)) return false
  const at = t.indexOf("@")
  if (at < 1 || at !== t.lastIndexOf("@")) return false
  const domain = t.slice(at + 1)
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".")
}

const defaultOnFocus = (fn: () => void) => {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("focus", fn)
  return () => window.removeEventListener("focus", fn)
}

const codeOf = (error: unknown): CloudErrorCode =>
  error instanceof CloudError ? error.code : "UNKNOWN"

export function createCloudStore(deps: CloudStoreDeps): CloudStore {
  const { client } = deps
  const clock = deps.clock ?? realClock
  const listeners = new Set<() => void>()
  let state: CloudState = {
    apiUrl: client.apiUrl,
    session: "unknown",
    account: null,
    plans: FALLBACK_PLANS,
    relay: null,
    offline: false,
    refreshing: false,
    signIn: { phase: "email", email: "", busy: false, error: null },
    checkout: { phase: "choose", interval: "month", busy: false, error: null },
  }
  let disposed = false
  const set = (patch: Partial<CloudState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    for (const l of [...listeners]) l()
  }
  /** Network outcome of any call: an answer clears offline, no answer sets it. */
  const reached = () => {
    if (state.offline) set({ offline: false })
  }
  const failed = (error: unknown) => {
    if (isUnreachable(error)) set({ offline: true })
    else reached()
  }
  const signedOut = () =>
    set({
      session: "signed-out",
      account: null,
      relay: null,
      checkout: { phase: "choose", interval: "month", busy: false, error: null },
    })

  // --- Timers (one loop each, always bounded) -------------------------------------------------------
  let signInTimer: unknown = null
  let checkoutTimer: unknown = null
  const stopSignInPoll = () => {
    if (signInTimer !== null) clock.clearTimeout(signInTimer)
    signInTimer = null
  }
  const stopCheckoutPoll = () => {
    if (checkoutTimer !== null) clock.clearTimeout(checkoutTimer)
    checkoutTimer = null
  }

  // --- Account ------------------------------------------------------------------------------------------
  let refreshing: Promise<CloudState> | null = null
  const refresh = (): Promise<CloudState> => {
    refreshing ??= (async () => {
      set({ refreshing: true })
      try {
        const account = await client.account()
        set({ session: "signed-in", account, offline: false })
      } catch (error) {
        if (error instanceof CloudError && error.code === "NOT_SIGNED_IN") {
          reached()
          signedOut()
        } else failed(error)
      } finally {
        set({ refreshing: false })
        refreshing = null
      }
      return state
    })()
    return refreshing
  }

  // --- Sign in (section 2) ------------------------------------------------------------------------------
  const pollSignIn = (requestId: string) => {
    stopSignInPoll()
    signInTimer = clock.setTimeout(async () => {
      signInTimer = null
      const s = state.signIn
      if (s.phase !== "sent" || s.requestId !== requestId) return
      // The link is good for its 15 minutes; past them it is expired whatever the poll says.
      if (clock.now() > s.expiresAt + SIGN_IN_POLL_MS) {
        set({ signIn: { phase: "expired", email: s.email, busy: false, error: null } })
        return
      }
      try {
        const answer = await client.authPoll(requestId)
        reached()
        const now = state.signIn
        if (now.phase !== "sent" || now.requestId !== requestId) return
        if (answer.status === "verified") {
          set({
            session: "signed-in",
            account: answer.account,
            signIn: { phase: "signed-in", email: answer.account.account.email },
          })
          return
        }
        if (answer.status === "expired" || answer.status === "superseded") {
          set({ signIn: { phase: "expired", email: now.email, busy: false, error: null } })
          return
        }
      } catch (error) {
        failed(error)
        const now = state.signIn
        if (now.phase !== "sent" || now.requestId !== requestId) return
        if (error instanceof CloudError && error.code === "NOT_FOUND") {
          set({ signIn: { phase: "expired", email: now.email, busy: false, error: null } })
          return
        }
      }
      pollSignIn(requestId)
    }, SIGN_IN_POLL_MS)
  }

  const startSignIn = async (given?: string) => {
    const s = state.signIn
    const email = (given ?? (s.phase === "signed-in" ? "" : s.email)).trim()
    if (!looksLikeEmail(email)) return
    stopSignInPoll()
    if (s.phase === "sent" || s.phase === "expired")
      set({ signIn: { ...s, busy: true, error: null } })
    else set({ signIn: { phase: "email", email, busy: true, error: null } })
    try {
      const started = await client.authStart({
        email,
        deviceName: deps.deviceName(),
        client: deps.clientKind,
      })
      reached()
      set({
        signIn: {
          phase: "sent",
          email: started.email,
          requestId: started.requestId,
          expiresAt: started.expiresAt,
          resendAfter: started.resendAfter,
          busy: false,
          error: null,
        },
      })
      pollSignIn(started.requestId)
    } catch (error) {
      failed(error)
      if (error instanceof CloudError && error.code === "ALREADY_SIGNED_IN") {
        const after = await refresh()
        if (after.session === "signed-in" && after.account) {
          set({ signIn: { phase: "signed-in", email: after.account.account.email } })
          return
        }
      }
      const now = state.signIn
      const code = codeOf(error)
      set({
        signIn:
          now.phase === "sent" || now.phase === "expired"
            ? { ...now, busy: false, error: code }
            : { phase: "email", email, busy: false, error: code },
      })
      // A Resend that failed: the earlier link is still good, so keep waiting for it (and for its
      // expiry) as before.
      if (now.phase === "sent") pollSignIn(now.requestId)
    }
  }

  // --- Checkout (section 3) ---------------------------------------------------------------------------
  const ready = async () => {
    stopCheckoutPoll()
    await refresh()
    set({ checkout: { phase: "ready" } })
  }

  const pollCheckout = (checkoutId: string) => {
    stopCheckoutPoll()
    checkoutTimer = clock.setTimeout(async () => {
      checkoutTimer = null
      await checkCheckout(checkoutId)
    }, CHECKOUT_POLL_MS)
  }

  const checkCheckout = async (checkoutId: string) => {
    const c = state.checkout
    if (c.phase !== "waiting" || c.checkoutId !== checkoutId) return
    try {
      const answer = await client.checkoutStatus(checkoutId)
      reached()
      const now = state.checkout
      if (now.phase !== "waiting" || now.checkoutId !== checkoutId) return
      // Moves on when the plan allows sharing, not on `succeeded` alone (§6.2).
      if (answer.plan.canShare) return void (await ready())
      if (answer.status === "failed" || answer.status === "expired") {
        stopCheckoutPoll()
        set({ checkout: { phase: "failed", interval: now.interval, busy: false, error: null } })
        return
      }
    } catch (error) {
      failed(error)
    }
    const now = state.checkout
    if (now.phase !== "waiting" || now.checkoutId !== checkoutId) return
    // A checkout the provider never closed: past its expiry it did not go through.
    if (clock.now() > now.expiresAt + CHECKOUT_POLL_MS) {
      set({ checkout: { phase: "failed", interval: now.interval, busy: false, error: null } })
      return
    }
    pollCheckout(checkoutId)
  }

  const startCheckout = async () => {
    const c = state.checkout
    if (c.phase === "waiting" || c.phase === "ready") return
    const interval = c.interval
    set({ checkout: { ...c, busy: true, error: null } })
    try {
      const created = await client.checkout(interval)
      reached()
      set({
        checkout: {
          phase: "waiting",
          interval,
          checkoutId: created.checkoutId,
          url: created.url,
          expiresAt: created.expiresAt,
        },
      })
      pollCheckout(created.checkoutId)
      await deps.openUrl(created.url).catch(() => undefined)
    } catch (error) {
      failed(error)
      // Already paying (or paying late): the plan allows sharing, nothing to buy.
      if (
        error instanceof CloudError &&
        (error.code === "ALREADY_SUBSCRIBED" || error.code === "PAST_DUE")
      ) {
        const after = await refresh()
        if (after.account?.plan.canShare) {
          set({ checkout: { phase: "ready" } })
          return
        }
      }
      const now = state.checkout
      set({
        checkout:
          now.phase === "failed"
            ? { ...now, busy: false, error: codeOf(error) }
            : { phase: "choose", interval, busy: false, error: codeOf(error) },
      })
    }
  }

  // --- Plans (public prices) ---------------------------------------------------------------------------
  let plansLoaded = false
  let plansFailedAt: number | null = null
  let plansLoading: Promise<void> | null = null
  const loadPlans = (options?: { force?: boolean }): Promise<void> => {
    if (plansLoading) return plansLoading
    if (!options?.force) {
      if (plansLoaded) return Promise.resolve()
      if (plansFailedAt !== null && clock.now() - plansFailedAt < PLANS_RETRY_MS)
        return Promise.resolve()
    }
    plansLoading = (async () => {
      try {
        set({ plans: await client.plans() })
        plansLoaded = true
        plansFailedAt = null
        reached()
      } catch (error) {
        plansFailedAt = clock.now()
        failed(error)
      } finally {
        plansLoading = null
      }
    })()
    return plansLoading
  }

  // --- Focus --------------------------------------------------------------------------------------------
  const offFocus = (deps.onFocus ?? defaultOnFocus)(() => {
    if (state.session === "signed-in") void refresh()
    const c = state.checkout
    if (c.phase === "waiting") void checkCheckout(c.checkoutId)
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    refresh,
    loadPlans,
    setEmail(email) {
      const s = state.signIn
      if (s.phase === "email") set({ signIn: { ...s, email, error: null } })
    },
    startSignIn,
    async resend() {
      const s = state.signIn
      if (s.phase !== "sent" && s.phase !== "expired") return
      if (s.phase === "sent" && clock.now() < s.resendAfter) return
      await startSignIn(s.email)
    },
    changeEmail() {
      stopSignInPoll()
      const s = state.signIn
      set({
        signIn: {
          phase: "email",
          email: s.phase === "signed-in" ? "" : s.email,
          busy: false,
          error: null,
        },
      })
    },
    async signOut() {
      try {
        await client.signOut()
        reached()
      } catch (error) {
        failed(error)
        if (!(error instanceof CloudError && error.code === "NOT_SIGNED_IN")) throw error
      }
      const email = state.account?.account.email ?? ""
      stopSignInPoll()
      stopCheckoutPoll()
      signedOut()
      set({ signIn: { phase: "email", email, busy: false, error: null } })
    },
    async renameDevice(pub, name) {
      const devices = await client.renameDevice(pub, name).catch((error: unknown) => {
        failed(error)
        throw error
      })
      reached()
      if (state.account) set({ account: { ...state.account, devices } })
    },
    async signOutDevice(pub) {
      const self = state.account?.devices.find((d) => d.self)?.pub === pub
      const devices = await client.signOutDevice(pub).catch((error: unknown) => {
        failed(error)
        throw error
      })
      reached()
      if (self) {
        stopSignInPoll()
        stopCheckoutPoll()
        signedOut()
        set({ signIn: { phase: "email", email: "", busy: false, error: null } })
      } else if (state.account) set({ account: { ...state.account, devices } })
    },
    chooseInterval(interval) {
      const c = state.checkout
      if (c.phase === "choose" || c.phase === "failed") set({ checkout: { ...c, interval } })
    },
    startCheckout,
    async reopenCheckout() {
      const c = state.checkout
      if (c.phase === "waiting") await deps.openUrl(c.url)
    },
    backToChoose() {
      stopCheckoutPoll()
      const c = state.checkout
      set({
        checkout: {
          phase: "choose",
          interval: c.phase === "ready" ? "month" : c.interval,
          busy: false,
          error: null,
        },
      })
    },
    async openPortal() {
      try {
        const portal = await client.billingPortal()
        reached()
        await deps.openUrl(portal.url)
      } catch (error) {
        failed(error)
        throw error
      }
    },
    async relay() {
      if (state.relay) return state.relay
      try {
        const relay = await client.relay()
        reached()
        set({ relay })
        return relay
      } catch (error) {
        failed(error)
        if (error instanceof CloudError && error.code === "NOT_SIGNED_IN") signedOut()
        throw error
      }
    },
    dispose() {
      stopSignInPoll()
      stopCheckoutPoll()
      offFocus()
      listeners.clear()
      disposed = true
    },
  }
}
