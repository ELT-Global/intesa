import { Chip } from "@/components/ui/badge"

const TAG_SLOT: Record<string, string> = {
  blue: "1",
  orange: "2",
  aqua: "3",
  violet: "4",
  magenta: "5",
}

/** Label tag: a neutral chip with a dot in the tag's colour. */
export function TagDot({ name, color }: { name: string; color: string }) {
  return (
    <Chip className="font-medium text-foreground/90">
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: `var(--chart-${TAG_SLOT[color] ?? "ink"})` }}
      />
      {name}
    </Chip>
  )
}
