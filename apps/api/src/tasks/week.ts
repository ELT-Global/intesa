import { sql } from "kysely"
import type { Db } from "../db"
import type { Priority, Status } from "./schemas"
import type { UserRef } from "./service"

export type WeekChange = {
  fromStatus: Status | null
  toStatus: Status
  at: string
  by: UserRef
}

export type WeekTask = {
  id: string
  key: string
  title: string
  project: { id: string; name: string; key: string }
  parentTaskId: string | null
  priority: Priority | null
  dueAt: string | null
  createdAt: string
  /** Status at `to`. */
  status: Status
  /** Status at `from`; null when the task was created during the week. */
  startStatus: Status | null
  /** When it last moved to complete inside the week, if it is complete at `to`. */
  completedAt: string | null
  /** When this person's earliest assignment overlapping the week began. */
  assignedAt: string
  /**
   * When it became planned work for them: the later of `assignedAt` and the task's last move
   * out of Backlog (or its creation outside it) before `to`; null if it never left Backlog.
   * Clients show this as the assigned date, falling back to `assignedAt`.
   */
  plannedAt: string | null
  /** Planned before the week and not in Backlog when it began. */
  carriedOver: boolean
  /** When it was taken off them inside the week; null if still theirs at `to`. */
  unassignedAt: string | null
  /** Status changes inside the week, oldest first (creation included). */
  changes: WeekChange[]
  /** Its subtasks' progress now; null without subtasks. */
  subtasks: { done: number; total: number } | null
  /** Tasks that block it and are not complete yet, as they stand now. */
  blockedBy: { id: string; key: string; title: string; status: Status }[]
}

export type WeekPerson = { user: UserRef; member: boolean; tasks: WeekTask[] }

export type WeekLog = { from: string; to: string; people: WeekPerson[] }

// Completed work first, then the rest from closest to done.
const STATUS_RANK: Record<Status, number> = {
  complete: 0,
  review: 1,
  in_progress: 2,
  todo: 3,
  backlog: 4,
}

