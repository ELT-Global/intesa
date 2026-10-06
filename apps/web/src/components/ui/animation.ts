// Enter/exit animation utilities from tw-animate-css, driven by Radix `data-state`/`data-side`
// (Radix Presence keeps the node mounted until the exit animation ends). Zoom and slide only
// apply under `motion-safe`; reduced-motion users get the opacity fade alone.

const state =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"

export const overlayAnimation = `${state} duration-150`

export const dialogAnimation = `${state} motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95 duration-200`

export const sheetAnimation = {
  right: `${state} motion-safe:data-[state=open]:slide-in-from-right motion-safe:data-[state=closed]:slide-out-to-right duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]`,
  left: `${state} motion-safe:data-[state=open]:slide-in-from-left motion-safe:data-[state=closed]:slide-out-to-left duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]`,
} as const

export const menuAnimation = `${state} motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[side=bottom]:slide-in-from-top-2 motion-safe:data-[side=left]:slide-in-from-right-2 motion-safe:data-[side=right]:slide-in-from-left-2 motion-safe:data-[side=top]:slide-in-from-bottom-2 duration-150`
