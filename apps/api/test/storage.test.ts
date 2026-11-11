import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../src/app"
import { createDb, migrate } from "../src/db"
import { createTestApp, setupProject, signIn } from "./helpers"

const usePg = /^postgres(ql)?:\/\//.test(process.env.TEST_DATABASE_URL ?? "")

describe("storage", () => {
  test("requires sign-in and counts uploaded files", async () => {
    const t = await createTestApp()
    expect((await t.app.request("/api/storage")).status).toBe(401)
    const { owner, project } = await setupProject(t, "storage@example.com")
    const task = await owner.call("POST", `/api/projects/${project.id}/tasks`, { title: "Files" })
    const body = new FormData()
    body.set("file", new File(["# Notes"], "notes.md"))
    await owner.request(`/api/tasks/${task.body.task.id}/artifacts`, { method: "POST", body })
    const { status, body: storage } = await owner.call("GET", "/api/storage")
    expect(status).toBe(200)
    expect(storage.database.dialect).toBe(usePg ? "postgres" : "sqlite")
    expect(storage.database.bytes).toBeGreaterThan(0)
    expect(storage.database.files).toEqual({ count: 1, bytes: 7 })
    // In-memory SQLite and PostgreSQL have no local file whose disk could be measured.
    expect(storage.disk).toBeNull()
  })

  test.skipIf(usePg)(
    "measures a SQLite file with its write-ahead log and the disk it is on",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "intesa-storage-"))
      const path = join(dir, "intesa.db")
      const db = await createDb(path)
      try {
        await migrate(db)
        const app = createApp({
          db,
          config: {
            nodeEnv: "test",
            devLogin: true,
            publicUrl: "http://localhost:3000",
            secureCookies: false,
          },
        })
        const user = await signIn(app, "file@example.com")
        const { body } = await user.call("GET", "/api/storage")
        const onDisk = ["", "-wal", "-shm"].reduce((sum, suffix) => {
          try {
            return sum + statSync(path + suffix).size
          } catch {
            return sum
          }
        }, 0)
        expect(body.database.bytes).toBe(onDisk)
        expect(body.disk.totalBytes).toBeGreaterThan(0)
        expect(body.disk.freeBytes).toBeGreaterThan(0)
        expect(body.disk.freeBytes).toBeLessThanOrEqual(body.disk.totalBytes)
      } finally {
        await db.destroy()
        // Windows can keep the closed database's files locked for a moment; it is a temp dir.
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {}
      }
    },
  )
})
