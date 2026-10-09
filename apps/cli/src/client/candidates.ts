import type { Complete } from "../registry/define"
import { resolver } from "./resolve"

// Where shell completion gets values from, for arguments and flags alike. Each matches the
// word typed so far; lookups use the -w and -p on the line (see registry/completion).

// Completion candidates from names: single words only, since the shell would split the
// others, matching what was typed in any case.
export const wordsStarting = (names: string[], word: string) =>
  names.filter((n) => !/\s/.test(n) && n.toLowerCase().startsWith(word.toLowerCase()))

export const workspaceSlugs: Complete = async (ctx, { word }) =>
  wordsStarting(
    (await resolver(ctx).workspaces()).map((w) => w.slug),
    word,
  )

export const projectKeys: Complete = async (ctx, { word }) =>
  wordsStarting(
    (await resolver(ctx).projects()).map((p) => p.key),
    word,
  )

export const tagNames: Complete = async (ctx, { word }) =>
  wordsStarting(
    (await resolver(ctx).tags()).map((t) => t.name),
    word,
  )

// `@me`, then people by email or name, as `-a` takes them.
export const people: Complete = async (ctx, { word }) =>
  wordsStarting(["@me", ...(await resolver(ctx).members()).flatMap((m) => [m.email, m.name])], word)

const fieldNames = async (ctx: Parameters<Complete>[0]) => {
  const r = resolver(ctx)
  return (await r.fields((await r.project()).id)).map((f) => f.name)
}

export const customFieldNames: Complete = async (ctx, { word }) =>
  wordsStarting(await fieldNames(ctx), word)

// For `--field NAME=VALUE`: the name and its `=`, so only the value is left to type.
export const customFieldAssignments: Complete = async (ctx, { word }) =>
  wordsStarting(
    (await fieldNames(ctx)).map((n) => `${n}=`),
    word,
  )

// Task keys of the current project (or the -p typed on the command line).
export const taskKeys: Complete = async (ctx, { word }) => {
  const project = await resolver(ctx).project()
  const { client } = await ctx.http()
  const res = await client.api.projects[":projectId"].tasks.$get({
    param: { projectId: project.id },
  })
  return (await res.json()).tasks
    .sort((a, b) => a.number - b.number)
    .map((t) => t.key)
    .filter((k) => k.startsWith(word.toUpperCase()))
}
