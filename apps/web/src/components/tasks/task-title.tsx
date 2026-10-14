import { type IntentHue, titleIntent } from "@intesa/task-query"

// Written out in full so Tailwind finds the classes.
const HUE_CLASSES: Record<IntentHue, string> = {
  green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  red: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
  blue: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  violet: "bg-violet-500/14 text-violet-700 dark:text-violet-400",
  orange: "bg-orange-500/12 text-orange-700 dark:text-orange-400",
  pink: "bg-pink-500/12 text-pink-700 dark:text-pink-400",
  cyan: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-400",
  yellow: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  indigo: "bg-indigo-500/14 text-indigo-700 dark:text-indigo-400",
  lime: "bg-lime-500/14 text-lime-700 dark:text-lime-400",
  gray: "bg-neutral-500/12 text-neutral-600 dark:text-neutral-400",
}

/** A task title; a conventional commit style `type(scope):` prefix gets its type's colour. */
export function TaskTitle({ title }: { title: string }) {
  const intent = titleIntent(title)
  if (!intent) return title
  return (
    <>
      <span
        className={`rounded-sm px-1 py-px box-decoration-clone ${HUE_CLASSES[intent.hue]}`}
        data-intent={intent.type}
      >
        {intent.prefix}
      </span>
      {intent.rest}
    </>
  )
}
