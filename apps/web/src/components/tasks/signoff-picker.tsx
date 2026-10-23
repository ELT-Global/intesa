import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { membersQuery } from "@/lib/queries"
import { type TaskDetail, type UserRef, useUpdateTask } from "@/lib/tasks"
import { cn } from "@/lib/utils"
import { filterPeople, PersonOption, PickerPopover } from "./picker-popover"

/** An answer to "who reviewed/tested it?": a person, null for nobody, undefined while unanswered. */
export type Signoff = UserRef | null | undefined

/** Single-choice member picker with a "Nobody" option. */
export function SignoffPicker({
  label,
  workspaceId,
  value,
  onChange,
  field,
}: {
  /** "Reviewed by", "Tested by". */
  label: string
  workspaceId: string
  value: Signoff
  onChange: (next: UserRef | null) => void
  /** Outlined, form-field trigger for dialogs; otherwise a ghost button for property strips. */
  field?: boolean
}) {
  const members = useQuery(membersQuery(workspaceId)).data ?? []
  const [filter, setFilter] = useState("")
  const needle = filter.trim().toLowerCase()
  const visible = filterPeople(members, filter)
  const nobody = !needle || "nobody".includes(needle)
  const answer = value === undefined ? "Not set" : value === null ? "Nobody" : value.name

  return (
    <PickerPopover
      single
      label={label}
      placeholder="Filter people"
      empty="No matching people."
      filter={filter}
      onFilterChange={setFilter}
      onOpenChange={(open) => !open && setFilter("")}
      trigger={
        <Button
          variant={field ? "outline" : "ghost"}
          size="sm"
          aria-label={`${label}: ${answer}`}
          className={cn("text-foreground", field && "min-w-44 justify-start")}
        >
          {!field && <span className="text-muted-foreground">{label}</span>}
          {value && <Avatar name={value.name} />}
          <span className={cn(value === undefined && "text-muted-foreground")}>{answer}</span>
        </Button>
      }
      options={[
        ...(nobody
          ? [
              {
                id: "nobody",
                label: "Nobody",
                selected: value === null,
                onSelect: () => onChange(null),
                content: <span className="min-w-0 flex-1">Nobody</span>,
              },
            ]
          : []),
        ...visible.map((m) => ({
          id: m.userId,
          label: `${m.name} ${m.email}`,
          selected: value?.id === m.userId,
          onSelect: () => onChange({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }),
          content: <PersonOption name={m.name} email={m.email} />,
        })),
      ]}
    />
  )
}

/** Reviewed by / Tested by of a task in Review or Complete; both can be changed at any time. */
export function SignoffProperties({
  task,
  workspaceId,
}: {
  task: TaskDetail
  workspaceId: string
}) {
  const update = useUpdateTask()
  // Subtasks are never asked, so they are not given the fields either.
  if ((task.status !== "review" && task.status !== "complete") || task.parentTaskId) return null

  const set = (field: "reviewedBy" | "testedBy", user: UserRef | null) => {
    const id = user?.id ?? null
    update.mutate({
      taskId: task.id,
      projectId: task.projectId,
      patch: field === "reviewedBy" ? { reviewedById: id } : { testedById: id },
      view: field === "reviewedBy" ? { reviewedBy: user } : { testedBy: user },
    })
  }

  return (
    <>
      <SignoffPicker
        label="Reviewed by"
        workspaceId={workspaceId}
        value={task.reviewedBy}
        onChange={(user) => set("reviewedBy", user)}
      />
      <SignoffPicker
        label="Tested by"
        workspaceId={workspaceId}
        value={task.testedBy}
        onChange={(user) => set("testedBy", user)}
      />
    </>
  )
}
