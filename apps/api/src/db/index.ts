import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { Dialect } from "kysely"
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely"
import { Migrator } from "kysely/migration"
import { migrations } from "./migrations"
import type { Database } from "./schema"

export type { Database } from "./schema"
export type Db = Kysely<Database>

async function dialectFor(url: string): Promise<Dialect> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    // Loaded lazily so SQLite deployments never import the driver.
    const { default: pg } = await import("pg")
    return new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) })
  }
  if (url !== ":memory:") mkdirSync(dirname(url), { recursive: true })
  const { bunSqliteDialect } = await import("./bun-sqlite")
  return bunSqliteDialect(url)
}

export async function createDb(url: string): Promise<Db> {
  return new Kysely<Database>({
    dialect: await dialectFor(url),
    plugins: [new CamelCasePlugin()],
  })
}

// `schema` pins the migration bookkeeping tables to one Postgres schema; without it Kysely
// may mistake tables of the same name in another schema for its own.
export async function migrate(db: Db, schema?: string) {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
    migrationTableSchema: schema,
  })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

// Strictly increasing within the process so rows written in quick succession keep a
// stable order when sorted by timestamp (e.g. status history).
let lastMs = 0
export const now = () => {
  lastMs = Math.max(Date.now(), lastMs + 1)
  return new Date(lastMs).toISOString()
}
export const newId = () => crypto.randomUUID()

// Runs fn inside a transaction, joining the caller's transaction when there is one.
export function inTransaction<T>(db: Db, fn: (trx: Db) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db) : db.transaction().execute(fn)
}

// True for a unique/primary-key violation on either dialect (SQLite message or Postgres 23505).
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return (
    e?.code === "23505" ||
    e?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    e?.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    /UNIQUE constraint failed/i.test(e?.message ?? "")
  )
}
