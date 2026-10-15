#!/bin/sh
#
# Desk host-prep tests (T-1411, T-1605). Shell-only; needs `sh` and `docker`
# (for `compose config`). Proves, without touching a real host or a running
# stack:
#
#   1. `zilar host-setup --dry-run` prints the pinned gVisor release with its
#      SHA-512 check, the jq runtime merge, a Docker `reload` (and never a
#      `restart`), and the slice values.
#   2. `./zilar init` writes no DESKS_ENABLED switch and `./zilar up` passes no
#      `--profile`: the desk services are always in the stack. `./zilar update`
#      clears a digest it pinned itself and keeps one set by hand.
#   3. both compose files render the desk services with no profile, starting
#      the sidecar/proxy, with `restart: unless-stopped` and no DESKS_ENABLED
#      guard, and `server` carrying the fixed socket and the socket volume.
#   4. `doctor` reads the desk slice from the systemd unit, not the live
#      cgroup, so a freshly prepared but idle host does not false-FAIL; a host
#      without the runsc runtime only warns.
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

# --- throwaway env file -------------------------------------------------

ENV_FILE="$T/stack.env"
if "$ZILAR" --env-file="$ENV_FILE" init --domain localhost \
  --admin-email ops@example.com --acme-email ops@example.com \
  --image-owner testowner --no-push >"$T/init.log" 2>&1 </dev/null; then
  ok "init wrote a throwaway env"
else
  bad "init failed ($(tail -n 1 "$T/init.log"))"
fi
if grep -q '^DESKS_ENABLED' "$ENV_FILE"; then
  bad "init still writes the DESKS_ENABLED switch"
else
  ok "init writes no DESKS_ENABLED switch"
fi

# --- 2. up passes no desk profile or socket override --------------------

if "$ZILAR" --env-file="$ENV_FILE" --dry-run up >"$T/up.log" 2>&1; then
  if grep -q -- "--profile" "$T/up.log"; then
    bad "'up' still passes a Compose profile"
  else
    ok "'up' passes no Compose profile"
  fi
  if grep -q "DESK_AGENT_SOCKET=" "$T/up.log"; then
    bad "'up' still derives DESK_AGENT_SOCKET"
  else
    ok "'up' does not derive DESK_AGENT_SOCKET"
  fi
else
  bad "'up --dry-run' failed ($(tail -n 1 "$T/up.log"))"
fi

# --- 2b. update clears its own pin and keeps a hand-set one -------------

# A stub `docker` makes the compose pull/up no-ops, so update runs offline.
mkdir -p "$T/updatebin"
printf '#!/bin/sh\nexit 0\n' >"$T/updatebin/docker"
chmod +x "$T/updatebin/docker"

DIGEST="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
AUTO="$T/auto.env"
cp "$ENV_FILE" "$AUTO"
chmod 600 "$AUTO"
printf 'DESK_IMAGE=ghcr.io/testowner/zilar-desk@sha256:%s\n' "$DIGEST" >>"$AUTO"
# The rewrite must keep the mode and every other line, not just the one key.
sed 's|^DESK_IMAGE=.*|DESK_IMAGE=|' "$AUTO" >"$T/auto.expected"
if PATH="$T/updatebin:$PATH" "$ZILAR" --env-file="$AUTO" update >"$T/update-auto.log" 2>&1; then
  if grep -qF "the jail image now follows the release" "$T/update-auto.log" \
    && cmp -s "$T/auto.expected" "$AUTO" \
    && [ "$(ls -l "$AUTO" | cut -c1-10)" = "-rw-------" ]; then
    ok "update clears a digest ./zilar pinned itself (mode and other lines kept)"
  else
    bad "update did not clear the auto-pinned digest (or changed the rest of the file)"
  fi
else
  bad "update failed on an auto-pinned digest ($(tail -n 1 "$T/update-auto.log"))"
fi

