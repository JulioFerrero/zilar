#!/bin/sh
#
# Coolify-mode tests (T-1588). Shell-only and offline, with a stub `curl` that
# records every call and answers canned JSON, so no test touches a Coolify, a
# host, Docker or the network. Needs `sh`, `jq` and `openssl` (the flow needs
# both on a real host too).
#
# What it proves:
#   1. the happy path makes exactly the calls, in the order, the layout needs:
#      GET /version, /servers, its /destinations, /projects; POST /projects,
#      /services;
#      PATCH the service and its envs; POST /deploy; POST the server App (routes
#      `/api` and `/health`), its two storages and its envs; POST /deploy; POST
#      the web App; POST /deploy; then the public /health wait;
#   2. an existing Zilar project that holds zilar-core stops with the
#      "already installed" message and makes no POST;
#   3. a 401 on GET /version stops with "the token was refused";
#   4. the token never reaches the recorded argv, stdout or stderr (it travels
#      only in a root-only file that curl reads with `-H @file`);
#   5. --dry-run prints the calls and makes none;
#   6. a server with two destinations deploys with destination_uuid, one with a
#      single destination does not;
#   7. every docker call runs through $SUDO, so a non-root install works;
#   8. a missing zilar-server container prints the manual invite command, never
#      a rerun (a rerun would stop at "already installed");
#   9. a failed call never echoes its body: a 422 on envs/bulk that quotes a
#      submitted secret prints the method, the path and the code only;
#  10. the version check compares major and minor as numbers (4.10 > 4.4 > 4.3).
#
# The flow runs in a child `sh` (see $T/flow): install.sh runs it under `set -e`,
# so a stop must end the script, and a subshell in an && / || list would drop -e.
#
# Usage: sh deploy/tests/coolify-mode.test.sh
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

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT INT TERM

# --- the stub curl, tee and docker --------------------------------------

# curl -sS -o FILE -w '%{http_code}' -X METHOD [--data @FILE] URL: record the
# raw argv (so a token in it would show) and the call, write the canned body to
# -o, and print the code for -w. A FAIL_URL turns into its FAIL_CODE; when the
# call carried a --data body, the failure body quotes it back, the way Coolify
# can echo a rejected value.
BIN="$T/bin"
mkdir -p "$BIN" "$T/state" "$T/secrets"
cat >"$BIN/curl" <<'STUB'
#!/bin/sh
printf 'ARGV %s\n' "$*" >>"$ZILAR_TEST_CURL_LOG"
method="GET"; out=""; url=""; writefmt=""; datafile=""; prev=""
for a in "$@"; do
  case "$prev" in
    -X) method="$a" ;;
    -o) out="$a" ;;
    -w) writefmt="$a" ;;
    --data) datafile="$a" ;;
  esac
  case "$a" in http://*|https://*) url="$a" ;; esac
  prev="$a"
done
printf 'CALL %s %s\n' "$method" "$url" >>"$ZILAR_TEST_CURL_LOG"
case "$url" in
  */envs/bulk) printf 'BODY %s %s\n' "$url" "$(tr -d '\n' <"${datafile#@}")" >>"$ZILAR_TEST_CURL_LOG" ;;
  */api/v1/services)
    [ "$method" = "POST" ] && printf 'BODY %s\n' "$(tr -d '\n' <"${datafile#@}")" >>"$ZILAR_TEST_CURL_LOG" ;;
  */api/v1/applications/dockerimage)
    [ "$method" = "POST" ] && printf 'BODY %s %s\n' "$url" "$(tr -d '\n' <"${datafile#@}")" >>"$ZILAR_TEST_CURL_LOG" ;;
esac
code=200
case "$url" in
  */api/v1/version) body="${ZILAR_TEST_VERSION:-4.4.6}" ;;
  */api/v1/servers/*/destinations) body="${ZILAR_TEST_DESTINATIONS:-[]}" ;;
  */api/v1/servers) body='[{"name":"localhost","ip":"host.docker.internal","uuid":"srv-1"}]' ;;
  */api/v1/projects)
    if [ "$method" = "POST" ]; then body='{"uuid":"proj-1"}'; else body="${ZILAR_TEST_PROJECTS:-[]}"; fi ;;
  */api/v1/services/*/envs/bulk) body='{}' ;;
  */api/v1/services)
    if [ "$method" = "POST" ]; then body='{"uuid":"core-1"}'; else body='{}'; fi ;;
  */api/v1/services/*) body='{}' ;;
  */api/v1/applications/dockerimage)
    n="$(cat "$ZILAR_TEST_STATE/appcount" 2>/dev/null || echo 0)"
    n=$((n + 1)); printf '%s' "$n" >"$ZILAR_TEST_STATE/appcount"
    if [ "$n" -eq 1 ]; then body='{"uuid":"app-1"}'; else body='{"uuid":"app-2"}'; fi ;;
  */api/v1/applications/*/storages) body='{"uuid":"vol-1"}' ;;
  */api/v1/applications/*/envs/bulk) body='{}' ;;
  */api/v1/deploy*) body='{"deployments":[{"deployment_uuid":"dep-1"}]}' ;;
  */health) body='{"ok":true,"db":"ok","ejabberd":"ok","push":"off"}' ;;
  *) body='{}' ;;
