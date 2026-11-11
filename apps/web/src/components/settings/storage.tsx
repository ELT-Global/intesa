import { useQuery } from "@tanstack/react-query"
import { HardDrive } from "lucide-react"
import type { ReactNode } from "react"
import { ErrorState } from "@/components/page"
import { RowsSkeleton } from "@/components/skeleton"
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel"
import { storageQuery } from "@/lib/queries"

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

export function formatBytes(bytes: number) {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}

/** How much room the instance's database takes, and what is left on its disk. */
export function StoragePanel() {
  const result = useQuery(storageQuery)
  const storage = result.data
  return (
    <Panel>
      <PanelHeader icon={<HardDrive />} title="Storage" note="Shared by every workspace" />
      {result.isError && <ErrorState error={result.error} onRetry={() => void result.refetch()} />}
      {result.isPending && (
        <div className="p-4">
          <RowsSkeleton rows={2} />
        </div>
      )}
      {storage && (
        <PanelBody className="flex flex-col gap-4 text-[13px]">
          <dl className="flex flex-col gap-2">
            <Row
              label={
                storage.database.dialect === "sqlite" ? "SQLite database" : "PostgreSQL database"
              }
            >
              {formatBytes(storage.database.bytes)}
            </Row>
            <Row label="Screenshots and artifacts">
              {formatBytes(storage.database.files.bytes)} in {storage.database.files.count}{" "}
              {storage.database.files.count === 1 ? "file" : "files"}
            </Row>
            {storage.disk && (
              <Row label="Available disk space">
                {formatBytes(storage.disk.freeBytes)} of {formatBytes(storage.disk.totalBytes)}
              </Row>
            )}
          </dl>
          {storage.disk ? (
            <DiskMeter
              total={storage.disk.totalBytes}
              free={storage.disk.freeBytes}
              database={storage.database.bytes}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {storage.database.dialect === "postgres"
                ? "Disk space belongs to the PostgreSQL server, so it is not shown here."
                : "The database is in memory, so it takes no disk space."}
            </p>
          )}
        </PanelBody>
      )}
    </Panel>
  )
}

function DiskMeter({ total, free, database }: { total: number; free: number; database: number }) {
  const used = total - free
  const percent = (bytes: number) => `${Math.min(100, (bytes / total) * 100)}%`
  return (
    <div className="flex flex-col gap-1.5">
      {/* Visual only: the rows above give the same numbers as text. */}
      <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
        {/* At least a sliver for the database, so it shows even on a large disk. */}
        <div className="h-full min-w-0.5 bg-primary" style={{ width: percent(database) }} />
        <div
          className="h-full bg-muted-foreground/40"
          style={{ width: percent(Math.max(0, used - database)) }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          Intesa database
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-muted-foreground/40" />
          Everything else
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full border border-border bg-muted" />
          Free
        </span>
      </div>
    </div>
  )
}
