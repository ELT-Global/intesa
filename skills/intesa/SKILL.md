---
name: intesa
description: Manage Intesa tasks, projects, members, tags, custom fields and task attachments from a terminal with the intesa CLI. Use when asked to list, create, edit, move, assign or delete Intesa tasks or projects, to upload or download a task's files, to check what is due, or when a repository has an .intesa.json file.
compatibility: Requires the intesa CLI (a standalone binary, or Bun 1.4+ to run intesa.js) and network access to an Intesa server.
metadata:
  cli-version: "0.1.0"
---

# intesa

`intesa` is the command-line client for Intesa, a project and task tracker. Every command acts as the signed-in user through the Intesa API. Tasks are named by key (`WEB-12`: project key, then number). Statuses are `backlog`, `todo`, `in_progress`, `review` and `complete`; priorities are `low`, `medium`, `high` and `urgent`.

## Install

Check with `intesa --version`. If it is missing, ask the user before installing it, then use one of:

- **Standalone binary** (no runtime needed): download the archive for the platform from https://github.com/ELT-Global/intesa/releases (tags `cli-v*`), unpack it and put `intesa` (`intesa.exe` on Windows) on the PATH.
- **With Bun 1.4+**: `curl -fsSL "$INTESA_HOST/cli/intesa.js" -o intesa.js`, then run `bun intesa.js …` wherever this guide says `intesa …`. The server hands out the client that matches it.
- **Inside the Intesa repository**: `bun apps/cli/src/main.ts …`.

## Set up

- **Sign in.** Set `INTESA_TOKEN` (and `INTESA_HOST`, the server URL) in the environment, or run `intesa auth login --host URL`, which shows a code for a person to approve in the browser. `intesa auth login --with-token < token.txt` stores a token made with `intesa token create`. `intesa auth status` shows who you are. Exit code 4 means you are not signed in.
- **Context.** A command needs a workspace and, for tasks, a project. They come from `-w SLUG` and `-p KEY`, then `INTESA_WORKSPACE` and `INTESA_PROJECT`, then the nearest `.intesa.json` found by walking up from the current directory (`{"host": "https://pm.example.com", "workspace": "acme", "project": "WEB"}`), then saved defaults (`intesa workspace use`, `intesa project use`). A key such as `WEB-12` implies its project. In a checkout with an `.intesa.json` you need no flags at all. When the workspace is ambiguous the error lists the slugs and exits 2.

## Rules for agents

1. Always pass `--json`, plus `--fields key,title,status` to keep the output small. Lists are JSON arrays; `view` and every mutation print the resulting object. Field names are camelCase, with `key` and `url` added. Without `--json` piped output is tab-separated, and `-q` prints only keys or ids (handy for loops).
2. stdout carries only data. Confirmations (`✓ …`), warnings and, with `--json`, errors go to stderr; an error is one line, `{"error":{"code","message","exitCode","hint"}}`. Check the exit code first, and read `hint` for the fix.
3. intesa never prompts when stdin or stdout is not a terminal, or with `--yes` or `CI` set. Missing input fails with exit 2 and names the flag, so supply every required flag.
4. Destructive commands (`delete`, `member remove`, `member leave`, `token revoke`) need `--yes` when they cannot prompt. Do not add it unless the user asked for the deletion.
5. `--dry-run` works on every mutation: it prints `{method, path, body}` instead of sending it and exits 0. Use it to check a bulk change first.
6. People are `@me`, an email or an exact name; tags are exact names (`--create-tags` creates missing ones). Nothing is guessed: an ambiguous name exits 2 and lists the candidates, an unknown one exits 5.
7. Check exact flags, arguments and output fields with `intesa schema <command words>` (JSON Schema; no words describes everything) or `intesa <command> --help`. `intesa api PATH` makes any authenticated API request that no command covers.
8. `intesa board` is a full-screen terminal UI for people; do not run it. `intesa mcp` serves the same commands as MCP tools (`claude mcp add intesa -- intesa mcp`); use it instead of the shell when your client supports MCP. Its destructive tools take `confirm: true`.

## Exit codes

On failure the exit code says what kind; `error.code` in the JSON is the exact reason.

