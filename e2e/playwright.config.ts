import { resolve } from "node:path"
import { defineConfig, devices } from "@playwright/test"

const PORT = 4173

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Runs the production server against the already-built SPA.
  webServer: {
    command: "bun run --cwd ../apps/api start",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      NODE_ENV: "test",
      DATABASE_URL: resolve(import.meta.dirname, "../.e2e/e2e.db"),
    },
  },
})
