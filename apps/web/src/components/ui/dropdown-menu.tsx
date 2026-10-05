import * as Menu from "@radix-ui/react-dropdown-menu"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuSeparator = ({
  className,
  ...p
}: ComponentProps<typeof Menu.Separator>) => (
  <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />
)

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          "z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label className={cn("px-2 py-1 text-xs text-muted-foreground", className)} {...props} />
  )
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground outline-none transition-colors data-[highlighted]:bg-accent data-[disabled]:opacity-64 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}
