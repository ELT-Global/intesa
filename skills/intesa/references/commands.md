# intesa command reference

`intesa <noun> <verb>`; `<arg>` is required and `[arg]` optional. Every command also takes the global flags: `-w`, `-p`, `--host`, `--json`, `--fields`, `-q`, `--yes`, `--dry-run`, `--no-color`, `--debug`. Run `intesa schema <command words>` for a command's flags and output fields.

## auth

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

## workspace (alias ws)

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

## project (alias p)

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

## task (alias t)

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

## member

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

## tag

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

## field

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

## artifact (alias a)

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

## config

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

## token

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

## me

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

## Other commands

- `intesa board [key]`: Open a project's board full screen
- `intesa status`: Show your recent projects, your tasks and what is due soon
- `intesa week [week]`: Show what each person worked on in a week
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
intesa week
intesa week last
intesa week 2026-10-05 --raw | pbcopy
intesa week --json
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
