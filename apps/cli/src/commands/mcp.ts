import { debugLevel } from "../client/http"
import { serve } from "../mcp/server"
import { buildTools, callTool, toolEnv } from "../mcp/tools"
import { defineCommand } from "../registry/define"
import { allCommands } from "."

export default defineCommand({
  name: "mcp",
  summary: "Serve intesa's commands to AI agents as MCP tools",
  description: [
    "Run a Model Context Protocol server on stdin and stdout, so an AI agent can use intesa's",
    "commands as tools: one per command (task_list, task_create, artifact_upload, …), taking",
    "the command's arguments and flags and returning its --json output.",
    "",
    "Register it with your agent, e.g. for Claude Code:",
    "",
    "  claude mcp add intesa -- intesa mcp",
    "",
    "or in a client's config file:",
    "",
    '  {"mcpServers": {"intesa": {"command": "intesa", "args": ["mcp"]}}}',
    "",
    "Tools act as you, with the login from `intesa auth login`, or with INTESA_TOKEN when it is",
    "set (add it to the server's env in the client config). -w, -p and --host given here are",
    "every tool's defaults. Nothing prompts; tools that delete need `confirm: true`. Signing in,",
    "the board, shell completion and changing your config are not offered as tools.",
  ].join("\n"),
  context: ["workspace", "project"],
  examples: [
    "claude mcp add intesa -- intesa mcp",
    "claude mcp add intesa-web -- intesa mcp -w acme -p WEB",
  ],
  async run(ctx) {
    const tools = buildTools(await allCommands())
    const { host, workspace, project } = ctx.globals
    const defaults: Record<string, string> = {}
    for (const [name, value] of Object.entries({ host, workspace, project })) {
      if (value !== undefined) defaults[name] = value
    }
    const debug = debugLevel(ctx.env, ctx.globals.debug) !== "off"
    const env = toolEnv(ctx.env)
    if (ctx.globals.debug) env.INTESA_DEBUG ??= "1"
    if (process.stdin.isTTY) {
      ctx.stderr(
        "intesa mcp talks to an MCP client on stdin and stdout; see `intesa mcp --help`.\n",
      )
    }
    await serve(
      {
        tools,
        call: (tool, args) =>
          callTool(tool, args, {
            invoke: ctx.invoke,
            env,
            defaults,
            log: debug ? ctx.stderr : undefined,
          }),
        send: ctx.stdout,
        log: ctx.stderr,
      },
      Bun.stdin.stream(),
    )
  },
})
