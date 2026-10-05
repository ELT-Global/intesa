import { createHmac } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Decode(input: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of input.replace(/[\s=]/g, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error(`invalid base32 character: ${ch}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30s step). */
export function totp(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)))
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest()
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff
  return String(bin % 1_000_000).padStart(6, "0")
}
