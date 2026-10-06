import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  // Empty prefix: read API_URL from apps/web/.env too, not only VITE_-prefixed variables
  // (which would be exposed to the browser bundle; this one is for the dev server only).
  const env = loadEnv(mode, process.cwd(), "")
  return {
    server: {
      port: 5173,
      proxy: { "/api": env.API_URL || "http://localhost:3000" },
    },
    resolve: { tsconfigPaths: true },
    plugins: [tanstackStart({ spa: { enabled: true } }), viteReact(), tailwindcss()],
  }
})
