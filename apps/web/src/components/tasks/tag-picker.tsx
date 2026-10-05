import { useQuery } from "@tanstack/react-query"
import { Plus, Tag as TagIcon, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { type Tag, tagsQuery, useCreateTag } from "@/lib/tags"
import { type TaskDetail, type TaskSummary, useUpdateTask } from "@/lib/tasks"
import { PickerPopover } from "./picker-popover"
import { TagDot } from "./task-card"

export function TagPicker({
  task,
  workspaceId,
}: {
  task: TaskDetail | TaskSummary
  workspaceId: string
}) {
  const update = useUpdateTask()
  const createTag = useCreateTag(workspaceId)
  const tags = useQuery(tagsQuery(workspaceId)).data ?? []
  const [filter, setFilter] = useState("")

  const appliedIds = new Set(task.tags.map((t) => t.id))
  const name = filter.trim()
  const needle = name.toLowerCase()
  const visible = tags.filter((t) => !needle || t.name.toLowerCase().includes(needle))
  const exists = tags.some((t) => t.name.toLowerCase() === needle)

  function setTags(next: Tag[]) {
    update.mutate({
      taskId: task.id,
      projectId: task.projectId,
      patch: { tagIds: next.map((t) => t.id) },
      view: { tags: next },
    })
  }

  function toggle(tag: Tag) {
    const kept = task.tags.filter((t) => t.id !== tag.id)
    setTags(appliedIds.has(tag.id) ? kept : [...kept, tag])
  }

  async function create() {
    setFilter("")
    try {
      setTags([...task.tags, await createTag.mutateAsync(name)])
    } catch {
      // A duplicate means another tab created it first; the refetched list will show it.
    }
  }

  return (
    <PickerPopover
      label="Tags"
      placeholder="Filter or create tags"
      empty="No matching tags."
      filter={filter}
      onFilterChange={setFilter}
      onOpenChange={(open) => !open && setFilter("")}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={task.tags.length === 0 ? "Add tag" : "Change tags"}
          className="text-foreground"
        >
          <TagIcon />
          {task.tags.length === 0 && "Add tag"}
        </Button>
      }
      options={[
        ...visible.map((t) => ({
          id: t.id,
          label: t.name,
          selected: appliedIds.has(t.id),
          onSelect: () => toggle(t),
          content: <TagDot name={t.name} color={t.color} />,
        })),
        ...(name && !exists
          ? [
              {
                id: "create",
                label: `Create tag “${name}”`,
                onSelect: () => void create(),
                content: (
                  <>
                    <Plus aria-hidden className="size-4 text-muted-foreground" />
                    Create tag “{name}”
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  )
}

/** Applied tags as removable chips, shown beside the picker trigger in the property strip. */
export function TagChips({ task }: { task: TaskDetail | TaskSummary }) {
  const update = useUpdateTask()
  return (
    <>
      {task.tags.map((t) => (
        <span key={t.id} className="inline-flex items-center">
          <TagDot name={t.name} color={t.color} />
          <button
            type="button"
            aria-label={`Remove tag ${t.name}`}
            onClick={() =>
              update.mutate({
                taskId: task.id,
                projectId: task.projectId,
                patch: { tagIds: task.tags.filter((x) => x.id !== t.id).map((x) => x.id) },
                view: { tags: task.tags.filter((x) => x.id !== t.id) },
              })
            }
            className="-ml-1 flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
    </>
  )
}
