import { createHash } from "node:crypto"
import { generateNKeysBetween } from "fractional-indexing"
import { type ColumnDefinitionBuilder, type Kysely, SqliteAdapter, sql } from "kysely"
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

const artifacts: Migration = {
  async up(db) {
    const binary = db.getExecutor().adapter instanceof SqliteAdapter ? sql`blob` : sql`bytea`
    await db.schema
      .createTable("artifacts")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
      .addColumn("name", text, notNull)
      .addColumn("mime_type", text, notNull)
      .addColumn("size", "integer", notNull)
      .addColumn("content", binary, notNull)
      .addColumn("created_at", text, notNull)
      .addColumn("updated_at", text, notNull)
      .execute()
    await db.schema.createIndex("artifacts_task_id").on("artifacts").column("task_id").execute()
  },
}

const apiTokensAndDeviceAuth: Migration = {
  async up(db) {
    await db.schema
      .createTable("api_tokens")
      .addColumn("id", text, (c) => c.primaryKey())
      .addColumn("user_id", text, (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("name", text, notNull)
      .addColumn("kind", text, (c) => c.notNull().check(sql`kind in ('cli', 'pat')`))
      .addColumn("scope", text, (c) => c.notNull().check(sql`scope in ('read', 'write')`))
      .addColumn("token_hash", text, (c) => c.notNull().unique())
      .addColumn("last_four", text, notNull)
      .addColumn("created_at", text, notNull)
      .addColumn("last_used_at", text)
      .addColumn("expires_at", text)
      .execute()
    await db.schema.createIndex("api_tokens_user_id").on("api_tokens").column("user_id").execute()

    await db.schema
      .createTable("device_authorizations")
      .addColumn("device_code_hash", text, (c) => c.primaryKey())
      .addColumn("user_code", text, (c) => c.notNull().unique())
      .addColumn("client_name", text, notNull)
      .addColumn("status", text, (c) =>
        c.notNull().check(sql`status in ('pending', 'approved', 'denied')`),
      )
      .addColumn("user_id", text, (c) => c.references("users.id").onDelete("cascade"))
      .addColumn("created_at", text, notNull)
      .addColumn("expires_at", text, notNull)
      .addColumn("last_polled_at", text)
      .execute()
    // Every new request sweeps out the expired rows.
    await db.schema
      .createIndex("device_authorizations_expires_at")
      .on("device_authorizations")
      .column("expires_at")
      .execute()
  },
}

// When each person was assigned to each task: one row per stretch of time, open while it lasts.
// Existing assignments have no recorded start, so they begin when their task was created.
const taskAssignments: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      await trx.schema
        .createTable("task_assignments")
        .addColumn("id", text, (c) => c.primaryKey())
        .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
        .addColumn("user_id", text, (c) => c.notNull().references("users.id").onDelete("cascade"))
        .addColumn("assigned_at", text, notNull)
        .addColumn("unassigned_at", text)
        .execute()
      await trx.schema
        .createIndex("task_assignments_task_id")
        .on("task_assignments")
        .column("task_id")
        .execute()
      await trx.schema
        .createIndex("task_assignments_user_assigned")
        .on("task_assignments")
        .columns(["user_id", "assigned_at"])
        .execute()

      const rows = await trx
        .selectFrom("taskAssignees")
        .innerJoin("tasks", "tasks.id", "taskAssignees.taskId")
        .select(["taskAssignees.taskId", "taskAssignees.userId", "tasks.createdAt"])
        .execute()
      // Batched to stay well under SQLite's bound-parameter limit.
      for (let i = 0; i < rows.length; i += 500) {
        await trx
          .insertInto("taskAssignments")
          .values(
            rows.slice(i, i + 500).map((r) => ({
              id: crypto.randomUUID(),
              taskId: r.taskId,
              userId: r.userId,
              assignedAt: r.createdAt,
              unassignedAt: null,
            })),
          )
          .execute()
      }
    })
  },
}

