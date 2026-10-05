const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const STEP_SECONDS = 30
const DIGITS = 6

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error("Invalid base32 character")
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function generateSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)))
}

async function hotp(key: Uint8Array, counter: number): Promise<string> {
  const msg = new ArrayBuffer(8)
  const view = new DataView(msg)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter >>> 0)
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  )
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg))
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f
  const bin =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0)
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0")
}

export function totpCode(secret: string, timeMs: number = Date.now()): Promise<string> {
  return hotp(base32Decode(secret), Math.floor(timeMs / 1000 / STEP_SECONDS))
}

// Accepts the current step and one step either side to tolerate clock drift.
export async function verifyTotp(
  secret: string,
  code: string,
  timeMs: number = Date.now(),
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false
  const key = base32Decode(secret)
  const step = Math.floor(timeMs / 1000 / STEP_SECONDS)
  let ok = false
  for (const delta of [-1, 0, 1]) {
    if ((await hotp(key, step + delta)) === code) ok = true
  }
  return ok
}

export function otpauthUrl(secret: string, account: string, issuer = "Intesa"): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
}
