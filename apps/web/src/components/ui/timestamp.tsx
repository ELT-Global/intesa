import { dateTime, timestampDay } from "@/lib/time"

/** A timestamp shown as its day, like due dates, with the full date and time on hover. */
export function Timestamp({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={dateTime(iso)} className={className}>
      {timestampDay(iso)}
    </time>
  )
}
