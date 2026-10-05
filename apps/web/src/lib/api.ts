import type { AppType } from "@intesa/api"
import { hc } from "hono/client"

// Same-origin: Vite proxies /api in dev, Hono serves it in production.
export const api = hc<AppType>("/")
