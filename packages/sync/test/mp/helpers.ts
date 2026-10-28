import { concatBytes, fromHex } from "../../src/mp"

/** `seq(n, s)`: the `n` bytes `s, s+1, ...` (mod 256), as in the protocol test vectors. */
export function seq(n: number, start: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff)
}

const PKCS8_PREFIX = fromHex("302e020100300506032b657004220420")

/** An Ed25519 key pair from a 32-byte seed (PKCS#8 import), with the raw public key. */
export async function keyPairFromSeed(
  seed: Uint8Array,
): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; publicRaw: Uint8Array }> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    concatBytes(PKCS8_PREFIX, seed),
    { name: "Ed25519" },
    true,
    ["sign"],
  )
  const jwk = await crypto.subtle.exportKey("jwk", privateKey)
  const publicRaw = new Uint8Array(Buffer.from(jwk.x as string, "base64url"))
  const publicKey = await crypto.subtle.importKey("raw", publicRaw, { name: "Ed25519" }, true, [
    "verify",
  ])
  return { privateKey, publicKey, publicRaw }
}

/** Flips one bit of a copy of `bytes`. */
export function flipBit(bytes: Uint8Array, index: number, bit = 0): Uint8Array {
  const copy = bytes.slice()
  copy[index] = (copy[index] as number) ^ (1 << bit)
  return copy
}

/** Expects `promise` (or `fn`) to fail with a MultiplayerError of `code`. */
export async function expectCode(
  run: Promise<unknown> | (() => unknown),
  code: string,
): Promise<void> {
  try {
    await (typeof run === "function" ? run() : run)
  } catch (error) {
    const actual = (error as { code?: string }).code
    if (actual !== code) throw new Error(`expected ${code}, got ${actual ?? String(error)}`)
    return
  }
  throw new Error(`expected ${code}, but it succeeded`)
}
