import { Hono } from "hono"
import { ApiError, onError } from "./lib/errors"
import { serveSpa } from "./static"

export type AppDeps = {
  // When set, the built SPA is served from this directory.
  webDist?: string
}

export function createApp(deps: AppDeps = {}) {
  const api = new Hono().get("/health", (c) => c.json({ ok: true as const }))

  // Unknown API paths must not fall through to the SPA shell.
  api.all("*", () => {
    throw new ApiError("NOT_FOUND", "Not found")
  })

  const app = new Hono().route("/api", api)
  app.onError(onError)

  if (deps.webDist) serveSpa(app, deps.webDist)
  return app
}

export type AppType = ReturnType<typeof createApp>
