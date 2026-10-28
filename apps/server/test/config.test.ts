import { describe, expect, test } from "bun:test"
import { toBase64Url } from "@kimo/sync/mp"
import { loadConfig } from "../src/config"

const MiB = 1 << 20
const KEY_A = toBase64Url(new Uint8Array(32).fill(1))
const KEY_B = toBase64Url(new Uint8Array(32).fill(2))

describe("loadConfig", () => {
  test("lists are trimmed, owner keys deduplicated, sizes read in MB, flags parsed", () => {
    const config = loadConfig({
      PORT: "9000",
      KIMO_ALLOWED_ORIGINS: "https://app.example, http://localhost:5173/",
      KIMO_OWNER_KEY: ` ${KEY_A}, ${KEY_B},${KEY_A} `,
      KIMO_RESET_OWNER: " 2026-10-21 ",
      KIMO_BLOB_MAX_MB: "5",
      KIMO_TRUST_PROXY: "1",
      KIMO_TRUST_PROXY_HOPS: "2",
    })
    expect(config).toMatchObject({
      port: 9000,
      allowedOrigins: ["https://app.example", "http://localhost:5173"],
      ownerKeys: [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)],
      resetOwner: "2026-10-21",
      blobMaxBytes: 5 * MiB,
      trustProxy: true,
      trustProxyHops: 2,
    })
  })

  test("empty values fall back to defaults", () => {
    expect(loadConfig({ PORT: "", KIMO_OWNER_KEY: "", KIMO_DATA_DIR: " " }).port).toBe(8787)
    expect(loadConfig({ KIMO_OWNER_KEY: " " }).ownerKeys).toEqual([])
    expect(loadConfig({ KIMO_RESET_OWNER: "  " }).resetOwner).toBeNull()
  })

  test.each([
    ["PORT", "abc"],
    ["PORT", "70000"],
    ["KIMO_ALLOWED_ORIGINS", "not a url"],
    // The desktop origins are admitted by the relay itself, never listed.
    ["KIMO_ALLOWED_ORIGINS", "tauri://localhost"],
    ["KIMO_OWNER_KEY", "not-a-key"],
    ["KIMO_OWNER_KEY", toBase64Url(new Uint8Array(31))],
    ["KIMO_MAX_PEERS", "0"],
    ["KIMO_ROOM_QUOTA_MB", "1.5"],
    ["KIMO_TRUST_PROXY", "yes"],
    ["KIMO_RATE_CONNECT_PER_MIN", "0"],
  ])("an invalid %s=%s throws naming the variable", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(name)
  })
})
