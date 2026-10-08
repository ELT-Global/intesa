import { generateNKeysBetween } from "fractional-indexing"
import { type ColumnDefinitionBuilder, type Kysely, sql } from "kysely"
import type { Migration } from "kysely/migration"

const text = "text" as const
const notNull = (c: ColumnDefinitionBuilder) => c.notNull()

const initial: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("users")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("name", text, notNull)
      .addColumn("email", text, (c) => c.notNull().unique())
      .addColumn("avatar_url", text)
      .addColumn("google_sub", text, (c) => c.unique())
      .addColumn("totp_secret", text)
      .addColumn("totp_enabled", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", text, notNull)
      .addColumn("updated_at", text, notNull)
      .execute()

    await db.schema
      .createTable("sessions")
      .addColumn("token_hash", text, (c) => c.primaryKey())
      .addColumn("user_id", text, (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("pending_two_factor", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("expires_at", text, notNull)
      .addColumn("created_at", text, notNull)
      .execute()
    await db.schema.createIndex("sessions_user_id").on("sessions").column("user_id").execute()

    await db.schema
      .createTable("workspaces")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("name", text, notNull)
      .addColumn("slug", text, (c) => c.notNull().unique())
      .addColumn("created_at", text, notNull)
      .addColumn("updated_at", text, notNull)
      .execute()

    await db.schema
      .createTable("workspace_members")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("workspace_id", text, (c) =>
        c.notNull().references("workspaces.id").onDelete("cascade"),
      )
      .addColumn("user_id", text, (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("role", text, (c) => c.notNull().check(sql`role in ('owner', 'member')`))
      .addColumn("created_at", text, notNull)
      .addUniqueConstraint("workspace_members_workspace_user", ["workspace_id", "user_id"])
      .execute()
    await db.schema
      .createIndex("workspace_members_user_id")
      .on("workspace_members")
      .column("user_id")
      .execute()

    await db.schema
      .createTable("projects")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("workspace_id", text, (c) =>
        c.notNull().references("workspaces.id").onDelete("cascade"),
      )
      .addColumn("name", text, notNull)
      .addColumn("key", text, notNull)
      .addColumn("description", text)
      .addColumn("task_counter", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", text, notNull)
      .addColumn("updated_at", text, notNull)
      .addUniqueConstraint("projects_workspace_key", ["workspace_id", "key"])
      .execute()
    await db.schema
      .createIndex("projects_workspace_id")
      .on("projects")
      .column("workspace_id")
      .execute()

    await db.schema
      .createTable("tasks")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("workspace_id", text, (c) =>
        c.notNull().references("workspaces.id").onDelete("cascade"),
      )
      .addColumn("project_id", text, (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("parent_task_id", text, (c) => c.references("tasks.id").onDelete("cascade"))
      .addColumn("number", "integer", notNull)
      .addColumn("title", text, notNull)
      .addColumn("body", text)
      .addColumn("status", text, notNull)
      .addColumn("priority", text)
      .addColumn("due_at", text)
      .addColumn("created_by", text, (c) => c.notNull().references("users.id"))
      .addColumn("created_at", text, notNull)
      .addColumn("updated_at", text, notNull)
      .addUniqueConstraint("tasks_project_number", ["project_id", "number"])
      .execute()
    await db.schema
      .createIndex("tasks_project_status")
      .on("tasks")
      .columns(["project_id", "status"])
      .execute()
    await db.schema.createIndex("tasks_parent").on("tasks").column("parent_task_id").execute()
    await db.schema
      .createIndex("tasks_workspace_due")
      .on("tasks")
      .columns(["workspace_id", "due_at"])
      .execute()

    await db.schema
      .createTable("task_assignees")
      .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
      .addColumn("user_id", text, (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addPrimaryKeyConstraint("task_assignees_pk", ["task_id", "user_id"])
      .execute()
    await db.schema
      .createIndex("task_assignees_user")
      .on("task_assignees")
      .column("user_id")
      .execute()

    await db.schema
      .createTable("tags")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("workspace_id", text, (c) =>
        c.notNull().references("workspaces.id").onDelete("cascade"),
      )
      .addColumn("name", text, notNull)
      .addColumn("color", text, notNull)
      .addColumn("created_at", text, notNull)
      .addUniqueConstraint("tags_workspace_name", ["workspace_id", "name"])
      .execute()

    await db.schema
      .createTable("task_tags")
      .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
      .addColumn("tag_id", text, (c) => c.notNull().references("tags.id").onDelete("cascade"))
      .addPrimaryKeyConstraint("task_tags_pk", ["task_id", "tag_id"])
      .execute()
    await db.schema.createIndex("task_tags_tag").on("task_tags").column("tag_id").execute()

    await db.schema
      .createTable("task_relationships")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("source_task_id", text, (c) =>
        c.notNull().references("tasks.id").onDelete("cascade"),
      )
      .addColumn("target_task_id", text, (c) =>
        c.notNull().references("tasks.id").onDelete("cascade"),
      )
      .addColumn("type", text, (c) => c.notNull().check(sql`type in ('blocks', 'related')`))
      .addColumn("created_at", text, notNull)
      .addUniqueConstraint("task_relationships_unique", [
        "source_task_id",
        "target_task_id",
        "type",
      ])
      .execute()
    await db.schema
      .createIndex("task_relationships_target")
      .on("task_relationships")
      .column("target_task_id")
      .execute()

    await db.schema
      .createTable("task_status_history")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
      .addColumn("from_status", text)
      .addColumn("to_status", text, notNull)
      .addColumn("updated_at", text, notNull)
      .addColumn("updated_by", text, (c) => c.notNull().references("users.id"))
      .execute()
    await db.schema
      .createIndex("task_status_history_task")
      .on("task_status_history")
      .column("task_id")
      .execute()

    await db.schema
      .createTable("custom_field_definitions")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("project_id", text, (c) =>
        c.notNull().references("projects.id").onDelete("cascade"),
      )
      .addColumn("name", text, notNull)
      .addColumn("type", text, notNull)
      .addColumn("required", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("options", text)
      .addColumn("position", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("created_at", text, notNull)
      .execute()
    await db.schema
      .createIndex("custom_field_definitions_project")
      .on("custom_field_definitions")
      .column("project_id")
      .execute()

    await db.schema
      .createTable("task_custom_field_values")
      .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
      .addColumn("field_id", text, (c) =>
        c.notNull().references("custom_field_definitions.id").onDelete("cascade"),
      )
      .addColumn("value", text, notNull)
      .addPrimaryKeyConstraint("task_custom_field_values_pk", ["task_id", "field_id"])
      .execute()
    await db.schema
      .createIndex("task_custom_field_values_field")
      .on("task_custom_field_values")
      .column("field_id")
      .execute()
  },
}

// Renames rows whose name collides (ignoring case) with an earlier row in the same scope, so a
// unique index on (scope, lower(name)) can be created over existing data. "Earlier" means
// older by (created_at, id), so the outcome is deterministic: later rows become "Name (2)",
// "Name (3)", ... skipping names already taken.
async function dedupeNames(
  db: Kysely<any>,
  table: "tags" | "custom_field_definitions",
  scope: "workspaceId" | "projectId",
) {
  const rows = await db.selectFrom(table).selectAll().orderBy("created_at").orderBy("id").execute()
  const taken = new Map<string, Set<string>>()
  for (const row of rows) {
    const names = taken.get(row[scope]) ?? new Set<string>()
    taken.set(row[scope], names)
    let name: string = row.name
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${row.name} (${n})`
    names.add(name.toLowerCase())
    if (name !== row.name)
      await db.updateTable(table).set({ name }).where("id", "=", row.id).execute()
  }
}

// Tag names are unique per workspace ignoring case; the constraint, not a prior lookup,
// decides concurrent creates.
const tagNameIndex: Migration = {
  async up(db: Kysely<any>) {
    await dedupeNames(db, "tags", "workspaceId")
    await sql`create unique index tags_workspace_lower_name on tags (workspace_id, lower(name))`.execute(
      db,
    )
  },
}

const customFieldNamesAndRelated: Migration = {
  async up(db: Kysely<any>) {
    // Field names are unique per project ignoring case; the index decides concurrent creates.
    await dedupeNames(db, "custom_field_definitions", "projectId")
    await sql`create unique index custom_fields_project_lower_name on custom_field_definitions (project_id, lower(name))`.execute(
      db,
    )

    // "related" is symmetric and is now stored with source < target so the unique constraint
    // also catches reversed duplicates. Drop any reversed duplicate first, then swap the rest
    // (both dialects evaluate the right-hand sides against the old row).
    await sql`delete from task_relationships where type = 'related' and source_task_id > target_task_id and exists (select 1 from task_relationships r where r.type = 'related' and r.source_task_id = task_relationships.target_task_id and r.target_task_id = task_relationships.source_task_id)`.execute(
      db,
    )
    await sql`update task_relationships set source_task_id = target_task_id, target_task_id = source_task_id where type = 'related' and source_task_id > target_task_id`.execute(
      db,
    )
  },
}

// Kysely wraps a migration in a transaction only where the dialect has transactional DDL
// (Postgres). SQLite's DDL is transactional too, but Kysely does not rely on it, so a
// migration that needs to be all-or-nothing there opens its own transaction.
const atomically = <T>(db: Kysely<any>, fn: (trx: Kysely<any>) => Promise<T>) =>
  db.isTransaction ? fn(db) : db.transaction().execute(fn)

// Tasks get a fractional-index `position` so cards can be reordered within a column by
// writing one row. The column is ordered by (project, status, parent); existing tasks keep the
// order they were shown in, newest (highest number) first.
//
// The default exists only because SQLite cannot add a NOT NULL column without one; every row
// is given a real key below, and the app always writes one. Keys are compared as plain strings
// in application code, never with SQL ORDER BY: Postgres would use the database collation
// (which is not byte order), SQLite would not, and the two would disagree.
const taskPosition: Migration = {
  async up(db: Kysely<any>) {
    await atomically(db, async (trx) => {
      await trx.schema
        .alterTable("tasks")
        .addColumn("position", text, (c) => c.notNull().defaultTo(""))
        .execute()

      const rows = await trx
        .selectFrom("tasks")
        .select(["id", "projectId", "status", "parentTaskId"])
        .orderBy("projectId")
        .orderBy("status")
        .orderBy("parentTaskId")
        .orderBy("number", "desc")
        .execute()
      const columns = new Map<string, string[]>()
      for (const row of rows) {
        const scope = JSON.stringify([row.projectId, row.status, row.parentTaskId])
        const ids = columns.get(scope)
        if (ids) ids.push(row.id)
        else columns.set(scope, [row.id])
      }
      for (const ids of columns.values()) {
        const keys = generateNKeysBetween(null, null, ids.length)
        for (const [i, id] of ids.entries()) {
          await trx
            .updateTable("tasks")
            .set({ position: keys[i] as string })
            .where("id", "=", id)
            .execute()
        }
      }
    })
  },
}

export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
  "0002_tag_name_unique": tagNameIndex,
  "0003_custom_field_names_related_order": customFieldNamesAndRelated,
  "0004_task_position": taskPosition,
}
