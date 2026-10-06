import { cn } from "@/lib/utils"
import { menuAnimation } from "./animation"

// Shared by DropdownMenu and ContextMenu so both look and move identically.
export const menuContentClass = (originClass: string) =>
  cn(
    menuAnimation,
    originClass,
    "z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
  )

export const menuItemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[disabled]:opacity-64 [&_svg]:size-4 [&_svg]:text-muted-foreground"

export const menuRadioItemClass =
  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[state=checked]:font-medium [&_svg]:size-4"

export const menuDestructiveClass =
  "text-destructive-foreground [&_svg]:text-destructive-foreground"
