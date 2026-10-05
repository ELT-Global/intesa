import { Hono } from "hono"
import { sql } from "kysely"
import { createAttemptLimiter, LOCKOUT_MS, MAX_CODE_ATTEMPTS } from "./auth/attempts"
import type { Config } from "./config"
import type { Db } from "./db"
import { compressJson } from "./lib/compress-json"
import { ApiError, onError } from "./lib/errors"
import { requestLog } from "./lib/request-log"
import { authRoutes } from "./routes/auth"
import { fieldRoutes, projectFieldRoutes } from "./routes/custom-fields"
import { homeRoutes } from "./routes/home"
import { meRoutes } from "./routes/me"
import { memberRoutes } from "./routes/members"
import { projectRoutes, workspaceProjectRoutes } from "./routes/projects"
import { searchRoutes } from "./routes/search"
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
  const deps = { db, config, attempts: createAttemptLimiter(MAX_CODE_ATTEMPTS, LOCKOUT_MS) }
  const api = new Hono()
    .get("/health", async (c) => {
      // Touches the database so an orchestrator health check notices a lost connection.
      await sql`select 1`.execute(db)
      return c.json({ ok: true as const })
    })
    .route("/auth", authRoutes(deps))
    .route("/me", meRoutes(deps))
    .route("/workspaces", workspaceRoutes(deps))
    .route("/workspaces", workspaceProjectRoutes(deps))
    .route("/workspaces", memberRoutes(deps))
    .route("/workspaces", homeRoutes(deps))
    .route("/workspaces", workspaceTagRoutes(deps))
    .route("/workspaces", searchRoutes(deps))
    .route("/projects", projectRoutes(deps))
    .route("/projects", projectFieldRoutes(deps))
    .route("/custom-fields", fieldRoutes(deps))
    .route("/tags", tagRoutes(deps))
    .route("/tasks", taskRoutes(deps))

  // Unknown API paths must not fall through to the SPA shell.
  api.all("*", () => {
    throw new ApiError("NOT_FOUND", "Not found")
  })

  const app = new Hono().use(requestLog).use("/api/*", compressJson).route("/api", api)
  app.onError(onError)

  if (webDist) serveSpa(app, webDist)
  return app
}

export type AppType = ReturnType<typeof createApp>
