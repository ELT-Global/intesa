import { describe, expect, test } from "bun:test"
import { generateKeyBetween } from "fractional-indexing"
import { CamelCasePlugin, Kysely, sql } from "kysely"
import { Migrator } from "kysely/migration"
import { createDb } from "../src/db"
import { bunSqliteDialect } from "../src/db/bun-sqlite"
import { migrations } from "../src/db/migrations"
import type { Database } from "../src/db/schema"
import { byBoardOrder } from "../src/tasks/order"

// Always SQLite: this builds a database at an old schema version.
describe("migration 0003", () => {
  test("sorts stored related links and drops reversed duplicates, leaving blocks alone", async () => {
    const db = new Kysely<Database>({
      dialect: bunSqliteDialect(":memory:"),
      plugins: [new CamelCasePlugin()],
    })
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
    expect((await migrator.migrateTo("0002_tag_name_unique")).error).toBeUndefined()

    const ts = "2026-01-01T00:00:00.000Z"
    await db
      .insertInto("users")
      .values({
        id: "u",
        name: "U",
        email: "u@x.com",
        totpEnabled: 0,
        createdAt: ts,
        updatedAt: ts,
      })
      .execute()
    await db
      .insertInto("workspaces")
      .values({ id: "w", name: "W", slug: "w1", createdAt: ts, updatedAt: ts })
      .execute()
    await db
      .insertInto("projects")
      .values({
        id: "p",
        workspaceId: "w",
        name: "P",
        key: "PP",
        taskCounter: 4,
        createdAt: ts,
        updatedAt: ts,
      })
      .execute()
    const task = (id: string, number: number) => ({
      id,
      workspaceId: "w",
      projectId: "p",
      number,
      title: id,
      status: "todo",
      createdBy: "u",
      createdAt: ts,
      updatedAt: ts,
    })
    await db
      .insertInto("tasks")
      // `tasks` has no position column at this schema version, which the types describe.
      .values([task("a", 1), task("b", 2), task("c", 3), task("d", 4)] as never)
      .execute()

    const edge = (id: string, source: string, target: string, type: "blocks" | "related") => ({
      id,
      sourceTaskId: source,
      targetTaskId: target,
      type,
      createdAt: ts,
    })
    await db
      .insertInto("taskRelationships")
      .values([
        edge("r1", "b", "a", "related"), // unsorted: must be swapped
        edge("r2", "c", "d", "related"), // already sorted
        edge("r3", "d", "c", "related"), // reversed duplicate of r2: removed
        edge("k1", "d", "a", "blocks"), // blocks keep their direction
      ])
      .execute()

    expect((await migrator.migrateToLatest()).error).toBeUndefined()

    const rows = await db
      .selectFrom("taskRelationships")
      .select(["id", "sourceTaskId", "targetTaskId", "type"])
      .orderBy("id")
      .execute()
    expect(rows).toEqual([
      { id: "k1", sourceTaskId: "d", targetTaskId: "a", type: "blocks" },
      { id: "r1", sourceTaskId: "a", targetTaskId: "b", type: "related" },
      { id: "r2", sourceTaskId: "c", targetTaskId: "d", type: "related" },
    ])
    await db.destroy()
  })
})

