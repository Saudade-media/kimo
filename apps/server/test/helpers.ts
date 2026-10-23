/**
 * Shared test fixtures: owners, tokens, admin calls and a frame-queue WebSocket client. Every
 * relay starts owned by {@link device} (`KIMO_OWNER_KEY`), and register carries its owner proof,
 * unless a test says otherwise.
 */
import {
  type AdminBody,
  type ClientMessage,
  decodeRelayMessage,
  deriveRoomId,
  deriveRoomKeys,
  encodeClientMessage,
  exportPublicKey,
  generateRoomKey,
  generateSigningKeyPair,
  type LinkCert,
  type MpOrigin,
  mintToken,
  type OwnerBody,
  type RelayMessage,
  type RoomId,
  type RoomKeys,
  randomBytes,
  SUBPROTOCOL,
  sealSnapshot,
  sealUpdate,
  signAdminCommand,
  signLinkCert,
  signOwnerCommand,
  signRegisterOwner,
  type TokenRole,
  toBase64Url,
} from "@kimo/sync/mp"
import { createServer, type OwnerPolicyModule, type RelayConfig, relayOf } from "../src/index"

/** The device that owns every test relay unless a test passes its own `ownerKeys`. */
export const device = await generateSigningKeyPair()
export const devicePub = await exportPublicKey(device.publicKey)

export interface Owner {
  root: CryptoKeyPair
  rootPub: Uint8Array
  room: RoomId
  link: CryptoKeyPair
  linkPub: Uint8Array
  kid: number
  cert: LinkCert
  roomKey: Uint8Array
  keys: RoomKeys
}

export async function makeOwner(kid = 1, iat = Math.floor(Date.now() / 1000)): Promise<Owner> {
  const root = await generateSigningKeyPair()
  const rootPub = await exportPublicKey(root.publicKey)
  const room = await deriveRoomId(rootPub)
  const link = await generateSigningKeyPair()
  const linkPub = await exportPublicKey(link.publicKey)
  const cert = await signLinkCert(root.privateKey, { kid, iat, room, linkPub })
  const roomKey = generateRoomKey()
  return {
    root,
    rootPub,
    room,
    link,
    linkPub,
    kid,
    cert,
    roomKey,
    keys: await deriveRoomKeys(roomKey, room),
  }
}

/** A fresh link key and certificate with a higher kid. */
export async function rotateOwner(owner: Owner, kid: number, iat = Math.floor(Date.now() / 1000)) {
  const link = await generateSigningKeyPair()
  const linkPub = await exportPublicKey(link.publicKey)
  const cert = await signLinkCert(owner.root.privateKey, { kid, iat, room: owner.room, linkPub })
  return { ...owner, link, linkPub, kid, cert }
}

export interface TokenOptions {
  exp?: number
  origin?: MpOrigin
  jti?: Uint8Array
  kid?: number
  iat?: number
}

export function token(owner: Owner, role: TokenRole, options: TokenOptions = {}): Promise<string> {
  return mintToken(owner.link.privateKey, {
    room: owner.room,
    role,
    kid: options.kid ?? owner.kid,
    iat: options.iat ?? Math.floor(Date.now() / 1000),
    exp: options.exp ?? 0,
    jti: options.jti ?? randomBytes(16),
    origin: options.origin ?? "user",
  })
}

export interface Harness {
  server: ReturnType<typeof createServer>
  base: string
  wsBase: string
  relay: ReturnType<typeof relayOf>
  clock: { now: number }
  stop(): Promise<void>
}

