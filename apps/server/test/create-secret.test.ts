import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { type Harness, startRelay } from "./helpers"

let open: Harness
let guarded: Harness

beforeAll(() => {
  open = startRelay()
  guarded = startRelay({ createSecret: "s3cret", adminRatePerMin: 3 })
})

afterAll(async () => {
  await open.stop()
  await guarded.stop()
})

const check = (h: Harness, secret?: string, method = "POST") =>
  fetch(`${h.base}/create-secret/check`, {
    method,
    headers: secret === undefined ? {} : { "kimo-create-secret": secret },
  })

describe("POST /create-secret/check", () => {
  test("a relay without a secret accepts anyone", async () => {
    const res = await check(open)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ required: false, accepted: true })
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })

  test("the right secret is accepted, a wrong or missing one is CREATE_FORBIDDEN", async () => {
    const ok = await check(guarded, "s3cret")
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ required: true, accepted: true })
    for (const secret of ["wrong", undefined]) {
      const res = await check(guarded, secret)
      expect(res.status).toBe(403)
      expect(((await res.json()) as { error: string }).error).toBe("CREATE_FORBIDDEN")
    }
  })

  test("shares the admin rate limit", async () => {
    // Three admin requests per minute: the three above used them up.
    const res = await check(guarded, "s3cret")
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).not.toBeNull()
  })

  test("only POST", async () => {
    const res = await check(open, undefined, "GET")
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  test("preflight allows the secret header", async () => {
    const res = await fetch(`${open.base}/create-secret/check`, {
      method: "OPTIONS",
      headers: { origin: "https://app.example", "access-control-request-method": "POST" },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-headers")).toContain("kimo-create-secret")
  })
})
