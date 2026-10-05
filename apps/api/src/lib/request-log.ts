import { createMiddleware } from "hono/factory"

// Logs server failures only. Method, path (no query string, which can carry OAuth codes),
// status and duration; never bodies, headers or cookies.
export const requestLog = createMiddleware(async (c, next) => {
  const start = performance.now()
  await next()
  if (c.res.status >= 500) {
    console.error(
      JSON.stringify({
        level: "error",
        time: new Date().toISOString(),
        msg: "request failed",
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      }),
    )
  }
})
