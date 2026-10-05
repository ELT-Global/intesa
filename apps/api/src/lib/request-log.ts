import { createMiddleware } from "hono/factory"

// Logs server failures only. Method, path (no query string, which can carry OAuth codes),
// status and duration; never bodies, headers or cookies.
// Every request is timed, which costs two clock reads; the duration is only worth having
// when something failed, so it is only reported then.
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
