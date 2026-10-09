import { z } from "zod"
import { usageError } from "../output/errors"
import { type Ctx, defineCommand } from "../registry/define"

function keyValue(input: string, flag: string): [string, string] {
  const at = input.indexOf("=")
  if (at <= 0) throw usageError(`${flag} expects key=value, got "${input}"`)
  return [input.slice(0, at), input.slice(at + 1)]
}

async function readSource(ctx: Ctx, path: string, flag: string) {
  if (path === "-") return ctx.readStdin()
  const file = Bun.file(path)
  if (!(await file.exists())) throw usageError(`${flag}: no such file "${path}"`)
  return file.text()
}

// `-F` values: literals become JSON values, `@file` reads a file and `@-` reads stdin.
async function typedValue(ctx: Ctx, value: string): Promise<unknown> {
  if (value.startsWith("@")) return readSource(ctx, value.slice(1), "--field")
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

// Paths are relative to the API root; a leading `/api` is accepted too.
const apiPath = (path: string) => {
  const clean = path.replace(/^\/+/, "")
  return `/${clean === "api" || clean.startsWith("api/") || clean.startsWith("api?") ? clean : `api/${clean}`}`
}

export default defineCommand({
  name: "api",
  summary: "Make an authenticated request to the Intesa API",
  description: [
    "Make an authenticated HTTP request to the Intesa API and print the response body.",
    "",
    "The path is relative to /api, e.g. `/me` or `/workspaces`. The method is GET, or POST",
    "when parameters or --input are given; override it with --method.",
    "",
    "-f adds a string parameter and -F a typed one: true, false, null and numbers become JSON",
    "values, and @file reads the value from a file (@- from stdin). Parameters form a JSON",
    "body, or the query string for GET and HEAD and when --input supplies the body.",
    "",
    "Errors exit with the code for the API's error (see `intesa help exit-codes`) and print",
    "nothing on stdout.",
  ].join("\n"),
  args: [{ name: "path", required: true, description: "API path, e.g. /me" }],
  flags: z.object({
    method: z
      .string()
      .optional()
      .meta({ short: "X", placeholder: "method", description: "HTTP method to use" }),
    rawField: z
      .array(z.string())
      .default([])
      .meta({ short: "f", placeholder: "key=value", description: "Add a string parameter" }),
    field: z
      .array(z.string())
      .default([])
      .meta({ short: "F", placeholder: "key=value", description: "Add a typed parameter" }),
    header: z
      .array(z.string())
      .default([])
      .meta({ short: "H", placeholder: "'key: value'", description: "Add a request header" }),
    input: z.string().optional().meta({
      placeholder: "file",
      description: "Read the request body from a file (- for stdin)",
    }),
    include: z
      .boolean()
      .default(false)
      .meta({ short: "i", description: "Print the status line and response headers too" }),
  }),
  examples: [
    "intesa api /me",
    "intesa api /workspaces -f name=Acme -f slug=acme",
    "intesa api -X PATCH /tasks/TASK_ID -F priority=null",
    "intesa api -X GET /workspaces/WS_ID/tasks/search -f q=login",
    "intesa api -X PUT /tasks/TASK_ID/artifacts/ID --input notes.md -H 'Content-Type: text/markdown'",
  ],
  async run(ctx, { path }, flags) {
    const params: Record<string, unknown> = {}
    for (const f of flags.rawField) {
      const [k, v] = keyValue(f, "--raw-field")
      params[k] = v
    }
    for (const f of flags.field) {
      const [k, v] = keyValue(f, "--field")
      params[k] = await typedValue(ctx, v)
    }
    const hasParams = Object.keys(params).length > 0
    const method = (flags.method ?? (hasParams || flags.input ? "POST" : "GET")).toUpperCase()

    const http = await ctx.http()
    const url = new URL(apiPath(path), http.host)
    const headers = new Headers()
    let body: string | undefined
    const inQuery = flags.input !== undefined || method === "GET" || method === "HEAD"
    if (hasParams && inQuery) {
      for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v))
    }
    if (flags.input !== undefined) {
      body = await readSource(ctx, flags.input, "--input")
      headers.set("content-type", "application/json")
    } else if (hasParams && !inQuery) {
      body = JSON.stringify(params)
      headers.set("content-type", "application/json")
    }
    for (const h of flags.header) {
      const at = h.indexOf(":")
      if (at <= 0) throw usageError(`--header expects 'key: value', got "${h}"`)
      headers.set(h.slice(0, at).trim(), h.slice(at + 1).trim())
    }

    const res = await http.request(url, { method, headers, body })
    if (flags.include) {
      const lines = [`HTTP/1.1 ${res.status} ${res.statusText}`]
      for (const [k, v] of res.headers) lines.push(`${k}: ${v}`)
      ctx.stdout(`${lines.join("\n")}\n\n`)
    }
    const text = await res.text()
    if (!text) return
    if (ctx.mode.tty) {
      try {
        ctx.stdout(`${JSON.stringify(JSON.parse(text), null, 2)}\n`)
        return
      } catch {}
    }
    ctx.stdout(text.endsWith("\n") ? text : `${text}\n`)
  },
})
