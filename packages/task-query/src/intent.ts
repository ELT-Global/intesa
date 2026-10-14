/** The colours an intent can take; each client maps them to its own palette. */
export const INTENT_HUES = [
  "green",
  "red",
  "blue",
  "violet",
  "orange",
  "pink",
  "cyan",
  "yellow",
  "indigo",
  "lime",
  "gray",
] as const
export type IntentHue = (typeof INTENT_HUES)[number]

// The usual conventional commit types each get a colour of their own.
const KNOWN: Record<string, IntentHue> = {
  feat: "green",
  fix: "red",
  docs: "blue",
  refactor: "violet",
  perf: "orange",
  style: "pink",
  test: "cyan",
  build: "yellow",
  ci: "indigo",
  revert: "lime",
  chore: "gray",
}

/** The `type(scope)!:` that opens a title written like a conventional commit. */
export type TitleIntent = {
  type: string
  scope: string | null
  /** The prefix as written, up to and including the colon. */
  prefix: string
  /** What follows the prefix, leading space included. */
  rest: string
  hue: IntentHue
}

// Lower case only, and a space after the colon, so "Note: …" and "http://…" stay plain titles.
const PREFIX = /^([a-z]+)(?:\(([^()\n]*)\))?!?:(?=\s|$)/

export function titleIntent(title: string): TitleIntent | null {
  const m = PREFIX.exec(title)
  if (!m) return null
  const [prefix, type = "", scope] = m
  return {
    type,
    scope: scope ?? null,
    prefix,
    rest: title.slice(prefix.length),
    hue: intentHue(type),
  }
}

/** Every instance of a type shares a colour; types outside the usual set get a stable one. */
export function intentHue(type: string): IntentHue {
  const known = KNOWN[type]
  if (known) return known
  let hash = 0
  for (const ch of type) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return INTENT_HUES[hash % INTENT_HUES.length] ?? "gray"
}
