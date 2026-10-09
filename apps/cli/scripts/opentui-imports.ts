// The names the sources import from @opentui/core, read from their text so that building does
// not need to load the native library (which a build on another libc could not). Only
// `import { a, b as c } from "@opentui/core"` is understood; any other mention of the package
// fails the build, since the stand-in module would silently lack what it brings in.

const NAMED = /import\s*(type\s*)?\{([^}]*)\}\s*from\s*["']@opentui\/core["']/g
const ANY = /["']@opentui\/core["']/g

export function openTuiImports(files: { path: string; text: string }[]): string[] {
  const names = new Set<string>()
  const unsupported: string[] = []
  for (const { path, text } of files) {
    const named = [...text.matchAll(NAMED)]
    if (named.length !== [...text.matchAll(ANY)].length) unsupported.push(path)
    for (const [, typeOnly, list] of named) {
      if (typeOnly) continue
      for (const part of (list as string).split(",")) {
        const spec = part.trim()
        if (spec && !spec.startsWith("type ")) names.add(spec.split(/\s+as\s+/)[0] as string)
      }
    }
  }
  if (unsupported.length > 0) {
    throw new Error(
      `${unsupported.join(", ")}: import @opentui/core only as \`import { … } from "@opentui/core"\`, which the bundle knows how to stand in for`,
    )
  }
  return [...names]
}
