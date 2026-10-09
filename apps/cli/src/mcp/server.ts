import { VERSION } from "../version"
import type { Tool, ToolResult } from "./tools"

// Newest first. A client asking for another version gets the newest, and decides whether it
// can work with that.
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

const INSTRUCTIONS = [
  "Each tool runs one intesa command as the signed-in user and returns its JSON output.",
  'A failed call sets isError and returns {"error": {code, message, exitCode, hint}}.',
  "Arguments are the command's arguments and flags by name: a list repeats a flag, null",
  "clears a value (what --no-x does), and fields picks output fields.",
  "Tasks are named by key (WEB-12), by number with a project, by id or by URL; people by",
  "@me, email or name. Workspace and project default to the server's settings.",
  "Mutations take dry-run: true to return the request instead of sending it; tools that",
  "delete need confirm: true.",
].join(" ")

type Id = string | number | null
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }

export type Server = {
  tools: Tool[]
  call: (tool: Tool, args: unknown) => Promise<ToolResult>
  // Writes one JSON-RPC message; must be the only thing that writes to stdout.
  send: (line: string) => void
  log: (text: string) => void
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

async function respond(server: Server, method: string, params: unknown): Promise<unknown> {
  const p = isObject(params) ? params : {}
  switch (method) {
    case "initialize": {
      const asked = p.protocolVersion
      const protocolVersion =
        typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : PROTOCOL_VERSIONS[0]
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "intesa", title: "Intesa", version: VERSION },
        instructions: INSTRUCTIONS,
      }
    }
    case "ping":
      return {}
    case "tools/list":
      // Small enough for one page, so a cursor is never handed out.
      return { tools: server.tools.map((t) => t.definition) }
    case "tools/call": {
      if (typeof p.name !== "string") throw new RpcError(INVALID_PARAMS, "params.name is required")
      const tool = server.tools.find((t) => t.definition.name === p.name)
      if (!tool) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${p.name}`)
      if (p.arguments !== undefined && !isObject(p.arguments)) {
        throw new RpcError(INVALID_PARAMS, "params.arguments must be an object")
      }
      return server.call(tool, p.arguments)
    }
    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`)
  }
}

async function handle(server: Server, line: string) {
  const reply = (
    id: Id,
    body: { result: unknown } | { error: { code: number; message: string } },
  ) => server.send(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`)
  const fail = (id: Id, code: number, message: string) => reply(id, { error: { code, message } })

  let msg: Message
  try {
    msg = JSON.parse(line)
  } catch {
    return fail(null, PARSE_ERROR, "Parse error")
  }
  const hasId = isObject(msg) && "id" in msg
  const id = hasId && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null
  if (!isObject(msg) || msg.jsonrpc !== "2.0") {
    return fail(id, INVALID_REQUEST, "Invalid Request: expected one JSON-RPC 2.0 object")
  }
  if (typeof msg.method !== "string") {
    // A response to a request of ours; this server never sends any.
    if ("result" in msg || "error" in msg) return
    return fail(id, INVALID_REQUEST, "Invalid Request: method is required")
  }
  // Notifications (initialized, cancelled, …) need no answer, and none of them changes
  // anything here.
  if (!hasId) return
  if (id === null)
    return fail(null, INVALID_REQUEST, "Invalid Request: id must be a string or number")
  try {
    reply(id, { result: await respond(server, msg.method, msg.params) })
  } catch (err) {
    if (err instanceof RpcError) return fail(id, err.code, err.message)
    server.log(`intesa mcp: ${(err as Error)?.stack ?? err}\n`)
    fail(id, INTERNAL_ERROR, `Internal error: ${(err as Error)?.message ?? err}`)
  }
}

// Serves newline-delimited JSON-RPC from `input` until it ends. Messages are handled one at a
// time in the order they arrive, so a mutation never overtakes the one sent before it.
export async function serve(server: Server, input: ReadableStream<Uint8Array>) {
  let queue = Promise.resolve()
  const enqueue = (line: string) => {
    if (!line.trim()) return
    queue = queue
      .then(() => handle(server, line))
      .catch((err) => server.log(`intesa mcp: ${(err as Error)?.stack ?? err}\n`))
  }
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true })
    let end = buffer.indexOf("\n")
    while (end !== -1) {
      enqueue(buffer.slice(0, end))
      buffer = buffer.slice(end + 1)
      end = buffer.indexOf("\n")
    }
  }
  enqueue(buffer + decoder.decode())
  await queue
}
