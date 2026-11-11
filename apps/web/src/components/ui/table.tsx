import type { Sort } from "@intesa/task-query"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

// The look shared by the task and bug tables: compact rows, a sticky first column and
// headers that sort on click.

export const tableCell =
  "h-10 pointer-coarse:h-11 border-b border-border/70 px-4 align-middle group-last/row:border-b-0"

/** The first column: sticky while the table scrolls sideways, and given the spare width. */
export const tableFirstCell =
  "sticky left-0 z-10 w-full max-w-0 bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]"

export const tableRow = "group/row cursor-pointer transition-colors hover:bg-muted/40"

/** A column header; with a `sortKey` it is a button that sorts by it, and flips on a second click. */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  first,
}: {
  label: string
  sortKey?: K
  sort: Sort<K> | null
  onSort: (key: K) => void
  first?: boolean
}) {
  const th = cn(
    "h-9 whitespace-nowrap border-b border-border px-4 text-left text-[12px] font-medium text-muted-foreground",
    first && "sticky left-0 z-10 bg-card",
  )
  if (sortKey === undefined) {
    return (
      <th scope="col" className={th}>
        {label}
      </th>
    )
  }
  const active = sort?.key === sortKey
  const Chevron = active && sort.dir === "desc" ? ChevronDown : ChevronUp
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={th}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "touch-target group/sort -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
      >
        {label}
        <Chevron
          aria-hidden
          className={cn(
            "size-3",
            !active &&
              "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </button>
    </th>
  )
}

/** An empty cell's placeholder. */
export function Dash() {
  return <span className="text-muted-foreground">—</span>
}
