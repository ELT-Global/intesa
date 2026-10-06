import * as S from "@radix-ui/react-dialog"
import type { ComponentProps, HTMLAttributes } from "react"
import { cn } from "@/lib/utils"
import { overlayAnimation, sheetAnimation } from "./animation"

export const Sheet = S.Root
export const SheetTrigger = S.Trigger
export const SheetClose = S.Close
export const SheetPortal = S.Portal

export function SheetOverlay({ className, ...props }: ComponentProps<typeof S.Overlay>) {
  return (
    <S.Overlay
      className={cn(
        "fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]",
        overlayAnimation,
        className,
      )}
      {...props}
    />
  )
}

const sides = {
  right: "inset-y-0 right-0",
  left: "inset-y-0 left-0",
} as const

/** Edge-anchored panel. Slides in and out through the shared overlay animations. */
export function SheetContent({
  side = "right",
  className,
  overlayClassName,
  children,
  ...props
}: ComponentProps<typeof S.Content> & { side?: keyof typeof sides; overlayClassName?: string }) {
  return (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <S.Content
        className={cn(
          "fixed z-50 flex flex-col outline-none",
          sheetAnimation[side],
          sides[side],
          className,
        )}
        {...props}
      >
        {children}
      </S.Content>
    </SheetPortal>
  )
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof S.Title>) {
  return <S.Title className={cn("text-base font-medium", className)} {...props} />
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof S.Description>) {
  return <S.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
}
