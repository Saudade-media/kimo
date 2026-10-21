/**
 * Relay ownership and pairing on the client (docs/spec/multiplayer.md §6.1, §6.2, §7.1, §16.9,
 * ADR 0017): this install's device key against a relay's owner set. Every call is one signed
 * request, stateless on this side, so any window (or the desktop document host) can make them.
 */
import {
  type AdminBody,
  formatPairingLink,
  fromHex,
  MultiplayerError,
  mintPairingToken,
  normalizeRelayUrl,
  type OwnerBody,
  type OwnerDevice,
  PAIRING_MAX_TTL_SECONDS,
  PAIRING_TTL_SECONDS,
  parsePairingLink,
  RelayHttpClient,
  type RelayInfo,
  randomBytes,
  signOwnerCommand,
  signRegisterOwner,
  toBase64Url,
  toHex,
} from "@kimo/sync/mp"
import { type DeviceKeyStore, devicePubOf } from "./device-key"

export type RelayOwnerState = "unclaimed" | "yours" | "other"

export interface RelayDevice extends OwnerDevice {
  /** This install's key. */
  self: boolean
}

export interface RelayOwnership {
  relayUrl: string
  state: RelayOwnerState
  /** Only when `yours`. */
  devices: RelayDevice[] | null
}

export interface IssuedPairingLink {
  link: string
  /** Hex of the 16-byte token id (what Cancel burns). */
  jti: string
  /** Unix seconds. */
  iat: number
  exp: number
}

export interface OwnershipDeps {
  deviceKeys: DeviceKeyStore
  /** Default device name (§16.9): the platform only. */
  deviceName(): string
  /** Base for pairing links: `location.origin` on web, `kimo:` on desktop. */
  webOrigin: string
  fetch?: typeof fetch
  now?: () => number
  /** Request timeout (ms). Default the client's 30 s. */
  timeoutMs?: number
}

export interface OwnershipClient {
  devicePublicKey(): Promise<string>
  relayOwnership(relayUrl: string): Promise<RelayOwnership>
  claimRelay(relayUrl: string, options?: { name?: string }): Promise<RelayDevice[]>
  listDevices(relayUrl: string): Promise<RelayDevice[]>
  removeDevice(relayUrl: string, pub: string): Promise<RelayDevice[]>
  renameDevice(relayUrl: string, pub: string, name: string): Promise<RelayDevice[]>
  createPairingLink(relayUrl: string, options?: { ttlSeconds?: number }): Promise<IssuedPairingLink>
  cancelPairingLink(relayUrl: string, link: IssuedPairingLink): Promise<void>
  acceptPairingLink(
    link: string,
    options?: { name?: string },
  ): Promise<{ relayUrl: string; devices: RelayDevice[]; added: boolean }>
  /**
   * The register body of a new room with this device's owner proof (§6): signed over the relay id,
   * the command's room, nonce and `iat`, and the root public key.
   */
  registerBody(
    relayUrl: string,
    input: {
      room: Parameters<typeof signRegisterOwner>[1]["room"]
      rootPub: Uint8Array
      cert: string
    },
    command: { nonce: Uint8Array; iat: number },
  ): Promise<Extract<AdminBody, { op: "register" }>>
  /** `/version` of a relay (`relayId` and `owner` included). */
  probe(relayUrl: string): Promise<RelayInfo>
}

/** Trims and shortens a device name to at most 64 UTF-8 bytes; falls back when nothing is left. */
export function cleanDeviceName(name: string, fallback: string): string {
  let text = name
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  const enc = new TextEncoder()
  while (enc.encode(text).length > 64) text = text.slice(0, -1).trimEnd()
  return text || fallback
}

