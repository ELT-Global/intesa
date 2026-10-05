import { resolve } from "node:path"
import { createApp } from "./app"
import { configFromEnv } from "./config"
import { createDb, migrate } from "./db"

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...extra }))

const port = Number(process.env.PORT ?? 3000)
const webDist = process.env.WEB_DIST ?? resolve(import.meta.dir, "../../web/dist/client")

const config = configFromEnv(process.env)
const db = await createDb(process.env.DATABASE_URL ?? "./data/intesa.db")
await migrate(db)

// In dev the Vite server serves the web app, so static hosting is production-only.
const serveWeb = config.nodeEnv !== "development"
const app = createApp({ db, config, webDist: serveWeb ? webDist : undefined })

const server = Bun.serve({ port, fetch: app.fetch })
log("server started", { port: server.port, env: config.nodeEnv })

const shutdown = async (signal: string) => {
  log("server stopping", { signal })
  // Let in-flight requests finish, but never hang a deploy on a stuck connection.
  const force = setTimeout(() => process.exit(1), 10_000)
  await server.stop()
  await db.destroy()
  clearTimeout(force)
  log("server stopped")
  process.exit(0)
}
process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
