# Intesa

A small project management tool in the style of Linear, meant for one team of around eight developers who host it themselves. Workspaces contain projects, projects contain tasks (with one level of subtasks), and tasks carry a status, priority, due date, assignees, tags, blocking and related links, a status history and per-project custom fields. Sign-in is Google only (plus optional TOTP two-factor); there are no passwords.

What it deliberately does not do: no email or notifications, no comments or file attachments, no real-time updates (a second browser sees changes on its next fetch), no manual ordering inside a board column, no billing, no audit log beyond task status history, and no sign-in methods other than Google. It is one service, one database, and has not been load tested beyond a few thousand tasks per workspace.

Stack: Bun, Hono, Kysely (SQLite by default, PostgreSQL supported), a TanStack Start single-page client built with Vite, Playwright for end-to-end tests.

## Quick start

Requires [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
DEV_LOGIN=true bun run dev
```

The web client is on <http://localhost:5173> and proxies `/api` to the API on port 3000. With `DEV_LOGIN=true` (and `NODE_ENV` not `production`) the login page offers an email-only sign-in that creates the account on the fly, so you do not need Google credentials to try it. The SQLite file is created at `./data/intesa.db`.

To run the production build on one port:

```sh
bun run build
NODE_ENV=production PUBLIC_URL=http://localhost:3000 bun run start
```

## Configuration

All settings come from environment variables (see `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port for the API and the built client. |
| `NODE_ENV` | `production` when unset | `development`, `production` or `test`. Anything other than `production` allows the dev login. In `development` the API does not serve the client (Vite does). |
| `DATABASE_URL` | `./data/intesa.db` | SQLite file path (the directory is created), `:memory:`, or a `postgres://` URL. |
| `WEB_DIST` | `apps/web/dist/client` | Directory with the built web client. |
| `PUBLIC_URL` | `http://localhost:$PORT` | Public origin, used for the Google redirect URI. Session cookies get the `Secure` flag when `NODE_ENV=production` and this starts with `https://`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | unset | Both are required to enable Google sign-in. |
| `DEV_LOGIN` | unset | `true` enables `POST /api/auth/dev-login`. Ignored in production. |
| `TEST_DATABASE_URL` | unset | Test only: run the API tests against this Postgres database. |

## Google sign-in

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an OAuth client of type "Web application" (configure the consent screen first if asked).
2. Add the authorised redirect URI `${PUBLIC_URL}/api/auth/google/callback`, for example `https://pm.example.com/api/auth/google/callback`. It must match `PUBLIC_URL` exactly, including scheme and port.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL` and restart.

Accounts are matched by Google account id, then by email. A workspace owner can add a member by email before that person has ever signed in; the placeholder account is linked on their first Google sign-in. Only verified Google emails are accepted.

Two-factor authentication (TOTP) is switched on per user in account settings. If someone loses their authenticator, an operator must clear it in the database:

```sql
UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE email = 'person@example.com';
```

## PostgreSQL

Set `DATABASE_URL=postgres://user:password@host:5432/dbname`. Migrations run at startup. The `pg` driver is loaded only when a Postgres URL is used. Run Intesa with a role that may create tables in its schema; there is no separate migration command.

## Tests

```sh
bun run test          # API tests on in-memory SQLite
bun run test:pg       # same suite on Postgres; set TEST_DATABASE_URL first
bun run test:e2e      # Playwright against the production build
bun run typecheck
bun run lint
```

`test:pg` drops and recreates the schema `intesa_test` in the database you point it at, for example
`TEST_DATABASE_URL=postgres://postgres:intesa@localhost:55432/intesa bun run test:pg`.

## Docker

```sh
docker build -t intesa .
docker run -d --name intesa -p 3000:3000 -v intesa-data:/data \
  -e PUBLIC_URL=https://pm.example.com \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  intesa
```

The image runs as an unprivileged user, keeps the SQLite database in the `/data` volume (`DATABASE_URL=/data/intesa.db`) and has a health check on `/api/health`, which also checks the database connection. The API is bundled into a single file, so the image holds only the Bun runtime, that file and the built client. Terminate TLS in front of it (a reverse proxy); the app itself speaks plain HTTP.

## Layout

- `apps/api`: Hono API, Kysely migrations, auth, tests (`apps/api/test`).
- `apps/web`: the single-page client.
- `e2e`: Playwright tests.
- `docs`: plan, design rules and architecture decision records.
