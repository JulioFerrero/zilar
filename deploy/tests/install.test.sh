#!/bin/sh
#
# One-line installer tests (T-1428). Shell-only and offline; needs `sh` and
# `tar`. Proves, without a Linux host, a network or Docker:
#
#   1. `--dry-run --yes` prints the planned steps in order (check, docker,
#      fetch, configure, up, doctor), with the image tag following the version
#      (main -> :latest, a v* release keeps its tag);
#   2. `--desks` adds host-setup, before `up`;
#   3. a missing `--domain` with `--yes` fails clearly (and `--yes` never
#      prompts);
#   4. the fetch is stubbed with ZILAR_INSTALL_TARBALL, so no test touches
#      codeload.github.com;
#   5. a real run with that stub extracts deploy/ and drives the stub `zilar`
#      (init, up, doctor) — no Docker, no network;
#   6. an existing .env is kept on a re-run;
#   7. finish() reads the domain back from .env, so a prompted run does not
#      print https://localhost;
#   8. the script is at most 400 lines and a cut-off download runs nothing;
#   9. as root (uid 0) `--desks` plans zilar host-setup without sudo;
#  10. as non-root with sudo, the plan prefixes the fetch, the Docker install
#      and every ./zilar step with sudo;
#  11. a failed get.docker.com download dies at the docker step;
#  12. a re-run with a new --domain prints the kept .env domain and warns.
#
# Usage: sh deploy/tests/install.test.sh
# Exit 0 when every check passes, 1 on the first failure.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
INSTALL="$ROOT/deploy/install.sh"
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

OPT="$T/opt"

# A local tarball shaped like codeload's: <repo>-<ref>/deploy/... The `zilar`
# inside is a stub so a real run could never start a stack.
mkdir -p "$T/zilar-main/deploy/tests"
cat >"$T/zilar-main/deploy/zilar" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >>"${ZILAR_STUB_LOG:-/dev/null}"
exit 0
STUB
chmod +x "$T/zilar-main/deploy/zilar"
printf 'services: {}\n' >"$T/zilar-main/deploy/docker-compose.yml"
printf '#!/bin/sh\nexit 0\n' >"$T/zilar-main/deploy/tests/host-setup.test.sh"
tar -czf "$T/zilar-main.tar.gz" -C "$T" zilar-main
STUB_TARBALL="$T/zilar-main.tar.gz"

# --- 1. the dry run plans the steps in order ----------------------------

status=0
sh "$INSTALL" --dry-run --yes --domain chat.example.com \
  --admin-email ops@example.com --version main --dir "$OPT" \
  >"$T/plan.log" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  ok "--dry-run --yes exits 0"
else
  bad "--dry-run --yes failed ($(tail -n 1 "$T/plan.log"))"
fi

_prev=0
for _step in check docker fetch configure up doctor; do
  _line="$(grep -n "^==> $_step\$" "$T/plan.log" | head -n 1 | cut -d: -f1 || true)"
  if [ -z "$_line" ]; then
    bad "the plan is missing the '$_step' step"
  elif [ "$_line" -le "$_prev" ]; then
    bad "the plan lists '$_step' out of order"
  else
    ok "the plan lists '$_step' after the previous step"
  fi
  if [ -n "$_line" ]; then
    _prev="$_line"
  fi
done

if grep -qF -- "--image-owner julioferrero --image-tag latest" "$T/plan.log"; then
  ok "the plan installs the official images (main -> :latest)"
else
  bad "the plan does not pass --image-owner julioferrero --image-tag latest"
fi

# The image tag follows the version: a v* release keeps its own tag, while main
# pulls :latest (CI never publishes :main). The deploy/ tarball is fetched from
# the same version either way.
_release="$T/release.log"
sh "$INSTALL" --dry-run --yes --domain chat.example.com \
  --admin-email ops@example.com --version v1.2.3 --dir "$OPT" >"$_release" 2>&1
if grep -qF -- "--image-owner julioferrero --image-tag v1.2.3" "$_release"; then
  ok "a v* release keeps its own image tag"
else
  bad "a v* release did not keep its image tag"
fi
if grep -qF "tar.gz/v1.2.3" "$_release" && grep -qF "tar.gz/main" "$T/plan.log"; then
  ok "the deploy/ tarball is fetched from the chosen version"
else
  bad "the deploy/ tarball does not follow the version"
fi

if grep -q "^==> host-setup\$" "$T/plan.log"; then
  bad "the plan runs host-setup without --desks"
else
  ok "the plan skips host-setup without --desks"
fi

# --- 2. --desks adds host-setup, before up ------------------------------

sh "$INSTALL" --dry-run --yes --desks --domain chat.example.com \
  --admin-email ops@example.com --version main --dir "$OPT" \
  >"$T/desks.log" 2>&1
