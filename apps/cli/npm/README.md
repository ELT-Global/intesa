# intesa

The command-line client for [Intesa](https://github.com/ELT-Global/intesa), a project and task tracker: tasks, projects, members, tags, custom fields and attachments from the terminal, a full-screen board, and a contract built for AI agents (`--json` everywhere, stable exit codes, no prompts when not interactive, `intesa schema`, `intesa mcp`).

## Install

intesa runs on [Bun](https://bun.sh) 1.4 or newer.

```sh
bun add -g intesa      # recommended
bunx intesa --help     # or run it without installing
npm install -g intesa  # also works; still runs on Bun
```

With npm, the full-screen board (`intesa board`) may be missing its terminal UI library, whose package asks for a newer Node than most installs have; installing with Bun avoids that. Without Bun, use a standalone binary from the [releases](https://github.com/ELT-Global/intesa/releases) instead.

## Sign in

```sh
intesa auth login --host https://pm.example.com    # shows a code to approve in the browser
intesa auth status
```

Scripts and CI can set `INTESA_TOKEN` and `INTESA_HOST` instead. A `.intesa.json` such as `{"host": "https://pm.example.com", "workspace": "acme", "project": "WEB"}` pins the context for a checkout.

## Use

```sh
intesa task list --mine
intesa task create -T "Fix login redirect" -a @me -t bug --priority high
intesa task move WEB-12 review --subtasks match
intesa board WEB
```

Run `intesa --help`, `intesa <command> --help` or `intesa schema` for everything else.

## For AI agents

Pass `--json` (and `--fields`) to every command; stdout carries only data, errors are JSON on stderr, and the exit code says what went wrong (`intesa help exit-codes`). Nothing prompts when stdin is not a terminal. `intesa mcp` serves the same commands as MCP tools (`claude mcp add intesa -- intesa mcp`), and the agent skill installs with:

```sh
npx skills add ELT-Global/intesa --skill intesa
```

## License

MIT
