import { type ColumnDefinitionBuilder, type Kysely, sql } from "kysely"
import type { Migration } from "kysely/migration"

const text = "text" as const
const notNull = (c: ColumnDefinitionBuilder) => c.notNull()

const initial: Migration = {
  async up(db: Kysely<any>) {
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

export const migrations: Record<string, Migration> = { "0001_initial": initial }