if grep -qF "sudo $OPT/zilar host-setup" "$T/desks.log"; then
  ok "--desks runs 'sudo ./zilar host-setup'"
else
  bad "--desks does not run host-setup"
fi
_hs="$(grep -n "^==> host-setup\$" "$T/desks.log" | head -n 1 | cut -d: -f1)"
_up="$(grep -n "^==> up\$" "$T/desks.log" | head -n 1 | cut -d: -f1)"
if [ -n "$_hs" ] && [ -n "$_up" ] && [ "$_hs" -lt "$_up" ]; then
  ok "host-setup comes before up"
else
  bad "host-setup is missing or comes after up"
fi

# --- 2b. root runs host-setup without sudo ------------------------------

# A root-on-a-minimal-image host has no `sudo` package at all, so phase_desks
# must not prefix it when uid 0 (S1). A stub `id` reports uid 0; the dry-run
# then plans zilar host-setup directly.
mkdir -p "$T/rootbin"
printf '#!/bin/sh\necho 0\n' >"$T/rootbin/id"
chmod +x "$T/rootbin/id"
PATH="$T/rootbin:$PATH" sh "$INSTALL" --dry-run --yes --desks \
  --domain chat.example.com --admin-email ops@example.com --version main \
  --dir "$OPT" >"$T/root-desks.log" 2>&1
if grep -qF "+ $OPT/zilar host-setup" "$T/root-desks.log" && \
   ! grep -qF "sudo $OPT/zilar host-setup" "$T/root-desks.log"; then
  ok "as root, --desks runs zilar host-setup without sudo"
else
  bad "as root, --desks still needs sudo ($(grep -i 'host-setup' "$T/root-desks.log" || true))"
fi

# --- 2c. non-root with sudo prefixes the privileged steps ----------------

# With uid != 0 and sudo present, the plan shows the prefix where it applies:
# the Docker install, the fetch's cp into --dir, and every ./zilar call.
mkdir -p "$T/userbin"
printf '#!/bin/sh\necho 1000\n' >"$T/userbin/id"
printf '#!/bin/sh\nexec "$@"\n' >"$T/userbin/sudo"
printf '#!/bin/sh\nexit 1\n' >"$T/userbin/docker"
chmod +x "$T/userbin/id" "$T/userbin/sudo" "$T/userbin/docker"
PATH="$T/userbin:$PATH" sh "$INSTALL" --dry-run --yes --desks \
  --domain chat.example.com --admin-email ops@example.com --version main \
  --dir "$OPT" >"$T/user-plan.log" 2>&1
if grep -qF "+ sudo sh <tmp>/get-docker.sh" "$T/user-plan.log"; then
  ok "as non-root, the plan installs Docker with sudo"
else
  bad "the non-root plan does not prefix the Docker install with sudo"
fi
if grep -qF "sudo cp -R " "$T/user-plan.log"; then
  ok "as non-root, the plan fetches deploy/ with sudo"
else
  bad "the non-root plan does not prefix the fetch with sudo"
fi
if grep -qF "sudo ./zilar init " "$T/user-plan.log" && \
   grep -qF "sudo ./zilar up)" "$T/user-plan.log" && \
   grep -qF "sudo ./zilar doctor" "$T/user-plan.log" && \
   grep -qF "sudo $OPT/zilar host-setup" "$T/user-plan.log"; then
  ok "as non-root, the plan prefixes every ./zilar step with sudo"
else
  bad "the non-root plan misses a sudo-prefixed ./zilar step ($(grep -i 'zilar' "$T/user-plan.log" || true))"
fi

# --- 2d. a failed Docker download dies before the fetch -----------------

# A dead get.docker.com download must stop the install instead of piping an
# empty script into sh and marching on to fetch (S1). `curl`/`docker` are
# stubbed so the run takes the install path and the download fails; the run
# must die at the docker step, before the fetch.
mkdir -p "$T/failbin"
printf '#!/bin/sh\nexit 1\n' >"$T/failbin/docker"
printf '#!/bin/sh\nexit 1\n' >"$T/failbin/curl"
printf '#!/bin/sh\nexec "$@"\n' >"$T/failbin/sudo"
printf '#!/bin/sh\necho 1000\n' >"$T/failbin/id"
chmod +x "$T/failbin/docker" "$T/failbin/curl" "$T/failbin/sudo" "$T/failbin/id"
FAIL_DIR="$T/dockerfail"
status=0
PATH="$T/failbin:$PATH" ZILAR_INSTALL_TARBALL="$STUB_TARBALL" \
  ZILAR_INSTALL_SKIP_CHECKS=1 \
  sh "$INSTALL" --yes --domain chat.example.com --admin-email ops@example.com \
  --version main --dir "$FAIL_DIR" >"$T/dockerfail.log" 2>&1 || status=$?
