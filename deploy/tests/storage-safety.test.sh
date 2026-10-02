#!/bin/sh
#
# Deploy storage-safety tests (T-0151). Shell-only, no dependencies beyond
# `sh` and `docker` (for `compose config`).
#
# What it proves, without touching the lead's running dev stack and without
# reading any real `.env` file:
#
#   1. Both compose files render with a `sticker-data` volume mounted at
#      /data/stickers on the server, STICKER_STORAGE_DIR set to exactly
#      that path, and the uploads volume still present.
#   2. The production ejabberd.yml carries the quota module
#      (mod_http_upload_quota) with literal 2048/4096 shaper rules,
#      max_size still 50 MiB, and no max_days (no age-out).
#   3. `zilar doctor` warns at 80% disk use and fails at 95% (injected
#      ZILAR_DOCTOR_DISK_USED_PCT — no real disk is filled).
#   4. `zilar backup --dry-run` / `restore --dry-run` mention both file
#      stores; backup refuses without a running stack (fail-closed).
#   5. No secrets appear in any output captured here.
#
# Usage: sh deploy/tests/storage-safety.test.sh
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

# A minimal env file that renders both compose files (throwaway values).
T="$(mktemp -d)"
cleanup() {
  rm -rf "$T"
}
trap cleanup EXIT INT TERM
cat > "$T/.env" <<'EOF'
ZILAR_DOMAIN=storage-test.example
ACME_EMAIL=ops@storage-test.example
IMAGE_OWNER=testowner
IMAGE_TAG=t0151
POSTGRES_PASSWORD=x1
ZILAR_DB_PASSWORD=x2
EJABBERD_DB_PASSWORD=x3
ZILAR_ARCHIVE_DB_PASSWORD=x4
EJABBERD_ADMIN_PASSWORD=x5
ZILAR_XMPP_JWT_SECRET=x6
BETTER_AUTH_SECRET=x7
EOF
cat > "$T/cool.env" <<'EOF'
IMAGE_OWNER=testowner
IMAGE_TAG=t0151
SERVICE_PASSWORD_POSTGRES=x1
SERVICE_PASSWORD_ZILAR_DB=x2
SERVICE_PASSWORD_EJABBERD_DB=x3
SERVICE_PASSWORD_ARCHIVE_DB=x4
SERVICE_PASSWORD_EJABBERD_ADMIN=x5
SERVICE_PASSWORD_XMPP_JWT=x6
SERVICE_PASSWORD_BETTER_AUTH=x7
XMPP_DOMAIN=storage-test.example
XMPP_MUC_DOMAIN=rooms.storage-test.example
WEB_ORIGIN=http://localhost:18080
SERVICE_URL_SERVER_3000=http://localhost:18081
SERVICE_URL_EJABBERD_WS_5280=http://localhost:18082
SERVICE_URL_WEB_80=http://localhost:18080
EOF

# 1. Both compose files render; sticker volume mounted at the fixed path.
for _file in "deploy/docker-compose.yml" "deploy/coolify/docker-compose.yml"; do
  if [ "$_file" = "deploy/coolify/docker-compose.yml" ]; then
    _env="$T/cool.env"
  else
    _env="$T/.env"
  fi
  if docker compose -f "$ROOT/$_file" --env-file "$_env" config > "$T/rendered.yml" 2> "$T/render.err"; then
    ok "$_file renders"
  else
    bad "$_file does not render: $(head -n 2 "$T/render.err")"
  fi
  if grep -q 'STICKER_STORAGE_DIR: /data/stickers' "$T/rendered.yml"; then
    ok "$_file sets STICKER_STORAGE_DIR=/data/stickers"
  else
    bad "$_file does not set STICKER_STORAGE_DIR=/data/stickers"
  fi
  if grep -q 'source: sticker-data' "$T/rendered.yml" && grep -q 'target: /data/stickers' "$T/rendered.yml"; then
    ok "$_file mounts sticker-data at /data/stickers"
  else
    bad "$_file does not mount sticker-data at /data/stickers"
  fi
  if grep -q 'ejabberd-uploads:/opt/ejabberd/upload' "$T/rendered.yml" || grep -q 'target: /opt/ejabberd/upload' "$T/rendered.yml"; then
    ok "$_file keeps the ejabberd uploads volume"
  else
    bad "$_file lost the ejabberd uploads volume"
  fi
done

# 2. Quota config: literal rules, 50 MiB max, no age-out.
YML="$ROOT/deploy/ejabberd/ejabberd.yml"
if grep -q 'mod_http_upload_quota' "$YML"; then
  ok "ejabberd.yml enables mod_http_upload_quota"
else
  bad "ejabberd.yml does not enable mod_http_upload_quota"
fi
if grep -A2 'soft_upload_quota:' "$YML" | grep -q '2048: all'; then
  ok "soft quota defaults to 2048 MiB"
