import { Check } from "lucide-react"
import type { InputHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

/** 16px checkbox (native input underneath, so keyboard and form behaviour are free). */
export function Checkbox({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className={cn("relative inline-flex size-4 shrink-0", className)}>
      <input
        type="checkbox"
        className={cn(
          "peer size-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-background outline-none transition-colors",
          "checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring/24 dark:focus-visible:ring-ring/48",
          "disabled:cursor-default disabled:opacity-64",
        )}
        {...props}
      />
      <Check
        aria-hidden
        strokeWidth={3}
        className="pointer-events-none absolute inset-0.5 hidden size-3 text-primary-foreground peer-checked:block"
      />
    </span>
  )
}