describe("name uniqueness migrations over existing data", () => {
  test("case-insensitive duplicate tag and field names are renamed deterministically", async () => {
    const db = new Kysely<Database>({
      dialect: bunSqliteDialect(":memory:"),
      plugins: [new CamelCasePlugin()],
    })
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
    expect((await migrator.migrateTo("0001_initial")).error).toBeUndefined()

    const ts = (n: number) => `2026-01-01T00:00:0${n}.000Z`
    await db
      .insertInto("users")
      .values({
        id: "u",
        name: "U",
        email: "u@x.com",
        totpEnabled: 0,
        createdAt: ts(0),
        updatedAt: ts(0),
      })
      .execute()
    await db
      .insertInto("workspaces")
      .values([
        { id: "w1", name: "W1", slug: "w1", createdAt: ts(0), updatedAt: ts(0) },
        { id: "w2", name: "W2", slug: "w2", createdAt: ts(0), updatedAt: ts(0) },
      ])
      .execute()
    const tag = (id: string, workspaceId: string, name: string, n: number) => ({
      id,
      workspaceId,
      name,
      color: "blue",
      createdAt: ts(n),
    })
    await db
      .insertInto("tags")
      .values([
        tag("t1", "w1", "Bug", 1),
        tag("t2", "w1", "bug", 2), // duplicate of t1 -> "bug (2)"
        tag("t3", "w1", "BUG", 3), // -> "BUG (2)" is taken? no: "bug (2)" is, so "BUG (3)"
        tag("t4", "w2", "bug", 1), // other workspace: untouched
      ])
      .execute()

    await db
      .insertInto("projects")
      .values({
        id: "p",
        workspaceId: "w1",
        name: "P",
        key: "PP",
        taskCounter: 0,
        createdAt: ts(0),
        updatedAt: ts(0),
      })
      .execute()
    const field = (id: string, name: string, n: number) => ({
      id,
      projectId: "p",
      name,
      type: "text",
      required: 0,
      position: n,
      createdAt: ts(n),
    })
    await db
      .insertInto("customFieldDefinitions")
      .values([field("f1", "Estimate", 1), field("f2", "ESTIMATE", 2), field("f3", "Other", 3)])
      .execute()

    expect((await migrator.migrateToLatest()).error).toBeUndefined()

    const tags = await db.selectFrom("tags").select(["id", "name"]).orderBy("id").execute()
    expect(tags).toEqual([
      { id: "t1", name: "Bug" },
      { id: "t2", name: "bug (2)" },
      { id: "t3", name: "BUG (3)" },
      { id: "t4", name: "bug" },
    ])
    const fields = await db
      .selectFrom("customFieldDefinitions")
      .select(["id", "name"])
      .orderBy("id")
      .execute()
    expect(fields).toEqual([
      { id: "f1", name: "Estimate" },
      { id: "f2", name: "ESTIMATE (2)" },
      { id: "f3", name: "Other" },
    ])
    await db.destroy()
  })
})

// The same scenario runs on SQLite (always) and Postgres (when TEST_DATABASE_URL is set), since
// production runs both and the migration is the one place their behaviour could diverge.
const pgUrl = process.env.TEST_DATABASE_URL
const usePg = Boolean(pgUrl && /^postgres(ql)?:\/\//.test(pgUrl))
const PG_SCHEMA = "intesa_migration_test"

type Target = { db: Kysely<Database>; migrator: Migrator; close: () => Promise<void> }

async function sqliteTarget(): Promise<Target> {
  const db = new Kysely<Database>({
    dialect: bunSqliteDialect(":memory:"),
    plugins: [new CamelCasePlugin()],
  })
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
  return { db, migrator, close: () => db.destroy() }
}

async function pgTarget(url: string): Promise<Target> {
  const admin = await createDb(url)
  await sql`drop schema if exists ${sql.id(PG_SCHEMA)} cascade`.execute(admin)
  await sql`create schema ${sql.id(PG_SCHEMA)}`.execute(admin)
  await admin.destroy()
  const scoped = new URL(url)
  scoped.searchParams.set("options", `-c search_path=${PG_SCHEMA}`)
  const db = await createDb(scoped.toString())
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
    migrationTableSchema: PG_SCHEMA,
  })
  return { db, migrator, close: () => db.destroy() }
}

const targets: [string, () => Promise<Target>][] = [["SQLite", sqliteTarget]]
if (usePg && pgUrl) targets.push(["Postgres", () => pgTarget(pgUrl)])