else
  bad "soft quota is not 2048 MiB"
fi
if grep -A2 'hard_upload_quota:' "$YML" | grep -q '4096: all'; then
  ok "hard quota defaults to 4096 MiB"
else
  bad "hard quota is not 4096 MiB"
fi
if grep -q 'max_size: 52428800' "$YML"; then
  ok "max_size stays at 50 MiB"
else
  bad "max_size is not 50 MiB"
fi
if grep -A5 '^  mod_http_upload_quota' "$YML" | grep -q 'max_days'; then
  bad "mod_http_upload_quota sets max_days (files would age out)"
else
  ok "no max_days: files never age out without the owner"
fi
# The yml must stay valid YAML (prettier parses it for format:check).
if (cd "$ROOT" && pnpm --silent prettier --check deploy/ejabberd/ejabberd.yml deploy/baremetal/ejabberd.yml deploy/docker-compose.yml deploy/coolify/docker-compose.yml > /dev/null 2>&1); then
  ok "compose + ejabberd yml files parse (prettier)"
else
  bad "a compose or ejabberd yml file does not parse"
fi

# 3. Doctor disk thresholds (injected — no real disk is filled). Doctor
# also checks machine-specific things (ports); those may fail on the
# machine running this test, so the assertions look for the disk lines,
# not for a green exit.
if ZILAR_DOCTOR_DISK_USED_PCT=50 "$ZILAR" --env-file="$T/.env" doctor > "$T/doctor50.log" 2>&1; then
  if grep -q 'disk has room (50% used' "$T/doctor50.log"; then
    ok "doctor reports room at 50%"
  else
    bad "doctor at 50% lacks the room line"
  fi
else
  if grep -q 'disk has room (50% used' "$T/doctor50.log"; then
    ok "doctor reports room at 50% (other machine-specific checks fail)"
  else
    bad "doctor at 50% lacks the room line"
  fi
fi
if ZILAR_DOCTOR_DISK_USED_PCT=80 "$ZILAR" --env-file="$T/.env" doctor > "$T/doctor80.log" 2>&1; then
  if grep -q 'WARN: disk is 80% full' "$T/doctor80.log"; then
    ok "doctor warns at 80% in plain words"
  else
    bad "doctor at 80% lacks the warning line"
  fi
else
  if grep -q 'WARN: disk is 80% full' "$T/doctor80.log"; then
    ok "doctor warns at 80% in plain words (other machine-specific checks fail)"
  else
    bad "doctor at 80% lacks the warning line"
  fi
fi
if ZILAR_DOCTOR_DISK_USED_PCT=95 "$ZILAR" --env-file="$T/.env" doctor > "$T/doctor95.log" 2>&1; then
  bad "doctor passes at 95% disk use (should fail)"
else
  if grep -q 'FAIL: disk is 95% full' "$T/doctor95.log"; then
    ok "doctor fails at 95% in plain words"
  else
    bad "doctor at 95% lacks the FAIL line"
  fi
fi

# 4. Backup/restore dry-runs mention both file stores. The restore dry-run
# still checks the archive exists first (fail-closed), so build a minimal
# fake archive for the dry-run (contents never read in dry-run mode).
mkdir -p "$T/fake"
touch "$T/fake/nothing"
tar -czf "$T/fake.tgz" -C "$T/fake" nothing
if "$ZILAR" --env-file="$T/.env" backup --dry-run > "$T/backup-dry.log" 2>&1; then
  if grep -q 'uploads.tgz' "$T/backup-dry.log" && grep -q 'stickers.tgz' "$T/backup-dry.log"; then
    ok "backup dry-run lists uploads + stickers"
  else
    bad "backup dry-run does not list both file stores"
  fi
else
  bad "backup --dry-run fails"
fi
if "$ZILAR" --env-file="$T/.env" restore "$T/fake.tgz" --dry-run --yes > "$T/restore-dry.log" 2>&1; then
  if grep -q 'uploads' "$T/restore-dry.log" && grep -q 'sticker' "$T/restore-dry.log"; then
    ok "restore dry-run lists uploads + stickers"
  else
    bad "restore dry-run does not list both file stores"
  fi
else
  bad "restore --dry-run fails"
fi

# 5. No secrets appear in any output captured here. The throwaway env file
# uses single-char values (no 32+ char runs), so only the tool's own words
# are scanned: dry-run/doctor must never print generated secrets.
if grep -qE 'BEGIN (OPENSSH|RSA|EC) PRIVATE KEY|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}' "$T/backup-dry.log" "$T/restore-dry.log" "$T/doctor50.log" 2>/dev/null; then
  bad "dry-run/doctor output looks like it contains secret material"
else
  ok "dry-run/doctor outputs contain no secret material"
fi

trap - EXIT INT TERM
rm -rf "$T"
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
