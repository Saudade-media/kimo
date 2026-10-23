/**
 * Live text end to end (ADR 0016 item 17): two real stores type into the same text layer at the
 * same time through real network providers and the real relay (in process). They converge with
 * every character of both, and a keystroke reaches the other store well under 200 ms locally.
 */
import { describe, expect, test } from "bun:test"
import { createEmptyDocument, YjsDocStore } from "@kimo/editor-state"
import * as sync from "@kimo/sync"
import { sealSnapshot } from "@kimo/sync/mp"
import { bearer, type Harness, type Owner, registered, startRelay, token, until } from "./helpers"

const ID = "Text000001"
const text = (s: YjsDocStore) => (s.textRuns(ID) ?? []).map((r) => r.text).join("")

async function seeded(h: Harness): Promise<{ owner: Owner; seed: YjsDocStore }> {
  const owner = await registered(h)
  const seed = new YjsDocStore()
  seed.loadDocument(createEmptyDocument("Live text"))
  const r = seed.apply(
    { op: "insert", id: ID, node: { type: "text", content: "Hello world" } as never },
    { origin: "user" },
  )
  if (!r.ok) throw new Error(JSON.stringify(r))
  const env = await sealSnapshot(owner.keys, 0, seed.encodeStateAsUpdate())
  const res = await fetch(`${h.base}/room/${owner.room.id}/snapshot?upTo=0`, {
    method: "PUT",
    headers: bearer(await token(owner, "edit")),
    body: env as Uint8Array<ArrayBuffer>,
  })
  expect(res.status).toBe(201)
  return { owner, seed }
}

function provider(h: Harness, owner: Owner, tokenText: string) {
  return sync.createNetworkProvider({
    relayUrl: h.base,
    room: owner.room.id,
    token: tokenText,
    roomKey: owner.roomKey,
    backoff: [5, 40],
  })
}

/** Types `word` into `store` one character at a time, `gap` ms apart, at `at()` each time. */
async function type(store: YjsDocStore, word: string, at: () => number, gap: number) {
  for (const ch of word) {
    const r = store.editText(ID, [{ op: "insert", at: at(), text: ch }], { origin: "user" })
    if (!r.ok) throw new Error(JSON.stringify(r))
    await Bun.sleep(gap)
  }
}

describe("live text through the relay", () => {
  test("two people typing in one text layer converge, nothing lost, under 200 ms", async () => {
    const h = startRelay({}, { realTime: true })
    try {
      const { owner, seed } = await seeded(h)
      const a = seed
      const b = new YjsDocStore()
      const pa = provider(h, owner, await token(owner, "edit"))
      const pb = provider(h, owner, await token(owner, "edit"))
      await pa.attach(a)
      await pb.attach(b)
      await until(() => text(b) === "Hello world", 5000)

      // Latency: one keystroke on A shows on B.
      const t0 = performance.now()
      a.editText(ID, [{ op: "insert", at: 11, text: "!" }], { origin: "user" })
      await until(() => text(b) === "Hello world!", 2000)
      const latency = performance.now() - t0
      console.log(`live text: one keystroke reached the other store in ${latency.toFixed(1)} ms`)
      expect(latency).toBeLessThan(200)

      // Both type at once: A at the start of "world", B at the end of the text.
      const aWord = "brave new "
      const bWord = " and more"
      await Promise.all([
        type(a, aWord, () => text(a).indexOf("world"), 7),
        type(b, bWord, () => text(b).length, 5),
      ])
      await until(
        () => text(a) === text(b) && text(a).length === 12 + aWord.length + bWord.length,
        5000,
      )
      expect(text(a)).toBe(`Hello ${aWord}world! and more`)
      expect(a.toDocument()).toEqual(b.toDocument())
      // The file shape is unchanged: a plain string.
      expect(typeof b.getNode(ID)?.content).toBe("string")

      await Promise.all([pa.detach(), pb.detach()])
    } finally {
      await h.stop()
    }
  })
})
