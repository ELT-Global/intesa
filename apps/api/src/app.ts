import { Hono } from "hono"
import type { Config } from "./config"
import type { Db } from "./db"
import { ApiError, onError } from "./lib/errors"
import { authRoutes } from "./routes/auth"
import { homeRoutes } from "./routes/home"
import { meRoutes } from "./routes/me"
import { memberRoutes } from "./routes/members"
import { projectRoutes, workspaceProjectRoutes } from "./routes/projects"
import { tagRoutes, workspaceTagRoutes } from "./routes/tags"
import { taskRoutes } from "./routes/tasks"
import { workspaceRoutes } from "./routes/workspaces"
import { serveSpa } from "./static"

export type AppDeps = {
  db: Db
  config: Config
  // When set, the built SPA is served from this directory.
  webDist?: string
}

export function createApp({ db, config, webDist }: AppDeps) {
  const deps = { db, config }
  const api = new Hono()
    .get("/health", (c) => c.json({ ok: true as const }))
    .route("/auth", authRoutes(deps))
    .route("/me", meRoutes(deps))
    .route("/workspaces", workspaceRoutes(deps))
    .route("/workspaces", workspaceProjectRoutes(deps))
    .route("/workspaces", memberRoutes(deps))
    .route("/workspaces", homeRoutes(deps))
    .route("/workspaces", workspaceTagRoutes(deps))
    .route("/projects", projectRoutes(deps))
    .route("/tags", tagRoutes(deps))
    .route("/tasks", taskRoutes(deps))

  // Unknown API paths must not fall through to the SPA shell.
  api.all("*", () => {
    throw new ApiError("NOT_FOUND", "Not found")
  })

  const app = new Hono().route("/api", api)
  app.onError(onError)

  if (webDist) serveSpa(app, webDist)
  return app
}

export type AppType = ReturnType<typeof createApp>