CUSTOM="$T/custom.env"
cp "$ENV_FILE" "$CUSTOM"
printf 'DESK_IMAGE=ghcr.io/me/myjail@sha256:%s\n' "$DIGEST" >>"$CUSTOM"
if PATH="$T/updatebin:$PATH" "$ZILAR" --env-file="$CUSTOM" update >"$T/update-custom.log" 2>&1; then
  if grep -qF "overrides the release jail image" "$T/update-custom.log" \
    && grep -q "^DESK_IMAGE=ghcr.io/me/myjail@sha256:$DIGEST\$" "$CUSTOM"; then
    ok "update keeps a hand-set digest and warns"
  else
    bad "update changed or ignored a hand-set digest"
  fi
else
  bad "update failed on a hand-set digest ($(tail -n 1 "$T/update-custom.log"))"
fi

# --- 3. compose renders -------------------------------------------------

# The Coolify app needs Coolify-style variables; the wizard's env is for the
# plain stack. Values are placeholders (syntax only, like push-deploy.test.sh).
cat >"$T/cool.env" <<EOF
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
EOF

# render FILE OUT ENV PROJDIR
# PROJDIR is empty for the plain stack (compose defaults to the file's dir,
# which is what its build contexts expect) and the repo root for the Coolify
# file (its build contexts are relative to the repo root, matching Coolify).
render() {
  _file="$1" _out="$2" _env="$3" _projdir="$4"
  if [ -n "$_projdir" ]; then
    docker compose --project-directory "$_projdir" \
      -f "$ROOT/$_file" --env-file "$_env" config >"$_out" 2>"$_out.err" && return 0
  else
    docker compose \
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
    _env="$T/cool.env" _projdir="$ROOT"
  else
    _env="$ENV_FILE" _projdir=""
  fi

  if render "$_file" "$T/rendered" "$_env" "$_projdir"; then
    ok "$_tag renders with the desk services always present"
  else
    bad "$_tag does not render ($(head -n 1 "$T/rendered.err"))"
  fi
  check_service "$T/rendered" "desk-agent" 1 "$_tag shows desk-agent"
  check_service "$T/rendered" "desk-egress" 1 "$_tag shows desk-egress"
  check_service "$T/rendered" "server" 1 "$_tag still has the server service"

  for _svc in desk-agent desk-egress; do
    _block="$(service_block "$T/rendered" "$_svc")"
    if printf '%s\n' "$_block" | grep -q 'restart: unless-stopped'; then
      ok "$_tag $_svc uses restart: unless-stopped"
    else
      bad "$_tag $_svc does not use restart: unless-stopped"
    fi
    if printf '%s\n' "$_block" | grep -q 'DESKS_ENABLED'; then
      bad "$_tag $_svc still guards on DESKS_ENABLED"
    else
      ok "$_tag $_svc has no DESKS_ENABLED guard"
    fi
    if printf '%s\n' "$_block" | grep -q '^    profiles:'; then
      bad "$_tag $_svc is still behind a Compose profile"
    else
      ok "$_tag $_svc has no Compose profile"
    fi
  done

  if service_block "$T/rendered" "desk-agent" | grep -qF "/app/desk-agent"; then
    ok "$_tag desk-agent starts the sidecar (/app/desk-agent)"
  else
    bad "$_tag desk-agent has no start command for the sidecar"
  fi
  if service_block "$T/rendered" "desk-egress" | grep -qF "/app/desk-egress"; then
    ok "$_tag desk-egress starts the proxy (/app/desk-egress)"
  else
    bad "$_tag desk-egress has no start command for the proxy"
  fi
  if service_block "$T/rendered" "server" | grep -q "DESK_AGENT_SOCKET: /run/zilar/desk.sock" \
    && service_block "$T/rendered" "server" | grep -q "desk-socket"; then
    ok "$_tag server carries the fixed DESK_AGENT_SOCKET and the desk-socket volume"
  else
    bad "$_tag server is missing the fixed DESK_AGENT_SOCKET or the desk-socket volume"
  fi
done

# --- 4. doctor desk checks (fresh host: unit present, cgroup not) -------
#
# host-setup writes /etc/systemd/system/zilar-desks.slice, but systemd only
# materialises the cgroup when the first jail joins it via --cgroup-parent.
# doctor must read the unit's configured limit, not /sys/fs/cgroup/..., or a
# freshly prepared idle host false-FAILs and sends the operator in a circle.
# A stub `docker` reports whether the runsc runtime is registered.
mkdir -p "$T/stubbin"
cat >"$T/stubbin/systemctl" <<'STUB'
#!/bin/sh
# stub for `systemctl show --value -p MemoryMax zilar-desks.slice`
[ "${STUB_SLICE_PRESENT:-1}" = "1" ] || exit 1
printf '%s\n' "${STUB_SLICE_MEMMAX:-4294967296}"
STUB
chmod +x "$T/stubbin/systemctl"
mkdir -p "$T/dockerbin"
cat >"$T/dockerbin/docker" <<'STUB'
#!/bin/sh
case "$1" in
  --version) echo "Docker version 27.0.0, build test" ;;
  compose) [ "${2:-}" = "version" ] && echo "Docker Compose version v2.0.0" ;;
  info) if [ "${STUB_RUNSC:-1}" = "1" ]; then echo '{"runsc":{"path":"/usr/local/bin/runsc"}}'; else echo '{}'; fi ;;
