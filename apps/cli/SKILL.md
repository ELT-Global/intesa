---
name: intesa
description: Manage Intesa tasks, projects, members, tags, custom fields and task attachments from a terminal with the intesa CLI. Use when asked to list, create, edit, move, assign or delete Intesa tasks or projects, to upload or download a task's files, to check what is due, or when a repository has an .intesa.json file.
---

# intesa

`intesa` is the command-line client for Intesa, a project and task tracker. Every command acts as the signed-in user through the Intesa API. Tasks are named by key (`WEB-12`: project key, then number). Statuses are `backlog`, `todo`, `in_progress`, `review` and `complete`; priorities are `low`, `medium`, `high` and `urgent`.

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

`intesa <noun> <verb>`; `<arg>` is required and `[arg]` optional. Every command also takes the global flags: `-w`, `-p`, `--host`, `--json`, `--fields`, `-q`, `--yes`, `--dry-run`, `--no-color`, `--debug`. Run `intesa schema <command words>` for a command's flags and output fields.

### auth

- `intesa auth login`: Sign in to an Intesa server
- `intesa auth logout`: Sign out and revoke the stored token
- `intesa auth status`: Show who you are signed in as
- `intesa auth token`: Print the active token

```sh
intesa auth login --host https://pm.example.com
intesa auth login --with-token < token.txt
intesa auth login --dev --email me@example.com
intesa auth logout
intesa auth logout --host https://pm.example.com
intesa auth status
intesa auth status --json --fields user,scope
intesa auth token
curl -H "Authorization: Bearer $(intesa auth token)" …
```

### workspace (alias ws)

- `intesa workspace list` (alias ls): List your workspaces
- `intesa workspace view [slug]`: Show a workspace
- `intesa workspace create <name>`: Create a workspace
- `intesa workspace rename <new-name>`: Rename the current workspace
- `intesa workspace use <slug>`: Set the default workspace

```sh
intesa workspace list
intesa ws list --json --fields slug,role
intesa workspace view
intesa ws view acme --json
intesa workspace create "Acme Corp"
intesa ws create Acme --slug acme
intesa workspace rename "Acme Inc"
intesa ws rename "Acme Inc" -w acme
intesa workspace use acme
intesa ws use acme --local
```

### project (alias p)

- `intesa project list` (alias ls): List the workspace's projects
- `intesa project view [key]`: Show a project
- `intesa project create <name>`: Create a project
- `intesa project edit [key]`: Rename a project or change its description
- `intesa project delete <key>`: Delete a project and all of its tasks
- `intesa project use <key>`: Set the default project

```sh
intesa project list
intesa p list --json --fields key,name
intesa project view WEB
intesa p view --json --fields key,taskCounts
intesa project create "Website Redesign"
intesa p create Web --key WEB
intesa project edit WEB --name "Website"
intesa p edit WEB --no-description
intesa project delete WEB
intesa p delete WEB --yes
intesa project use WEB
intesa p use WEB --local
```

### task (alias t)

- `intesa task list` (alias ls): List and filter tasks
- `intesa task view <task>`: Show a task
- `intesa task create` (alias new): Create a task
- `intesa task edit <task>`: Change a task's title, description, priority, due date, people, tags or fields
- `intesa task move <task> <status>` (alias mv): Move a task to a status, optionally placing it in the column
- `intesa task start <task>`: Move a task to In progress
- `intesa task review <task>`: Move a task to Review
- `intesa task done <task>`: Move a task to Complete
- `intesa task assign <task> [people...]`: Assign people to a task
- `intesa task unassign <task> [people...]`: Remove people from a task
- `intesa task delete <task>` (alias rm): Delete a task and its subtasks
- `intesa task history <task>`: Show a task's status changes
- `intesa task link <task> <other>`: Link two tasks: one blocks the other, or they are related
- `intesa task unlink <task> <other>`: Remove a relationship between two tasks
- `intesa task search <query...>`: Find tasks in the workspace by title or key
- `intesa task open <task>`: Open a task in the browser
- `intesa task url <task>`: Print a task's web link

```sh
intesa task list -p WEB
intesa task list --mine --sort due
intesa task list -s todo,in_progress -a me
intesa task list -Q 'assignee:me -tag:bug has:due' --json --fields key,title,status
intesa task view WEB-12
intesa task view 12 -p WEB --history
intesa task view WEB-12 --json --fields key,status,subtasks
intesa task create -T "Fix login redirect" -a @me -t auth --priority high
intesa task create --parent WEB-12 -T "Write tests"
intesa task create -p WEB -T Notes -F notes.md --field Estimate=3
intesa task edit WEB-12 -T "Fix the login redirect" --priority urgent
intesa task edit WEB-12 --add-assignee @me --remove-tag blocked --no-due
intesa task edit WEB-12 --field Estimate=5 --clear-field Stage
intesa task edit WEB-12
intesa task move WEB-12 review
intesa task move WEB-12 todo --top
intesa task move WEB-12 in_progress --after WEB-9
intesa task move WEB-12 complete --subtasks match --json
intesa task start WEB-12
intesa task review WEB-12
intesa task done WEB-12
intesa task assign WEB-12
intesa task assign WEB-12 @me "Mei Chen"
intesa task unassign WEB-12
intesa task unassign WEB-12 mei@example.com
intesa task delete WEB-12
intesa task delete WEB-12 --yes
intesa task history WEB-12
intesa task history WEB-12 --json
intesa task link WEB-12 --blocks WEB-14
intesa task link WEB-12 --blocked-by API-3
intesa task link WEB-12 --related WEB-7
intesa task unlink WEB-12 WEB-14
intesa task unlink WEB-12 WEB-7 --type related
intesa task search login redirect
intesa task search WEB-1
intesa task search auth --json --fields key,title
intesa task open WEB-12
intesa task url WEB-12
intesa task url 12 -p WEB
```

