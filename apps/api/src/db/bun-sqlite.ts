import { Database as BunDatabase } from "bun:sqlite"
import type { SqliteDatabase, SqliteStatement } from "kysely"
import { SqliteDialect } from "kysely"

// Kysely's SqliteDialect targets better-sqlite3's shape; this adapts bun:sqlite to it.
function adapt(db: BunDatabase): SqliteDatabase {
  return {
    close: () => db.close(),
    prepare(sql): SqliteStatement {
      const stmt = db.prepare(sql)
      const args = (p: ReadonlyArray<unknown>) => p as never[]
      return {
        // Statements that produce columns (SELECT, RETURNING) are readers.
        reader: stmt.columnNames.length > 0,
        all: (p) => stmt.all(...args(p)),
        run: (p) => {
          const r = stmt.run(...args(p))
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
        },
        iterate: (p) => stmt.iterate(...args(p)) as IterableIterator<unknown>,
      }
    },
  }
}

export function bunSqliteDialect(path: string) {
  return new SqliteDialect({
    database: () => {
      const db = new BunDatabase(path, { create: true, strict: true })
      db.run("PRAGMA foreign_keys = ON")
      if (path !== ":memory:") db.run("PRAGMA journal_mode = WAL")
      return Promise.resolve(adapt(db))
    },
  })
}
