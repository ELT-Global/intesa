import { type DragEvent, useCallback, useEffect, useRef } from "react"

/** Set on dragstart of a card, so other drags (files, text) do not trigger board behaviour. */
export const CARD_DRAG_TYPE = "application/x-intesa-task"

const EDGE = 64
const MAX_STEP = 20
// dragover repeats while the pointer is over a target (about every 50ms in Chrome, up to
// ~350ms in Firefox); silence for longer than this means the drag is over.
const IDLE_MS = 500

/** Scroll step for a pointer `distance` px from an edge: faster the closer it gets. */
function step(distance: number, edge: number) {
  const closeness = Math.min(1, Math.max(0, (edge - distance) / edge))
  return Math.ceil(closeness * MAX_STEP)
}

/**
 * Scrolls a container while a card is dragged near its left or right edge, and the column list
 * under the pointer near its top or bottom edge. Native drag and drop does not scroll nested
 * containers by itself.
 */
export function useDragAutoScroll() {
  const canvas = useRef<HTMLDivElement>(null)
  const pointer = useRef({ x: 0, y: 0, target: null as Element | null, at: 0 })
  const frame = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const tick = useCallback(() => {
    const el = canvas.current
    const p = pointer.current
    if (!el || performance.now() - p.at > IDLE_MS) return stop()

    const rect = el.getBoundingClientRect()
    if (p.x - rect.left < EDGE) el.scrollLeft -= step(p.x - rect.left, EDGE)
    else if (rect.right - p.x < EDGE) el.scrollLeft += step(rect.right - p.x, EDGE)

    const list = p.target?.closest<HTMLElement>("[data-column-body]")
    if (list) {
      const box = list.getBoundingClientRect()
      if (p.y - box.top < EDGE) list.scrollTop -= step(p.y - box.top, EDGE)
      else if (box.bottom - p.y < EDGE) list.scrollTop += step(box.bottom - p.y, EDGE)
    }
    frame.current = requestAnimationFrame(tick)
  }, [stop])

  // A drag can end anywhere, including outside the board.
  useEffect(() => {
    document.addEventListener("dragend", stop)
    document.addEventListener("drop", stop)
    return () => {
      document.removeEventListener("dragend", stop)
      document.removeEventListener("drop", stop)
      stop()
    }
  }, [stop])

  return {
    canvas,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return
        pointer.current = {
          x: e.clientX,
          y: e.clientY,
          target: e.target instanceof Element ? e.target : null,
          at: performance.now(),
        }
        if (frame.current === null) frame.current = requestAnimationFrame(tick)
      },
    },
  }
}
