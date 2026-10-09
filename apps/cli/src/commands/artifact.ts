import { statSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { z } from "zod"
import { type Artifact, checkFile, type LocalFile, sendArtifact } from "../client/artifacts"
import type { Http } from "../client/http"
import { links } from "../client/links"
import { pickOne, resolver } from "../client/resolve"
import { openOrPrint } from "../io/browser"
import { editText } from "../io/editor"
import { personPresent } from "../io/prompt"
import { CliError, formatError, invalid, prefixed, usageError } from "../output/errors"
import { renderMarkdown } from "../output/markdown"
import { type Ctx, defineCommand, defineGroup } from "../registry/define"
import { taskArg } from "./task/shared"

const MARKDOWN = "text/markdown"

const withUrl = (http: Http, taskId: string, artifact: Artifact) => ({
  ...artifact,
  url: links.artifact(http.host, taskId, artifact.id),
})

const listArtifacts = async (http: Http, taskId: string) =>
  (await (await http.client.api.tasks[":taskId"].artifacts.$get({ param: { taskId } })).json())
    .artifacts as Artifact[]

// By id, exact name, then name in any case.
async function find(ctx: Ctx, taskRef: string, ref: string) {
  const task = await resolver(ctx).task(taskRef)
  const http = await ctx.http()
  const artifacts = await listArtifacts(http, task.id)
  const artifact = pickOne(artifacts, ref, {
    noun: "artifact",
    ids: (a) => [a.id],
    names: (a) => [a.name],
    label: (a) => `${a.name} (${a.id})`,
    exactCase: true,
    hint: artifacts.length
      ? `This task's artifacts: ${artifacts.map((a) => a.name).join(", ")}.`
      : "This task has no artifacts.",
  })
  return { http, task, artifact, url: links.artifact(http.host, task.id, artifact.id) }
}

const requireMarkdown = (artifact: Artifact, verb: string) => {
  if (artifact.mimeType !== MARKDOWN) {
    throw invalid(`${artifact.name}: only Markdown artifacts can be ${verb}.`)
  }
}

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
          const url = links.artifact(http.host, task.id)
          uploaded.push(
            withUrl(http, task.id, await sendArtifact(http, "POST", url, file.name, content)),
          )
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
    const result = uploaded.length > 0 ? uploaded : undefined
    if (!flags.continueOnError) {
      const { code, exitCode, hint } = first
      throw new CliError(first.message, { code, exitCode, hint, result })
    }
    for (const failure of failures) ctx.stderr(formatError(failure, ctx.globals.json))
    throw new CliError(`${failures.length} of ${paths.length} files were not uploaded`, {
      code: first.code,
      exitCode: first.exitCode,
      result,
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
    ctx.done(`Saved ${artifact.name} (${artifact.size} bytes) to ${path}`)
    return { ...withUrl(http, task.id, artifact), path }
  },
  human: () => "",
})

const view = defineCommand({
  name: "view",
  summary: "Show a Markdown artifact or open any other in the browser",
  description:
    "Print a Markdown artifact's text, rendered on a terminal. Any other format is opened in\n" +
    "the browser, which needs you to be signed in to the web app; when there is no terminal,\n" +
    "or with --no-browser, its link is printed instead.",
  args: [taskArg, artifactArg],
  flags: z.object({
    browser: z.boolean().default(true).meta({ description: "Do not open the browser" }),
  }),
  context: ["workspace", "project"],
  output: "artifactView",
  paged: true,
  examples: [
    "intesa artifact view WEB-12 notes.md",
    "intesa artifact view WEB-12 spec.pdf",
    "intesa artifact view WEB-12 spec.pdf --no-browser",
  ],
  async run(ctx, { task: taskRef, artifact: ref }) {
    const { http, task, artifact, url } = await find(ctx, taskRef, ref)
    const result = withUrl(http, task.id, artifact)
    if (artifact.mimeType !== MARKDOWN) return result
    return { ...result, content: await (await http.request(url)).text() }
  },
  human(ctx, artifact, flags) {
    if ("content" in artifact) {
      return ctx.mode.tty ? renderMarkdown(artifact.content, ctx.mode) : artifact.content
    }
    if (flags.browser && openOrPrint(ctx, artifact.url)) return ""
    return `${artifact.url}\n`
  },
})

const edit = defineCommand({
  name: "edit",
  summary: "Edit a Markdown artifact in your editor",
  description:
    "Open a Markdown artifact in your editor and save it back when it changed. The editor is\n" +
    "INTESA_EDITOR, else the `editor` config key, else VISUAL, else EDITOR, else notepad\n" +
    "(Windows) or vi; it must wait until the file is closed (`code --wait`). Without a\n" +
    "terminal only INTESA_EDITOR is used, and otherwise the command exits 2: scripts use\n" +
    "`intesa artifact replace`. Saving replaces the stored text; there is no merge with edits\n" +
    "made elsewhere in the meantime.",
  args: [taskArg, artifactArg],
  context: ["workspace", "project"],
  output: "artifact",
  examples: [
    "intesa artifact edit WEB-12 notes.md",
    "EDITOR='code --wait' intesa a edit WEB-12 notes.md",
  ],
  async run(ctx, { task: taskRef, artifact: ref }) {
    const interactive = personPresent(ctx)
    if (!interactive && !ctx.env.INTESA_EDITOR?.trim()) {
      throw usageError(
        "artifact edit needs a terminal for the editor",
        "Use `intesa artifact replace TASK ARTIFACT FILE` from scripts, or set INTESA_EDITOR.",
      )
    }
    const { http, task, artifact, url } = await find(ctx, taskRef, ref)
    requireMarkdown(artifact, "edited")
    const original = await (await http.request(url)).text()
    const edited = await editText(original, {
      filename: artifact.name,
      env: ctx.env,
      configEditor: ctx.config.editor,
      interactive,
    })
    if (edited === original) {
      ctx.stderr("No changes\n")
      return withUrl(http, task.id, artifact)
    }
    return withUrl(http, task.id, await sendArtifact(http, "PUT", url, artifact.name, edited))
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
    return withUrl(http, task.id, await sendArtifact(http, "PUT", url, artifact.name, content))
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
