import * as D from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ComponentProps, ReactNode, RefObject } from "react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  title,
  description,
  className,
  children,
  returnFocusRef,
  ...props
}: {
  title: string
  description?: string
  children: ReactNode
  /** Element to focus on close; for dialogs opened from a menu item, whose own element is gone. */
  returnFocusRef?: RefObject<HTMLElement | null>
} & ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl ring-1 ring-black/5 outline-none",
          className,
        )}
        onCloseAutoFocus={(e) => {
          if (returnFocusRef?.current) {
            e.preventDefault()
            returnFocusRef.current.focus()
          }
          props.onCloseAutoFocus?.(e)
        }}
        {...props}
      >
        <div className="mb-4 flex items-start gap-2">
          <div className="flex-1">
            <D.Title className="text-base font-medium">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="sm" icon aria-label="Close">
              <X />
            </Button>
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  )
}
