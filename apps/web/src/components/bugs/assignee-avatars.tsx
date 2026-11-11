import { Avatar } from "@/components/ui/avatar"

type Person = { id: string; name: string }

/** Everyone assigned to any of the tasks, once each, in the order first met. */
export function assigneesOf(tasks: { assignees: Person[] }[]): Person[] {
  const seen = new Map<string, Person>()
  for (const task of tasks) for (const a of task.assignees) if (!seen.has(a.id)) seen.set(a.id, a)
  return [...seen.values()]
}

/** Overlapping avatars, the first few of them, with a count of the rest. */
export function AssigneeAvatars({
  people,
  label,
  max = 3,
}: {
  people: Person[]
  label: string
  max?: number
}) {
  if (people.length === 0) return null
  const rest = people.length - max
  return (
    <ul
      aria-label={label}
      title={people.map((p) => p.name).join(", ")}
      className="flex shrink-0 items-center -space-x-1"
    >
      {people.slice(0, max).map((p) => (
        <li key={p.id} className="flex">
          <Avatar name={p.name} labelled className="border-background" />
        </li>
      ))}
      {rest > 0 && (
        <li className="pl-1.5 text-[11px] text-muted-foreground">
          +{rest}
          <span className="sr-only"> more</span>
        </li>
      )}
    </ul>
  )
}