// Who reviewed the code and who tested it. Each answer is a user, "nobody" or not given yet:
// `*_by` holds the user, and `*_by_set` says whether the question has been answered, so a null
// `*_by` is "nobody" when set and "unanswered" when not. Tasks that already exist predate the
// question and are backfilled to "nobody". Deleting a user turns their answers into "nobody".
const reviewAndTest: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      for (const column of ["reviewed_by", "tested_by"]) {
        await trx.schema
          .alterTable("tasks")
          .addColumn(column, text, (c) => c.references("users.id").onDelete("set null"))
          .execute()
        await trx.schema
          .alterTable("tasks")
          .addColumn(`${column}_set`, "integer", (c) => c.notNull().defaultTo(0))
          .execute()
      }
      await sql`update tasks set reviewed_by_set = 1, tested_by_set = 1`.execute(trx)
    })
  },
}

// GitHub pull requests on tasks (see github/). A workspace can have one GitHub webhook, with
// its own URL id, secret, merge branch (whose merges move tasks to review) and an optional
// token for looking PRs up. Moves made by the webhook are recorded as the "GitHub" system
// user, which nobody can sign in as (auth/users.ts refuses its email domain).
const github: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      await trx.schema
        .createTable("github_webhooks")
        .addColumn("workspace_id", text, (c) =>
          c.primaryKey().references("workspaces.id").onDelete("cascade"),
        )
        .addColumn("hook_id", text, (c) => c.notNull().unique())
        .addColumn("secret", text, notNull)
        .addColumn("merge_branch", text, notNull)
        .addColumn("token", text)
        .addColumn("created_at", text, notNull)
        .addColumn("updated_at", text, notNull)
        .execute()

      await trx.schema
        .createTable("task_pull_requests")
        .addColumn("id", text, (c) => c.primaryKey())
        .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
        .addColumn("repo", text, notNull)
        .addColumn("number", "integer", notNull)
        .addColumn("url", text, notNull)
        // The rest is null until GitHub has been asked or has sent an event about the PR.
        .addColumn("title", text)
        .addColumn("author", text)
        .addColumn("state", text, (c) =>
          c.check(sql`state in ('open', 'draft', 'merged', 'closed')`),
        )
        .addColumn("base_branch", text)
        .addColumn("github_updated_at", text)
        .addColumn("source", text, (c) => c.notNull().check(sql`source in ('manual', 'auto')`))
        .addColumn("linked_by", text, (c) => c.references("users.id").onDelete("set null"))
        .addColumn("created_at", text, notNull)
        .addColumn("updated_at", text, notNull)
        .addUniqueConstraint("task_pull_requests_unique", ["task_id", "repo", "number"])
        .execute()
      await trx.schema
        .createIndex("task_pull_requests_repo_number")
        .on("task_pull_requests")
        .columns(["repo", "number"])
        .execute()

      const ts = new Date().toISOString()
      await trx
        .insertInto("users")
        .values({
          id: "github",
          name: "GitHub",
          email: "github@intesa.invalid",
          totpEnabled: 0,
          createdAt: ts,
          updatedAt: ts,
        })
        .execute()
    })
  },
}

// What the GitHub webhook has to remember once a link is gone: the newest event it has applied
// for each PR (so a late event cannot bring back links a newer one removed), and the PRs
// someone unlinked from a task (so keywords in the PR do not link them again).
const githubMemory: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      await trx.schema
        .createTable("github_pull_requests")
        .addColumn("workspace_id", text, (c) =>
          c.notNull().references("workspaces.id").onDelete("cascade"),
        )
        .addColumn("repo", text, notNull)
        .addColumn("number", "integer", notNull)
        .addColumn("github_updated_at", text, notNull)
        .addPrimaryKeyConstraint("github_pull_requests_pk", ["workspace_id", "repo", "number"])
        .execute()

      await trx.schema
        .createTable("task_pull_request_unlinks")
        .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
        .addColumn("repo", text, notNull)
        .addColumn("number", "integer", notNull)
        .addColumn("created_at", text, notNull)
        .addPrimaryKeyConstraint("task_pull_request_unlinks_pk", ["task_id", "repo", "number"])
        .execute()
    })
  },
}

