import { type Db, inTransaction, now } from "../db"
import { ApiError } from "../lib/errors"
import { positionFor } from "./order"
import type { Status } from "./schemas"
import { type TaskRow, updateTask } from "./service"

/**
 * Turns a subtask into a top-level task of its project (ADR 0033). Subtasks use the project's
 * statuses already, so the status is kept: the task lands at the top of that board column,
 * like any task whose column changes. The assignees become `assigneeIds` (a full set, as in a
 * PATCH), so the assignment history follows. Status history is untouched: the status does not
 * change. The parent's progress counts are derived, so they follow on their own.
 */
export async function promoteSubtask(
  db: Db,
  userId: string,
  task: TaskRow,
  assigneeIds: string[],
): Promise<void> {
  await inTransaction(db, async (trx) => {
    // Read again inside the transaction: a concurrent promote must not run twice.
    const current = await trx
      .selectFrom("tasks")
      .select(["parentTaskId", "status"])
      .where("id", "=", task.id)
      .executeTakeFirstOrThrow()
    if (!current.parentTaskId) {
      throw new ApiError("VALIDATION_ERROR", "Only a subtask can be made a top-level task")
    }
    const status = current.status as Status
    const position = await positionFor(
      trx,
      { projectId: task.projectId, parentTaskId: null, status },
      "first",
      task.id,
    )
    await trx
      .updateTable("tasks")
      .set({ parentTaskId: null, position, updatedAt: now() })
      .where("id", "=", task.id)
      .execute()
    // Validates the people (workspace members) and records who was assigned or unassigned.
    await updateTask(trx, userId, { ...task, parentTaskId: null, status }, { assigneeIds })
  })
}
