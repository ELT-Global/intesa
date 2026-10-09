#!/usr/bin/env bash
# Checks that a built `intesa` runs: bash scripts/smoke.sh <command...>
# e.g. smoke.sh apps/cli/dist/intesa-linux-x64   or   smoke.sh bun apps/cli/dist/intesa.js
# Starts the API on an in-memory database and calls it through the CLI.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
port="${SMOKE_PORT:-38457}"
base="http://127.0.0.1:$port"

"$@" --version
"$@" schema >/dev/null

DATABASE_URL=:memory: DEV_LOGIN=true NODE_ENV=test PORT="$port" \
  bun "$repo/apps/api/src/index.ts" &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS "$base/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl -fsS "$base/api/health" >/dev/null || { echo "server did not become healthy" >&2; exit 1; }

config="$(mktemp -d)"
# No leading slash on the path: Git Bash on Windows would rewrite it into a drive path.
INTESA_HOST="$base" INTESA_CONFIG_DIR="$config" "$@" api health | grep -q '"ok":true'
echo "smoke ok"
