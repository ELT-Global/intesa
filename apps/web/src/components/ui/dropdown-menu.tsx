import * as Menu from "@radix-ui/react-dropdown-menu"
import { Check } from "lucide-react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { menuContentClass, menuItemClass, menuRadioItemClass } from "./menu-styles"

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
          menuContentClass("origin-(--radix-dropdown-menu-content-transform-origin)"),
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
  return <Menu.Item className={cn(menuItemClass, className)} {...props} />
}

export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(menuRadioItemClass, className)} {...props}>
      {children}
      <Menu.ItemIndicator className="ml-auto text-foreground">
        <Check className="size-3.5" aria-hidden />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  )
}
