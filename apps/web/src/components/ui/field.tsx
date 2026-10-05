import { type ComponentProps, type ReactNode, useId } from "react"
import { cn } from "@/lib/utils"
import { Input, Label } from "./input"

/** Label + input pair with an optional hint line. */
export function Field({
  label,
  hint,
  className,
  inputClassName,
  error,
  ...props
}: {
  label: string
  hint?: ReactNode
  inputClassName?: string
  error?: string | null
} & ComponentProps<typeof Input>) {
  const id = useId()
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className={inputClassName}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      <FormError id={`${id}-error`} message={error} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Inline mutation error. */
export function FormError({ message, id }: { message?: string | null; id?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive-foreground">
      {message}
    </p>
  )
}
