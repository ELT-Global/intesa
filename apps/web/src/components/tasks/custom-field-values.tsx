import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input, Select } from "@/components/ui/input"
import { type CustomField, customFieldsQuery } from "@/lib/custom-fields"
import { type TaskDetail, useUpdateTask } from "@/lib/tasks"

/** Two-column property list of the project's custom fields for one task. Renders nothing without fields. */
export function CustomFieldValues({ task }: { task: TaskDetail }) {
  const fields = useQuery(customFieldsQuery(task.projectId)).data ?? []
  const update = useUpdateTask()
  if (fields.length === 0) return null

  const values = task.customFields as Record<string, unknown>

  function save(field: CustomField, value: string | number | boolean | null, onError: () => void) {
    const next = { ...values }
    if (value === null) delete next[field.id]
    else next[field.id] = value
    update.mutate(
      {
        taskId: task.id,
        projectId: task.projectId,
        patch: { customFields: { [field.id]: value } },
        view: { customFields: next },
      },
      { onError },
    )
  }

  return (
    <section aria-label="Fields" className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">Fields</h3>
      <div className="grid grid-cols-[minmax(0,10rem)_1fr] items-start gap-x-4 gap-y-2">
        {fields.map((f) => (
          <FieldValueRow key={f.id} field={f} value={values[f.id] ?? null} save={save} />
        ))}
      </div>
    </section>
  )
}

type Value = string | number | boolean | null

function FieldValueRow({
  field,
  value,
  save,
}: {
  field: CustomField
  value: unknown
  save: (field: CustomField, value: Value, onError: () => void) => void
}) {
  const [rejected, setRejected] = useState(false)
  const empty = value === null || value === ""
  const commit = (v: Value) => {
    setRejected(false)
    save(field, v, () => setRejected(true))
  }

  return (
    <>
      <span className="flex h-8 items-center truncate text-[13px] text-muted-foreground">
        {field.name}
      </span>
      <div className="flex flex-col gap-1">
        {/* Remounting on a server-side change drops stale drafts. */}
        <ValueControl
          key={`${String(value)}:${rejected}`}
          field={field}
          value={value}
          commit={commit}
        />
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

function ValueControl({
  field,
  value,
  commit,
}: {
  field: CustomField
  value: unknown
  commit: (value: Value) => void
}) {
  const label = field.name
  const stored = value === null ? "" : String(value)
  const [draft, setDraft] = useState(stored)
  const [invalid, setInvalid] = useState(false)
  // Shown at once; the cache update lags a tick behind the click. A rollback remounts this control.
  const [checked, setChecked] = useState(value === true)

  switch (field.type) {
    case "boolean":
      return (
        <div className="flex h-8 items-center">
          <Checkbox
            aria-label={label}
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked)
              commit(e.target.checked)
            }}
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
    case "date":
      return (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            aria-label={label}
            value={stored}
            onChange={(e) => e.target.value && commit(e.target.value)}
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
            onChange={(e) => {
              setDraft(e.target.value)
              setInvalid(false)
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={() => {
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
