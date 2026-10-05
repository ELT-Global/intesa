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

export async function migrate(db: Db) {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export const now = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()
