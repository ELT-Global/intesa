import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react"
import { cn } from "@/lib/utils"

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs/5 outline-none transition-shadow placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48",
        "aria-invalid:border-destructive/36 aria-invalid:ring-2 aria-invalid:ring-destructive/16 dark:aria-invalid:ring-destructive/24",
        "disabled:pointer-events-none disabled:opacity-64",
        className,
      )}
      {...props}
    />
  )
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: association is supplied by callers via htmlFor
  return <label className={cn("text-xs font-medium text-foreground", className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full resize-y rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs/5 outline-none placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48",
        className,
      )}
      {...props}
    />
  )
}

/** Native select styled like Input; keeps platform behaviour on touch devices. */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm shadow-xs/5 outline-none",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48",
        className,
      )}
      {...props}
    />
  )
}