if [ "$status" -ne 0 ] && grep -qF "could not download the Docker installer" "$T/dockerfail.log"; then
  ok "a failed Docker download dies with a clear error"
else
  bad "a failed Docker download did not die ($(tail -n 1 "$T/dockerfail.log"))"
fi
if grep -q "^==> fetch\$" "$T/dockerfail.log" || [ -e "$FAIL_DIR/zilar" ]; then
  bad "the install reached fetch after the Docker download failed"
else
  ok "a failed Docker download stops before the fetch"
fi

# --- 3. --yes needs --domain and never prompts --------------------------

status=0
sh "$INSTALL" --yes --version main --dir "$OPT" >"$T/nodomain.log" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  bad "a missing --domain with --yes did not fail"
elif grep -qi "domain" "$T/nodomain.log"; then
  ok "a missing --domain with --yes fails clearly"
else
  bad "the failure does not mention the domain ($(tail -n 1 "$T/nodomain.log"))"
fi

# --- 4. the fetch is stubbed; nothing hits the network ------------------

status=0
ZILAR_INSTALL_TARBALL="$STUB_TARBALL" sh "$INSTALL" --dry-run --yes \
  --domain chat.example.com --admin-email ops@example.com --version main --dir "$OPT" \
  >"$T/stub.log" 2>&1 || status=$?
if [ "$status" -eq 0 ] && grep -qF "$STUB_TARBALL" "$T/stub.log"; then
  ok "ZILAR_INSTALL_TARBALL replaces the download"
else
  bad "the stub tarball is not used ($(tail -n 1 "$T/stub.log"))"
fi
if grep -qF "codeload.github.com" "$T/stub.log"; then
  bad "the stubbed plan still names codeload.github.com"
else
  ok "the stubbed plan never names codeload.github.com"
fi

# --- 5. a real run with the stub tarball, offline -----------------------

# The host checks want a Linux host, so this run turns them off (a test-only
# override, like deploy/zilar's COMPOSE_FILE_OVERRIDE). A stub `docker` keeps
# the run offline; the real one would call get.docker.com.
mkdir -p "$T/bin"
printf '#!/bin/sh\nexit 0\n' >"$T/bin/docker"
printf '#!/bin/sh\nexec "$@"\n' >"$T/bin/sudo"
chmod +x "$T/bin/docker" "$T/bin/sudo"
: >"$T/zilar.log"
REAL="$T/real"
status=0
PATH="$T/bin:$PATH" ZILAR_INSTALL_TARBALL="$STUB_TARBALL" \
  ZILAR_INSTALL_SKIP_CHECKS=1 ZILAR_STUB_LOG="$T/zilar.log" \
  sh "$INSTALL" --yes --domain chat.example.com --admin-email ops@example.com \
  --version main --dir "$REAL" >"$T/real.log" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  ok "a real run with the stub tarball exits 0"
else
  bad "the real run failed ($(tail -n 1 "$T/real.log"))"
fi
if [ -x "$REAL/zilar" ] && [ -f "$REAL/docker-compose.yml" ]; then
  ok "the real run extracted deploy/ into --dir"
else
  bad "the real run did not extract deploy/"
fi
if grep -qF "installed Zilar main (commit unknown)" "$T/real.log"; then
  ok "the real run prints the version and commit"
else
  bad "the real run does not print the version and commit"
fi
if grep -qF "init --domain chat.example.com --admin-email ops@example.com --acme-email ops@example.com --push-subject mailto:ops@example.com --image-owner julioferrero --image-tag latest" "$T/zilar.log"; then
  ok "the real run configures with the flags and the official images"
else
  bad "the real run passed unexpected init flags ($(cat "$T/zilar.log"))"
fi
# `--yes` must not fall through to init's ACME-email or push-subject prompts:
# the real init asks for both (deploy/zilar), and ask() reads /dev/tty, so a
# terminal run must get them as flags instead.
if grep -qF -- "--acme-email ops@example.com" "$T/zilar.log" && \
   grep -qF -- "--push-subject mailto:ops@example.com" "$T/zilar.log"; then
  ok "--yes passes init the ACME email and push subject (no prompts)"
else
  bad "--yes did not pass --acme-email/--push-subject to init ($(cat "$T/zilar.log"))"
fi
if grep -q "^up$" "$T/zilar.log" && grep -q "^doctor$" "$T/zilar.log"; then
  ok "the real run runs up, then doctor"
else
  bad "the real run did not run up and doctor ($(cat "$T/zilar.log"))"
fi
if grep -qF "codeload.github.com" "$T/real.log"; then
  bad "the real run went to the network"
else
  ok "the real run never went to the network"
fi

# --- 5b. finish() reads the prompted domain from .env -------------------