describe.each(targets)("migration 0004 (task position) on %s", (_name, open) => {
  test("gives every task a key that keeps the order it was shown in", async () => {
    const { db, migrator, close } = await open()
    expect(
      (await migrator.migrateTo("0003_custom_field_names_related_order")).error,
    ).toBeUndefined()

    const ts = "2026-01-01T00:00:00.000Z"
    await db
      .insertInto("users")
      .values({
        id: "u",
        name: "U",
        email: "u@x.com",
        totpEnabled: 0,
        createdAt: ts,
        updatedAt: ts,
      })
      .execute()
    await db
      .insertInto("workspaces")
      .values({ id: "w", name: "W", slug: "w1", createdAt: ts, updatedAt: ts })
      .execute()
    await db
      .insertInto("projects")
      .values(
        ["p1", "p2"].map((id) => ({
          id,
          workspaceId: "w",
          name: id,
          key: id.toUpperCase(),
          taskCounter: 0,
          createdAt: ts,
          updatedAt: ts,
        })),
      )
      .execute()

    // Inserted out of order on purpose; the board showed highest number first.
    const rows: {
      id: string
      projectId: string
      number: number
      status: string
      parent?: string
    }[] = [
      { id: "a3", projectId: "p1", number: 3, status: "todo" },
      { id: "a1", projectId: "p1", number: 1, status: "todo" },
      { id: "a5", projectId: "p1", number: 5, status: "todo" },
      { id: "a2", projectId: "p1", number: 2, status: "review" },
      { id: "a4", projectId: "p1", number: 4, status: "todo" },
      { id: "a6", projectId: "p1", number: 6, status: "todo", parent: "a5" },
      { id: "a7", projectId: "p1", number: 7, status: "todo", parent: "a5" },
      { id: "b1", projectId: "p2", number: 1, status: "todo" },
      { id: "b2", projectId: "p2", number: 2, status: "todo" },
    ]
    await db
      .insertInto("tasks")
      .values(
        rows
          .toSorted((x, y) => (x.id < y.id ? 1 : -1))
          .map((r) => ({
            id: r.id,
            workspaceId: "w",
            projectId: r.projectId,
            parentTaskId: r.parent ?? null,
            number: r.number,
            title: r.id,
            status: r.status,
            createdBy: "u",
            createdAt: ts,
            updatedAt: ts,
          })) as never,
      )
      .execute()

    expect((await migrator.migrateToLatest()).error).toBeUndefined()

    const tasks = await db
      .selectFrom("tasks")
      .select(["id", "projectId", "status", "parentTaskId", "number", "position"])
      .execute()
    const order = (projectId: string, status: string, parent: string | null) =>
      tasks
        .filter(
          (t) => t.projectId === projectId && t.status === status && t.parentTaskId === parent,
        )
        .sort(byBoardOrder)
        .map((t) => t.id)
    expect(order("p1", "todo", null)).toEqual(["a5", "a4", "a3", "a1"])
    expect(order("p1", "review", null)).toEqual(["a2"])
    expect(order("p1", "todo", "a5")).toEqual(["a7", "a6"])
    expect(order("p2", "todo", null)).toEqual(["b2", "b1"])

    // Keys are real fractional indexes (a new key fits after each) and unique per column.
    for (const t of tasks) expect(() => generateKeyBetween(t.position, null)).not.toThrow()
    const columns = new Map<string, string[]>()
    for (const t of tasks) {
      const scope = [t.projectId, t.status, t.parentTaskId].join("/")
      columns.set(scope, [...(columns.get(scope) ?? []), t.position])
    }
    for (const keys of columns.values()) expect(new Set(keys).size).toBe(keys.length)

    // Migrating again is a no-op.
    expect((await migrator.migrateToLatest()).error).toBeUndefined()
    await close()
  })

  test("an empty database migrates", async () => {
    const { migrator, close } = await open()
    expect((await migrator.migrateToLatest()).error).toBeUndefined()
    await close()
  })
})