// Assignment intervals in the workspace that overlap [from, to).
const overlapping = (db: Db, workspaceId: string, from: string, to: string) =>
  db
    .selectFrom("taskAssignments")
    .innerJoin("tasks", "tasks.id", "taskAssignments.taskId")
    .where("tasks.workspaceId", "=", workspaceId)
    .where("taskAssignments.assignedAt", "<", to)
    .where((eb) =>
      eb.or([
        eb("taskAssignments.unassignedAt", "is", null),
        eb("taskAssignments.unassignedAt", ">", from),
      ]),
    )

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Who worked on what in [from, to) (ISO instants), with a fixed number of queries. Statuses at
// the week's edges are derived from the status history; a task that was complete for the whole
// week is left out.
export async function loadWeekLog(
  db: Db,
  workspaceId: string,
  from: string,
  to: string,
): Promise<WeekLog> {
  const [members, assignments, history, subtaskCounts, blockers] = await Promise.all([
    db
      .selectFrom("workspaceMembers")
      .innerJoin("users", "users.id", "workspaceMembers.userId")
      .select(["users.id", "users.name", "users.avatarUrl"])
      .where("workspaceMembers.workspaceId", "=", workspaceId)
      .execute(),
    overlapping(db, workspaceId, from, to)
      .innerJoin("projects", "projects.id", "tasks.projectId")
      .innerJoin("users", "users.id", "taskAssignments.userId")
      .select((eb) => [
        "taskAssignments.userId",
        "taskAssignments.assignedAt",
        "taskAssignments.unassignedAt",
        "users.name as userName",
        "users.avatarUrl as userAvatarUrl",
        "tasks.id",
        "tasks.number",
        "tasks.title",
        "tasks.status",
        "tasks.priority",
        "tasks.dueAt",
        "tasks.parentTaskId",
        "tasks.createdAt",
        "projects.id as projectId",
        "projects.name as projectName",
        "projects.key as projectKey",
        eb
          .selectFrom("taskStatusHistory")
          .select("taskStatusHistory.toStatus")
          .whereRef("taskStatusHistory.taskId", "=", "tasks.id")
          .where("taskStatusHistory.updatedAt", "<", from)
          .orderBy("taskStatusHistory.updatedAt", "desc")
          .limit(1)
          .as("startStatus"),
        // The task's last move out of Backlog before `to`; creation counts as a move.
        eb
          .selectFrom("taskStatusHistory")
          .select("taskStatusHistory.updatedAt")
          .whereRef("taskStatusHistory.taskId", "=", "tasks.id")
          .where("taskStatusHistory.updatedAt", "<", to)
          .where("taskStatusHistory.toStatus", "!=", "backlog")
          .where((h) =>
            h.or([
              h("taskStatusHistory.fromStatus", "is", null),
              h("taskStatusHistory.fromStatus", "=", "backlog"),
            ]),
          )
          .orderBy("taskStatusHistory.updatedAt", "desc")
          .limit(1)
          .as("leftBacklogAt"),
      ])
      .execute(),
    db
      .selectFrom("taskStatusHistory")
      .innerJoin("users", "users.id", "taskStatusHistory.updatedBy")
      .select([
        "taskStatusHistory.taskId",
        "taskStatusHistory.fromStatus",
        "taskStatusHistory.toStatus",
        "taskStatusHistory.updatedAt",
        "users.id as userId",
        "users.name",
        "users.avatarUrl",
      ])
      .where(
        "taskStatusHistory.taskId",
        "in",
        overlapping(db, workspaceId, from, to).select("tasks.id"),
      )
      .where("taskStatusHistory.updatedAt", ">=", from)
      .where("taskStatusHistory.updatedAt", "<", to)
      .orderBy("taskStatusHistory.updatedAt")
      .execute(),
    db
      .selectFrom("tasks")
      .select([
        "parentTaskId",
        sql<number | string>`count(*)`.as("total"),
        sql<number | string>`sum(case when status = 'complete' then 1 else 0 end)`.as("done"),
      ])
      .where("parentTaskId", "in", overlapping(db, workspaceId, from, to).select("tasks.id"))
      .groupBy("parentTaskId")
      .execute(),
    db
      .selectFrom("taskRelationships")
      .innerJoin("tasks as blocker", "blocker.id", "taskRelationships.sourceTaskId")
      .innerJoin("projects", "projects.id", "blocker.projectId")
      .select([
        "taskRelationships.targetTaskId",
        "blocker.id",
        "blocker.number",
        "blocker.title",
        "blocker.status",
        "projects.key as projectKey",
      ])
      .where("taskRelationships.type", "=", "blocks")
      .where("blocker.status", "!=", "complete")
      .where(
        "taskRelationships.targetTaskId",
        "in",
        overlapping(db, workspaceId, from, to).select("tasks.id"),
      )
      .orderBy("projects.key")
      .orderBy("blocker.number")
      .execute(),
  ])

  const subtasksByTask = new Map(
    subtaskCounts.map((c) => [
      c.parentTaskId,
      { done: Number(c.done ?? 0), total: Number(c.total) },
    ]),
  )
  const blockedByTask = new Map<string, WeekTask["blockedBy"]>()
  for (const b of blockers) {
    const ref = {
      id: b.id,
      key: `${b.projectKey}-${b.number}`,
      title: b.title,
      status: b.status as Status,
    }
    const list = blockedByTask.get(b.targetTaskId)
    if (list) list.push(ref)
    else blockedByTask.set(b.targetTaskId, [ref])
  }

  const changesByTask = new Map<string, WeekChange[]>()
  for (const h of history) {
    const change: WeekChange = {
      fromStatus: h.fromStatus as Status | null,
      toStatus: h.toStatus as Status,
      at: h.updatedAt,
      by: { id: h.userId, name: h.name, avatarUrl: h.avatarUrl },
    }
    const list = changesByTask.get(h.taskId)
    if (list) list.push(change)
    else changesByTask.set(h.taskId, [change])
  }

  type Entry = {
    task: WeekTask
    number: number
    open: boolean
    lastEnd: string
    leftBacklogAt: string | null
  }
  type Person = { user: UserRef; member: boolean; entries: Map<string, Entry> }
  const people = new Map<string, Person>()
  for (const m of members) {
    people.set(m.id, {
      user: { id: m.id, name: m.name, avatarUrl: m.avatarUrl },
      member: true,
      entries: new Map(),
    })
  }

  for (const a of assignments) {
    const changes = changesByTask.get(a.id) ?? []
    const startStatus = a.startStatus as Status | null
    // A task that sat complete through the week is not part of it.
    if (startStatus === "complete" && changes.length === 0) continue

    let person = people.get(a.userId)
    if (!person) {
      person = {
        user: { id: a.userId, name: a.userName, avatarUrl: a.userAvatarUrl },
        member: false,
        entries: new Map(),
      }
      people.set(a.userId, person)
    }

    // Several stretches of the same assignment merge into one entry.
    const existing = person.entries.get(a.id)
    if (existing) {
      if (a.assignedAt < existing.task.assignedAt) existing.task.assignedAt = a.assignedAt
      if (a.unassignedAt === null) existing.open = true
      else if (a.unassignedAt > existing.lastEnd) existing.lastEnd = a.unassignedAt
      continue
    }

    const status = changes.at(-1)?.toStatus ?? startStatus ?? (a.status as Status)
    const completedAt =
      status === "complete"
        ? (changes.findLast((c) => c.toStatus === "complete")?.at ?? null)
        : null
    person.entries.set(a.id, {
      number: a.number,
      open: a.unassignedAt === null,
      lastEnd: a.unassignedAt ?? "",
      leftBacklogAt: a.leftBacklogAt,
      task: {
        id: a.id,
        key: `${a.projectKey}-${a.number}`,
        title: a.title,
        project: { id: a.projectId, name: a.projectName, key: a.projectKey },
        parentTaskId: a.parentTaskId,
        priority: a.priority as Priority | null,
        dueAt: a.dueAt,
        createdAt: a.createdAt,
        status,
        startStatus,
        completedAt,
        assignedAt: a.assignedAt,
        plannedAt: null,
        carriedOver: false,
        unassignedAt: null,
        changes,
        subtasks: subtasksByTask.get(a.id) ?? null,
        blockedBy: blockedByTask.get(a.id) ?? [],
      },
    })
  }

  const byWeekOrder = (x: Entry, y: Entry) =>
    STATUS_RANK[x.task.status] - STATUS_RANK[y.task.status] ||
    compare(x.task.completedAt ?? "", y.task.completedAt ?? "") ||
    compare(x.task.project.key, y.task.project.key) ||
    x.number - y.number

  return {
    from,
    to,
    people: [...people.values()]
      .sort(
        (x, y) =>
          compare(x.user.name.toLowerCase(), y.user.name.toLowerCase()) ||
          compare(x.user.id, y.user.id),
      )
      .map((p) => ({
        user: p.user,
        member: p.member,
        tasks: [...p.entries.values()].sort(byWeekOrder).map((entry) => {
          const { task, open, lastEnd, leftBacklogAt } = entry
          const plannedAt =
            leftBacklogAt === null
              ? null
              : leftBacklogAt > task.assignedAt
                ? leftBacklogAt
                : task.assignedAt
          return {
            ...task,
            plannedAt,
            // Backlog is not committed work, so it is never carried over.
            carriedOver: task.startStatus !== "backlog" && plannedAt !== null && plannedAt < from,
            // Still theirs at `to` unless the last stretch ended inside the week.
            unassignedAt: open || lastEnd >= to ? null : lastEnd,
          }
        }),
      })),
  }
}
