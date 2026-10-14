#!/bin/sh
#
# Desk host-setup tests (T-1411). Shell-only; needs `sh` and `docker` (for
# `compose config`). Proves, without touching a real host or a running stack:
#
#   1. `zilar host-setup --dry-run` prints the pinned gVisor release with its
#      SHA-512 check, the jq runtime merge, a Docker `reload` (and never a
#      `restart`), and the slice values.
#   2. `./zilar up` turns the `desks` Compose profile on exactly when
#      DESKS_ENABLED=true (nothing else changes a default install).
#   3. both compose files render with DESKS_ENABLED=false showing no desk
#      services, and with the `desks` profile showing desk-agent and
#      desk-egress and `server` carrying the socket volume and env.
#   4. `doctor` reads the desk slice from the systemd unit, not the live
#      cgroup, so a freshly prepared but idle host does not false-FAIL.
#
# Usage: sh deploy/tests/host-setup.test.sh
# Exit 0 when every check passes, 1 on the first failure.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
ZILAR="$ROOT/deploy/zilar"
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

# --- 1. host-setup --dry-run -------------------------------------------

if "$ZILAR" --dry-run host-setup >"$T/host-setup.log" 2>&1; then
  ok "host-setup --dry-run exits 0"
else
  bad "host-setup --dry-run failed ($(tail -n 1 "$T/host-setup.log"))"
fi
if grep -qF "20261005.0" "$T/host-setup.log"; then
  ok "dry run names the pinned gVisor release (20261005.0)"
else
  bad "dry run does not name the pinned release"
fi
if grep -qF "sha512sum -c" "$T/host-setup.log"; then
  ok "dry run checks the release SHA-512 before installing"
else
  bad "dry run does not check the SHA-512"
fi
if grep -qF "jq '" "$T/host-setup.log" && grep -qF "runtimes" "$T/host-setup.log"; then
  ok "dry run shows the jq runtime merge"
else
  bad "dry run does not show the jq runtime merge"
fi
if grep -qF "systemctl reload docker" "$T/host-setup.log"; then
  ok "dry run reloads Docker (SIGHUP)"
else
  bad "dry run does not reload Docker"
fi
if grep -qi "restart" "$T/host-setup.log"; then
  bad "dry run mentions a restart (it must only reload)"
else
  ok "dry run never mentions a restart"
fi
for _line in "MemoryMax=4G" "MemoryHigh=3500M" "MemorySwapMax=0" "TasksMax=4096" "CPUWeight=50"; do
  if grep -qF "$_line" "$T/host-setup.log"; then
    ok "dry run shows the slice value $_line"
  else
    bad "dry run is missing the slice value $_line"
  fi
done

# --- throwaway env files -----------------------------------------------

ENV_OFF="$T/off.env"
if "$ZILAR" --env-file="$ENV_OFF" init --domain localhost \
  --admin-email ops@example.com --acme-email ops@example.com \
  --image-owner testowner --no-push >"$T/init.log" 2>&1 </dev/null; then
  ok "init wrote a throwaway env (DESKS_ENABLED=false)"
else
  bad "init failed ($(tail -n 1 "$T/init.log"))"
fi
if grep -q '^DESKS_ENABLED=false$' "$ENV_OFF"; then
  ok "init writes DESKS_ENABLED=false by default"
else
  bad "init did not write DESKS_ENABLED=false"
fi
ENV_ON="$T/on.env"
sed 's/^DESKS_ENABLED=false$/DESKS_ENABLED=true/' "$ENV_OFF" >"$ENV_ON"

# --- 2. the installer turns the profile on from DESKS_ENABLED ----------

if "$ZILAR" --env-file="$ENV_ON" --dry-run up >"$T/up-on.log" 2>&1; then
  if grep -q -- "--profile desks" "$T/up-on.log"; then
    ok "DESKS_ENABLED=true makes 'up' pass --profile desks"
  else
    bad "DESKS_ENABLED=true did not pass --profile desks"
  fi
else
  bad "'up --dry-run' failed with desks on ($(tail -n 1 "$T/up-on.log"))"
fi
if "$ZILAR" --env-file="$ENV_OFF" --dry-run up >"$T/up-off.log" 2>&1; then
  if grep -q -- "--profile desks" "$T/up-off.log"; then
    bad "DESKS_ENABLED=false still passed --profile desks"
  else
    ok "DESKS_ENABLED=false leaves 'up' unchanged (no profile)"
  fi
else
  bad "'up --dry-run' failed with desks off ($(tail -n 1 "$T/up-off.log"))"
fi