// Where a task's code is: each webhook names its production branch (main), and a merged PR
// records its merge commit and, once that commit is found in the production branch, the
// branch's name. The default only exists because SQLite cannot add a NOT NULL column without
// one.
const githubCodeLocation: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      await trx.schema
        .alterTable("github_webhooks")
        .addColumn("production_branch", text, (c) => c.notNull().defaultTo("main"))
        .execute()
      await trx.schema
        .alterTable("task_pull_requests")
        .addColumn("merge_commit_sha", text)
        .execute()
      await trx.schema.alterTable("task_pull_requests").addColumn("released_to", text).execute()
      // PRs already merged straight into the production branch are in it.
      await sql`update task_pull_requests set released_to = base_branch where state = 'merged' and base_branch = coalesce((select w.production_branch from github_webhooks w join tasks t on t.workspace_id = w.workspace_id where t.id = task_pull_requests.task_id), 'main')`.execute(
        trx,
      )
    })
  },
}

// Artifact bytes move to `blobs`, keyed by their SHA-256, so identical files are stored once.
// An artifact is a handle on a blob; triggers delete a blob once no artifact refers to it, on
// every path an artifact goes (its own delete, a task's cascade, a Markdown replacement).
const contentAddressedArtifacts: Migration = {
  async up(db) {
    const sqlite = db.getExecutor().adapter instanceof SqliteAdapter
    await atomically(db, async (trx) => {
      await trx.schema
        .createTable("blobs")
        .addColumn("hash", text, (c) => c.primaryKey())
        .addColumn("size", "integer", notNull)
        .addColumn("content", sqlite ? sql`blob` : sql`bytea`, notNull)
        .execute()
      await trx.schema
        .createTable("artifacts_next")
        .addColumn("id", text, (c) => c.primaryKey())
        .addColumn("task_id", text, (c) => c.notNull().references("tasks.id").onDelete("cascade"))
        .addColumn("name", text, notNull)
        .addColumn("mime_type", text, notNull)
        .addColumn("size", "integer", notNull)
        .addColumn("blob_hash", text, (c) => c.notNull().references("blobs.hash"))
        .addColumn("created_at", text, notNull)
        .addColumn("updated_at", text, notNull)
        .execute()

      // One row at a time, so only one file's bytes are held in memory.
      const ids = await trx.selectFrom("artifacts").select("id").execute()
      for (const { id } of ids) {
        const { content, ...row } = await trx
          .selectFrom("artifacts")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirstOrThrow()
        const hash = createHash("sha256").update(content).digest("hex")
        await trx
          .insertInto("blobs")
          .values({ hash, size: content.byteLength, content })
          .onConflict((oc) => oc.column("hash").doNothing())
          .execute()
        await trx
          .insertInto("artifactsNext")
          .values({ ...row, blobHash: hash })
          .execute()
      }

      await trx.schema.dropTable("artifacts").execute()
      await trx.schema.alterTable("artifacts_next").renameTo("artifacts").execute()
      await trx.schema.createIndex("artifacts_task_id").on("artifacts").column("task_id").execute()
      await trx.schema
        .createIndex("artifacts_blob_hash")
        .on("artifacts")
        .column("blob_hash")
        .execute()

      // Updating an artifact to the same blob finds itself still referring to it: a no-op.
      const release = sql`delete from blobs where hash = old.blob_hash
        and not exists (select 1 from artifacts where blob_hash = old.blob_hash)`
      if (sqlite) {
        await sql`create trigger artifacts_release_blob_on_delete after delete on artifacts
          begin ${release}; end`.execute(trx)
        await sql`create trigger artifacts_release_blob_on_update
          after update of blob_hash on artifacts begin ${release}; end`.execute(trx)
      } else {
        await sql`create function release_artifact_blob() returns trigger
          language plpgsql as $$ begin ${release}; return null; end $$`.execute(trx)
        await sql`create trigger artifacts_release_blob
          after delete or update of blob_hash on artifacts
          for each row execute function release_artifact_blob()`.execute(trx)
      }
    })
  },
}

