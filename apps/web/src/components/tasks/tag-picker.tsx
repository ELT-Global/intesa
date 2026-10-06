import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Tag as TagIcon, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api"
import { type Tag, tagsQuery, useCreateTag } from "@/lib/tags"
import {
  type TagRef,
  type TaskDetail,
  type TaskSummary,
  taskKeys,
  useUpdateTask,
} from "@/lib/tasks"
import { PickerPopover } from "./picker-popover"
import { TagDot } from "./tag-chip"

/**
 * Edits a task's tags, or, with `value`/`onChange` instead of `task`, a draft list
 * (e.g. while composing a new task).
 */
export function TagPicker({
  task,
  workspaceId,
  value,
  onChange,
}: {
  task?: TaskDetail | TaskSummary
  workspaceId: string
  value?: Tag[]
  onChange?: (next: Tag[]) => void
}) {
  const applied = value ?? task?.tags ?? []
  const update = useUpdateTask()
  const qc = useQueryClient()
  const createTag = useCreateTag(workspaceId)
  const tags = useQuery(tagsQuery(workspaceId)).data ?? []
  const [filter, setFilter] = useState("")

  const appliedIds = new Set(applied.map((t) => t.id))
  const name = filter.trim()
  const needle = name.toLowerCase()
  const visible = tags.filter((t) => !needle || t.name.toLowerCase().includes(needle))
  const exists = tags.some((t) => t.name.toLowerCase() === needle)

  function setTags(next: Tag[]) {
    if (onChange || !task) return onChange?.(next)
    update.mutate({
      taskId: task.id,
      projectId: task.projectId,
      patch: { tagIds: next.map((t) => t.id) },
      view: { tags: next },
    })
  }

  function currentTags(): TagRef[] {
    return task
      ? (qc.getQueryData<TaskDetail>(taskKeys.detail(task.id))?.tags ?? task.tags)
      : applied
  }

  function toggle(tag: Tag) {
    const current = currentTags()
    const kept = current.filter((t) => t.id !== tag.id)
    setTags(current.some((t) => t.id === tag.id) ? kept : [...kept, tag])
  }

  async function create() {
    const wanted = name
    setFilter("")
    let tag: Tag | undefined
    try {
      tag = await createTag.mutateAsync(wanted)
    } catch (error) {
      // Someone else created it first: use theirs.
      if (!(error instanceof ApiError && error.status === 409)) return
      const fresh = await qc.fetchQuery({ ...tagsQuery(workspaceId), staleTime: 0 })
      tag = fresh.find((t) => t.name.toLowerCase() === wanted.toLowerCase())
    }
    if (!tag) return
    // The task may have changed while the tag was being created.
    const current = currentTags()
    const created = tag
    if (!current.some((t) => t.id === created.id)) setTags([...current, created])
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
          aria-label={applied.length === 0 ? "Add tag" : "Change tags"}
          className="text-foreground"
        >
          <TagIcon />
          {applied.length === 0 && "Add tag"}
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
            className="touch-target -ml-1 flex size-5 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
    </>
  )
}
