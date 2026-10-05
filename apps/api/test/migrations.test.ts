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
