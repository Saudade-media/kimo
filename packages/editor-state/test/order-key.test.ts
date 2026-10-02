import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  isFractionalKey,
  isOrderKey,
  keyBetween,
  keysBetween,
  MAX_ORDER_KEY_LENGTH,
  ORDER_DIGITS,
  OrderKeyError,
  planInsertKeys,
} from "../src/index"
import { rng } from "./helpers"

const RUNS = Number(process.env.KIMO_PROPERTY_RUNS ?? 200)
const det = { jitter: 0 }
const keyArb = fc.string({
  unit: fc.constantFrom(...ORDER_DIGITS.split("")),
  minLength: 1,
  maxLength: 12,
})

describe("keyBetween", () => {
  test("starts at a0 and appends/prepends with short keys", () => {
    expect(keyBetween(null, null, det)).toBe("a0")
    expect(keyBetween("a0", null, det)).toBe("a1")
    expect(keyBetween(null, "a0", det)).toBe("Zz")
    expect(keyBetween("a0", "a1", det)).toBe("a0V")
  })

  test("keys sort by code unit like digits", () => {
    const sorted = [...ORDER_DIGITS].sort()
    expect(sorted.join("")).toBe(ORDER_DIGITS)
  })

  test("1000 appends stay short and increasing", () => {
    let k: string | null = null
    for (let i = 0; i < 1000; i++) {
      const next = keyBetween(k, null, { random: rng(i) })
      if (k !== null) expect(next > k).toBe(true)
      k = next
    }
    expect((k as string).length).toBeLessThanOrEqual(8)
  })

  test("repeated inserts at the front stay ordered", () => {
    let k: string | null = null
    for (let i = 0; i < 300; i++) {
      const next = keyBetween(null, k, { random: rng(i) })
      if (k !== null) expect(next < k).toBe(true)
      expect(isOrderKey(next)).toBe(true)
      k = next
    }
  })

  test("jitter makes concurrent inserts at the same spot differ", () => {
    const a = keyBetween("a0", "a1", { random: rng(1) })
    const b = keyBetween("a0", "a1", { random: rng(2) })
    expect(a).not.toBe(b)
    for (const k of [a, b]) {
      expect(k > "a0" && k < "a1").toBe(true)
      expect(isFractionalKey(k)).toBe(true)
    }
  })

  test("works between arbitrary legal (non-fractional) keys", () => {
    expect(keyBetween("1", "2", det) > "1").toBe(true)
    expect(keyBetween("1", "2", det) < "2").toBe(true)
    expect(keyBetween("zz", null, det) > "zz").toBe(true)
    expect(keyBetween(null, "1", det) < "1").toBe(true)
  })

  test("rejects impossible and malformed bounds", () => {
    expect(() => keyBetween("a1", "a0")).toThrow(OrderKeyError)
    expect(() => keyBetween("a0", "a0")).toThrow(OrderKeyError)
    expect(() => keyBetween(null, "0")).toThrow(OrderKeyError)
    expect(() => keyBetween("a", "a0")).toThrow(OrderKeyError)
    expect(() => keyBetween("a-b", null)).toThrow(OrderKeyError)
  })

  test("property: a < keyBetween(a, b) < b for any legal keys", () => {
    fc.assert(
      fc.property(
        keyArb,
        keyArb,
        fc.integer({ min: 0, max: 4 }),
        fc.nat(),
        (x, y, jitter, seed) => {
          if (x === y) return
          const [a, b] = x < y ? [x, y] : [y, x]
          let k: string
          try {
            k = keyBetween(a, b, { jitter, random: rng(seed) })
          } catch (e) {
            // Only legitimately empty intervals may fail ("a" / "a0").
            expect(e).toBeInstanceOf(OrderKeyError)
            expect(b).toBe(`${a}0`)
            return
          }
          expect(isOrderKey(k)).toBe(true)
          expect(k > a && k < b).toBe(true)
          expect(k.length).toBeLessThanOrEqual(MAX_ORDER_KEY_LENGTH)
        },
      ),
      { numRuns: RUNS * 5 },
    )
  })

  test("property: unbounded sides", () => {
    fc.assert(
      fc.property(keyArb, fc.nat(), (a, seed) => {
        const r = { random: rng(seed) }
        expect(keyBetween(a, null, r) > a).toBe(true)
        try {
          expect(keyBetween(null, a, r) < a).toBe(true)
        } catch (e) {
          expect(e).toBeInstanceOf(OrderKeyError)
          expect(/^0+$/.test(a)).toBe(true)
        }
      }),
      { numRuns: RUNS * 5 },
    )
  })

  test("property: keysBetween returns n strictly increasing keys in range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.nat(), (n, seed) => {
        const keys = keysBetween("a0", "a1", n, { random: rng(seed) })
        expect(keys.length).toBe(n)
        let prev = "a0"
        for (const k of keys) {
          expect(k > prev).toBe(true)
          prev = k
        }
        expect(prev < "a1" || n === 0).toBe(true)
      }),
      { numRuns: RUNS },
    )
  })
})

describe("planInsertKeys", () => {
  const check = (orders: string[], index: number) => {
    const plan = planInsertKeys(orders, index, 1, det)
    const next = [...orders]
    for (const r of plan.rekey) next[r.index] = r.order
    next.splice(index, 0, plan.keys[0] as string)
    for (let i = 1; i < next.length; i++)
      expect((next[i] as string) > (next[i - 1] as string)).toBe(true)
    return plan
  }

  test("common case needs no re-keying", () => {
    expect(check(["a0", "a1", "a2"], 1).rekey).toEqual([])
    expect(check([], 0).keys).toEqual(["a0"])
    expect(check(["a0"], 1).keys).toEqual(["a1"])
  })

  test("equal keys (concurrent inserts) re-key the minimal run", () => {
    const plan = check(["a0", "a1", "a1", "a1", "a2"], 2)
    expect(plan.rekey.map((r) => r.index)).toEqual([2, 3])
  })

  test("adjacent keys and the bottom of the key space", () => {
    check(["a", "a0"], 1)
    check(["0", "00"], 0)
    check(["0"], 0)
  })

  test("property: inserting anywhere yields a strictly sorted list (ties re-keyed)", () => {
    fc.assert(
      fc.property(fc.array(keyArb, { maxLength: 12 }), fc.nat(), (raw, i) => {
        const orders = [...raw].sort()
        const index = orders.length === 0 ? 0 : i % (orders.length + 1)
        const plan = planInsertKeys(orders, index, 1, det)
        const next = [...orders]
        for (const r of plan.rekey) next[r.index] = r.order
        next.splice(index, 0, plan.keys[0] as string)
        // The inserted key lands at `index` and strictly between its neighbours.
        const k = plan.keys[0] as string
        if (index > 0) expect(k > (next[index - 1] as string)).toBe(true)
        if (index + 1 < next.length) expect(k < (next[index + 1] as string)).toBe(true)
        for (const key of next) expect(isOrderKey(key)).toBe(true)
        expect(next.length).toBe(orders.length + 1)
      }),
      { numRuns: RUNS * 2 },
    )
  })
})
