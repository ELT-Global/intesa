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
  // The length of the old body is wrong for the new one; the runtime sets the right value.
  headers.delete("content-length")
  if (!/\baccept-encoding\b/i.test(headers.get("vary") ?? "")) {
    headers.append("Vary", "Accept-Encoding")
  }

  const replace = (next: Response) => {
    // Assigning over an existing response makes Hono copy the old headers back onto the new
    // one, which would restore the stale Content-Length. Clearing first avoids the merge.
    c.res = undefined as unknown as Response
    c.res = next
  }

  if (!accepts || body.length < MIN_BYTES) {
    replace(new Response(body, { status: res.status, headers }))
    return
  }
  headers.set("Content-Encoding", "gzip")
  replace(new Response(Bun.gzipSync(body), { status: res.status, headers }))
})
