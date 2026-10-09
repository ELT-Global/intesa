import { statSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { artifactFileError } from "@intesa/api/artifacts"
import { z } from "zod"
import type { Http } from "../client/http"
import { notFound, resolver } from "../client/resolve"
import { openBrowser } from "../io/browser"
import { editText } from "../io/editor"
import { isInteractive } from "../output/ask"
import { CliError, formatError, usageError } from "../output/errors"
import { selectFields } from "../output/json"
import { FIELD_SETS, render } from "../output/render"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"

type Artifact = {
  id: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  updatedAt: string
}

const MARKDOWN = "text/markdown"

// The artifact's own address, as the web app links to it.
const rawUrl = (host: string, taskId: string, id?: string) =>
  `${host}/api/tasks/${encodeURIComponent(taskId)}/artifacts${id ? `/${encodeURIComponent(id)}` : ""}`

const withUrl = (http: Http, taskId: string, artifact: Artifact) => ({
  ...artifact,
  url: rawUrl(http.host, taskId, artifact.id),
})

// Local checks mirror the server's rules, so they fail with the server's exit code (8).
const invalid = (message: string) =>
  new CliError(message, { code: "VALIDATION_ERROR", exitCode: 8 })

type LocalFile = { path: string; name: string }

// Everything the server would reject without reading the content: a missing file is a usage
// error, an unsupported or oversized one a validation error.
function checkFile(path: string): LocalFile {
  const name = basename(path)
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch {
    throw usageError(`${path}: no such file`)
  }
  if (!stat.isFile()) throw usageError(`${path}: not a file`)
  const problem = artifactFileError({ name, type: "", size: stat.size })
  if (problem) throw invalid(`${name}: ${problem}`)
  return { path, name }
}

const prefixed = (name: string, err: CliError) =>
  new CliError(`${name}: ${err.message}`, {
    code: err.code,
    exitCode: err.exitCode,
    hint: err.hint,
  })

// The multipart upload the web sends. No content type is set on the file: the server derives
// it from the extension and checks the bytes.
async function send(
  http: Http,
  method: "POST" | "PUT",
  url: string,
  name: string,
  content: string | Uint8Array,
) {
  const body = new FormData()
  body.set("file", new File([content], name))
  const res = await http.request(url, { method, body })
  return ((await res.json()) as { artifact: Artifact }).artifact
}

const listArtifacts = async (http: Http, taskId: string) =>
  (await (await http.client.api.tasks[":taskId"].artifacts.$get({ param: { taskId } })).json())
    .artifacts as Artifact[]

// Exact id, then exact name, then case-insensitive name. The first step that finds anything
// decides; several matches in it are never guessed between.
function pick(artifacts: Artifact[], ref: string): Artifact {
  const wanted = ref.toLowerCase()
  const steps = [
    artifacts.filter((a) => a.id === ref),
    artifacts.filter((a) => a.name === ref),
    artifacts.filter((a) => a.name.toLowerCase() === wanted),
  ]
  for (const matches of steps) {
    const [first] = matches
    if (matches.length === 1 && first) return first
    if (matches.length > 1) {
      throw usageError(
        `"${ref}" matches several artifacts: ${matches.map((a) => `${a.name} (${a.id})`).join(", ")}`,
        "Pass the artifact id instead.",
      )
    }
  }
  throw notFound(
    `no artifact matches "${ref}"`,
    artifacts.length
      ? `This task's artifacts: ${artifacts.map((a) => a.name).join(", ")}.`
      : "This task has no artifacts.",
  )
}

async function find(ctx: Ctx, taskRef: string, ref: string) {
  const task = await resolver(ctx).task(taskRef)
  const http = await ctx.http()
  const artifact = pick(await listArtifacts(http, task.id), ref)
  return { http, task, artifact, url: rawUrl(http.host, task.id, artifact.id) }
}

const requireMarkdown = (artifact: Artifact, verb: string) => {
  if (artifact.mimeType !== MARKDOWN) {
    throw invalid(`${artifact.name}: only Markdown artifacts can be ${verb}.`)
  }
}

const taskArg = {
  name: "task",
  required: true,
  description: "Task key (WEB-12), id or link",
} as const
const artifactArg = {
  name: "artifact",
  required: true,
  description: "Artifact name or id",
} as const

const list = defineCommand({
  name: "list",
  aliases: ["ls"],
  summary: "List a task's artifacts",
  args: [taskArg],
  context: ["workspace", "project"],
  output: "artifact",
  examples: ["intesa artifact list WEB-12", "intesa a list WEB-12 --json --fields id,name,size"],
  async run(ctx, { task: taskRef }) {
    const task = await resolver(ctx).task(taskRef)
    const http = await ctx.http()
    return (await listArtifacts(http, task.id)).map((a) => withUrl(http, task.id, a))
  },
})

// An upload that failed part-way still prints what did go up, then reports the failure.
function printUploaded(ctx: Ctx, uploaded: unknown[]) {
  if (uploaded.length === 0) return
  ctx.stdout(
    render(uploaded, {
      output: "artifact",
      fields: selectFields(ctx.globals.fields, FIELD_SETS.artifact.fields),
      json: ctx.globals.json,
      quiet: ctx.globals.quiet,
      mode: ctx.mode,
    }),
  )
}

const upload = defineCommand({
  name: "upload",
  summary: "Upload files to a task",
  description:
    "Upload files to a task, one after the other. Each file can be up to 5 MB; HTML, PDF,\n" +
    "Markdown, Word and OpenDocument files are accepted.\n\n" +
    "Every file is checked before anything is sent, and the whole upload is refused (exit 8)\n" +
    "if one is not acceptable. A file the server rejects stops the upload with its exit code;\n" +
    "the files before it stay uploaded and are printed. With --continue-on-error a failure is\n" +
    "reported on stderr and the rest still go up; the exit code is then the first failure's.",
  args: [taskArg, { name: "file", required: true, variadic: true, description: "Files to upload" }],
  flags: z.object({
    continueOnError: z
      .boolean()
      .default(false)
      .meta({ description: "Upload the other files when one fails" }),
  }),
  context: ["workspace", "project"],
  output: "artifact",
  examples: [
    "intesa artifact upload WEB-12 spec.pdf notes.md",
    "intesa artifact upload WEB-12 *.md --continue-on-error",
  ],
  async run(ctx, { task: taskRef, file: paths }, flags) {
    const failures: CliError[] = []
    const files: LocalFile[] = []
    for (const path of paths) {
      try {
        files.push(checkFile(path))
      } catch (err) {
        if (!(err instanceof CliError) || !flags.continueOnError) throw err
        failures.push(err)
      }
    }

    const uploaded: ReturnType<typeof withUrl>[] = []
    if (files.length > 0) {
      const task = await resolver(ctx).task(taskRef)
      const http = await ctx.http()
      for (const file of files) {
        try {
          const content = await Bun.file(file.path).bytes()
          const artifact = await send(http, "POST", rawUrl(http.host, task.id), file.name, content)
          uploaded.push(withUrl(http, task.id, artifact))
        } catch (err) {
          // Anything but a CliError (e.g. --dry-run finishing) is not an upload failure.
          if (!(err instanceof CliError)) throw err
          failures.push(prefixed(file.name, err))
          if (!flags.continueOnError) break
        }
      }
    }

    const [first] = failures
    if (!first) return uploaded
    printUploaded(ctx, uploaded)
    if (!flags.continueOnError) throw first
    for (const failure of failures) ctx.stderr(formatError(failure, ctx.globals.json))
    throw new CliError(`${failures.length} of ${paths.length} files were not uploaded`, {
      code: first.code,
      exitCode: first.exitCode,
    })
  },
})

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const download = defineCommand({
  name: "download",
  summary: "Download an artifact",
  description:
    "Save an artifact to ./<name>, to --output PATH (a directory receives it under its own\n" +
    "name), or with `-o -` write the raw bytes to stdout. An existing file is never replaced\n" +
    "unless --force is given. The artifact is found by id, exact name or case-insensitive\n" +
    "name; a name shared by several artifacts exits 2 and lists them.",
  args: [taskArg, artifactArg],
  flags: z.object({
    output: z.string().optional().meta({
      short: "o",
      placeholder: "path",
      description: "Where to save it (- for stdout); default ./<name>",
    }),
    force: z.boolean().default(false).meta({ description: "Replace an existing file" }),
  }),
  context: ["workspace", "project"],
  output: "artifactDownload",
  examples: [
    "intesa artifact download WEB-12 spec.pdf",
    "intesa artifact download WEB-12 notes.md -o -",
    "intesa artifact download WEB-12 spec.pdf -o ~/Downloads --force",
  ],
  async run(ctx, { task: taskRef, artifact: ref }, flags) {
    const { http, task, artifact, url } = await find(ctx, taskRef, ref)
    if (flags.output === "-") {
      await Bun.write(Bun.stdout, await http.request(url))
      return
    }
    // Names come from the server; never let one choose a directory.
    let path = resolve(ctx.cwd, flags.output ?? basename(artifact.name))
    if (isDirectory(path)) path = join(path, basename(artifact.name))
    if (!flags.force && (await Bun.file(path).exists())) {
      throw new CliError(`${path} already exists`, {
        code: "CONFLICT",
        exitCode: 6,
        hint: "Pass --force to replace it, or -o to choose another path.",
      })
    }
    await Bun.write(path, await http.request(url))
    if (ctx.globals.json) return { ...withUrl(http, task.id, artifact), path }
    if (!ctx.globals.quiet)
      ctx.stderr(`Saved ${artifact.name} (${artifact.size} bytes) to ${path}\n`)
  },
})

const view = defineCommand({
  name: "view",
  summary: "Show a Markdown artifact or open any other in the browser",
  description:
    "Print a Markdown artifact's text. Any other format is opened in the browser, which needs\n" +
    "you to be signed in to the web app; when output is not a terminal, or with --no-browser,\n" +
    "its link is printed instead.",
  args: [taskArg, artifactArg],
  flags: z.object({
    browser: z.boolean().default(true).meta({ description: "Do not open the browser" }),
  }),
  context: ["workspace", "project"],
  output: "artifactView",
  examples: [
    "intesa artifact view WEB-12 notes.md",
    "intesa artifact view WEB-12 spec.pdf",
    "intesa artifact view WEB-12 spec.pdf --no-browser",
  ],
  async run(ctx, { task: taskRef, artifact: ref }, flags) {
    const { http, task, artifact, url } = await find(ctx, taskRef, ref)
    const result = withUrl(http, task.id, artifact)
    const { json, quiet, fields } = ctx.globals
    const structured = json || quiet || fields !== undefined
    if (artifact.mimeType === MARKDOWN) {
      const content = await (await http.request(url)).text()
      if (structured) return { ...result, content }
      ctx.stdout(content)
      return
    }
    if (structured) return result
    if (flags.browser && isInteractive(ctx)) {
      if (openBrowser(url, { env: ctx.env, configBrowser: ctx.config.browser })) {
        ctx.stderr(`Opening ${url} in your browser…\n`)
        return
      }
    }
    ctx.stdout(`${url}\n`)
  },
})

const edit = defineCommand({
  name: "edit",
  summary: "Edit a Markdown artifact in your editor",
  description:
    "Open a Markdown artifact in your editor and save it back when it changed. The editor is\n" +
    "the `editor` config key, else VISUAL, else EDITOR; it must wait until the file is closed\n" +
    "(`code --wait`). Without any of them, a terminal gets notepad (Windows) or vi, and a\n" +
    "script exits 2. Saving replaces the stored text; there is no merge with edits made\n" +
    "elsewhere in the meantime.",
  args: [taskArg, artifactArg],
  context: ["workspace", "project"],
  output: "artifact",
  examples: [
    "intesa artifact edit WEB-12 notes.md",
    "EDITOR='code --wait' intesa a edit WEB-12 notes.md",
  ],
  async run(ctx, { task: taskRef, artifact: ref }) {
    const { http, task, artifact, url } = await find(ctx, taskRef, ref)
    requireMarkdown(artifact, "edited")
    const original = await (await http.request(url)).text()
    const edited = await editText(original, {
      filename: artifact.name,
      env: ctx.env,
      configEditor: ctx.config.editor,
      interactive: isInteractive(ctx),
    })
    if (edited === original) {
      ctx.stderr("No changes\n")
      return ctx.globals.json ? withUrl(http, task.id, artifact) : undefined
    }
    return withUrl(http, task.id, await send(http, "PUT", url, artifact.name, edited))
  },
})

const replace = defineCommand({
  name: "replace",
  summary: "Replace a Markdown artifact with a file",
  description:
    "Replace a Markdown artifact's content with a local file. The file must have the same\n" +
    "name as the artifact (exit 8 otherwise), so rename or copy it first.",
  args: [taskArg, artifactArg, { name: "file", required: true, description: "The new content" }],
  context: ["workspace", "project"],
  output: "artifact",
  examples: ["intesa artifact replace WEB-12 notes.md ./drafts/notes.md"],
  async run(ctx, { task: taskRef, artifact: ref, file: path }) {
    const file = checkFile(path)
    const { http, task, artifact, url } = await find(ctx, taskRef, ref)
    requireMarkdown(artifact, "replaced")
    if (file.name !== artifact.name) {
      throw invalid(
        `${file.name} cannot replace ${artifact.name}: the file must have the same name as the artifact`,
      )
    }
    const content = await Bun.file(file.path).bytes()
    return withUrl(http, task.id, await send(http, "PUT", url, artifact.name, content))
  },
})

export default defineGroup({
  name: "artifact",
  aliases: ["a"],
  summary: "List, upload, download and edit a task's artifacts",
  description:
    "Artifacts are files attached to a task: HTML, PDF, Markdown, Word and OpenDocument,\n" +
    "up to 5 MB each. Only Markdown artifacts can be edited or replaced, and a replacement\n" +
    "keeps the artifact's name.",
  commands: [list, upload, download, view, edit, replace],
  examples: [
    "intesa artifact list WEB-12",
    "intesa a upload WEB-12 spec.pdf",
    "intesa a download WEB-12 spec.pdf",
  ],
})