esac
if [ -n "${ZILAR_TEST_FAIL_URL:-}" ] && [ "$url" = "$ZILAR_TEST_FAIL_URL" ]; then
  code="${ZILAR_TEST_FAIL_CODE:-500}"
  if [ -n "${datafile:-}" ] && [ -f "${datafile#@}" ]; then
    body="$(jq -nc --arg v "$(cat "${datafile#@}")" '{message: ("invalid value: " + $v)}')"
  else
    body='{"message":"refused"}'
  fi
fi
if [ -n "$out" ]; then printf '%s' "$body" >"$out"; else printf '%s' "$body"; fi
if [ -n "$writefmt" ]; then printf '%s' "$code"; fi
exit 0
STUB
# tee: the secrets copy goes to /root on a real host; here it lands in $T.
cat >"$BIN/tee" <<'STUB'
#!/bin/sh
args=""
for a in "$@"; do
  case "$a" in /root/*) a="$ZILAR_TEST_SECRETS_DIR/${a#/root/}" ;; esac
  args="$args $a"
done
# shellcheck disable=SC2086
exec /usr/bin/tee $args
STUB
cat >"$BIN/docker" <<'STUB'
#!/bin/sh
printf 'DOCKER %s\n' "$*" >>"${ZILAR_TEST_DOCKER_LOG:-/dev/null}"
case "$1" in
  ps) [ "${ZILAR_TEST_NO_CONTAINER:-0}" = "1" ] || echo "zilar-server-abc-123" ;;
  exec) echo "INVITE-CODE-1234" ;;
  image) echo "ghcr.io/julioferrero/zilar-desk@sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0" ;;
esac
exit 0
STUB
# sudo: log the call (so a bare `docker` shows up as a bypass) and run it, the
# way a non-root install needs `$SUDO docker`.
cat >"$BIN/sudo" <<'STUB'
#!/bin/sh
printf 'SUDO %s\n' "$*" >>"${ZILAR_TEST_SUDO_LOG:-/dev/null}"
exec "$@"
STUB
# chmod: /root lives in $T on a real host; remap it like the tee stub, so the
# flow's root-only checks can run without root.
cat >"$BIN/chmod" <<'STUB'
#!/bin/sh
args=""
for a in "$@"; do
  case "$a" in /root/*) a="$ZILAR_TEST_SECRETS_DIR/${a#/root/}" ;; esac
  args="$args $a"
done
# shellcheck disable=SC2086
exec /bin/chmod $args
STUB
chmod +x "$BIN/curl" "$BIN/tee" "$BIN/docker" "$BIN/chmod" "$BIN/sudo"

export PATH="$BIN:$PATH"
export ZILAR_TEST_CURL_LOG="$T/calls.log" ZILAR_TEST_STATE="$T/state"
export ZILAR_TEST_SECRETS_DIR="$T/secrets" ZILAR_TEST_ROOT="$ROOT" ZILAR_TEST_TMP="$T"
export ZILAR_TEST_SUDO_LOG="$T/sudo.log" ZILAR_TEST_DOCKER_LOG="$T/docker.log"
export ZILAR_COOLIFY_TOKEN="T-1588-SENTINEL-TOKEN"
: >"$ZILAR_TEST_CURL_LOG"

# --- the flow runner ----------------------------------------------------

# install.sh's globals and helpers, then the two libraries and coolify_run, in a
# child `sh` with `set -eu` so a stop really ends the run.
cat >"$T/flow" <<'RUN'
#!/bin/sh
set -eu
DRY_RUN="${DRY_RUN:-0}"
YES=1; DESKS=0; SUDO=""
DOMAIN="chat.example.com"; ADMIN_EMAIL="ops@example.com"
VERSION="main"; IMAGE_OWNER="julioferrero"
_root="$ZILAR_TEST_ROOT"; _tmp="$ZILAR_TEST_TMP"
die() { echo "test-die: $*" >&2; exit 1; }
info() { echo "test-info: $*"; }
warn() { echo "test-warn: $*" >&2; }
phase() { printf '==> %s\n' "$1"; }
ask() { printf '%s' "${2-}"; }
consent() { return 0; }
run() { "$@"; }
desk_sandbox() { DESK_SANDBOX_ERR="test"; return 1; }
. "$ZILAR_TEST_ROOT/deploy/lib/coolify-api.sh"
. "$ZILAR_TEST_ROOT/deploy/lib/coolify-mode.sh"
coolify_run
RUN
chmod +x "$T/flow"

# The same flow with SUDO=sudo, DESKS=1 and a passing sandbox, so the desks
# path runs (it uses `$SUDO docker`); `run` only logs, so the stub zilar never
# really runs host-setup. Used by the $SUDO test below.
cat >"$T/flow-sudo" <<'RUN'
#!/bin/sh
set -eu
DRY_RUN=0
YES=1; DESKS=1; SUDO="sudo"
DOMAIN="chat.example.com"; ADMIN_EMAIL="ops@example.com"
VERSION="main"; IMAGE_OWNER="julioferrero"
_root="$ZILAR_TEST_ROOT"; _tmp="$ZILAR_TEST_TMP"
die() { echo "test-die: $*" >&2; exit 1; }
info() { echo "test-info: $*"; }
warn() { echo "test-warn: $*" >&2; }
phase() { printf '==> %s\n' "$1"; }
ask() { printf '%s' "${2-}"; }
consent() { return 0; }
run() { echo "test-run: $*" >&2; }
desk_sandbox() { return 0; }
. "$ZILAR_TEST_ROOT/deploy/lib/coolify-api.sh"
. "$ZILAR_TEST_ROOT/deploy/lib/coolify-mode.sh"
coolify_run
RUN
chmod +x "$T/flow-sudo"

flow_run() { sh "$T/flow"; }

DRY_RUN=0
export DRY_RUN

# --- 1. the happy path: the calls, in order -----------------------------

status=0
flow_run >"$T/happy.out" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  ok "the happy path exits 0"
else
  bad "the happy path failed ($(tail -n 1 "$T/happy.out"))"
fi

cat >"$T/expected" <<'EOF'
GET http://localhost:8000/api/v1/version
GET http://localhost:8000/api/v1/servers
GET http://localhost:8000/api/v1/servers/srv-1/destinations
GET http://localhost:8000/api/v1/projects
POST http://localhost:8000/api/v1/projects
POST http://localhost:8000/api/v1/services
PATCH http://localhost:8000/api/v1/services/core-1
PATCH http://localhost:8000/api/v1/services/core-1/envs/bulk
POST http://localhost:8000/api/v1/deploy?uuid=core-1
POST http://localhost:8000/api/v1/applications/dockerimage
POST http://localhost:8000/api/v1/applications/app-1/storages
POST http://localhost:8000/api/v1/applications/app-1/storages
PATCH http://localhost:8000/api/v1/applications/app-1/envs/bulk
POST http://localhost:8000/api/v1/deploy?uuid=app-1
POST http://localhost:8000/api/v1/applications/dockerimage
POST http://localhost:8000/api/v1/deploy?uuid=app-2
GET https://chat.example.com/health
EOF
sed -n 's/^CALL //p' "$ZILAR_TEST_CURL_LOG" >"$T/actual"
if diff -u "$T/expected" "$T/actual" >"$T/order.diff" 2>&1; then
  ok "the calls are made in the layout's order ($(wc -l <"$T/actual" | tr -d ' ') calls)"
else
  bad "the call order differs: $(head -n 6 "$T/order.diff" | tr '\n' ' ')"
fi

# The envs/bulk bodies carry the variables, not an empty or malformed array.
if grep -qF '"key":"POSTGRES_PASSWORD"' "$ZILAR_TEST_CURL_LOG" &&
  grep -qF '"key":"DATABASE_URL"' "$ZILAR_TEST_CURL_LOG" &&
  grep -qF '"key":"ZILAR_DOMAIN","value":"chat.example.com"' "$ZILAR_TEST_CURL_LOG" &&
  grep -qF '"is_literal":true' "$ZILAR_TEST_CURL_LOG"; then
  ok "the core and server variables travel in the envs/bulk bodies"
else
  bad "an envs/bulk body is missing its variables ($(grep '^BODY' "$ZILAR_TEST_CURL_LOG" | cut -c1-60 | head -n 2 | tr '\n' ' '))"
fi

# The server App is created with both routes: /api and the public /health the
# install wait polls, so /health reaches the server and not the web App.
if grep -qF '"domains":"https://chat.example.com/api,https://chat.example.com/health"' "$ZILAR_TEST_CURL_LOG"; then
  ok "zilar-server is created with both /api and /health routes"
else
  bad "the zilar-server create body is missing a route ($(grep -F 'BODY http://localhost:8000/api/v1/applications/dockerimage ' "$ZILAR_TEST_CURL_LOG" | head -n 1 | cut -c1-100))"
fi

if grep -qF "sign up with ops@example.com" "$T/happy.out" && grep -qF "INVITE-CODE-1234" "$T/happy.out"; then
  ok "the first invite is minted and the sign-up line printed"
else
  bad "the first-invite step is missing ($(tail -n 2 "$T/happy.out" | tr '\n' ' '))"
fi
_secrets="$T/secrets/zilar-secrets-$(date +%Y%m%d).env"
if [ -f "$_secrets" ] && grep -q '^BETTER_AUTH_SECRET=' "$_secrets" &&
  grep -q '^ZILAR_DOMAIN=chat.example.com$' "$_secrets"; then
  ok "the root-only secrets copy holds every generated value"
else
  bad "the secrets copy is missing or incomplete"
fi
if [ -f "$_secrets" ] && [ "$(ls -l "$_secrets" | cut -c1-10)" = "-rw-------" ]; then
  ok "the secrets copy is root-only (mode 600)"
else
  bad "the secrets copy is not mode 600 ($(ls -l "$_secrets" 2>/dev/null | cut -c1-10))"
fi
if find "$T" -name 'request.*' -type f 2>/dev/null | grep -q .; then
  bad "request-body temp files (holding the generated secrets) were left behind"
else
  ok "no request-body temp files are left behind after the run"
fi

# --- 2. the token never shows -------------------------------------------

if grep -q "T-1588-SENTINEL-TOKEN" "$ZILAR_TEST_CURL_LOG"; then
  bad "the token reached curl's argv"
else
  ok "the token never reaches curl's argv"
fi
if grep -q "T-1588-SENTINEL-TOKEN" "$T/happy.out"; then
  bad "the token reached stdout/stderr"
else
  ok "the token never reaches stdout or stderr"
fi
_token_file="$(find "$T" -name token -type f 2>/dev/null | head -n 1)"
if [ -n "$_token_file" ] && grep -qF "T-1588-SENTINEL-TOKEN" "$_token_file"; then
  ok "the token travels in a file that curl reads with -H @file"
else
  bad "no token file was written"
fi
if [ -n "$_token_file" ] && [ "$(ls -l "$_token_file" | cut -c1-10)" = "-rw-------" ]; then
  ok "the token file is root-only (mode 600)"
else
  bad "the token file is not mode 600 ($(ls -l "${_token_file:?}" 2>/dev/null | cut -c1-10))"
fi

# --- 3. already installed: no POST --------------------------------------

: >"$ZILAR_TEST_CURL_LOG"
ZILAR_TEST_PROJECTS='[{"uuid":"proj-1","name":"Zilar","services":[{"name":"zilar-core"}]}]'
export ZILAR_TEST_PROJECTS
status=0
flow_run >"$T/installed.out" 2>&1 || status=$?
unset ZILAR_TEST_PROJECTS
if [ "$status" -ne 0 ] && grep -qF "Zilar is already installed in Coolify" "$T/installed.out"; then
  ok "an existing zilar-core stops with the 'already installed' message"
else
  bad "an existing zilar-core did not stop ($(tail -n 1 "$T/installed.out"))"
fi
if grep -q '^CALL POST ' "$ZILAR_TEST_CURL_LOG"; then
  bad "the 'already installed' path made a POST"
else
  ok "the 'already installed' path changes nothing (no POST)"
fi

# --- 4. a refused token stops -------------------------------------------

: >"$ZILAR_TEST_CURL_LOG"
ZILAR_TEST_FAIL_URL="http://localhost:8000/api/v1/version"
ZILAR_TEST_FAIL_CODE=401
export ZILAR_TEST_FAIL_URL ZILAR_TEST_FAIL_CODE
status=0
flow_run >"$T/refused.out" 2>&1 || status=$?
unset ZILAR_TEST_FAIL_URL ZILAR_TEST_FAIL_CODE
if [ "$status" -ne 0 ] && grep -qF "the token was refused" "$T/refused.out"; then
  ok "a 401 stops with 'the token was refused'"
else
  bad "a 401 did not stop with the refused message ($(tail -n 1 "$T/refused.out"))"
fi

# --- 5. --dry-run makes no calls ----------------------------------------

: >"$ZILAR_TEST_CURL_LOG"
DRY_RUN=1
status=0
flow_run >"$T/dry.out" 2>&1 || status=$?
DRY_RUN=0
if [ "$status" -eq 0 ]; then
  ok "--dry-run exits 0"
else
  bad "--dry-run failed ($(tail -n 1 "$T/dry.out"))"
fi
if [ -s "$ZILAR_TEST_CURL_LOG" ]; then
  bad "--dry-run made a call: $(head -n 1 "$ZILAR_TEST_CURL_LOG")"
else
  ok "--dry-run makes no HTTP call"
fi
if grep -qF "POST /services" "$T/dry.out" && grep -qF "POST /applications/dockerimage" "$T/dry.out" &&
  grep -qF "PATCH /services/<core-uuid>/envs/bulk" "$T/dry.out"; then
  ok "--dry-run prints the API calls it would make"
else
  bad "--dry-run does not print the calls ($(head -n 3 "$T/dry.out" | tr '\n' ' '))"
fi
if grep -qi "T-1588-SENTINEL-TOKEN" "$T/dry.out"; then
  bad "--dry-run printed a token"
else
  ok "--dry-run reads and prints no token"
fi

# --- 6. destinations: ask the endpoint, pass a uuid only when needed ----

# GET /servers does not embed a server's destinations, so the flow asks the
# endpoint. More than one destination must reach the create-service body as
# destination_uuid; a single destination needs none.
: >"$ZILAR_TEST_CURL_LOG"
ZILAR_TEST_DESTINATIONS='[{"uuid":"dest-1"},{"uuid":"dest-2"}]'
export ZILAR_TEST_DESTINATIONS
status=0
flow_run >"$T/multidest.out" 2>&1 || status=$?
unset ZILAR_TEST_DESTINATIONS
if [ "$status" -eq 0 ] && grep -qF '"destination_uuid":"dest-1"' "$ZILAR_TEST_CURL_LOG"; then
  ok "a multi-destination server deploys with destination_uuid set"
else
  bad "a multi-destination server did not set destination_uuid ($(tail -n 1 "$T/multidest.out"))"
fi
: >"$ZILAR_TEST_CURL_LOG"
ZILAR_TEST_DESTINATIONS='[{"uuid":"dest-1"}]'
export ZILAR_TEST_DESTINATIONS
status=0
flow_run >"$T/onedest.out" 2>&1 || status=$?
unset ZILAR_TEST_DESTINATIONS
if [ "$status" -eq 0 ] && ! grep -qF 'destination_uuid' "$ZILAR_TEST_CURL_LOG"; then
  ok "a single-destination server deploys without destination_uuid"
else
  bad "a single-destination server still sent destination_uuid ($(tail -n 1 "$T/onedest.out"))"
fi

# --- 7. every docker call runs through $SUDO -----------------------------

# A non-root install uses sudo, so a bare `docker` fails with permission denied
# while the same flow's other host steps are prefixed. Run the desks path with
# SUDO=sudo and a stub sudo: every docker invocation (pull, image inspect, ps,
# exec) must appear in sudo's log. A bare `docker` would bypass it.
: >"$ZILAR_TEST_SUDO_LOG"; : >"$ZILAR_TEST_DOCKER_LOG"
status=0
sh "$T/flow-sudo" >"$T/sudo.out" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  ok "the desks path runs with SUDO=sudo"
else
  bad "the desks path failed with SUDO=sudo ($(tail -n 1 "$T/sudo.out"))"
fi
if grep -qF 'docker pull' "$ZILAR_TEST_SUDO_LOG" &&
  grep -qF 'docker image inspect' "$ZILAR_TEST_SUDO_LOG" &&
  grep -qF 'docker ps' "$ZILAR_TEST_SUDO_LOG" &&
  grep -qF 'docker exec' "$ZILAR_TEST_SUDO_LOG"; then
  ok "every docker call (pull, image inspect, ps, exec) runs through \$SUDO"
else
  bad "a docker call bypassed \$SUDO ($(tr '\n' ' ' <"$ZILAR_TEST_SUDO_LOG"))"
fi

# --- 8. a missing zilar-server names the manual invite command ----------

# Any invite failure happens after the layout exists, so a rerun would hit the
# "already installed" stop and never mint the invite. The stop must print the
# manual `docker exec ... invite-cli.ts` command instead of advising a rerun.
: >"$ZILAR_TEST_CURL_LOG"
ZILAR_TEST_NO_CONTAINER=1
export ZILAR_TEST_NO_CONTAINER
status=0
flow_run >"$T/nocontainer.out" 2>&1 || status=$?
unset ZILAR_TEST_NO_CONTAINER
if [ "$status" -ne 0 ] &&
  grep -qF "invite-cli.ts --uses 1 --days 7" "$T/nocontainer.out" &&
  ! grep -qF "run this installer again" "$T/nocontainer.out"; then
  ok "a missing zilar-server prints the manual invite command, not a rerun"
else
  bad "the missing-container stop still advises a rerun ($(tail -n 1 "$T/nocontainer.out"))"
fi

# --- 9. a failed call never echoes its body -----------------------------

# Coolify can quote a rejected value back. A 422 on envs/bulk whose body carries
# the generated secret must print the method, the path and the code only, never
# the body. The stub echoes the request body it received in the failure
# `message`; the secret is read back from the recorded request body.
: >"$ZILAR_TEST_CURL_LOG"
ZILAR_TEST_FAIL_URL="http://localhost:8000/api/v1/services/core-1/envs/bulk"
ZILAR_TEST_FAIL_CODE=422
export ZILAR_TEST_FAIL_URL ZILAR_TEST_FAIL_CODE
status=0
flow_run >"$T/leak.out" 2>&1 || status=$?
unset ZILAR_TEST_FAIL_URL ZILAR_TEST_FAIL_CODE
_secret="$(grep -F 'BODY http://localhost:8000/api/v1/services/core-1/envs/bulk ' "$ZILAR_TEST_CURL_LOG" \
  | head -n 1 | sed 's/^BODY [^ ]* //' \
  | jq -r '.data[] | select(.key == "POSTGRES_PASSWORD") | .value' 2>/dev/null || true)"
if [ "$status" -ne 0 ] && [ -n "$_secret" ] &&
  ! grep -qF "$_secret" "$T/leak.out" &&
  grep -qF "HTTP 422 for PATCH /services/core-1/envs/bulk" "$T/leak.out"; then
  ok "a 422 on envs/bulk prints the code and path, never the echoed secret"
else
  bad "the envs/bulk error leaked its body or missed the code/path ($(tail -n 1 "$T/leak.out"))"
fi

# --- 10. the version check compares major and minor as numbers -----------

# 4.10 is newer than 4.4 (a version-glob would warn on it); 4.3.x is older.
for _case in "4.10.0:0" "4.3.9:1"; do
  _v="${_case%%:*}"; _want="${_case##*:}"
  : >"$ZILAR_TEST_CURL_LOG"
  ZILAR_TEST_VERSION="$_v"
  export ZILAR_TEST_VERSION
  status=0
  flow_run >"$T/version.out" 2>&1 || status=$?
  unset ZILAR_TEST_VERSION
  if grep -qF "older than 4.4" "$T/version.out"; then _got=1; else _got=0; fi
  if [ "$status" -eq 0 ] && [ "$_got" -eq "$_want" ]; then
    if [ "$_want" -eq 1 ]; then
      ok "Coolify $_v is warned as older than 4.4"
    else
      ok "Coolify $_v is newer than 4.4 and is not warned"
    fi
  else
    bad "the version check is wrong for $_v (warned=$_got, exit=$status)"
  fi
done

# --- 11. size and syntax ------------------------------------------------

for _f in deploy/lib/coolify-api.sh deploy/lib/coolify-mode.sh; do
  _lines="$(wc -l <"$ROOT/$_f" | tr -d ' ')"
  if [ "$_lines" -le 400 ]; then
    ok "$_f is $_lines lines (limit 400)"
  else
    bad "$_f is $_lines lines, over the 400-line limit"
  fi
  if sh -n "$ROOT/$_f" 2>/dev/null; then
    ok "$_f parses with sh -n"
  else
    bad "$_f does not parse"
  fi
done

rm -rf "$T"
trap - EXIT INT TERM
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