// Bugs group the tasks tagged `bug` that worked on them. A bug's description shows images
// through its own handles on blobs (`bug_images`), so a blob now lives while either an artifact
// or a bug image refers to it. A bug goes with its last task, whichever path removes the link.
const bugs: Migration = {
  async up(db) {
    const sqlite = db.getExecutor().adapter instanceof SqliteAdapter
    await atomically(db, async (trx) => {
      await trx.schema
        .alterTable("projects")
        .addColumn("bug_counter", "integer", (c) => c.notNull().defaultTo(0))
        .execute()
      await trx.schema
        .createTable("bugs")
        .addColumn("id", text, (c) => c.primaryKey())
        .addColumn("project_id", text, (c) =>
          c.notNull().references("projects.id").onDelete("cascade"),
        )
        .addColumn("number", "integer", notNull)
        .addColumn("title", text, notNull)
        .addColumn("body", text)
        // No foreign key: the task it mirrors may be deleted while the bug lives on.
        .addColumn("source_task_id", text)
        .addColumn("edited_at", text)
        .addColumn("created_by", text, (c) => c.notNull().references("users.id"))
        .addColumn("created_at", text, notNull)
        .addColumn("updated_at", text, notNull)
        .addUniqueConstraint("bugs_project_number", ["project_id", "number"])
        .execute()
      await trx.schema
        .createTable("bug_tasks")
        .addColumn("task_id", text, (c) =>
          c.primaryKey().references("tasks.id").onDelete("cascade"),
        )
        .addColumn("bug_id", text, (c) => c.notNull().references("bugs.id").onDelete("cascade"))
        .addColumn("created_at", text, notNull)
        .execute()
      await trx.schema.createIndex("bug_tasks_bug_id").on("bug_tasks").column("bug_id").execute()
      await trx.schema
        .createTable("bug_images")
        .addColumn("id", text, (c) => c.primaryKey())
        .addColumn("bug_id", text, (c) => c.notNull().references("bugs.id").onDelete("cascade"))
        .addColumn("name", text, notNull)
        .addColumn("mime_type", text, notNull)
        .addColumn("size", "integer", notNull)
        .addColumn("blob_hash", text, (c) => c.notNull().references("blobs.hash"))
        .addColumn("created_at", text, notNull)
        .execute()
      await trx.schema.createIndex("bug_images_bug_id").on("bug_images").column("bug_id").execute()
      await trx.schema
        .createIndex("bug_images_blob_hash")
        .on("bug_images")
        .column("blob_hash")
        .execute()

      const release = sql`delete from blobs where hash = old.blob_hash
        and not exists (select 1 from artifacts where blob_hash = old.blob_hash)
        and not exists (select 1 from bug_images where blob_hash = old.blob_hash)`
      const dropEmptyBug = sql`delete from bugs where id = old.bug_id
        and not exists (select 1 from bug_tasks where bug_id = old.bug_id)`
      if (sqlite) {
        await sql`drop trigger artifacts_release_blob_on_delete`.execute(trx)
        await sql`drop trigger artifacts_release_blob_on_update`.execute(trx)
        for (const table of ["artifacts", "bug_images"]) {
          await sql`create trigger ${sql.id(`${table}_release_blob_on_delete`)}
            after delete on ${sql.table(table)} begin ${release}; end`.execute(trx)
          await sql`create trigger ${sql.id(`${table}_release_blob_on_update`)}
            after update of blob_hash on ${sql.table(table)} begin ${release}; end`.execute(trx)
        }
        await sql`create trigger bug_tasks_drop_empty_bug after delete on bug_tasks
          begin ${dropEmptyBug}; end`.execute(trx)
      } else {
        await sql`drop trigger artifacts_release_blob on artifacts`.execute(trx)
        await sql`drop function release_artifact_blob()`.execute(trx)
        await sql`create function release_blob() returns trigger
          language plpgsql as $$ begin ${release}; return null; end $$`.execute(trx)
        for (const table of ["artifacts", "bug_images"]) {
          await sql`create trigger ${sql.id(`${table}_release_blob`)}
            after delete or update of blob_hash on ${sql.table(table)}
            for each row execute function release_blob()`.execute(trx)
        }
        await sql`create function drop_empty_bug() returns trigger
          language plpgsql as $$ begin ${dropEmptyBug}; return null; end $$`.execute(trx)
        await sql`create trigger bug_tasks_drop_empty_bug after delete on bug_tasks
          for each row execute function drop_empty_bug()`.execute(trx)
      }
    })
  },
}

