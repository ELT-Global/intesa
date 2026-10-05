import { describe, expect, test } from "bun:test"
import { base32Decode, base32Encode, generateSecret, totpCode, verifyTotp } from "../src/auth/totp"

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890". The RFC lists 8-digit codes;
// ours are 6 digits, which are the last six digits of those values.
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"))
const VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
]

describe("base32", () => {
  test("encodes known values", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI")
  })

  test("round trips random bytes of any length", () => {
    for (const length of [1, 2, 3, 4, 5, 6, 19, 20, 21]) {
      const bytes = crypto.getRandomValues(new Uint8Array(length))
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
    }
  })

  test("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("ABC1")).toThrow()
  })

  test("generated secrets decode to 20 bytes", () => {
    expect(base32Decode(generateSecret()).length).toBe(20)
  })
})

describe("totp", () => {
  test.each(VECTORS)("matches RFC 6238 vector at t=%d", async (seconds, expected8) => {
    expect(await totpCode(RFC_SECRET, seconds * 1000)).toBe(expected8.slice(-6))
  })

  test("accepts the current step and one step either side", async () => {
    const t = 1_700_000_000_000
    for (const delta of [-30_000, 0, 30_000]) {
      expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, t + delta), t)).toBe(true)
    }
  })

  test("rejects codes two or more steps away", async () => {
    const t = 1_700_000_000_000
    for (const delta of [-60_000, 60_000, 300_000]) {
      expect(await verifyTotp(RFC_SECRET, await totpCode(RFC_SECRET, t + delta), t)).toBe(false)
    }
  })

  test("rejects malformed codes", async () => {
    const t = 1_700_000_000_000
    expect(await verifyTotp(RFC_SECRET, "12345", t)).toBe(false)
    expect(await verifyTotp(RFC_SECRET, "abcdef", t)).toBe(false)
  })
})
