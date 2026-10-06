import * as Menu from "@radix-ui/react-context-menu"
import { Check, ChevronRight } from "lucide-react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { menuContentClass, menuItemClass, menuRadioItemClass } from "./menu-styles"

export const ContextMenu = Menu.Root
export const ContextMenuTrigger = Menu.Trigger
export const ContextMenuRadioGroup = Menu.RadioGroup
export const ContextMenuSub = Menu.Sub

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        collisionPadding={8}
        className={cn(
          menuContentClass("origin-(--radix-context-menu-content-transform-origin)"),
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return (
    <Menu.Label className={cn("px-2 py-1 text-xs text-muted-foreground", className)} {...props} />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

export function ContextMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        menuItemClass,
        destructive && "text-destructive-foreground [&_svg]:text-destructive-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuRadioItem({
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

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger
      className={cn(menuItemClass, "data-[state=open]:bg-accent", className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </Menu.SubTrigger>
  )
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          menuContentClass("origin-(--radix-context-menu-content-transform-origin)"),
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  )
}
