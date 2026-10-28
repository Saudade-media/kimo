/**
 * M6 secrets and the AI request relay (ADR 0014 §4).
 *
 * - **Desktop**: provider keys live in the OS keychain — service `kimo`, account
 *   `provider.<id>` (macOS Keychain, Windows Credential Manager, Secret Service on Linux). Keys
 *   never enter JS after they are saved: model calls go through the Rust relay
 *   (`kimo_ai_request`), which reads the key from the keychain, adds the auth header, performs
 *   the HTTP request (no CORS) and streams the body back. Bedrock / Vertex / Foundry are signed
 *   in Rust (SigV4, Google ADC, Entra).
 * - **Web**: keys are stored in `localStorage` under one key, `kimo.providers` (this origin
 *   only, never synced), with a visible warning; Anthropic additionally needs the explicit
 *   browser opt-in. Requests use the page's `fetch`.
 * - **Memory**: tests.
 *
 * Kept out of `TAURI_COMMANDS` (frozen by ADR 0012), like the M5 MCP commands.
 */
import { PlatformError } from "./errors"

/** Keychain service name (lead decision). */
const SECRET_SERVICE = "kimo"

/** Keychain account for a provider id: `provider.anthropic`, `provider.custom:ollama`. */
export function providerAccount(providerId: string): string {
  if (!/^[a-z0-9][a-z0-9:._-]{0,63}$/.test(providerId))
    throw new PlatformError("INVALID", `Invalid provider id ${providerId}`)
  return `provider.${providerId}`
}

/** Web storage key (board 22 "localStorage · kimo.providers (this origin only)"). */
export const WEB_SECRETS_KEY = "kimo.providers"

export type SecretsBackend = "keychain" | "localStorage" | "memory"

export interface SecretsApi {
  readonly backend: SecretsBackend
  /** Whether a secret exists (never returns the value on desktop). */
  has(account: string): Promise<boolean>
  /**
   * Returns the secret. Desktop: `UNSUPPORTED` — keys stay in Rust and are injected by the relay.
   * Web/memory: the stored value (needed for direct browser calls).
   */
  get(account: string): Promise<string | null>
  set(account: string, value: string): Promise<void>
  delete(account: string): Promise<void>
  /** Accounts with a stored secret (`provider.*`). */
  list(): Promise<string[]>
  /** Last 4 characters for the masked field ("sk-ant-api03-••••3f9a"); null when absent. */
  hint(account: string): Promise<string | null>
}

/** Minimal invoke shape (any Tauri `invoke`). */
export type InvokeLike = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
export type ListenLike = (event: string, handler: (payload: unknown) => void) => Promise<() => void>

// --- Tauri surface ------------------------------------------------------------------------------

/** One relayed AI request. `auth` tells Rust which keychain entry to inject, and how. */
export interface AiRelayRequest {
  requestId: string
  /** Provider id; the key is read from `kimo` / `provider.<id>`. */
  provider: string
  method: "GET" | "POST"
  /** https URL, `http://localhost…`/`http://127.0.0.1…` (local runtimes), or `kimo-relay://<bedrock|vertex|foundry>/…`. */
  url: string
  headers: Record<string, string>
  bodyBase64?: string
  auth:
    | { kind: "header"; header: string; scheme?: "Bearer" }
    | { kind: "none" }
    | {
        kind: "cloud"
        platform: "bedrock" | "vertex" | "foundry"
        region?: string
        /** Vertex: the Google Cloud project; Foundry: the resource. */
        project?: string
        /**
         * The provider card's credential choice. Bedrock: `profile` (static keys or SSO of
         * {@link profile}), `env` (`AWS_*` only) or `sso`; Vertex: `adc` (gcloud / env, never the
         * keychain) or `service-account` (the keychain JSON); Foundry: `entra` (Azure CLI token)
         * or `api-key` (the keychain key). Omitted: keychain first, then the platform's chain.
         * A key saved in the keychain always wins for Bedrock.
         */
        credentials?: string
        /** Bedrock: the AWS profile name (`~/.aws/config`); default `AWS_PROFILE`, then `default`. */
        profile?: string
      }
}

export interface AiRelayChunk {
  requestId: string
  /** First chunk: status + headers. */
  status?: number
  headers?: Record<string, string>
  chunkBase64?: string
  end: boolean
  /** Transport failure (DNS, TLS, refused): mapped to a network/offline ProviderError. */
  error?: string
}

export interface TauriSecretsCommandMap {
  kimo_secret_has: { args: { service: string; account: string }; result: boolean }
  kimo_secret_set: { args: { service: string; account: string; value: string }; result: null }
  kimo_secret_delete: { args: { service: string; account: string }; result: null }
  kimo_secret_list: { args: { service: string }; result: string[] }
  kimo_secret_hint: { args: { service: string; account: string }; result: string | null }
  /** Starts a relayed request; chunks arrive as `kimo://ai-response` events. */
  kimo_ai_request: { args: AiRelayRequest; result: null }
  kimo_ai_abort: { args: { requestId: string }; result: null }
}

export const TAURI_SECRETS_COMMANDS = [
  "kimo_secret_has",
  "kimo_secret_set",
  "kimo_secret_delete",
  "kimo_secret_list",
  "kimo_secret_hint",
  "kimo_ai_request",
  "kimo_ai_abort",
] as const satisfies readonly (keyof TauriSecretsCommandMap)[]

export interface TauriSecretsEventMap {
  "kimo://ai-response": AiRelayChunk
}

