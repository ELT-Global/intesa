import { defineConfig, devices } from "@playwright/test"

const PORT = 4173

export default defineConfig({
  testDir: "./tests",
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
      DEV_LOGIN: "true",
      // A fresh in-memory database per run keeps tests independent of earlier runs.
      DATABASE_URL: ":memory:",
    },
  },
})