# When init prompts for the domain, $DOMAIN is empty; finish() must read
# ZILAR_DOMAIN back from the written .env instead of printing
# https://localhost. --desks avoids the AI-computers prompt; the $T/bin sudo
# stub (section 5) keeps the run offline and password-free. The pre-made .env
# makes configure keep it (so init is never reached).
mkdir -p "$T/prompted"
printf 'ZILAR_DOMAIN=chat.example.com\n' >"$T/prompted/.env"
: >"$T/zilar-prompted.log"
status=0
PATH="$T/bin:$PATH" ZILAR_INSTALL_TARBALL="$STUB_TARBALL" \
  ZILAR_INSTALL_SKIP_CHECKS=1 ZILAR_STUB_LOG="$T/zilar-prompted.log" \
  sh "$INSTALL" --desks --version main --dir "$T/prompted" \
  >"$T/prompted.log" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  ok "a run with a prompted (no --domain) domain exits 0"
else
  bad "the prompted-domain run failed ($(tail -n 1 "$T/prompted.log"))"
fi
if grep -qF "Open: https://chat.example.com" "$T/prompted.log"; then
  ok "finish() prints the domain read back from .env"
else
  bad "finish() did not print the .env domain ($(grep -i 'Open:' "$T/prompted.log" || tail -n 1 "$T/prompted.log"))"
fi
if grep -qF "Open: https://localhost" "$T/prompted.log"; then
  bad "finish() printed https://localhost for a real domain"
else
  ok "finish() does not print https://localhost when .env has a domain"
fi

# --- 5c. a re-run prints the kept .env domain, not a new --domain --------

# phase_configure keeps an existing .env, so a re-run with a different
# --domain must print the domain the stack really serves (the .env one) and
# warn that the flag was ignored (S2).
mkdir -p "$T/reused"
printf 'ZILAR_DOMAIN=chat.example.com\n' >"$T/reused/.env"
: >"$T/zilar-reused.log"
status=0
PATH="$T/bin:$PATH" ZILAR_INSTALL_TARBALL="$STUB_TARBALL" \
  ZILAR_INSTALL_SKIP_CHECKS=1 ZILAR_STUB_LOG="$T/zilar-reused.log" \
  sh "$INSTALL" --desks --domain other.example.com --version main \
  --dir "$T/reused" >"$T/reused.log" 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
  ok "a re-run with a new --domain exits 0"
else
  bad "the re-run with a new --domain failed ($(tail -n 1 "$T/reused.log"))"
fi
if grep -qF "Open: https://chat.example.com" "$T/reused.log" && \
   ! grep -qF "Open: https://other.example.com" "$T/reused.log"; then
  ok "a re-run prints the .env domain, not the new --domain"
else
  bad "a re-run printed the wrong domain ($(grep -i 'Open:' "$T/reused.log" || tail -n 1 "$T/reused.log"))"
fi
if grep -qF ".env kept: domain is chat.example.com" "$T/reused.log"; then
  ok "a re-run warns that the new --domain was ignored"
else
  bad "a re-run did not warn the new --domain was ignored"
fi

# --- 6. a re-run keeps the existing .env --------------------------------

mkdir -p "$OPT"
printf 'ZILAR_DOMAIN=chat.example.com\n' >"$OPT/.env"
sh "$INSTALL" --dry-run --yes --domain chat.example.com \
  --admin-email ops@example.com --version main --dir "$OPT" \
  >"$T/keep.log" 2>&1
if grep -qi "keeping the existing" "$T/keep.log"; then
  ok "a re-run keeps the existing .env"
else
  bad "a re-run does not say it keeps the .env"
fi
if [ "$(cat "$OPT/.env")" = "ZILAR_DOMAIN=chat.example.com" ]; then
  ok "the dry run left the .env untouched"
else
  bad "the dry run changed the .env"
fi
rm -f "$OPT/.env"

# --- 7. size and cut-off safety -----------------------------------------

_lines="$(wc -l <"$INSTALL" | tr -d ' ')"
if [ "$_lines" -le 400 ]; then
  ok "install.sh is $_lines lines (limit 400)"
else
  bad "install.sh is $_lines lines, over the 400-line limit"
fi

if sh -n "$INSTALL" 2>/dev/null; then
  ok "install.sh parses with sh -n"
else
  bad "install.sh does not parse"
fi

# A download cut off before the last line must define the body and run
# nothing: the only call to main() is that last line.
sed '$d' "$INSTALL" >"$T/truncated.sh"
status=0
_out="$(sh "$T/truncated.sh" 2>&1)" || status=$?
if [ "$status" -eq 0 ] && [ -z "$_out" ]; then
  ok "a truncated download runs nothing"
else
  bad "a truncated download ran something (status=$status output=$_out)"
fi

rm -rf "$T"
trap - EXIT INT TERM
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
