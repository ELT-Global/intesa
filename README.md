# Intesa

A small project management tool in the style of Linear, meant for one team of around eight developers who host it themselves. Workspaces contain projects, projects contain tasks (with one level of subtasks), and tasks carry a status, priority, due date, assignees, tags, blocking and related links, a status history and per-project custom fields. Sign-in is Google only (plus optional TOTP two-factor); there are no passwords.

What it deliberately does not do: no email or notifications, no comments or file attachments, no real-time updates (a second browser sees changes on its next fetch), no reordering of board cards on touch screens (drag and drop or Alt+ArrowUp/Down only), no billing, no audit log beyond task status history, and no sign-in methods other than Google. It is one service, one database, and has not been load tested beyond a few thousand tasks per workspace.

Stack: Bun, Hono, Kysely (SQLite by default, PostgreSQL supported), a TanStack Start single-page client built with Vite, Playwright for end-to-end tests.

## Quick start

Requires [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
DEV_LOGIN=true bun run dev
```

Settings can also live in files: copy `apps/api/.env.example` to `apps/api/.env` (and, only if the API is not on port 3000, `apps/web/.env.example` to `apps/web/.env`). Bun reads `apps/api/.env` automatically because the dev, start and test scripts run inside `apps/api`; variables set in the shell win over the file, and the dev script always sets `NODE_ENV=development`.

The web client is on <http://localhost:5173> and proxies `/api` to the API on port 3000. With `DEV_LOGIN=true` (and `NODE_ENV` not `production`) the login page offers an email-only sign-in that creates the account on the fly, so you do not need Google credentials to try it. The SQLite file is created at `data/intesa.db` in the repository root (git-ignored), whichever directory you start from.

To run the production build on one port:

```sh
bun run build
NODE_ENV=production PUBLIC_URL=http://localhost:3000 bun run start
```

## Configuration

All settings come from environment variables (see `apps/api/.env.example`; copy it to `apps/api/.env`, which Bun loads automatically, or set them in the shell).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port for the API and the built client. |
| `NODE_ENV` | `production` when unset | `development`, `production` or `test`. Anything other than `production` allows the dev login. In `development` the API does not serve the client (Vite does). |
| `DATABASE_URL` | `<repo root>/data/intesa.db` | SQLite file path (the directory is created; a relative path is relative to the directory you start the process in), `:memory:`, or a `postgres://` URL. |
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
docker build -f Dockerfile.coolify -t intesa .
docker run -d --name intesa --init -p 5580:5580 -v intesa-data:/data \
  -e PUBLIC_URL=https://pm.example.com \
  -e GOOGLE_CLIENT_ID=... -e GOOGLE_CLIENT_SECRET=... \
  intesa
```

The image runs as an unprivileged user, keeps the SQLite database in the `/data` volume (`DATABASE_URL=/data/intesa.db`) and listens on port 5580 (`PORT`) and has a health check on `/api/health`, which also checks the database connection. One container serves both the API (`/api/*`) and the built client. The API is bundled into a single file, so the image holds only the Bun runtime, that file and the built client. Terminate TLS in front of it (a reverse proxy); the app itself speaks plain HTTP.

Things to know when running the container:

- It runs in production mode, where the dev login is disabled, so Google sign-in must be configured (`PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) or nobody can sign in. The first person to sign in has no workspace yet and creates one.
- Use `--init` so signals reach the server and it can shut down cleanly: it closes the database and exits within about 8 seconds, inside Docker's default 10-second stop timeout.
- With a bind mount instead of a named volume (`-v /srv/intesa:/data`), the directory must be writable by the image's `bun` user (uid 1000): `chown 1000:1000 /srv/intesa`, or run with `--user` set to the directory's owner.

## Deploy on Coolify

Two ways; the Docker Compose one is the simpler.

**Docker Compose build pack (uses `coolify.compose.yaml`)**

1. In Coolify: New Resource, choose the Git repository, set the build pack to Docker Compose (Base Directory `/`, compose file `/coolify.compose.yaml`).
2. Create a Google OAuth client first (see "Google sign-in") and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the resource's Environment Variables. Both are required (nobody can sign in without them); mark them runtime only by unticking "Available at Buildtime".
3. Optionally set a domain for the `intesa` service (Configuration, Domains). If you leave it, Coolify generates one. Set `PUBLIC_URL` in the resource's Environment Variables to that domain's full `https://` URL (for example `https://intesa.eltglobal.xyz`). If you change the domain later, update `PUBLIC_URL` and redeploy.
4. In the Google console, add the authorised redirect URI `<the service URL>/api/auth/google/callback` (for example `https://pm.example.com/api/auth/google/callback`). If you let Coolify generate the domain, deploy once, copy the domain from the Configuration page, register the URI, then try signing in.
5. Deploy. The first person to sign in creates a workspace.

To use PostgreSQL instead of SQLite, uncomment the `postgres` service, the `depends_on` block and the `intesa-pg` volume in `coolify.compose.yaml`, and replace the `DATABASE_URL` line of the `intesa` service with `DATABASE_URL=postgres://intesa:${SERVICE_PASSWORD_POSTGRES}@postgres:5432/intesa` (Coolify generates the password and uses it for both services, so no manual URL is needed).

**Dockerfile build pack**

Choose Dockerfile as the build pack, with Dockerfile location `/Dockerfile.coolify`, and set: port exposed `5580`, health check path `/api/health` (HTTP, port 5580), and a persistent storage mount at `/data`. Add the environment variables from the table above: `PUBLIC_URL` (the full `https://` URL of the domain you assign), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `DATABASE_URL`. `NODE_ENV`, `PORT` and the default `DATABASE_URL=/data/intesa.db` are already set in the image.

**Backups.** With SQLite, everything lives in the `intesa-data` volume (`intesa.db` plus `-wal` and `-shm` files), and Coolify does not back up volumes for you. Copying the live files can capture a half-written state; make a consistent copy first, then back up that file:

```sh
docker exec <container> bun -e "new (require('bun:sqlite').Database)('/data/intesa.db').run(\"VACUUM INTO '/data/backup.db'\")"
```

(`docker volume ls` shows the volume name, which Coolify prefixes with the resource id.) With PostgreSQL, use Coolify's database backups or `pg_dump`.

## Logging

The server logs startup and shutdown, and requests only when they fail: a response with status 500 or above produces one JSON error line with method, path (no query string), status and duration. There are no access logs, and request bodies, headers and cookies are never logged.

## Layout

- `apps/api`: Hono API, Kysely migrations, auth, tests (`apps/api/test`).
- `apps/web`: the single-page client.
- `e2e`: Playwright tests.
