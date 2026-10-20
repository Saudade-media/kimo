import { describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config"

const MiB = 1 << 20

describe("loadConfig (section 14.9)", () => {
  test("defaults", () => {
    expect(loadConfig({})).toEqual({
      port: 8787,
      hostname: "127.0.0.1",
      dataDir: "./data",
      allowedOrigins: "*",
      createSecret: null,
      maxRooms: 0,
      maxPeers: 32,
      roomQuotaBytes: 500 * MiB,
      blobMaxBytes: 20 * MiB,
      entryMaxBytes: 4 * MiB,
      snapshotMaxBytes: 64 * MiB,
      logMaxBytes: 32 * MiB,
      compactEntries: 1000,
      compactBytes: 8388608,
      logRetainMs: 600000,
      roomTtlDays: 0,
      sweepGraceDays: 30,
      trustProxy: false,
      trustProxyHops: 1,
      connectRatePerMin: 30,
      adminRatePerMin: 30,
      blobRatePerMin: 60,
    })
  })

  test("every variable is parsed", () => {
    const config = loadConfig({
      PORT: "9000",
      HOST: "0.0.0.0",
      KIMO_DATA_DIR: "/data",
      KIMO_ALLOWED_ORIGINS: "https://app.example, http://localhost:5173/",
      KIMO_CREATE_SECRET: "hunter2",
      KIMO_MAX_ROOMS: "10",
      KIMO_MAX_PEERS: "8",
      KIMO_ROOM_QUOTA_MB: "100",
      KIMO_BLOB_MAX_MB: "5",
      KIMO_ENTRY_MAX_MB: "2",
      KIMO_SNAPSHOT_MAX_MB: "16",
      KIMO_LOG_MAX_MB: "8",
      KIMO_COMPACT_ENTRIES: "50",
      KIMO_COMPACT_BYTES: "1024",
      KIMO_LOG_RETAIN_MS: "1000",
      KIMO_ROOM_TTL_DAYS: "90",
      KIMO_SWEEP_GRACE_DAYS: "7",
      KIMO_TRUST_PROXY: "1",
      KIMO_TRUST_PROXY_HOPS: "2",
      KIMO_RATE_CONNECT_PER_MIN: "5",
      KIMO_RATE_ADMIN_PER_MIN: "6",
      KIMO_RATE_BLOB_PER_MIN: "7",
    })
    expect(config).toEqual({
      port: 9000,
      hostname: "0.0.0.0",
      dataDir: "/data",
      allowedOrigins: ["https://app.example", "http://localhost:5173"],
      createSecret: "hunter2",
      maxRooms: 10,
      maxPeers: 8,
      roomQuotaBytes: 100 * MiB,
      blobMaxBytes: 5 * MiB,
      entryMaxBytes: 2 * MiB,
      snapshotMaxBytes: 16 * MiB,
      logMaxBytes: 8 * MiB,
      compactEntries: 50,
      compactBytes: 1024,
      logRetainMs: 1000,
      roomTtlDays: 90,
      sweepGraceDays: 7,
      trustProxy: true,
      trustProxyHops: 2,
      connectRatePerMin: 5,
      adminRatePerMin: 6,
      blobRatePerMin: 7,
    })
  })

  test("empty values fall back to defaults", () => {
    expect(loadConfig({ PORT: "", KIMO_CREATE_SECRET: "", KIMO_DATA_DIR: " " }).port).toBe(8787)
    expect(loadConfig({ KIMO_CREATE_SECRET: "" }).createSecret).toBeNull()
  })

  test.each([
    ["PORT", "abc"],
    ["PORT", "70000"],
    ["PORT", "-1"],
    ["KIMO_ALLOWED_ORIGINS", "not a url"],
    ["KIMO_ALLOWED_ORIGINS", "ftp://x.example"],
    // The desktop origins are admitted by the relay itself, never listed.
    ["KIMO_ALLOWED_ORIGINS", "tauri://localhost"],
    ["KIMO_MAX_ROOMS", "-3"],
    ["KIMO_MAX_PEERS", "0"],
    ["KIMO_TRUST_PROXY_HOPS", "0"],
    ["KIMO_ROOM_QUOTA_MB", "1.5"],
    ["KIMO_BLOB_MAX_MB", "0"],
    ["KIMO_ENTRY_MAX_MB", "x"],
    ["KIMO_SNAPSHOT_MAX_MB", "0"],
    ["KIMO_LOG_MAX_MB", "0"],
    ["KIMO_COMPACT_ENTRIES", "0"],
    ["KIMO_COMPACT_BYTES", "0"],
    ["KIMO_LOG_RETAIN_MS", "-1"],
    ["KIMO_ROOM_TTL_DAYS", "forever"],
    ["KIMO_SWEEP_GRACE_DAYS", "0"],
    ["KIMO_TRUST_PROXY", "yes"],
    ["KIMO_RATE_CONNECT_PER_MIN", "0"],
    ["KIMO_RATE_ADMIN_PER_MIN", "0"],
    ["KIMO_RATE_BLOB_PER_MIN", "0"],
  ])("an invalid %s=%s throws naming the variable", (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(name)
  })
})