export function startRelay(
  config: Partial<RelayConfig> = {},
  options: { realTime?: boolean; ownerPolicy?: OwnerPolicyModule } = {},
): Harness {
  const clock = { now: Date.now() }
  const server = createServer({
    port: 0,
    config: {
      dataDir: ":memory:",
      connectRatePerMin: 1_000_000,
      adminRatePerMin: 1_000_000,
      blobRatePerMin: 1_000_000,
      ownerKeys: [devicePub],
      ...config,
    },
    ...(options.realTime ? { tickMs: 250 } : { now: () => clock.now, tickMs: 3_600_000 }),
    ...(options.ownerPolicy ? { ownerPolicy: options.ownerPolicy } : {}),
  })
  const base = server.url.href.replace(/\/$/, "")
  return {
    server,
    base,
    wsBase: base.replace(/^http/, "ws"),
    relay: relayOf(server),
    clock,
    stop: () => server.stop(true),
  }
}

/**
 * Signs and posts an admin command. A register body without `owner` gets the proof of
 * `options.device` (default {@link device}); `device: null` sends none.
 */
export async function admin(
  h: Harness,
  owner: Owner,
  body: AdminBody | Omit<Extract<AdminBody, { op: "register" }>, "owner">,
  options: {
    iat?: number
    nonce?: Uint8Array
    signer?: CryptoKey
    device?: CryptoKeyPair | null
    relayId?: Uint8Array
  } = {},
): Promise<Response> {
  const iat = options.iat ?? h.clock.now
  const nonce = options.nonce ?? randomBytes(16)
  let full = body as AdminBody
  if (body.op === "register" && !("owner" in body) && options.device !== null)
    full = {
      ...body,
      owner: await signRegisterOwner(options.device ?? device, {
        relayId: options.relayId ?? h.relay.relayId,
        room: owner.room,
        nonce,
        iat,
        rootPub: owner.rootPub,
      }),
    }
  const bytes = await signAdminCommand(options.signer ?? owner.root.privateKey, owner.room, full, {
    iat,
    nonce,
  })
  return fetch(`${h.base}/room/${owner.room.id}/admin`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes as Uint8Array<ArrayBuffer>,
  })
}

export function register(
  h: Harness,
  owner: Owner,
  options: { device?: CryptoKeyPair | null } = {},
): Promise<Response> {
  return admin(
    h,
    owner,
    { op: "register", rootPub: toBase64Url(owner.rootPub), cert: toBase64Url(owner.cert.bytes) },
    options,
  )
}

/** Signs and posts an owner command (§6.1) for `keys` (default {@link device}). */
export async function ownerCommand(
  h: Harness,
  body: OwnerBody,
  options: { keys?: CryptoKeyPair; iat?: number; nonce?: Uint8Array; relayId?: Uint8Array } = {},
): Promise<Response> {
  const bytes = await signOwnerCommand(
    options.keys ?? device,
    options.relayId ?? h.relay.relayId,
    body,
    { iat: options.iat ?? h.clock.now, ...(options.nonce ? { nonce: options.nonce } : {}) },
  )
  return fetch(`${h.base}/owner`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes as Uint8Array<ArrayBuffer>,
  })
}

