import * as D from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ComponentProps, HTMLAttributes, RefObject } from "react"
import { cn } from "@/lib/utils"
import { dialogAnimation, overlayAnimation } from "./animation"
import { Button } from "./button"

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogPortal = D.Portal
export const DialogClose = D.Close

export function DialogOverlay({ className, ...props }: ComponentProps<typeof D.Overlay>) {
  return (
    <D.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]",
        overlayAnimation,
        className,
      )}
      {...props}
    />
  )
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("text-base font-medium", className)} {...props} />
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
}

type ContentProps = ComponentProps<typeof D.Content> & {
  /** Convenience: renders a header with this title (and optional description) and a close button. */
  title?: string
  description?: string
  /** Element to focus on close; for dialogs opened from a menu item, whose own element is gone. */
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function DialogContent({
  title,
  description,
  className,
  children,
  returnFocusRef,
  onCloseAutoFocus,
  ...props
}: ContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <D.Content
        className={cn(
          dialogAnimation,
          "fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-1/2 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl ring-1 ring-black/5 outline-none",
          className,
        )}
        onCloseAutoFocus={(e) => {
          if (returnFocusRef?.current) {
            e.preventDefault()
            returnFocusRef.current.focus()
          }
          onCloseAutoFocus?.(e)
        }}
        {...props}
      >
        {title ? (
          <DialogHeader className="flex-row items-start gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <DialogTitle>{title}</DialogTitle>
              {description ? (
                <DialogDescription>{description}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">{title}</DialogDescription>
              )}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="sm" icon aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </DialogHeader>
        ) : null}
        {children}
      </D.Content>
    </DialogPortal>
  )
}