| Exit | Name | Meaning | error.code |
| --- | --- | --- | --- |
| 0 | OK | Success |  |
| 1 | ERROR | Unexpected error: network, server error, rate limited | `RATE_LIMITED`, `INTERNAL`, `HTTP_ERROR`, `NETWORK_ERROR`, `CONFIG_ERROR`, `EDITOR_ERROR` |
| 2 | USAGE | Bad flags or arguments, missing input when not interactive, ambiguous name | `USAGE_ERROR` |
| 3 | CANCELLED | Cancelled: prompt aborted or Ctrl+C | `CANCELLED` |
| 4 | AUTH | Not logged in, token expired or revoked, two-factor required | `UNAUTHORIZED`, `TWO_FACTOR_REQUIRED`, `NOT_LOGGED_IN`, `ACCESS_DENIED`, `DEVICE_CODE_EXPIRED` |
| 5 | NOT_FOUND | The resource does not exist or is not visible to you | `NOT_FOUND` |
| 6 | CONFLICT | Conflicts with the current state, e.g. a taken name | `CONFLICT` |
| 7 | FORBIDDEN | Not allowed, including writes with a read-only token | `FORBIDDEN` |
| 8 | VALIDATION | The server rejected the input | `VALIDATION_ERROR` |

## Searching with -Q

`intesa task list -Q QUERY` takes the web app's search syntax. Terms are separated by spaces and all must match: free text (matched against key, title and description), `"two words"`, `field:value`, `field:a,b` (any of), and `-` in front to negate. Fields: `status`, `priority` (`none` for unset), `assignee` (a name, `me` or `unassigned`), `tag`, `due` (`overdue`, `soon`, `today`, `none` or YYYY-MM-DD), `has:` and `no:` (`due`, `assignee`, `tag`, `priority`, `subtasks`, `description`). The flags `-s`, `-a`, `-t`, `--priority` and `--due` add the same terms. Completed tasks are hidden unless `--include-complete` or a `status:` term is given.

```sh
intesa task list -Q 'login assignee:me priority:high,urgent' --json
intesa task list -Q 'due:overdue -status:review no:assignee' --json --fields key,title,dueAt
intesa task list -Q '"password reset" -tag:wontfix has:subtasks' --json
intesa task search "checkout" --json     # server-side title or key search across the workspace
```

## Recipes

List my open tasks (all projects; for one project use `-p WEB -a me` instead of `--mine`):

```sh
intesa task list --mine --sort due --json --fields key,title,status,priority,dueAt
```

Create a task with tags (`url` is the link to share):

```sh
intesa task create -p WEB -T "Fix login redirect" -b "Steps to reproduce: …" -a @me -t auth -t bug --priority high --create-tags --json --fields key,url
intesa task create --parent WEB-12 -T "Write tests" --json    # a subtask
```

Move a task to review and bring its subtasks along. When not interactive the default is to leave subtasks alone (`keep`); `match` moves them too. The result lists any subtasks still in another status in `subtasksOutOfSync`:

```sh
intesa task review WEB-12 --subtasks match --json --fields key,status,subtasksOutOfSync
intesa task move WEB-12 in_progress --after WEB-9 --json    # any status, optionally placed in the column
```

Attach a file (HTML, PDF, Markdown, Word or OpenDocument, up to 5 MB each; the whole upload is refused with exit 8 if one file is not acceptable) and fetch one back:

```sh
intesa artifact upload WEB-12 spec.pdf notes.md --json
intesa artifact download WEB-12 spec.pdf -o ./downloads    # -o - writes the bytes to stdout
```

Edit several things of a task in one go through a document. With no flags `task edit` opens the task as a document (front matter with title, status, priority, due, assignees, tags and fields, then the Markdown body). Without a terminal it only works if `INTESA_EDITOR` names a program; intesa runs it with the path of a temporary file as its last argument, and the program edits that file in place and exits 0. A key left out of the front matter changes nothing, an empty value clears it, and only the differences are sent. For a few fields, prefer flags (`task edit WEB-12 --priority urgent --add-assignee @me --no-due`).

```sh
INTESA_EDITOR="bun fix-task.ts" intesa task edit WEB-12 --json
```

## Command reference

Every command with its usage, summary and examples is listed in [references/commands.md](references/commands.md); read it when you need a command not shown above. For the exact flags and output fields of one command, run `intesa schema <command words>` or `intesa <command words> --help`.