export const TAURI_SECRETS_EVENTS = [
  "kimo://ai-response",
] as const satisfies readonly (keyof TauriSecretsEventMap)[]

// --- Implementations ----------------------------------------------------------------------------

export function createTauriSecrets(invoke: InvokeLike): SecretsApi {
  const s = SECRET_SERVICE
  return {
    backend: "keychain",
    has: async (account) => (await invoke("kimo_secret_has", { service: s, account })) === true,
    get: async () => {
      throw new PlatformError(
        "UNSUPPORTED",
        "Desktop keys stay in the keychain; requests go through kimo_ai_request.",
      )
    },
    set: async (account, value) => {
      await invoke("kimo_secret_set", { service: s, account, value })
    },
    delete: async (account) => {
      await invoke("kimo_secret_delete", { service: s, account })
    },
    list: async () => (await invoke("kimo_secret_list", { service: s })) as string[],
    hint: async (account) =>
      (await invoke("kimo_secret_hint", { service: s, account })) as string | null,
  }
}

/** `localStorage`-like store (injected so tests need no DOM). */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createWebSecrets(storage: KeyValueStorage): SecretsApi {
  const read = (): Record<string, string> => {
    try {
      const v = JSON.parse(storage.getItem(WEB_SECRETS_KEY) ?? "{}")
      return v && typeof v === "object" ? (v as Record<string, string>) : {}
    } catch {
      return {}
    }
  }
  const write = (m: Record<string, string>) => {
    if (Object.keys(m).length) storage.setItem(WEB_SECRETS_KEY, JSON.stringify(m))
    else storage.removeItem(WEB_SECRETS_KEY)
  }
  return {
    backend: "localStorage",
    has: async (a) => a in read(),
    get: async (a) => read()[a] ?? null,
    set: async (a, v) => write({ ...read(), [a]: v }),
    delete: async (a) => {
      const m = read()
      delete m[a]
      write(m)
    },
    list: async () => Object.keys(read()).sort(),
    hint: async (a) => {
      const v = read()[a]
      return v ? v.slice(-4) : null
    },
  }
}

export function createMemorySecrets(initial: Record<string, string> = {}): SecretsApi {
  const m = new Map(Object.entries(initial))
  return {
    backend: "memory",
    has: async (a) => m.has(a),
    get: async (a) => m.get(a) ?? null,
    set: async (a, v) => {
      m.set(a, v)
    },
    delete: async (a) => {
      m.delete(a)
    },
    list: async () => [...m.keys()].sort(),
    hint: async (a) => m.get(a)?.slice(-4) ?? null,
  }
}

/** Copy shown under the web key field (board 22 web variant). */
export const WEB_SECRETS_WARNING =
  "Stored in this browser only (localStorage, this origin). Page scripts can read it; use the desktop app to keep keys in the OS keychain."

// --- Relay fetch (desktop) ----------------------------------------------------------------------

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  },
  decode(text: string): Uint8Array {
    const s = atob(text)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  },
}

/** Per-request routing the agent supplies (provider id and how the key is injected). */
export type RelayRoute = (url: string) => Pick<AiRelayRequest, "provider" | "auth">

/**
 * A WHATWG `fetch` over `kimo_ai_request` / `kimo://ai-response`: the adapters use it as their
 * fetch on desktop, so the key never enters JS and CORS does not apply. Auth headers set by an
 * SDK (placeholder keys) are stripped; Rust adds the real one.
 */
export function createRelayFetch(
  bridge: { invoke: InvokeLike; listen: ListenLike },
  route: RelayRoute,
  newId: () => string = () => crypto.randomUUID(),
): typeof fetch {
  const relay = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init)
    const requestId = newId()
    const { provider, auth } = route(req.url)
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => {
      if (!["authorization", "x-api-key", "x-goog-api-key"].includes(k.toLowerCase()))
        headers[k] = v
    })
    const body = req.method === "GET" ? undefined : new Uint8Array(await req.arrayBuffer())
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel() {
        void bridge.invoke("kimo_ai_abort", { requestId })
      },
    })
    let resolveHead!: (r: Response) => void
    let rejectHead!: (e: unknown) => void
    const head = new Promise<Response>((res, rej) => {
      resolveHead = res
      rejectHead = rej
    })
    let started = false
    const unlisten = await bridge.listen("kimo://ai-response", (payload) => {
      const c = payload as AiRelayChunk
      if (c.requestId !== requestId) return
      if (c.error) {
        const err = new TypeError(c.error)
        if (!started) rejectHead(err)
        else controller.error(err)
        void unlisten()
        return
      }
      if (!started && c.status !== undefined) {
        started = true
        resolveHead(new Response(stream, { status: c.status, headers: c.headers ?? {} }))
      }
      if (c.chunkBase64) controller.enqueue(b64.decode(c.chunkBase64))
      if (c.end) {
        controller.close()
        void unlisten()
      }
    })
    const signal = init?.signal ?? req.signal
    signal?.addEventListener(
      "abort",
      () => {
        void bridge.invoke("kimo_ai_abort", { requestId })
        const e = new DOMException("Aborted", "AbortError")
        if (!started) rejectHead(e)
        else controller.error(e)
        void unlisten()
      },
      { once: true },
    )
    const method = req.method === "GET" ? "GET" : "POST"
    await bridge.invoke("kimo_ai_request", {
      requestId,
      provider,
      method,
      url: req.url,
      headers,
      ...(body?.length ? { bodyBase64: b64.encode(body) } : {}),
      auth,
    } satisfies AiRelayRequest as unknown as Record<string, unknown>)
    return head
  }
  return relay as typeof fetch
}