# The server builds its Hands client only when DESK_AGENT_SOCKET is set;
# ./zilar derives it from DESKS_ENABLED so self-host stays one flag.
if grep -qF "DESK_AGENT_SOCKET=/run/zilar/desk.sock" "$T/up-on.log"; then
  ok "DESKS_ENABLED=true makes 'up' set DESK_AGENT_SOCKET for the server"
else
  bad "DESKS_ENABLED=true did not set DESK_AGENT_SOCKET"
fi
if grep -qF "DESK_AGENT_SOCKET=" "$T/up-off.log"; then
  bad "DESKS_ENABLED=false still set DESK_AGENT_SOCKET"
else
  ok "DESKS_ENABLED=false leaves DESK_AGENT_SOCKET unset"
fi

# --- 3. compose renders -------------------------------------------------

# The Coolify app needs Coolify-style variables; the wizard's env is for the
# plain stack. Values are placeholders (syntax only, like push-deploy.test.sh).
cat >"$T/cool-off.env" <<EOF
SERVICE_PASSWORD_POSTGRES=x1
SERVICE_PASSWORD_ZILARDB=x2
SERVICE_PASSWORD_EJABBERDB=x3
SERVICE_PASSWORD_ARCHIVEDB=x4
SERVICE_PASSWORD_EJABBERDADMIN=x5
SERVICE_PASSWORD_XMPPJWT=x6
SERVICE_PASSWORD_BETTERAUTH=x7
SERVICE_PASSWORD_KEYENCRYPTION=x8
SERVICE_PASSWORD_PUSHCOMPONENT=x9
SERVICE_FQDN_WEB=desk.example
SERVICE_URL_WEB=http://localhost:18080
SOURCE_COMMIT=test
DESKS_ENABLED=false
EOF
COOL_ON="$T/cool-on.env"
sed 's/^DESKS_ENABLED=false$/DESKS_ENABLED=true/' "$T/cool-off.env" >"$COOL_ON"

# render FILE OUT ENV PROJDIR [--profile desks]
# PROJDIR is empty for the plain stack (compose defaults to the file's dir,
# which is what its build contexts expect) and the repo root for the Coolify
# file (its build contexts are relative to the repo root, matching Coolify).
render() {
  _file="$1" _out="$2" _env="$3" _projdir="$4"
  shift 4
  if [ -n "$_projdir" ]; then
    docker compose --project-directory "$_projdir" "$@" \
      -f "$ROOT/$_file" --env-file "$_env" config >"$_out" 2>"$_out.err" && return 0
  else
    docker compose "$@" \
      -f "$ROOT/$_file" --env-file "$_env" config >"$_out" 2>"$_out.err" && return 0
  fi
  return 1
}

check_service() { # OUT NAME PRESENT(0/1)
  if grep -q "^  $2:$" "$1"; then
    _has=1
  else
    _has=0
  fi
  if [ "$_has" -eq "$3" ]; then
    ok "$4"
  else
    bad "$4"
  fi
}

service_block() { # OUT NAME — print one service block from a rendered config
  awk -v name="$2" '
    $0 == "  " name ":" { in_service = 1; next }
    in_service && /^  [a-z]/ { exit }
    in_service { print }
  ' "$1"
}

