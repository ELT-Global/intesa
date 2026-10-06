import { useQuery, useQueryClient } from "@tanstack/react-query"
import { UserPlus } from "lucide-react"
import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { Member } from "@/lib/api"
import { membersQuery, meQuery } from "@/lib/queries"
import {
  type TaskDetail,
  type TaskSummary,
  taskKeys,
  type UserRef,
  useUpdateTask,
} from "@/lib/tasks"
import { PickerPopover } from "./picker-popover"

export function AssigneePicker({
  task,
  workspaceId,
  value,
  onChange,
  compact,
  parentTaskId,
}: {
  /** The task to edit; omit it and pass `value`/`onChange` to edit a draft list instead. */
  task?: TaskDetail | TaskSummary
  workspaceId: string
  value?: UserRef[]
  onChange?: (next: UserRef[]) => void
  /** Icon-only trigger for dense rows; avatars stay visible, the empty state is a ghost icon. */
  compact?: boolean
  /** Set for a subtask shown inside its parent, whose cached detail then updates too. */
  parentTaskId?: string
}) {
  const update = useUpdateTask()
  const members = useQuery(membersQuery(workspaceId)).data ?? []
  const me = useQuery(meQuery).data
  const qc = useQueryClient()
  const [filter, setFilter] = useState("")

  const assignees = value ?? task?.assignees ?? []
  const assignedIds = new Set(assignees.map((a) => a.id))
  const needle = filter.trim().toLowerCase()
  const visible = members.filter(
    (m) =>
      !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
  )

  const meMember = members.find((m) => m.userId === me?.id)
  const showMe =
    meMember !== undefined &&
    !assignedIds.has(meMember.userId) &&
    (!needle || "assign to me".includes(needle))

  function setAssignees(next: UserRef[]) {
    if (!task) return onChange?.(next)
    update.mutate({
      taskId: task.id,
      projectId: task.projectId,
      patch: { assigneeIds: next.map((a) => a.id) },
      view: { assignees: next },
      parentTaskId,
    })
  }

  function toggle(member: Member) {
    // Built from the task's own assignees so a still-loading members list can't drop anyone.
    // Read at click time so two quick toggles build on each other instead of the render's snapshot.
    const current = task
      ? (qc.getQueryData<TaskDetail>(taskKeys.detail(task.id))?.assignees ?? task.assignees)
      : assignees
    const kept = current.filter((a) => a.id !== member.userId)
    if (current.some((a) => a.id === member.userId)) setAssignees(kept)
    else
      setAssignees([...kept, { id: member.userId, name: member.name, avatarUrl: member.avatarUrl }])
  }

  return (
    <PickerPopover
      label="Assignees"
      placeholder="Filter people"
      empty="No matching people."
      filter={filter}
      onFilterChange={setFilter}
      onOpenChange={(open) => !open && setFilter("")}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          icon={compact && assignees.length === 0}
          aria-label={compact ? `Change assignees of ${task?.title}` : "Change assignees"}
          className="text-foreground"
        >
          {assignees.length > 0 ? (
            <>
              <span className="flex -space-x-1">
                {assignees.slice(0, 3).map((a) => (
                  <Avatar
                    key={a.id}
                    name={a.name}
                    labelled={compact}
                    size={compact ? "sm" : "md"}
                    className="border-background"
                  />
                ))}
              </span>
              {!compact && (assignees.length === 1 ? assignees[0]?.name : assignees.length)}
            </>
          ) : (
            <>
              <UserPlus />
              {!compact && "Assign"}
            </>
          )}
        </Button>
      }
      options={[
        ...(showMe
          ? [
              {
                id: "assign-me",
                label: "Assign to me",
                onSelect: () => meMember && toggle(meMember),
                content: (
                  <>
                    <UserPlus aria-hidden className="size-4 text-muted-foreground" />
                    Assign to me
                  </>
                ),
              },
            ]
          : []),
        ...visible.map((m) => ({
          id: m.userId,
          label: `${m.name} ${m.email}`,
          selected: assignedIds.has(m.userId),
          onSelect: () => toggle(m),
          content: (
            <>
              <Avatar name={m.name} />
              <span className="min-w-0 flex-1 truncate">
                {m.name}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{m.email}</span>
              </span>
            </>
          ),
        })),
      ]}
    />
  )
}
