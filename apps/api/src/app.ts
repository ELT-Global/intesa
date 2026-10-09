import { Hono } from "hono"
import { csrf } from "hono/csrf"
import { createMiddleware } from "hono/factory"
import { sql } from "kysely"
import { version } from "../package.json"
import { createAttemptLimiter, LOCKOUT_MS, MAX_CODE_ATTEMPTS } from "./auth/attempts"
import { bearerToken } from "./auth/tokens"
import type { Config } from "./config"
import type { Db } from "./db"
import { compressJson } from "./lib/compress-json"
import { ApiError, onError } from "./lib/errors"
import { requestLog } from "./lib/request-log"
import { authRoutes } from "./routes/auth"
import { fieldRoutes, projectFieldRoutes } from "./routes/custom-fields"
import { deviceRoutes } from "./routes/device"
import { homeRoutes } from "./routes/home"
import { meRoutes } from "./routes/me"
import { memberRoutes } from "./routes/members"
import { projectRoutes, workspaceProjectRoutes } from "./routes/projects"
import { searchRoutes } from "./routes/search"
import { tagRoutes, workspaceTagRoutes } from "./routes/tags"
import { taskRoutes } from "./routes/tasks"
import { tokenRoutes } from "./routes/tokens"
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
      // The CLI compares this with its own version to warn about a mismatch.
      return c.json({ ok: true as const, version })
    })
    .route("/auth", authRoutes(deps))
    .route("/auth/device", deviceRoutes(deps))
    // Before /me so its handlers run ahead of the /me guard (see tokenRoutes).
    .route("/me/tokens", tokenRoutes(deps))
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

  // Refuses writes that a cross-site page can send with the session cookie (forms, and
  // body-less or multipart requests), unless the browser says they came from the app itself.
  // Bearer requests carry no ambient credentials, and the CLI sends neither header.
  const crossSite = csrf({ origin: config.publicUrl })
  const noCrossSiteWrites = createMiddleware((c, next) =>
    bearerToken(c) === undefined ? crossSite(c, next) : next(),
  )

  const app = new Hono()
    .use(requestLog)
    .use("/api/*", compressJson)
    .use("/api/*", noCrossSiteWrites)
    .route("/api", api)
  app.onError(onError)

  if (webDist) serveSpa(app, webDist)
  return app
}

export type AppType = ReturnType<typeof createApp>
