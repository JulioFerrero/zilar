#!/bin/sh
#
# Deploy connection-resilience tests (T-0174). Shell-only, no dependencies
# beyond `sh` and `grep`.
#
# What it proves, without touching the lead's running dev stack:
#
#   1. The production ejabberd.yml sends pings on idle connections
#      (send_pings, 60 s interval) without ever killing a session from the
#      server side (timeout_action none: the client detects a dead
#      connection itself and reconnects).
#
# Usage: sh deploy/tests/connection-resilience.test.sh
# Exit 0 when every check passes, 1 on the first failure.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONFIG="$ROOT/deploy/ejabberd/ejabberd.yml"
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

# The mod_ping block: indented under `modules:` like its neighbours.
if grep -q "^  mod_ping:" "$CONFIG"; then
  ok "mod_ping block is present"
else
  bad "mod_ping block is missing"
fi

if grep -q "^    send_pings: true" "$CONFIG"; then
  ok "mod_ping sends pings on idle connections"
else
  bad "mod_ping does not send pings (send_pings: true missing)"
fi

if grep -q "^    ping_interval: 60" "$CONFIG"; then
  ok "mod_ping pings every 60 s"
else
  bad "mod_ping ping_interval is not 60"
fi

# Traffic only: the server must never kill a session; the client reconnects.
if grep -q "^    timeout_action: none" "$CONFIG"; then
  ok "mod_ping never kills a session (timeout_action none)"
else
  bad "mod_ping timeout_action is not none"
fi

echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
