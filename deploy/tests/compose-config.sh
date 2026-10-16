#!/bin/sh
#
# Deploy compose-config check (T-1644, audit OPS-12). Renders every compose file
# with a throwaway env file, so a broken compose fails CI before it reaches a
# server. Shell-only and offline: `docker compose config` parses and interpolates
# without a Docker daemon and without network.
#
# Usage: sh deploy/tests/compose-config.sh
# Exit 0 when all four files render, 1 on the first failure (naming the file).
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

# A throwaway env file: every `${VAR:?}` variable found in the four compose files
# gets a dummy value. ZILAR_DOMAIN feeds URLs, so it gets a domain-looking value;
# the rest are secrets, so `x` is enough.
ENV_DIR="$(mktemp -d)"
trap 'rm -rf "$ENV_DIR"' EXIT
ENV_FILE="$ENV_DIR/compose.env"

_vars="$(
  grep -ohE '\$\{[A-Za-z_][A-Za-z0-9_]*:\?' \
    "$ROOT/deploy/docker-compose.yml" \
    "$ROOT/deploy/coolify/docker-compose.yml" \
    "$ROOT/deploy/coolify/docker-compose.app.yml" \
    "$ROOT/deploy/coolify/zilar-core.yml" |
    sed -e 's/^\${//' -e 's/:?$//' | sort -u
)"
: > "$ENV_FILE"
for _var in $_vars; do
  case "$_var" in
  ZILAR_DOMAIN) _value="example.test" ;;
  *) _value="x" ;;
  esac
  printf '%s=%s\n' "$_var" "$_value" >> "$ENV_FILE"
done

cd "$ROOT"

# FILE PROJECT_DIR — render one file; the app compose's build contexts are
# relative to the repo root (matching Coolify), the other three default to the
# directory of their own file.
render() {
  if [ -n "$2" ]; then
    docker compose --project-directory "$2" -f "$1" --env-file "$ENV_FILE" config -q
  else
    docker compose -f "$1" --env-file "$ENV_FILE" config -q
  fi
}

for _file in \
  deploy/docker-compose.yml \
  deploy/coolify/docker-compose.yml \
  deploy/coolify/docker-compose.app.yml \
  deploy/coolify/zilar-core.yml; do
  if [ "$_file" = "deploy/coolify/docker-compose.app.yml" ]; then
    _project_dir="."
  else
    _project_dir=""
  fi
  if render "$_file" "$_project_dir" 2>"$ENV_DIR/err"; then
    echo "ok: $_file renders with a throwaway env file"
  else
    echo "FAIL: $_file does not render:" >&2
    sed 's/^/  /' "$ENV_DIR/err" >&2
    exit 1
  fi
done
