#!/bin/sh
#
# Deploy admin-password leak tests (T-0167). Shell-only, no dependencies
# beyond `sh` and `docker`.
#
# What it proves, with throwaway sentinel passwords (never real ones):
#
#   1. A fresh start registers the admin account (`ejabberdctl check_account`)
#      and the sentinel password appears NOWHERE in `docker logs` (stdout
#      and stderr) — the base image's REGISTER_ADMIN_PASSWORD mechanism
#      echoes `ejabberdctl register ... <password>` into the log, so our
#      entrypoint must never use it.
#   2. A restart with a different sentinel changes the password
#      (`ejabberdctl check_password` answers the new one, not the old) and
#      still leaks nothing.
#   3. Both compose files pass the admin password under the name the
#      entrypoint reads (EJABBERD_ADMIN_PASSWORD), never REGISTER_ADMIN_*,
#      and the Coolify file keeps SERVICE_PASSWORD_EJABBERDADMIN.
#
# The test builds the image from deploy/ and runs it against a throwaway
# Postgres container on its own network; everything is removed afterwards.
# The full run takes a few minutes (two ejabberd boots). If Docker is not
# available, the test skips with a clear message (exit 0).
#
# Usage: sh deploy/tests/admin-password-log.test.sh
# Exit 0 when every check passes (or Docker is missing), 1 on failure.
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

if ! command -v docker > /dev/null 2>&1 || ! docker info > /dev/null 2>&1; then
  echo "skip: Docker is not available, cannot run the admin-password container test"
  echo "---"
  echo "pass=0 fail=0 (skipped)"
  exit 0
fi