esac
exit 0
STUB
chmod +x "$T/dockerbin/docker"
if [ -e /sys/fs/cgroup/zilar-desks.slice/memory.max ]; then
  bad "the test machine unexpectedly has the live slice cgroup"
fi

# runsc registered, unit present, live cgroup absent: the slice is installed.
PATH="$T/dockerbin:$T/stubbin:$PATH" STUB_RUNSC=1 STUB_SLICE_PRESENT=1 STUB_SLICE_MEMMAX=4294967296 \
  "$ZILAR" --env-file="$ENV_FILE" doctor >"$T/doctor-slice.log" 2>&1 || true
if grep -q "ok: zilar-desks.slice is installed" "$T/doctor-slice.log"; then
  ok "doctor reads the slice from the unit, not the live cgroup"
else
  bad "doctor did not report the slice as installed ($(grep -i slice "$T/doctor-slice.log" | head -n 1))"
fi

# runsc registered, no unit at all: doctor must FAIL and point at host-setup.
PATH="$T/dockerbin:$T/stubbin:$PATH" STUB_RUNSC=1 STUB_SLICE_PRESENT=0 \
  "$ZILAR" --env-file="$ENV_FILE" doctor >"$T/doctor-noslice.log" 2>&1 || true
if grep -q "FAIL: zilar-desks.slice is missing" "$T/doctor-noslice.log"; then
  ok "doctor FAILs when systemd has no desk slice"
else
  bad "doctor did not FAIL a missing desk slice"
fi

# A slice that exists but caps something other than the 4 GB pool is a FAIL:
# a hand-edited unit must not pass as the shared memory ceiling.
PATH="$T/dockerbin:$T/stubbin:$PATH" STUB_RUNSC=1 STUB_SLICE_PRESENT=1 STUB_SLICE_MEMMAX=2147483648 \
  "$ZILAR" --env-file="$ENV_FILE" doctor >"$T/doctor-badslice.log" 2>&1 || true
if grep -q "FAIL: zilar-desks.slice has MemoryMax=2147483648" "$T/doctor-badslice.log"; then
  ok "doctor FAILs a slice whose MemoryMax is not the 4G pool"
else
  bad "doctor passed a slice with the wrong MemoryMax"
fi

# No runsc runtime: the host is simply not prepared yet, so doctor warns (it
# must not FAIL the install for a stack that is running fine).
PATH="$T/dockerbin:$T/stubbin:$PATH" STUB_RUNSC=0 STUB_SLICE_PRESENT=0 \
  "$ZILAR" --env-file="$ENV_FILE" doctor >"$T/doctor-norunsc.log" 2>&1 || true
if grep -q "host not set up for AI computers" "$T/doctor-norunsc.log" \
  && ! grep -q "FAIL: zilar-desks.slice" "$T/doctor-norunsc.log"; then
  ok "a host without runsc only warns"
else
  bad "a host without runsc did not warn cleanly"
fi

rm -rf "$T"
trap - EXIT INT TERM
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