export async function registered(h: Harness, kid = 1): Promise<Owner> {
  const owner = await makeOwner(kid, Math.floor(h.clock.now / 1000))
  const res = await register(h, owner)
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`)
  return owner
}

export class Client {
  readonly messages: RelayMessage[] = []
  private waiters: (() => void)[] = []
  readonly closed: Promise<{ code: number; reason: string }>
  private constructor(readonly ws: WebSocket) {
    ws.binaryType = "arraybuffer"
    ws.onmessage = (event) => {
      const msg = decodeRelayMessage(new Uint8Array(event.data as ArrayBuffer))
      if (msg) this.messages.push(msg)
      for (const wake of this.waiters.splice(0)) wake()
    }
    this.closed = new Promise((resolve) => {
      ws.onclose = (event) => {
        resolve({ code: event.code, reason: event.reason })
        for (const wake of this.waiters.splice(0)) wake()
      }
    })
  }

  static async connect(h: Harness, room: string): Promise<Client> {
    const ws = new WebSocket(`${h.wsBase}/sync/${room}`, [SUBPROTOCOL])
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error("websocket failed to open"))
    })
    return new Client(ws)
  }

  /** Connect, send hello and wait for the welcome. */
  static async join(
    h: Harness,
    room: string,
    tokenText: string,
    since = 0,
  ): Promise<{ client: Client; welcome: Extract<RelayMessage, { type: "welcome" }> }> {
    const client = await Client.connect(h, room)
    client.send({ type: "hello", proto: 1, token: tokenText, since, client: "test/1" })
    const welcome = await client.next("welcome")
    return { client, welcome }
  }

  send(message: ClientMessage): void {
    this.ws.send(encodeClientMessage(message) as Uint8Array<ArrayBuffer>)
  }

  sendRaw(bytes: Uint8Array): void {
    this.ws.send(bytes as Uint8Array<ArrayBuffer>)
  }

  /** Next message of `type` (earlier other messages are dropped). */
  async next<T extends RelayMessage["type"]>(
    type: T,
    timeoutMs = 3000,
  ): Promise<Extract<RelayMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const index = this.messages.findIndex((m) => m.type === type)
      if (index >= 0) {
        const [msg] = this.messages.splice(index, 1)
        return msg as Extract<RelayMessage, { type: T }>
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${type}`)
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }

  /** Waits for the socket to close. */
  async closeInfo(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    return Promise.race([
      this.closed,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("socket did not close")), timeoutMs),
      ),
    ])
  }

  /** Lets queued frames arrive, then returns the buffered messages of `type`. */
  async drain(type: RelayMessage["type"], waitMs = 150): Promise<RelayMessage[]> {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    const taken = this.messages.filter((m) => m.type === type)
    for (const m of taken) this.messages.splice(this.messages.indexOf(m), 1)
    return taken
  }

  close(): void {
    this.ws.close()
  }
}

export function update(owner: Owner, text: string): Promise<Uint8Array> {
  return sealUpdate(owner.keys, new TextEncoder().encode(text))
}

export const bearer = (tokenText: string) => ({ authorization: `Bearer ${tokenText}` })

/** Polls until `check` is truthy (default 3 s). */
export async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Joins as `role` with a fresh token; returns the client and its welcome. */
export async function joinAs(
  h: Harness,
  owner: Owner,
  role: "view" | "edit",
  options: TokenOptions & { since?: number } = {},
) {
  const text = await token(owner, role, { iat: Math.floor(h.clock.now / 1000), ...options })
  return Client.join(h, owner.room.id, text, options.since ?? 0)
}

export const upgradeHeaders = (protocol?: string, extra: Record<string, string> = {}) => ({
  upgrade: "websocket",
  connection: "Upgrade",
  "sec-websocket-version": "13",
  "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
  ...(protocol ? { "sec-websocket-protocol": protocol } : {}),
  ...extra,
})

/** Inserts log entries straight into storage (fast setup for catch-up tests). */
export function seedLog(h: Harness, owner: Owner, count: number, bytes = 40): void {
  const env = new Uint8Array(bytes)
  env[0] = 1
  env[1] = 1
  for (let i = 0; i < count; i++)
    h.relay.db.appendLog(owner.room.id, "user", new Uint8Array(16), h.clock.now, env)
}

export function putSnapshotRaw(
  h: Harness,
  owner: Owner,
  tokenText: string,
  upTo: number,
  options: { carries?: boolean; body?: Uint8Array } = {},
): Promise<Response> {
  return (async () => {
    const body =
      options.body ??
      (await sealSnapshot(owner.keys, upTo, new TextEncoder().encode(`state@${upTo}`)))
    const query = `upTo=${upTo}${options.carries ? "&carries=1" : ""}`
    return fetch(`${h.base}/room/${owner.room.id}/snapshot?${query}`, {
      method: "PUT",
      headers: bearer(tokenText),
      body: body as Uint8Array<ArrayBuffer>,
    })
  })()
}

/** Sends `caught-up` and waits until the relay processed it. */
export async function markCaughtUp(client: Client, seq = 0): Promise<void> {
  client.send({ type: "caught-up", seq })
  client.send({ type: "ping", n: 777 })
  await client.next("pong")
}
