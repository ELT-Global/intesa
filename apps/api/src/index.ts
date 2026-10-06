import { resolve } from "node:path"
import { createApp } from "./app"
import { configFromEnv, optionalEnv } from "./config"
import { createDb, migrate } from "./db"

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...extra }))

const port = Number(optionalEnv(process.env, "PORT") ?? 3000)
const webDist =
  optionalEnv(process.env, "WEB_DIST") ?? resolve(import.meta.dir, "../../web/dist/client")

// Without DATABASE_URL the database lives in <repo root>/data, whatever directory the
// process was started from. An explicit relative DATABASE_URL is relative to the cwd.
const defaultDatabase = resolve(import.meta.dir, "../../../data/intesa.db")

const config = configFromEnv(process.env)
const db = await createDb(optionalEnv(process.env, "DATABASE_URL") ?? defaultDatabase)
await migrate(db)

// In dev the Vite server serves the web app, so static hosting is production-only.
const serveWeb = config.nodeEnv !== "development"
const app = createApp({ db, config, webDist: serveWeb ? webDist : undefined })

const server = Bun.serve({ port, fetch: app.fetch })
log("server started", { port: server.port, env: config.nodeEnv })

const shutdown = async (signal: string) => {
  log("server stopping", { signal })
  // Let in-flight requests finish, but never hang a deploy on a stuck connection
  // (under the 10 s Docker stop grace period).
  const force = setTimeout(() => process.exit(1), 8_000)
  await server.stop()
  await db.destroy()
  clearTimeout(force)
  log("server stopped")
  process.exit(0)
}
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
