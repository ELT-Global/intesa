import { Kbd } from "@/components/ui/badge"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useIsMac } from "@/lib/shortcuts"

type Shortcut = { label: string; keys: string[] }

const GENERAL: Shortcut[] = [
  { label: "Show keyboard shortcuts", keys: ["Mod", "/"] },
  { label: "Toggle sidebar", keys: ["["] },
  { label: "New task", keys: ["N"] },
  { label: "New task (alternative)", keys: ["C"] },
  { label: "Board view", keys: ["B"] },
  { label: "Table view", keys: ["T"] },
]

const BOARD: Shortcut[] = [
  { label: "Search tasks", keys: ["F"] },
  { label: "Switch assignee view", keys: ["Shift", "←/→"] },
  { label: "Move the focused card between columns", keys: ["Alt", "←/→"] },
  { label: "Reorder the focused card in its column", keys: ["Alt", "↑/↓"] },
]

const MAC_LABELS: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥" }
const PC_LABELS: Record<string, string> = { Mod: "Ctrl" }

/** How a key is written on this platform: ⌘ ⇧ ⌥ on a Mac, Ctrl Shift Alt elsewhere. */
export function keyLabel(key: string, mac: boolean): string {
  return (mac ? MAC_LABELS : PC_LABELS)[key] ?? key
}

/** The shortcut that opens this dialog, as text for tooltips and menus. */
export function helpShortcutLabel(mac: boolean): string {
  return mac ? "⌘/" : "Ctrl+/"
}

function Section({
  title,
  shortcuts,
  mac,
}: {
  title: string
  shortcuts: Shortcut[]
  mac: boolean
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul>
        {shortcuts.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 py-1.5 text-[13px]">
            <span>{s.label}</span>
            <span className="flex shrink-0 gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{keyLabel(k, mac)}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Lists the project page's keyboard shortcuts; the board ones only when the board is shown. */
export function ShortcutHelpDialog({
  open,
  onOpenChange,
  showBoard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  showBoard: boolean
}) {
  const mac = useIsMac()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" className="flex flex-col gap-4">
        <Section title="General" shortcuts={GENERAL} mac={mac} />
        {showBoard && <Section title="Board" shortcuts={BOARD} mac={mac} />}
      </DialogContent>
    </Dialog>
  )
}
