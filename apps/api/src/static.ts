import { resolve, sep } from "node:path"
import type { Hono } from "hono"

const SHELL = "_shell.html"

// Serves the built SPA. Real files are returned as-is; any other GET that is not an
// API call gets the SPA shell so client-side routes survive reloads and deep links.
export function serveSpa(app: Hono, webDist: string) {
  const root = resolve(webDist)

  app.get("*", async (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname)
    const file = resolve(root, `.${path}`)

    if (path !== "/" && file.startsWith(root + sep)) {
      const f = Bun.file(file)
      if (await f.exists()) {
        // Hashed build assets never change; everything else must revalidate.
        const cache = path.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache"
        return new Response(f, { headers: { "Cache-Control": cache } })
      }
    }

    // A missing path with an extension is a missing asset, not a client route.
    if (/\.[a-z0-9]+$/i.test(path)) {
      return c.json({ code: "NOT_FOUND", message: "Not found" }, 404)
    }

    const shell = Bun.file(resolve(root, SHELL))
    if (!(await shell.exists())) {
      return c.json({ code: "NOT_FOUND", message: "Web build not found" }, 404)
    }
    return new Response(shell, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    })
  })
}
