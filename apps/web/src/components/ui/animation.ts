import { cn } from "@/lib/utils"

// Enter/exit animation utilities from tw-animate-css, driven by Radix `data-state`/`data-side`
// (Radix Presence keeps the node mounted until the exit animation ends). Zoom and slide only
// apply under `motion-safe`; reduced-motion users get the opacity fade alone, kept short.
// Class names must stay literal so Tailwind can see them.

const state =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"

export const overlayAnimation = cn(state, "duration-150")

export const dialogAnimation = cn(
  state,
  "motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95",
  "duration-200 motion-reduce:duration-150",
)

/** Per side: where the panel sits and the slide it plays. */
export const sheetSides = {
  right: {
    position: "inset-y-0 right-0",
    motion:
      "motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=closed]:slide-out-to-right",
  },
  left: {
    position: "inset-y-0 left-0",
    motion:
      "motion-safe:data-[state=open]:slide-in-from-left motion-safe:data-[state=closed]:slide-out-to-left",
  },
} as const

export const sheetAnimation = (side: keyof typeof sheetSides) =>
  cn(state, sheetSides[side].motion, "duration-200 ease-drawer motion-reduce:duration-150")

export const menuAnimation = cn(
  state,
  "motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95",
  "motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2",
  "motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2",
  "duration-150",
)
