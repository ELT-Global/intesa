import { useQuery } from "@tanstack/react-query"
import { Users, UserX, X } from "lucide-react"
import { useState } from "react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { membersQuery } from "@/lib/queries"
import { PickerPopover } from "./picker-popover"

/** Selection entry that matches tasks with no assignee. */
export const UNASSIGNED = "unassigned"

/** Multi-select assignee filter. An empty selection means everyone's tasks. */
export function AssigneeFilter({
  workspaceId,
  selected,
  meId,
  onChange,
}: {
  workspaceId: string | undefined
  selected: string[]
  meId: string | undefined
  onChange: (next: string[]) => void
}) {
  const members = useQuery({ ...membersQuery(workspaceId ?? ""), enabled: !!workspaceId }).data ?? []
  const [filter, setFilter] = useState("")
  const needle = filter.trim().toLowerCase()
  const visible = members.filter(
    (m) =>
      !needle || m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle),
  )
  const chosen = members.filter((m) => selected.includes(m.userId))

  function toggle(userId: string) {
    onChange(selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId])
  }

  let summary = "Everyone"
  if (selected.length === 1) {
    const only = chosen[0]
    if (selected[0] === UNASSIGNED) summary = "Unassigned"
    else summary = only ? (only.userId === meId ? "Me" : only.name) : "1 person"
  } else if (selected.length > 1) {
    summary = `${selected.length} selected`
  }
  const showUnassigned = !needle || "unassigned".includes(needle)

  return (
    <div className="flex items-center gap-1">
      <PickerPopover
        label="Assignee filter"
        placeholder="Filter people"
        empty="No matching people."
        filter={filter}
        onFilterChange={setFilter}
        onOpenChange={(open) => !open && setFilter("")}
        trigger={
          <Button variant="outline" size="sm" aria-label={`Filter by assignee: ${summary}`}>
            <Users />
            <span className="text-muted-foreground">Assignee</span>
            {summary}
          </Button>
        }
        options={[
          ...(showUnassigned
            ? [
                {
                  id: UNASSIGNED,
                  label: "Unassigned",
                  selected: selected.includes(UNASSIGNED),
                  onSelect: () => toggle(UNASSIGNED),
                  content: (
                    <>
                      <UserX aria-hidden className="size-4 text-muted-foreground" />
                      Unassigned
                    </>
                  ),
                },
              ]
            : []),
          ...visible.map((m) => ({
          id: m.userId,
          label: `${m.name} ${m.email}`,
          selected: selected.includes(m.userId),
          onSelect: () => toggle(m.userId),
          content: (
            <>
              <Avatar name={m.name} />
              <span className="min-w-0 flex-1 truncate">
                {m.name}
                {m.userId === meId && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                )}
              </span>
            </>
          ),
          })),
        ]}
      />
      {selected.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label="Clear assignee filter"
          onClick={() => onChange([])}
        >
          <X />
        </Button>
      )}
    </div>
  )
}
