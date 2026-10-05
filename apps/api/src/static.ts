import { resolve, sep } from "node:path"
import type { Context, Hono } from "hono"

const SHELL = "_shell.html"

// Precompressed siblings written at build time (scripts/precompress.ts), best first.
const VARIANTS = [
  { encoding: "br", suffix: ".br" },
  { encoding: "gzip", suffix: ".gz" },
] as const

// Encodings the client accepts, honouring q=0 as "not acceptable".
function acceptedEncodings(header: string | undefined): Set<string> {
  const accepted = new Set<string>()
  for (const part of (header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";")
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="))
    if (name && (q === undefined || Number(q.slice(2)) > 0)) accepted.add(name)
  }
  return accepted
}

// If-None-Match is a list of entity tags or "*"; weak comparison ignores the W/ prefix.
function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const strip = (tag: string) => tag.trim().replace(/^W\//, "")
  const ours = strip(etag)
  return header.split(",").some((tag) => tag.trim() === "*" || strip(tag) === ours)
}

async function sendFile(c: Context, path: string, cacheControl: string) {
  const original = Bun.file(path)
  const accepted = acceptedEncodings(c.req.header("accept-encoding"))

  let file = original
  let encoding: string | undefined
  for (const variant of VARIANTS) {
    if (!accepted.has(variant.encoding)) continue
    const candidate = Bun.file(path + variant.suffix)
    if (await candidate.exists()) {
      file = candidate
      encoding = variant.encoding
      break
    }
  }

  // Weak validators: cheap, and enough for no-cache files to revalidate with a 304.
  const etag = `W/"${file.size}-${file.lastModified}-${encoding ?? "identity"}"`
  const headers = new Headers({
    "Content-Type": original.type,
    "Cache-Control": cacheControl,
    ETag: etag,
    Vary: "Accept-Encoding",
  })
  if (encoding) headers.set("Content-Encoding", encoding)

  if (matchesIfNoneMatch(c.req.header("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(file, { headers })
}

// Malformed percent-encoding and NUL bytes are client errors, not crashes.
function decodePath(raw: string): string | null {
  try {
    const path = decodeURIComponent(raw)
    return path.indexOf(String.fromCharCode(0)) >= 0 ? null : path
  } catch {
    return null
  }
}

// Serves the built SPA. Real files are returned as-is; any other GET that is not an
// API call gets the SPA shell so client-side routes survive reloads and deep links.
export function serveSpa(app: Hono, webDist: string) {
  const root = resolve(webDist)

  app.get("*", async (c) => {
    const path = decodePath(new URL(c.req.url).pathname)
    if (path === null) return c.json({ code: "VALIDATION_ERROR", message: "Bad request path" }, 400)
    const file = resolve(root, `.${path}`)

    const isVariant = VARIANTS.some((v) => path.endsWith(v.suffix))
    if (
      !isVariant &&
      path !== "/" &&
      file.startsWith(root + sep) &&
      (await Bun.file(file).exists())
    ) {
      // Hashed build assets never change; everything else must revalidate.
      const cache = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
      return sendFile(c, file, cache)
    }

    // A missing path with an extension is a missing asset, not a client route.
    if (/\.[a-z0-9]+$/i.test(path)) {
      return c.json({ code: "NOT_FOUND", message: "Not found" }, 404)
    }

    const shell = resolve(root, SHELL)
    if (!(await Bun.file(shell).exists())) {
      return c.json({ code: "NOT_FOUND", message: "Web build not found" }, 404)
    }
    return sendFile(c, shell, "no-cache")
  })
}
