import { describe, expect, test } from "bun:test"
import { CamelCasePlugin, Kysely } from "kysely"
import { Migrator } from "kysely/migration"
import { bunSqliteDialect } from "../src/db/bun-sqlite"
import { migrations } from "../src/db/migrations"
import type { Database } from "../src/db/schema"

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
      .values([task("a", 1), task("b", 2), task("c", 3), task("d", 4)])
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
