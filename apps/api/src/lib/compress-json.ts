import { gzipSync } from "node:zlib"
import { createMiddleware } from "hono/factory"

const MIN_BYTES = 1024

// Gzips JSON responses of at least 1 KB for clients that accept it. Smaller bodies are
// sent as they are, since the framing would cost more than it saves.
export const compressJson = createMiddleware(async (c, next) => {
  await next()
  const res = c.res
  const isJson = res.headers.get("content-type")?.includes("application/json")
  if (!isJson || !res.body || res.headers.has("content-encoding")) return

  const body = new Uint8Array(await res.arrayBuffer())
  const accepts = /\bgzip\b/i.test(c.req.header("accept-encoding") ?? "")
  const headers = new Headers(res.headers)
  headers.append("Vary", "Accept-Encoding")

  if (!accepts || body.length < MIN_BYTES) {
    c.res = new Response(body, { status: res.status, headers })
    return
  }
  headers.set("Content-Encoding", "gzip")
  c.res = new Response(gzipSync(body), { status: res.status, headers })
})
