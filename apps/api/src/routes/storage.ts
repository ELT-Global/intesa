import { stat, statfs } from "node:fs/promises"
import { dirname } from "node:path"
import { Hono } from "hono"
import { SqliteAdapter, sql } from "kysely"
import { type AppEnv, requireUser } from "../auth/middleware"
import type { Db } from "../db"
import type { Deps } from "../deps"

const fileSize = (path: string) =>
  stat(path).then(
    (s) => s.size,
    () => 0,
  )

async function databaseUsage(db: Db) {
  if (!(db.getExecutor().adapter instanceof SqliteAdapter)) {
    const { rows } = await sql<{ bytes: string }>`
      select pg_database_size(current_database()) as bytes`.execute(db)
    return { dialect: "postgres" as const, bytes: Number(rows[0]?.bytes ?? 0), path: null }
  }
  const { rows } = await sql<{ name: string; file: string }>`pragma database_list`.execute(db)
  const path = rows.find((r) => r.name === "main")?.file || null
  if (!path) {
    // In memory: only the pages themselves take space.
    const pages = await sql<{ bytes: number }>`
      select page_count * page_size as bytes from pragma_page_count(), pragma_page_size()`.execute(
      db,
    )
    return { dialect: "sqlite" as const, bytes: pages.rows[0]?.bytes ?? 0, path: null }
  }
  // Recent writes sit in the write-ahead log until a checkpoint folds them into the file.
  const sizes = await Promise.all(["", "-wal", "-shm"].map((suffix) => fileSize(path + suffix)))
  return { dialect: "sqlite" as const, bytes: sizes.reduce((a, b) => a + b, 0), path }
}

async function diskUsage(path: string | null) {
  if (!path) return null
  try {
    const fs = await statfs(dirname(path))
    return { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize }
  } catch {
    return null
  }
}

/**
 * How much room the database takes and, for a SQLite file, how much is left on its disk.
 * Instance-wide: every workspace shares the one database.
 */
export function storageRoutes({ db }: Pick<Deps, "db">) {
  return new Hono<AppEnv>().use(requireUser(db)).get("/", async (c) => {
    const { path, ...database } = await databaseUsage(db)
    const files = await db
      .selectFrom("artifacts")
      .select((eb) => [eb.fn.countAll<string>().as("count"), eb.fn.sum<string>("size").as("bytes")])
      .executeTakeFirstOrThrow()
    return c.json({
      database: {
        ...database,
        // Uploaded artifacts and screenshots, which are stored in the database itself.
        files: { count: Number(files.count), bytes: Number(files.bytes ?? 0) },
      },
      // Unknown for PostgreSQL, whose disk belongs to the database server.
      disk: await diskUsage(path),
    })
  })
}
