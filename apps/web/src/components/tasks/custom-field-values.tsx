import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input, Select } from "@/components/ui/input"
import { type CustomField, customFieldsQuery } from "@/lib/custom-fields"
import { type TaskDetail, useUpdateTask } from "@/lib/tasks"

type Value = string | number | boolean | null

/** Two-column property list of the project's custom fields for one task. Renders nothing without fields. */
export function CustomFieldValues({ task }: { task: TaskDetail }) {
  const fields = useQuery(customFieldsQuery(task.projectId)).data ?? []
  if (fields.length === 0) return null

  const values = task.customFields as Record<string, unknown>
  return (
    <section aria-label="Fields" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">Fields</h3>
      <div className="grid grid-cols-[minmax(0,10rem)_1fr] items-start gap-x-4 gap-y-2">
        {fields.map((f) => (
          <FieldValueRow key={f.id} task={task} field={f} value={values[f.id] ?? null} />
        ))}
      </div>
    </section>
  )
}

function FieldValueRow({
  task,
  field,
  value,
}: {
  task: TaskDetail
  field: CustomField
  value: unknown
}) {
  const update = useUpdateTask()
  const [rejected, setRejected] = useState(false)
  // Shown synchronously on edit: a controlled input reverts to its prop right after the event
  // if the cache hasn't changed yet, and the cache write happens after an awaited cancel.
  const [local, setLocal] = useState<{ value: Value } | null>(null)

  // Drop the override once the cache has caught up with it.
  useEffect(() => {
    if (local && local.value === value) setLocal(null)
  }, [value, local])

  const shown = local ? local.value : value
  const empty = shown === null || shown === ""

  function commit(next: Value) {
    setRejected(false)
    setLocal({ value: next })
    update.mutate(
      {
        taskId: task.id,
        projectId: task.projectId,
        patch: { customFields: { [field.id]: next } },
      },
      {
        onError: () => {
          setLocal(null)
          setRejected(true)
        },
      },
    )
  }

  return (
    <>
      <span className="flex h-8 items-center truncate text-[13px] text-muted-foreground">
        {field.name}
      </span>
      <div className="flex flex-col gap-1">
        <ValueControl field={field} value={shown} rejected={rejected} commit={commit} />
        {field.required && empty && field.type !== "boolean" && (
          <span
            role={rejected ? "alert" : undefined}
            className={
              rejected ? "text-xs text-destructive-foreground" : "text-xs text-muted-foreground"
            }
          >
            {rejected ? `${field.name} is required.` : "Required"}
          </span>
        )}
        {rejected && !empty && (
          <span role="alert" className="text-xs text-destructive-foreground">
            Could not save {field.name}.
          </span>
        )}
      </div>
    </>
  )
}

/** Text-like inputs keep a draft while focused and adopt the stored value otherwise. */
function useDraft(stored: string, rejected: boolean) {
  const [draft, setDraft] = useState(stored)
  const focused = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a failed save must reset the draft too
  useEffect(() => {
    if (!focused.current) setDraft(stored)
  }, [stored, rejected])
  return { draft, setDraft, focused }
}

function ValueControl({
  field,
  value,
  rejected,
  commit,
}: {
  field: CustomField
  value: unknown
  rejected: boolean
  commit: (value: Value) => void
}) {
  const label = field.name
  const stored = value === null || value === undefined ? "" : String(value)
  const { draft, setDraft, focused } = useDraft(stored, rejected)
  const [invalid, setInvalid] = useState(false)

  switch (field.type) {
    case "boolean":
      return (
        <div className="flex h-8 items-center">
          <Checkbox
            aria-label={label}
            checked={value === true}
            onChange={(e) => commit(e.target.checked)}
          />
        </div>
      )
    case "select":
      return (
        <Select aria-label={label} value={stored} onChange={(e) => commit(e.target.value || null)}>
          <option value="">None</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      )
    case "date": {
      const save = () => {
        if (draft !== stored && draft) commit(draft)
      }
      return (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-label={label}
            value={draft}
            onFocus={() => {
              focused.current = true
            }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            onBlur={() => {
              focused.current = false
              save()
            }}
          />
          {stored && (
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Clear ${label}`}
              onClick={() => commit(null)}
            >
              <X />
            </Button>
          )}
        </div>
      )
    }
    default: {
      const isNumber = field.type === "number"
      return (
        <>
          <Input
            aria-label={label}
            aria-invalid={invalid || undefined}
            inputMode={isNumber ? "decimal" : undefined}
            maxLength={isNumber ? 32 : 2000}
            value={draft}
            onFocus={() => {
              focused.current = true
            }}
            onChange={(e) => {
              setDraft(e.target.value)
              setInvalid(false)
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={() => {
              focused.current = false
              const next = draft.trim()
              if (next === stored) return
              if (!next) return commit(null)
              if (!isNumber) return commit(next)
              const n = Number(next)
              if (Number.isFinite(n)) commit(n)
              else setInvalid(true)
            }}
          />
          {invalid && (
            <span role="alert" className="text-xs text-destructive-foreground">
              Enter a valid number.
            </span>
          )}
        </>
      )
    }
  }
}
