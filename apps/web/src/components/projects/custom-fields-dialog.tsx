import { useQuery } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { type RefObject, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { FormError } from "@/components/ui/field"
import { Input, Select, Textarea } from "@/components/ui/input"
import {
  type CustomField,
  customFieldsQuery,
  FIELD_TYPE_LABELS,
  type FieldType,
  useFieldMutations,
} from "@/lib/custom-fields"

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FieldType[]

const parseOptions = (text: string) => [
  ...new Set(
    text
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean),
  ),
]

export function CustomFieldsDialog({
  projectId,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        returnFocusRef={returnFocusRef}
        title="Custom fields"
        description="Fields appear on every task in this project."
        className="max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <FieldsBody projectId={projectId} />
      </DialogContent>
    </Dialog>
  )
}

function FieldsBody({ projectId }: { projectId: string }) {
  const fields = useQuery(customFieldsQuery(projectId)).data ?? []
  const m = useFieldMutations(projectId)
  const error = m.create.error ?? m.update.error ?? m.remove.error

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">No custom fields yet.</p>
      )}
      <ul aria-label="Fields" className="flex flex-col divide-y divide-border">
        {fields.map((f) => (
          <FieldRow
            key={`${f.id}:${f.name}:${f.options.join("\n")}`}
            field={f}
            onChange={(json) => m.update.mutate({ fieldId: f.id, json })}
            onDelete={() => m.remove.mutate(f.id)}
          />
        ))}
      </ul>
      <FormError message={error?.message} />
      <NewFieldForm
        pending={m.create.isPending}
        onCreate={(json, done) => m.create.mutate(json, { onSuccess: done })}
      />
    </div>
  )
}

function FieldRow({
  field,
  onChange,
  onDelete,
}: {
  field: CustomField
  onChange: (patch: { name?: string; required?: boolean; options?: string[] }) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(field.name)
  const [options, setOptions] = useState(field.options.join("\n"))
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Name of ${field.name}`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const next = name.trim()
            if (!next) setName(field.name)
            else if (next !== field.name) onChange({ name: next })
          }}
        />
        <span className="w-16 shrink-0 text-xs text-muted-foreground">
          {FIELD_TYPE_LABELS[field.type]}
        </span>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped Checkbox renders the input */}
        <label className="flex shrink-0 items-center gap-1.5 text-xs">
          <Checkbox
            aria-label={`Required: ${field.name}`}
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
        <Button
          variant="ghost"
          size="sm"
          icon
          aria-label={`Delete field ${field.name}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </Button>
      </div>
      {field.type === "select" && (
        <Textarea
          aria-label={`Options of ${field.name}`}
          placeholder="One option per line"
          className="min-h-16"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
          onBlur={() => {
            const next = parseOptions(options)
            if (next.length === 0) setOptions(field.options.join("\n"))
            else if (next.join("\n") !== field.options.join("\n")) onChange({ options: next })
          }}
        />
      )}
      {confirming && (
        <div className="flex items-center gap-2 text-sm">
          <span className="flex-1">Delete {field.name} and its values on every task?</span>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Confirm delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
    </li>
  )
}

function NewFieldForm({
  pending,
  onCreate,
}: {
  pending: boolean
  onCreate: (
    input: { name: string; type: FieldType; required: boolean; options?: string[] },
    done: () => void,
  ) => void
}) {
  const [name, setName] = useState("")
  const [type, setType] = useState<FieldType>("text")
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState("")
  const parsed = parseOptions(options)
  const valid = name.trim() !== "" && (type !== "select" || parsed.length > 0)

  return (
    <form
      aria-label="New field"
      className="flex flex-col gap-2 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onCreate(
          { name: name.trim(), type, required, ...(type === "select" ? { options: parsed } : {}) },
          () => {
            setName("")
            setOptions("")
            setRequired(false)
            setType("text")
          },
        )
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          aria-label="Field name"
          placeholder="New field name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          aria-label="Field type"
          className="w-28 shrink-0"
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped Checkbox renders the input */}
        <label className="flex shrink-0 items-center gap-1.5 text-xs">
          <Checkbox
            aria-label="Required field"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
      </div>
      {type === "select" && (
        <Textarea
          aria-label="Field options"
          placeholder="One option per line"
          className="min-h-16"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
        />
      )}
      <Button
        type="submit"
        variant="primary"
        size="sm"
        className="self-end"
        disabled={!valid}
        pending={pending}
      >
        Add field
      </Button>
    </form>
  )
}
