import { type ComponentProps, type ReactNode, useId } from "react"
import { cn } from "@/lib/utils"
import { Input, Label } from "./input"

/** Label + input pair with an optional hint line. */
export function Field({
  label,
  hint,
  className,
  inputClassName,
  ...props
}: { label: string; hint?: ReactNode; inputClassName?: string } & ComponentProps<typeof Input>) {
  const id = useId()
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={inputClassName} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Inline mutation error. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive-foreground">
      {message}
    </p>
  )
}
