import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { brotliCompressSync, gunzipSync, gzipSync } from "node:zlib"
import { createApp } from "../src/app"
import { createDb, migrate } from "../src/db"

const JS = `export const greeting = "${"hello ".repeat(400)}"\n`
let dir: string
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "intesa-web-"))
  mkdirSync(join(dir, "assets"))
  writeFileSync(join(dir, "_shell.html"), "<!doctype html><title>shell</title>")
  writeFileSync(join(dir, "assets", "app-abc123.js"), JS)
  writeFileSync(join(dir, "assets", "app-abc123.js.br"), brotliCompressSync(Buffer.from(JS)))
  writeFileSync(join(dir, "assets", "app-abc123.js.gz"), gzipSync(Buffer.from(JS)))
  writeFileSync(join(dir, "assets", "plain-1.js"), "export {}\n")
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\n")

  const db = await createDb(":memory:")
  await migrate(db)
  app = createApp({
    db,
    config: {
      nodeEnv: "test",
      devLogin: false,
      publicUrl: "http://localhost",
      secureCookies: false,
    },
    webDist: dir,
  })
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const get = (path: string, encoding?: string, extra: Record<string, string> = {}) =>
  app.request(path, { headers: { ...(encoding ? { "accept-encoding": encoding } : {}), ...extra } })

describe("static assets", () => {
  test("serves brotli when accepted, and the body decodes to the original", async () => {
    const res = await get("/assets/app-abc123.js", "gzip, deflate, br")
    expect(res.headers.get("content-encoding")).toBe("br")
    expect(res.headers.get("vary")).toBe("Accept-Encoding")
    expect(res.headers.get("content-type")).toContain("javascript")
    const { brotliDecompressSync } = await import("node:zlib")
    expect(brotliDecompressSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(JS)
  })

  test("falls back to gzip, then to the plain file", async () => {
    const gz = await get("/assets/app-abc123.js", "gzip")
    expect(gz.headers.get("content-encoding")).toBe("gzip")
    expect(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()).toBe(JS)

    const plain = await get("/assets/app-abc123.js")
    expect(plain.headers.get("content-encoding")).toBeNull()
    expect(plain.headers.get("vary")).toBe("Accept-Encoding")
    expect(await plain.text()).toBe(JS)
  })

  test("an encoding offered with q=0 is not used", async () => {
    const res = await get("/assets/app-abc123.js", "br;q=0, gzip;q=0.5")
    expect(res.headers.get("content-encoding")).toBe("gzip")
  })

  test("files without a precompressed copy are served as they are", async () => {
    const res = await get("/assets/plain-1.js", "br, gzip")
    expect(res.headers.get("content-encoding")).toBeNull()
    expect(await res.text()).toBe("export {}\n")
  })

  test("hashed assets are immutable; the shell and other files must revalidate", async () => {
    expect((await get("/assets/app-abc123.js")).headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    )
    expect((await get("/")).headers.get("cache-control")).toBe("no-cache")
    expect((await get("/robots.txt")).headers.get("cache-control")).toBe("no-cache")
  })

  test("a matching If-None-Match gets a 304 per encoding", async () => {
    const first = await get("/robots.txt")
    const etag = first.headers.get("etag") ?? ""
    expect(etag).not.toBe("")
    const again = await get("/robots.txt", undefined, { "if-none-match": etag })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe("")

    const encoded = await get("/assets/app-abc123.js", "br")
    const stale = await get("/assets/app-abc123.js", "gzip", {
      "if-none-match": encoded.headers.get("etag") ?? "",
    })
    expect(stale.status).toBe(200)
  })

  test("unknown routes get the shell; unknown files and raw variants are 404", async () => {
    const route = await get("/w/acme/projects")
    expect(route.status).toBe(200)
    expect(await route.text()).toContain("shell")

    expect((await get("/assets/missing.js")).status).toBe(404)
    expect((await get("/assets/app-abc123.js.br")).status).toBe(404)
  })

  test("raw precompressed files are 404 whatever the client accepts", async () => {
    expect((await get("/assets/app-abc123.js.br", "identity")).status).toBe(404)
    expect((await get("/assets/app-abc123.js.gz", "gzip, br")).status).toBe(404)
  })

  test("an identity-only client gets the plain file", async () => {
    const res = await get("/assets/app-abc123.js", "identity")
    expect(res.headers.get("content-encoding")).toBeNull()
    expect(await res.text()).toBe(JS)
  })

  test("the API is not shadowed by the shell", async () => {
    expect((await get("/api/nope")).status).toBe(404)
  })
})

describe("static edge cases", () => {
  test("malformed percent-encoding and NUL bytes are 400, not a crash", async () => {
    for (const path of ["/%E0%A4%A", "/assets/%", "/%00", "/assets/app%00.js"]) {
      const res = await get(path)
      expect([path, res.status]).toEqual([path, 400])
      expect(((await res.json()) as { code: string }).code).toBe("VALIDATION_ERROR")
    }
  })

  test("encoded dot segments cannot escape the web root", async () => {
    // A file that exists outside the root is never served; asset-looking paths are 404 and
    // route-looking ones get the shell.
    const outside = join(dir, "..", "intesa-outside.txt")
    writeFileSync(outside, "secret")
    try {
      const asset = await get("/%2e%2e/intesa-outside.txt")
      expect(asset.status).toBe(404)
      expect(await asset.text()).not.toContain("secret")
      const route = await get("/%2e%2e/%2e%2e/etc/passwd")
      expect(await route.text()).toContain("shell")
      expect((await get("/assets/%2e%2e/%2e%2e/intesa-outside.txt")).status).toBe(404)
    } finally {
      rmSync(outside, { force: true })
    }
  })

  test("HEAD returns the headers without a body", async () => {
    const res = await app.request("/assets/app-abc123.js", {
      method: "HEAD",
      headers: { "accept-encoding": "br" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-encoding")).toBe("br")
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(await res.text()).toBe("")
  })

  test("If-None-Match accepts lists, strong forms and *", async () => {
    const etag = (await get("/robots.txt")).headers.get("etag") ?? ""
    const strong = etag.replace(/^W\//, "")
    const headers = [`"nope", ${etag}`, strong, "*", `W/"a" , ${etag} ,W/"b"`]
    for (const header of headers) {
      const res = await get("/robots.txt", undefined, { "if-none-match": header })
      expect([header, res.status]).toEqual([header, 304])
    }
    const miss = await get("/robots.txt", undefined, { "if-none-match": 'W/"other", "x"' })
    expect(miss.status).toBe(200)
  })

  test("a 304 still carries the caching and Vary headers", async () => {
    const first = await get("/assets/app-abc123.js", "br")
    const res = await get("/assets/app-abc123.js", "br", {
      "if-none-match": first.headers.get("etag") ?? "",
    })
    expect(res.status).toBe(304)
    expect(res.headers.get("vary")).toBe("Accept-Encoding")
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    expect(res.headers.get("content-encoding")).toBe("br")
  })

  test("the encoding is part of the validator, separated from the size and time", async () => {
    const br = (await get("/assets/app-abc123.js", "br")).headers.get("etag") ?? ""
    const gz = (await get("/assets/app-abc123.js", "gzip")).headers.get("etag") ?? ""
    const plain = (await get("/assets/app-abc123.js")).headers.get("etag") ?? ""
    expect(br).toMatch(/-br"$/)
    expect(gz).toMatch(/-gzip"$/)
    expect(plain).toMatch(/-identity"$/)
    expect(new Set([br, gz, plain]).size).toBe(3)
  })
})