# The leak scan matches only log lines that carry the sentinel itself.
NET="t0167pwlog"
PG="t0167pwlog-pg"
EJ="t0167pwlog-ej"
IMAGE="zilar-ejabberd-adminpw-test:local"
cleanup() {
  docker rm -f "$EJ" "$PG" > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

start_stack() {
  _sentinel="$1"
  docker network create "$NET" > /dev/null 2>&1 || true
  docker run -d --name "$PG" --network "$NET" \
    -e POSTGRES_USER=ejabberd -e POSTGRES_PASSWORD=t0167sqlpw \
    -e POSTGRES_DB=ejabberd postgres:16-alpine > /dev/null
  for _i in $(seq 1 30); do
    if docker exec "$PG" pg_isready -U ejabberd > /dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  docker run -d --name "$EJ" --network "$NET" \
    -e EJABBERD_MACRO_HOST=pwlog.example \
    -e EJABBERD_MACRO_MUC_HOST=rooms.pwlog.example \
    -e EJABBERD_MACRO_ADMIN=admin@pwlog.example \
    -e EJABBERD_ADMIN_PASSWORD="$_sentinel" \
    -e EJABBERD_MACRO_SQL_SERVER="$PG" \
    -e EJABBERD_MACRO_SQL_DATABASE=ejabberd \
    -e EJABBERD_MACRO_SQL_USERNAME=ejabberd \
    -e EJABBERD_MACRO_SQL_PASSWORD=t0167sqlpw \
    -e EJABBERD_MACRO_PUSH_COMPONENT_SECRET=x \
    -e EJABBERD_MACRO_UPLOAD_URL=https://pwlog.example/upload \
    -e ZILAR_DOMAIN=pwlog.example \
    -e ZILAR_XMPP_JWT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    "$IMAGE" > /dev/null
}

# Assert the sentinel appears nowhere in the container log (stdout+stderr).
# Prints the offending lines to stderr when it fails.
assert_no_leak() {
  _sentinel="$1"
  _where="$2"
  if docker logs "$EJ" 2>&1 | grep -F -- "$_sentinel" > /tmp/t0167-leak.log 2> /dev/null; then
    bad "$_where: password appears in docker logs: $(head -n 1 /tmp/t0167-leak.log)"
  else
    ok "$_where: password is nowhere in docker logs"
  fi
  rm -f /tmp/t0167-leak.log
}

# Assert the account exists and the given password is the live one.
assert_account() {
  _password="$1"
  _where="$2"
  if docker exec "$EJ" ejabberdctl check_account admin pwlog.example > /dev/null 2>&1; then
    ok "$_where: admin account exists"
  else
    bad "$_where: admin account is missing"
  fi
  if docker exec "$EJ" ejabberdctl check_password admin pwlog.example "$_password" > /dev/null 2>&1; then
    ok "$_where: the expected password is the live one"
  else
    bad "$_where: the expected password does not authenticate"
  fi
}

echo "building the ejabberd image from deploy/"
if (cd "$ROOT" && docker build -f deploy/ejabberd/Dockerfile -t "$IMAGE" deploy/ > /dev/null 2>&1); then
  ok "ejabberd image builds"
else
  bad "ejabberd image does not build"
  echo "---"
  echo "pass=$PASS fail=$FAIL"
  exit 1
fi

SENTINEL_ONE="SENTINEL_ADMIN_PW_ONE_123"
SENTINEL_TWO="SENTINEL_ADMIN_PW_TWO_456"

# 1. Fresh start: account exists, sentinel nowhere in the logs.
start_stack "$SENTINEL_ONE"
echo "waiting for the first boot to register the admin account"
for _i in $(seq 1 60); do
  if docker exec "$EJ" ejabberdctl check_account admin pwlog.example > /dev/null 2>&1; then
    break
  fi
  sleep 5
done
# Give the server a few more seconds so any late log line is captured by
# the scan below instead of arriving after it.
sleep 10
assert_account "$SENTINEL_ONE" "fresh start"
assert_no_leak "$SENTINEL_ONE" "fresh start"
if docker logs "$EJ" 2>&1 | grep -q 'REGISTER_ADMIN_PASSWORD:'; then
  bad "fresh start: log mentions REGISTER_ADMIN_PASSWORD (the leaky path is in use)"
else
  ok "fresh start: log never mentions REGISTER_ADMIN_PASSWORD"
fi

# 2. Restart with a different sentinel: password changes, still no leak.
docker rm -f "$EJ" > /dev/null
docker run -d --name "$EJ" --network "$NET" \
  -e EJABBERD_MACRO_HOST=pwlog.example \
  -e EJABBERD_MACRO_MUC_HOST=rooms.pwlog.example \
  -e EJABBERD_MACRO_ADMIN=admin@pwlog.example \
  -e EJABBERD_ADMIN_PASSWORD="$SENTINEL_TWO" \
  -e EJABBERD_MACRO_SQL_SERVER="$PG" \
  -e EJABBERD_MACRO_SQL_DATABASE=ejabberd \
  -e EJABBERD_MACRO_SQL_USERNAME=ejabberd \
  -e EJABBERD_MACRO_SQL_PASSWORD=t0167sqlpw \
  -e EJABBERD_MACRO_PUSH_COMPONENT_SECRET=x \
  -e EJABBERD_MACRO_UPLOAD_URL=https://pwlog.example/upload \
  -e ZILAR_DOMAIN=pwlog.example \
  -e ZILAR_XMPP_JWT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  "$IMAGE" > /dev/null
echo "waiting for the restart to pick up the new password"
for _i in $(seq 1 60); do
  if docker exec "$EJ" ejabberdctl check_password admin pwlog.example "$SENTINEL_TWO" > /dev/null 2>&1; then
    break
  fi
  sleep 5
done
sleep 10
if docker exec "$EJ" ejabberdctl check_password admin pwlog.example "$SENTINEL_TWO" > /dev/null 2>&1; then
  ok "restart: the new password is the live one"
else
  bad "restart: the new password does not authenticate"
fi
if docker exec "$EJ" ejabberdctl check_password admin pwlog.example "$SENTINEL_ONE" > /dev/null 2>&1; then
  bad "restart: the old password still authenticates"
else
  ok "restart: the old password no longer authenticates"
fi
assert_no_leak "$SENTINEL_TWO" "restart"

# 3. Compose files wire the password under the entrypoint's name only.
for _file in "deploy/docker-compose.yml" "deploy/coolify/docker-compose.yml"; do
  if grep -q 'REGISTER_ADMIN_PASSWORD:' "$ROOT/$_file"; then
    bad "$_file still sets REGISTER_ADMIN_PASSWORD"
  else
    ok "$_file no longer sets REGISTER_ADMIN_PASSWORD"
  fi
done
if grep -q 'EJABBERD_ADMIN_PASSWORD' "$ROOT/deploy/docker-compose.yml"; then
  ok "plain compose passes EJABBERD_ADMIN_PASSWORD to ejabberd"
else
  bad "plain compose lost EJABBERD_ADMIN_PASSWORD for ejabberd"
fi
if grep -q 'SERVICE_PASSWORD_EJABBERDADMIN' "$ROOT/deploy/coolify/docker-compose.yml" \
  && grep -q 'EJABBERD_ADMIN_PASSWORD: ${SERVICE_PASSWORD_EJABBERDADMIN}' "$ROOT/deploy/coolify/docker-compose.yml"; then
  ok "coolify compose keeps SERVICE_PASSWORD_EJABBERDADMIN under EJABBERD_ADMIN_PASSWORD"
else
  bad "coolify compose no longer maps SERVICE_PASSWORD_EJABBERDADMIN to EJABBERD_ADMIN_PASSWORD"
fi

trap - EXIT INT TERM
cleanup
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
