/** Shared HTTP plumbing for the fetch-based adapters (OpenAI-compatible, Gemini). */
import { classifyFetchFailure, kindForStatus, ProviderError, retryAfterFrom } from "../errors"
import type { ProviderRuntime } from "./provider"

export async function postStream(
  runtime: ProviderRuntime,
  provider: string,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response
  try {
    res = await runtime.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
  } catch (e) {
    throw classifyFetchFailure(e, {
      provider,
      online: runtime.online(),
      web: runtime.platform === "web",
    })
  }
  if (!res.ok) throw await httpError(provider, res)
  if (!res.body) throw new ProviderError("server", "Empty response body.", { provider })
  return res
}

export async function getJson(
  runtime: ProviderRuntime,
  provider: string,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  let res: Response
  try {
    res = await runtime.fetch(url, { headers, ...(signal ? { signal } : {}) })
  } catch (e) {
    throw classifyFetchFailure(e, {
      provider,
      online: runtime.online(),
      web: runtime.platform === "web",
    })
  }
  if (!res.ok) throw await httpError(provider, res)
  return res.json()
}

export async function httpError(provider: string, res: Response): Promise<ProviderError> {
  let message = `${res.status} ${res.statusText}`.trim()
  let code: string | undefined
  try {
    const text = await res.text()
    const j = JSON.parse(text) as {
      error?: { message?: string; type?: string; code?: string | number; status?: string }
    }
    const err = Array.isArray(j) ? (j[0] as typeof j)?.error : j.error
    if (err?.message) message = `${res.status} ${err.message}`
    code = (err?.type ?? err?.status ?? (err?.code !== undefined ? String(err.code) : undefined)) as
      | string
      | undefined
  } catch {
    // keep the status line
  }
  const retryAfterMs = retryAfterFrom(res.headers)
  return new ProviderError(kindForStatus(res.status, code ?? message), message, {
    provider,
    status: res.status,
    ...(code ? { providerCode: code } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  })
}

/** Parses a tool-call argument string; malformed JSON becomes `{}` plus a flag for the loop. */
export function parseArgs(text: string): { input: Record<string, unknown>; ok: boolean } {
  if (!text.trim()) return { input: {}, ok: true }
  try {
    const v = JSON.parse(text)
    return v && typeof v === "object" && !Array.isArray(v)
      ? { input: v as Record<string, unknown>, ok: true }
      : { input: {}, ok: false }
  } catch {
    return { input: {}, ok: false }
  }
}

export const trimSlash = (u: string): string => u.replace(/\/+$/, "")
