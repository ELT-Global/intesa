import { resolve } from "node:path"
import { createApp } from "./app"

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...extra }))

const port = Number(process.env.PORT ?? 3000)
const webDist = process.env.WEB_DIST ?? resolve(import.meta.dir, "../../web/dist/client")

// In dev the Vite server serves the web app, so static hosting is production-only.
const serveWeb = process.env.NODE_ENV !== "development"
const app = createApp({ webDist: serveWeb ? webDist : undefined })

const server = Bun.serve({ port, fetch: app.fetch })
log("server started", { port: server.port, env: process.env.NODE_ENV ?? "production" })

const shutdown = (signal: string) => {
  log("server stopping", { signal })
  server.stop()
  process.exit(0)
}
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
