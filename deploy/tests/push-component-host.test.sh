#!/bin/sh
#
# Push component host wiring tests (T-0172). Shell-only, no docker: it
# greps the raw compose files so it runs anywhere, including machines
# busy with emulator builds where docker is off limits.
#
# What it proves:
#   1. Both compose files set PUSH_COMPONENT_HOST=ejabberd on the server
#      service (a grep under the `server:` block, so a stray mention in a
#      comment cannot pass).
#   2. The value is exactly `ejabberd` — not 127.0.0.1, which is the
#      server container itself in a compose install (T-0159 §3).
#
# Usage: sh deploy/tests/push-component-host.test.sh
# Exit 0 when every check passes, 1 on the first failure.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
PASS=0
FAIL=0

ok() {
  PASS=$((PASS + 1))
  echo "ok: $1"
}

bad() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $1" >&2
}

for _file in "deploy/docker-compose.yml" "deploy/coolify/docker-compose.yml"; do
  _server_block="$(awk 'f && /^  [a-zA-Z]+:/ { exit } /^  server:/ { f=1; next } f' "$ROOT/$_file")"
  _host_line="$(printf '%s\n' "$_server_block" | grep -E "^[[:space:]]+PUSH_COMPONENT_HOST:" || true)"
  if [ -z "$_host_line" ]; then
    bad "$_file: server service sets no PUSH_COMPONENT_HOST"
  elif printf '%s\n' "$_host_line" | grep -q "^[[:space:]]*PUSH_COMPONENT_HOST: ejabberd"; then
    ok "$_file: server service sets PUSH_COMPONENT_HOST=ejabberd"
  else
    bad "$_file: PUSH_COMPONENT_HOST is not ejabberd (got: $_host_line)"
  fi
done

echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