export function createOwnershipClient(deps: OwnershipDeps): OwnershipClient {
  const now = deps.now ?? Date.now
  const client = (relayUrl: string) =>
    new RelayHttpClient({
      relayUrl,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    })
  /** Relay ids by normalized URL: a relay's id never changes, so one probe per relay is enough. */
  const ids = new Map<string, Uint8Array>()

  const probe = async (relayUrl: string) => {
    const info = await client(relayUrl).probe()
    ids.set(info.relayUrl, info.relayId)
    return info
  }
  const relayIdOf = async (relayUrl: string) => {
    const url = normalizeRelayUrl(relayUrl)
    return ids.get(url) ?? (await probe(url)).relayId
  }
  const name = (given?: string) =>
    cleanDeviceName(given ?? deps.deviceName(), cleanDeviceName(deps.deviceName(), "Kimo"))

  const send = async (relayUrl: string, body: OwnerBody) => {
    const keys = await deps.deviceKeys.get()
    const relayId = await relayIdOf(relayUrl)
    const command = await signOwnerCommand(keys, relayId, body, { iat: now() })
    return client(relayUrl).owner(command)
  }
  const withSelf = async (devices: OwnerDevice[] | null): Promise<RelayDevice[]> => {
    const self = await devicePubOf(await deps.deviceKeys.get())
    return (devices ?? []).map((d) => ({ ...d, self: d.pub === self }))
  }

  return {
    probe,
    devicePublicKey: async () => devicePubOf(await deps.deviceKeys.get()),

    async relayOwnership(relayUrl) {
      const url = normalizeRelayUrl(relayUrl)
      const info = await probe(url)
      if (info.owner === "unclaimed") return { relayUrl: url, state: "unclaimed", devices: null }
      try {
        const { devices } = await send(url, { op: "devices" })
        return { relayUrl: url, state: "yours", devices: await withSelf(devices) }
      } catch (error) {
        if (error instanceof MultiplayerError && error.code === "NOT_OWNER")
          return { relayUrl: url, state: "other", devices: null }
        // Reset between the probe and the list: the relay is unclaimed again.
        if (error instanceof MultiplayerError && error.code === "RELAY_UNCLAIMED")
          return { relayUrl: url, state: "unclaimed", devices: null }
        throw error
      }
    },

    async claimRelay(relayUrl, options) {
      const { devices } = await send(relayUrl, { op: "claim", name: name(options?.name) })
      return withSelf(devices)
    },

    async listDevices(relayUrl) {
      return withSelf((await send(relayUrl, { op: "devices" })).devices)
    },

    async removeDevice(relayUrl, pub) {
      return withSelf((await send(relayUrl, { op: "remove", pub })).devices)
    },

    async renameDevice(relayUrl, pub, newName) {
      const clean = cleanDeviceName(newName, "")
      if (!clean) throw new MultiplayerError("BAD_REQUEST", "a device needs a name")
      return withSelf((await send(relayUrl, { op: "rename", pub, name: clean })).devices)
    },

    async createPairingLink(relayUrl, options) {
      const url = normalizeRelayUrl(relayUrl)
      const ttl = Math.min(options?.ttlSeconds ?? PAIRING_TTL_SECONDS, PAIRING_MAX_TTL_SECONDS)
      const keys = await deps.deviceKeys.get()
      const iat = Math.floor(now() / 1000)
      const jti = randomBytes(16)
      const token = await mintPairingToken(keys, {
        iat,
        exp: iat + ttl,
        jti,
        relayId: await relayIdOf(url),
      })
      return {
        link: formatPairingLink({ webOrigin: deps.webOrigin, relayUrl: url, token }),
        jti: toHex(jti),
        iat,
        exp: iat + ttl,
      }
    },

    async cancelPairingLink(relayUrl, link) {
      if (fromHex(link.jti).length !== 16) throw new MultiplayerError("BAD_REQUEST", "invalid jti")
      await send(relayUrl, { op: "cancel-pairing", jti: link.jti, exp: link.exp })
    },

    async acceptPairingLink(text, options) {
      const parsed = parsePairingLink(text)
      await probe(parsed.relayUrl)
      const result = await send(parsed.relayUrl, {
        op: "pair",
        token: parsed.token,
        name: name(options?.name),
      })
      return {
        relayUrl: parsed.relayUrl,
        devices: await withSelf(result.devices),
        added: result.status === 201,
      }
    },

    async registerBody(relayUrl, input, command) {
      const keys = await deps.deviceKeys.get()
      const owner = await signRegisterOwner(keys, {
        relayId: await relayIdOf(relayUrl),
        room: input.room,
        nonce: command.nonce,
        iat: command.iat,
        rootPub: input.rootPub,
      })
      return { op: "register", rootPub: toBase64Url(input.rootPub), cert: input.cert, owner }
    },
  }
}