// A bug has its own description and no longer follows its first task. A bug never edited
// only showed a copy of that task, so its description and the image handles the copy made go
// (the triggers release their blobs).
const bugOwnDescription: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      await sql`delete from bug_images where bug_id in (select id from bugs where edited_at is null)`.execute(
        trx,
      )
      await sql`update bugs set body = null where edited_at is null`.execute(trx)
      // One column per statement: SQLite drops a single column at a time.
      await trx.schema.alterTable("bugs").dropColumn("source_task_id").execute()
      await trx.schema.alterTable("bugs").dropColumn("edited_at").execute()
    })
  },
}

// Bugs are opened when a task gets the bug tag, so tasks tagged before bugs existed have none.
// Each becomes a bug of its own, numbered in task order within its project: which of them were
// regressions of one another cannot be told after the fact.
const backfillBugs: Migration = {
  async up(db) {
    await atomically(db, async (trx) => {
      const tasks = await trx
        .selectFrom("tasks")
        .innerJoin("taskTags", "taskTags.taskId", "tasks.id")
        .innerJoin("tags", "tags.id", "taskTags.tagId")
        .select([
          "tasks.id",
          "tasks.projectId",
          "tasks.title",
          "tasks.createdBy",
          "tasks.createdAt",
        ])
        .where((eb) => eb(eb.fn("lower", ["tags.name"]), "=", "bug"))
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("bugTasks")
                .select("taskId")
                .whereRef("bugTasks.taskId", "=", "tasks.id"),
            ),
          ),
        )
        .orderBy("tasks.projectId")
        .orderBy("tasks.number")
        .execute()
      const ts = new Date().toISOString()
      for (const task of tasks) {
        const { bugCounter } = await trx
          .updateTable("projects")
          .set((eb) => ({ bugCounter: eb("bugCounter", "+", 1) }))
          .where("id", "=", task.projectId)
          .returning("bugCounter")
          .executeTakeFirstOrThrow()
        const id = crypto.randomUUID()
        await trx
          .insertInto("bugs")
          .values({
            id,
            projectId: task.projectId,
            number: bugCounter,
            title: task.title,
            body: null,
            createdBy: task.createdBy,
            createdAt: task.createdAt,
            updatedAt: ts,
          })
          .execute()
        await trx
          .insertInto("bugTasks")
          .values({ taskId: task.id, bugId: id, createdAt: task.createdAt })
          .execute()
      }
    })
  },
}

export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
  "0002_tag_name_unique": tagNameIndex,
  "0003_custom_field_names_related_order": customFieldNamesAndRelated,
  "0004_task_position": taskPosition,
  "0005_artifacts": artifacts,
  "0006_api_tokens_device_auth": apiTokensAndDeviceAuth,
  "0007_task_assignments": taskAssignments,
  "0008_review_and_test": reviewAndTest,
  "0009_github": github,
  "0010_github_memory": githubMemory,
  "0011_github_code_location": githubCodeLocation,
  "0012_content_addressed_artifacts": contentAddressedArtifacts,
  "0013_bugs": bugs,
  "0014_bug_own_description": bugOwnDescription,
  "0015_backfill_bugs": backfillBugs,
}
