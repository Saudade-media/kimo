import { describe, expect, test } from "bun:test"
import {
  createRelayFetch,
  createTauriCliHost,
  createTauriSecrets,
  createWebSecrets,
  providerAccount,
  WEB_SECRETS_KEY,
} from "../src/index"

describe("secrets", () => {
  test("account names are provider.<id>; path-like ids are refused", () => {
    expect(providerAccount("custom:ollama")).toBe("provider.custom:ollama")
    expect(() => providerAccount("../x")).toThrow()
  })

  test("web: keys live under one localStorage entry and only the last four show as a hint", async () => {
    const m = new Map<string, string>()
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => m.set(k, v),
      removeItem: (k: string) => m.delete(k),
    }
    const s = createWebSecrets(storage)
    await s.set("provider.anthropic", "sk-ant-api03-xyz3f9a")
    expect(JSON.parse(m.get(WEB_SECRETS_KEY) ?? "{}")).toEqual({
      "provider.anthropic": "sk-ant-api03-xyz3f9a",
    })
    expect(await s.hint("provider.anthropic")).toBe("3f9a")
    await s.delete("provider.anthropic")
    expect(m.has(WEB_SECRETS_KEY)).toBe(false)
  })

  test("desktop: the key goes to the keychain and is never read back into the page", async () => {
    const calls: [string, unknown][] = []
    const s = createTauriSecrets(async (cmd, args) => {
      calls.push([cmd, args])
      return cmd === "kimo_secret_has" ? true : null
    })
    expect(await s.has("provider.anthropic")).toBe(true)
    await s.set("provider.anthropic", "k")
    await expect(s.get("provider.anthropic")).rejects.toThrow()
    expect(calls.map((c) => c[0])).toEqual(["kimo_secret_has", "kimo_secret_set"])
    expect(calls[1]?.[1]).toEqual({ service: "kimo", account: "provider.anthropic", value: "k" })
  })

  test("relay fetch: strips auth headers, streams chunks from kimo://ai-response", async () => {
    const listeners: ((p: unknown) => void)[] = []
    let sent: Record<string, unknown> | undefined
    const bridge = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "kimo_ai_request") {
          sent = args
          const id = args?.requestId
          queueMicrotask(() => {
            for (const l of listeners)
              l({ requestId: id, status: 200, headers: { "content-type": "text/plain" } })
            for (const l of listeners) l({ requestId: id, chunkBase64: btoa("hello "), end: false })
            for (const l of listeners) l({ requestId: id, chunkBase64: btoa("world"), end: true })
          })
        }
        return null
      },
      listen: async (_e: string, h: (p: unknown) => void) => {
        listeners.push(h)
        return () => {}
      },
    }
    const f = createRelayFetch(
      bridge,
      () => ({ provider: "anthropic", auth: { kind: "header", header: "x-api-key" } }),
      () => "r1",
    )
    const res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "placeholder", "content-type": "application/json" },
      body: "{}",
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("hello world")
    expect((sent?.headers as Record<string, string> | undefined)?.["x-api-key"]).toBeUndefined()
    expect(sent?.provider).toBe("anthropic")
    expect(atob(String(sent?.bodyBase64))).toBe("{}")
  })
})

describe("cli agents (Tauri surface)", () => {
  test("spawn streams output events for its own process id and resolves exit", async () => {
    const listeners = new Map<string, ((p: unknown) => void)[]>()
    const emit = (e: string, p: unknown) => {
      for (const l of listeners.get(e) ?? []) l(p)
    }
    const host = createTauriCliHost({
      invoke: async (cmd) => {
        if (cmd === "kimo_cli_spawn") {
          setTimeout(() => {
            emit("kimo://cli-output", { processId: "p1", stream: "stdout", chunk: "line\n" })
            emit("kimo://cli-output", { processId: "p2", stream: "stdout", chunk: "other\n" })
            emit("kimo://cli-exit", { processId: "p1", code: 0, signal: null })
          }, 1)
          return { processId: "p1", pid: 42 }
        }
        return null
      },
      listen: async (e, h) => {
        listeners.set(e, [...(listeners.get(e) ?? []), h])
        return () => {}
      },
    })
    const p = await host.spawn({ path: "/b/claude", args: ["-p"], cwd: "/w" })
    let out = ""
    p.onStdout((c) => {
      out += c
    })
    expect(await p.exited).toEqual({ code: 0, signal: null })
    expect(out).toBe("line\n")
  })
})
