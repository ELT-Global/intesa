import { useQuery } from "@tanstack/react-query"
import { UserPlus } from "lucide-react"
import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type { Member } from "@/lib/api"
import { membersQuery, meQuery } from "@/lib/queries"
import { type TaskDetail, type TaskSummary, useUpdateTask } from "@/lib/tasks"
import { PickerPopover } from "./picker-popover"

export function AssigneePicker({
  task,
  workspaceId,
}: {
  task: TaskDetail | TaskSummary
  workspaceId: string
}) {
  const update = useUpdateTask()
  const members = useQuery(membersQuery(workspaceId)).data ?? []
  const me = useQuery(meQuery).data
  const [filter, setFilter] = useState("")

  const assignedIds = new Set(task.assignees.map((a) => a.id))
  const needle = filter.trim().toLowerCase()
  const visible = members.filter(
    (m) =>
      !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
  )

  function setAssignees(next: Member[]) {
    update.mutate({
      taskId: task.id,
      projectId: task.projectId,
      patch: { assigneeIds: next.map((m) => m.userId) },
      view: {
        assignees: next.map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl })),
      },
    })
  }

  function toggle(member: Member) {
    const kept = members.filter((m) => assignedIds.has(m.userId) && m.userId !== member.userId)
    setAssignees(assignedIds.has(member.userId) ? kept : [...kept, member])
  }

  const meMember = members.find((m) => m.userId === me?.id)

  return (
    <PickerPopover
      label="Assignees"
      placeholder="Filter people"
      empty="No matching people."
      filter={filter}
      onFilterChange={setFilter}
      onOpenChange={(open) => !open && setFilter("")}
      trigger={
        <Button variant="ghost" size="sm" aria-label="Change assignees" className="text-foreground">
          {task.assignees.length > 0 ? (
            <>
              <span className="flex -space-x-1">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.id} name={a.name} className="border-background" />
                ))}
              </span>
              {task.assignees.length === 1 ? task.assignees[0]?.name : task.assignees.length}
            </>
          ) : (
            <>
              <UserPlus />
              Assign
            </>
          )}
        </Button>
      }
      leading={
        meMember && !assignedIds.has(meMember.userId) ? (
          <button
            type="button"
            onClick={() => toggle(meMember)}
            className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-accent focus-visible:bg-accent"
          >
            <UserPlus aria-hidden className="size-4 text-muted-foreground" />
            Assign to me
          </button>
        ) : null
      }
      options={visible.map((m) => ({
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
      }))}
    />
  )
}