### member

- `intesa member list` (alias ls): List the workspace's members
- `intesa member add <email>`: Add someone to the workspace
- `intesa member role <member> <role>`: Change a member's role
- `intesa member remove <member>`: Remove a member from the workspace
- `intesa member leave`: Leave the workspace

```sh
intesa member list
intesa member list --json --fields email,role
intesa member add ada@example.com
intesa member add ada@example.com --role owner
intesa member role ada@example.com owner
intesa member role @me member
intesa member remove ada@example.com
intesa member remove ada@example.com --yes
intesa member leave -w acme
intesa member leave -w acme --yes
```

### tag

- `intesa tag list` (alias ls): List the workspace's tags
- `intesa tag create <name>`: Create a tag
- `intesa tag edit <tag>`: Rename or recolour a tag
- `intesa tag delete <tag>`: Delete a tag

```sh
intesa tag list
intesa tag list --json --fields name,color
intesa tag create Urgent
intesa tag create Urgent --color magenta
intesa tag edit Urgent --name "Very urgent"
intesa tag edit Urgent --color gray
intesa tag delete Urgent
intesa tag delete Urgent --yes
```

### field

- `intesa field list` (alias ls): List a project's custom fields
- `intesa field create <name>`: Add a custom field to a project
- `intesa field edit <field>`: Rename a custom field or change its options
- `intesa field delete <field>`: Delete a custom field and its values

```sh
intesa field list -p WEB
intesa field list --json --fields name,type,options
intesa field create Estimate --type number -p WEB
intesa field create Stage --type select --option Alpha --option Beta --required
intesa field edit Stage --add-option "Release candidate"
intesa field edit Stage --remove-option Alpha
intesa field edit Estimate --required
intesa field delete Estimate -p WEB
intesa field delete Estimate --yes
```

### artifact (alias a)

- `intesa artifact list <task>` (alias ls): List a task's artifacts
- `intesa artifact upload <task> <file...>`: Upload files to a task
- `intesa artifact download <task> <artifact>`: Download an artifact
- `intesa artifact view <task> <artifact>`: Show a Markdown artifact or open any other in the browser
- `intesa artifact edit <task> <artifact>`: Edit a Markdown artifact in your editor
- `intesa artifact replace <task> <artifact> <file>`: Replace a Markdown artifact with a file

```sh
intesa artifact list WEB-12
intesa a list WEB-12 --json --fields id,name,size
intesa artifact upload WEB-12 spec.pdf notes.md
intesa artifact upload WEB-12 *.md --continue-on-error
intesa artifact download WEB-12 spec.pdf
intesa artifact download WEB-12 notes.md -o -
intesa artifact download WEB-12 spec.pdf -o ~/Downloads --force
intesa artifact view WEB-12 notes.md
intesa artifact view WEB-12 spec.pdf
intesa artifact view WEB-12 spec.pdf --no-browser
intesa artifact edit WEB-12 notes.md
EDITOR='code --wait' intesa a edit WEB-12 notes.md
intesa artifact replace WEB-12 notes.md ./drafts/notes.md
```

### config

- `intesa config get <key>`: Print the value of a configuration key
- `intesa config list` (alias ls): Print every configuration key and its value
- `intesa config set <key> <value>`: Set a configuration key

```sh
intesa config get editor
intesa config get host --json
intesa config list
intesa config list --json
intesa config set host https://pm.example.com
intesa config set editor 'code --wait'
intesa config set prompt disabled
```

### token

- `intesa token list` (alias ls): List your API tokens
- `intesa token create`: Create a personal access token
- `intesa token revoke <id>`: Revoke an API token

```sh
intesa token list
intesa token list --json --fields id,name,expiresAt
intesa token create --name ci --scope read
intesa token create --name laptop --expires 90d
INTESA_TOKEN=$(intesa token create --name agent) intesa api /me
intesa token revoke 3f2c0d1e-...
intesa token revoke 3f2c0d1e-... --yes
```

### me

- `intesa me view`: Show your account
- `intesa me edit`: Change your display name
- `intesa me 2fa <action>`: Enable or disable two-factor sign-in

```sh
intesa me
intesa me --json --fields email,totpEnabled
intesa me edit --name "Alan Turing"
intesa me 2fa enable
intesa me 2fa enable --json
intesa me 2fa disable --code 123456
```

### Other commands

- `intesa board [key]`: Open a project's board full screen
- `intesa status`: Show your recent projects, your tasks and what is due soon
- `intesa api <path>`: Make an authenticated request to the Intesa API
- `intesa schema [command...]`: Describe commands, flags and exit codes as JSON
- `intesa completion <shell>`: Generate a shell completion script
- `intesa mcp`: Serve intesa's commands to AI agents as MCP tools

```sh
intesa board
intesa board WEB
intesa board WEB-12
intesa status
intesa status -w acme --json --fields assigned
intesa api /me
intesa api /workspaces -f name=Acme -f slug=acme
intesa api -X PATCH /tasks/TASK_ID -F priority=null
intesa api -X GET /workspaces/WS_ID/tasks/search -f q=login
intesa api -X PUT /tasks/TASK_ID/artifacts/ID --input notes.md -H 'Content-Type: text/markdown'
intesa schema
intesa schema api
intesa schema config set
intesa completion bash
intesa completion powershell
claude mcp add intesa -- intesa mcp
claude mcp add intesa-web -- intesa mcp -w acme -p WEB
```