for _file in "deploy/docker-compose.yml" "deploy/coolify/docker-compose.app.yml"; do
  _tag="$(basename "$_file")"
  if [ "$_file" = "deploy/coolify/docker-compose.app.yml" ]; then
    _env_off="$T/cool-off.env" _env_on="$COOL_ON" _projdir="$ROOT"
  else
    _env_off="$ENV_OFF" _env_on="$ENV_ON" _projdir=""
  fi

  if render "$_file" "$T/off.rendered" "$_env_off" "$_projdir"; then
    ok "$_tag renders with DESKS_ENABLED=false"
  else
    bad "$_tag does not render with DESKS_ENABLED=false ($(head -n 1 "$T/off.rendered.err"))"
  fi
  check_service "$T/off.rendered" "desk-agent" 0 "$_tag keeps desk-agent off by default"
  check_service "$T/off.rendered" "desk-egress" 0 "$_tag keeps desk-egress off by default"
  check_service "$T/off.rendered" "server" 1 "$_tag still has the server service"
  if service_block "$T/off.rendered" "server" | grep -q 'DESK_AGENT_SOCKET: ""'; then
    ok "$_tag server DESK_AGENT_SOCKET is empty with desks off"
  else
    bad "$_tag server DESK_AGENT_SOCKET is not empty with desks off"
  fi

  if render "$_file" "$T/on.rendered" "$_env_on" "$_projdir" --profile desks; then
    ok "$_tag renders with the desks profile"
  else
    bad "$_tag does not render with the desks profile ($(head -n 1 "$T/on.rendered.err"))"
  fi
  check_service "$T/on.rendered" "desk-agent" 1 "$_tag shows desk-agent with desks on"
  check_service "$T/on.rendered" "desk-egress" 1 "$_tag shows desk-egress with desks on"
  if service_block "$T/on.rendered" "desk-agent" | grep -qF "/app/desk-agent"; then
    ok "$_tag desk-agent starts the sidecar (/app/desk-agent)"
  else
    bad "$_tag desk-agent has no start command for the sidecar"
  fi
  # Belt-and-braces: even if a platform ignores the `desks` profile, both desk
  # services must guard on DESKS_ENABLED (exit 0 while off) and use
  # restart: on-failure so an exit-0 container stays stopped.
  for _svc in desk-agent desk-egress; do
    _block="$(service_block "$T/on.rendered" "$_svc")"
    if printf '%s\n' "$_block" | grep -q 'DESKS_ENABLED:-false' \
      && printf '%s\n' "$_block" | grep -q 'restart: on-failure'; then
      ok "$_tag $_svc has the DESKS_ENABLED guard and restart: on-failure"
    else
      bad "$_tag $_svc is missing the DESKS_ENABLED guard or restart: on-failure"
    fi
  done
  if service_block "$T/on.rendered" "server" | grep -q "DESK_AGENT_SOCKET:" \
    && service_block "$T/on.rendered" "server" | grep -q "desk-socket"; then
    ok "$_tag server carries DESK_AGENT_SOCKET and the desk-socket volume"
  else
    bad "$_tag server is missing DESK_AGENT_SOCKET or the desk-socket volume"
  fi
done

# --- 4. doctor desk slice check (fresh host: unit present, cgroup not) ----
#
# host-setup writes /etc/systemd/system/zilar-desks.slice, but systemd only
# materialises the cgroup when the first jail joins it via --cgroup-parent.
# doctor must read the unit's configured limit, not /sys/fs/cgroup/..., or a
# freshly prepared idle host false-FAILs and sends the operator in a circle.
mkdir -p "$T/stubbin"
cat >"$T/stubbin/systemctl" <<'STUB'
#!/bin/sh
# stub for `systemctl show --value -p MemoryMax zilar-desks.slice`
[ "${STUB_SLICE_PRESENT:-1}" = "1" ] || exit 1
printf '%s\n' "${STUB_SLICE_MEMMAX:-4294967296}"
STUB
chmod +x "$T/stubbin/systemctl"
if [ -e /sys/fs/cgroup/zilar-desks.slice/memory.max ]; then
  bad "the test machine unexpectedly has the live slice cgroup"
fi

# Unit present, live cgroup absent: doctor must report the slice installed.
PATH="$T/stubbin:$PATH" STUB_SLICE_PRESENT=1 STUB_SLICE_MEMMAX=4294967296 \
  "$ZILAR" --env-file="$ENV_ON" doctor >"$T/doctor-slice.log" 2>&1 || true
if grep -q "ok: zilar-desks.slice is installed" "$T/doctor-slice.log"; then
  ok "doctor reads the slice from the unit, not the live cgroup"
else
  bad "doctor did not report the slice as installed ($(grep -i slice "$T/doctor-slice.log" | head -n 1))"
fi

# No unit at all: doctor must FAIL and point at host-setup.
PATH="$T/stubbin:$PATH" STUB_SLICE_PRESENT=0 \
  "$ZILAR" --env-file="$ENV_ON" doctor >"$T/doctor-noslice.log" 2>&1 || true
if grep -q "FAIL: zilar-desks.slice is missing" "$T/doctor-noslice.log"; then
  ok "doctor FAILs when systemd has no desk slice"
else
  bad "doctor did not FAIL a missing desk slice"
fi

# A slice that exists but caps something other than the 4 GB pool is a FAIL:
# a hand-edited unit must not pass as the shared memory ceiling.
PATH="$T/stubbin:$PATH" STUB_SLICE_PRESENT=1 STUB_SLICE_MEMMAX=2147483648 \
  "$ZILAR" --env-file="$ENV_ON" doctor >"$T/doctor-badslice.log" 2>&1 || true
if grep -q "FAIL: zilar-desks.slice has MemoryMax=2147483648" "$T/doctor-badslice.log"; then
  ok "doctor FAILs a slice whose MemoryMax is not the 4G pool"
else
  bad "doctor passed a slice with the wrong MemoryMax"
fi

rm -rf "$T"
trap - EXIT INT TERM
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
