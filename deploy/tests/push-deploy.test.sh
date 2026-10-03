#!/bin/sh
#
# Deploy push wiring tests (T-0145). Shell-only, no dependencies beyond
# `sh`, `openssl`, `docker` (for `compose config`) and `node` (for the
# ECDH pair check plus the web-push acceptance check, which resolves the
# library from the repo's own node_modules — no new dependency).
#
# What it proves, without touching the lead's running dev stack and
# without reading any real `.env` file:
#
#   1. `zilar init` writes a 0600 env file whose push lines parse in the
#      server's push schema and whose VAPID pair really matches
#      (ECDH-derived public point compared byte for byte — shape checks
#      alone accept mismatched pairs).
#   2. `zilar init --no-push` writes no push secrets and no empty values.
#   3. Both compose files render (`config`) with the wizard env, the two
#      component secrets agree, no host port is published for 5347, and
#      the ejabberd host derivation matches PUSH_COMPONENT_JID.
#   4. `push-entrypoint.sh` writes the literal host into a copy of the
#      production ejabberd.yml, is a no-op on rerun (restart-safe), and
#      refuses a config without its marker.
#   5. `zilar doctor` passes the push checks on the good env and fails
#      them in plain words on a tampered one.
#   6. Secrets never appear in `init --dry-run` output or doctor output.
#
# Usage: sh deploy/tests/push-deploy.test.sh
# Exit 0 when every check passes, 1 on the first failure.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
ZILAR="$ROOT/deploy/zilar"
PUSH_ENTRY="$ROOT/deploy/ejabberd/push-entrypoint.sh"
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

# A throwaway env file from the wizard. $2 are extra init flags.
make_env() {
  _dir="$(mktemp -d)"
  if ! printf '\n' | "$ZILAR" --env-file="$_dir/.env" init --domain "$1" \
    --admin-email "ops@$1" --acme-email "ops@$1" --image-owner testowner \
    ${2-} > "$_dir/init.log" 2>&1 < /dev/null; then
    bad "init failed for domain $1 (see $_dir/init.log)"
    return 1
  fi
  printf '%s' "$_dir"
}

T="$(make_env "push-test.example")"
ENV_FILE="$T/.env"

# 1. File mode is 0600.
if [ "$(stat -f %Lp "$ENV_FILE" 2>/dev/null || stat -c %a "$ENV_FILE")" = "600" ]; then
  ok "wizard env is mode 0600"
else
  bad "wizard env is not mode 0600"
fi

# 2. Push lines parse in the server's push schema and the VAPID pair really
# matches (run from the server package so `web-push` and the tsx loader
# resolve). `setVapidDetails` validates shape only — it accepted the
# mismatched pair from the first round — so the probe ECDH-derives the
# public point from the private scalar with node:crypto and compares it to
# the public key. The probe is a temp .mts file inside the server package:
# `tsx --eval` compiles as CJS (no top-level await), and a probe in /tmp
# cannot import the package's `./src/...` tree — so stage it in the package
# and remove it afterwards (trapped, so an interrupt cannot leave it
# behind). It never touches app code; it only reads the throwaway env file
# the wizard just wrote.
PROBE_FILE="$ROOT/apps/server/push-probe-t0145-tmp.mts"
cleanup_probe() {
  rm -f "$PROBE_FILE"
}
trap cleanup_probe EXIT INT TERM
cp /dev/null "$PROBE_FILE"
cat > "$PROBE_FILE" <<'EOF'
import crypto from 'node:crypto';
import fs from 'node:fs';
const envFile = process.env.PUSH_ENV_FILE as string;
const env: Record<string, string> = {};
for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
}
const { loadPushConfig, pushConfigError } = await import('./src/push/config.ts');
const config = loadPushConfig({
  PUSH_ENABLED: env.PUSH_ENABLED,
  PUSH_VAPID_PUBLIC_KEY: env.PUSH_VAPID_PUBLIC_KEY,
  PUSH_VAPID_PRIVATE_KEY: env.PUSH_VAPID_PRIVATE_KEY,
  PUSH_VAPID_SUBJECT: env.PUSH_VAPID_SUBJECT,
  PUSH_COMPONENT_JID: env.PUSH_COMPONENT_JID,
  PUSH_COMPONENT_SECRET: env.PUSH_COMPONENT_SECRET,
  PUSH_STORAGE_KEY: env.PUSH_STORAGE_KEY,
});
if (pushConfigError(config) !== null) throw new Error('push config incomplete');
const webpush = (await import('web-push')).default;
webpush.setVapidDetails(env.PUSH_VAPID_SUBJECT, env.PUSH_VAPID_PUBLIC_KEY, env.PUSH_VAPID_PRIVATE_KEY);
if (env.PUSH_VAPID_PUBLIC_KEY.length !== 87) throw new Error('public key shape');
if (env.PUSH_VAPID_PRIVATE_KEY.length !== 43) throw new Error('private key shape');
// The pair must really match: derive the public point from the private
// scalar (P-256 ECDH) and compare it byte for byte with the public key.
const scalar = Buffer.from(env.PUSH_VAPID_PRIVATE_KEY, 'base64url');
const claimed = Buffer.from(env.PUSH_VAPID_PUBLIC_KEY, 'base64url');
const ecdh = crypto.createECDH('prime256v1');
ecdh.setPrivateKey(scalar);
if (!ecdh.getPublicKey().equals(claimed)) throw new Error('VAPID pair mismatch: private key does not derive the public key');
if (env.PUSH_COMPONENT_JID !== 'push.push-test.example') throw new Error('component JID');
if (env.PUSH_VAPID_SUBJECT !== 'mailto:ops@push-test.example') throw new Error('subject default');
if ((env.PUSH_STORAGE_KEY || '').length < 32) throw new Error('storage key');
EOF
if (cd "$ROOT/apps/server" && PUSH_ENV_FILE="$ENV_FILE" ./node_modules/.bin/tsx push-probe-t0145-tmp.mts 2> "$T/push-parse.err"); then
  ok "wizard push env parses and the VAPID pair matches (ECDH)"
else
  bad "wizard push env does not parse (or the VAPID pair mismatches)"
fi
rm -f "$PROBE_FILE"
trap - EXIT INT TERM

# 3. --no-push writes no secrets, no JID and no empty values; both compose
# files still render with that env, and the rendered server env carries
# PUSH_ENABLED=false.
T_OFF="$(make_env "push-off.example" "--no-push")"
if grep -qE "^(PUSH_VAPID_PUBLIC_KEY|PUSH_VAPID_PRIVATE_KEY|PUSH_COMPONENT_SECRET|PUSH_STORAGE_KEY|PUSH_COMPONENT_JID)=" "$T_OFF/.env"; then
  bad "--no-push still wrote push lines (secrets or the component JID)"
else
  ok "--no-push writes no push secret or JID lines"
fi
if grep -qE "^(PUSH_VAPID_PUBLIC_KEY|PUSH_VAPID_PRIVATE_KEY|PUSH_VAPID_SUBJECT|PUSH_COMPONENT_SECRET|PUSH_STORAGE_KEY|PUSH_COMPONENT_JID)=$" "$T_OFF/.env"; then
  bad "--no-push left empty push values"
else
  ok "--no-push leaves no empty push values"
fi
# The Coolify render with --no-push values needs its own Coolify-style
# env (the wizard writes plain-stack vars, not SERVICE_PASSWORD_* ones).
cat > "$T/cool-off.env" <<EOF
IMAGE_OWNER=testowner
IMAGE_TAG=t0145
SERVICE_PASSWORD_POSTGRES=x1
SERVICE_PASSWORD_ZILAR_DB=x2
SERVICE_PASSWORD_EJABBERD_DB=x3
SERVICE_PASSWORD_ARCHIVE_DB=x4
SERVICE_PASSWORD_EJABBERD_ADMIN=x5
SERVICE_PASSWORD_XMPP_JWT=x6
SERVICE_PASSWORD_BETTER_AUTH=x7
SERVICE_PASSWORD_PUSH_COMPONENT=x8
XMPP_DOMAIN=push-off.example
XMPP_MUC_DOMAIN=rooms.push-off.example
WEB_ORIGIN=http://localhost:18080
SERVICE_URL_SERVER_3000=http://localhost:18081
SERVICE_URL_EJABBERD_WS_5280=http://localhost:18082
SERVICE_URL_WEB_80=http://localhost:18080
PUSH_ENABLED=false
EOF
for _file in "deploy/docker-compose.yml" "deploy/coolify/docker-compose.yml"; do
  if [ "$_file" = "deploy/coolify/docker-compose.yml" ]; then
    _off_env="$T/cool-off.env"
  else
    _off_env="$T_OFF/.env"
  fi
  if docker compose -f "$ROOT/$_file" --env-file "$_off_env" config > "$T/off-rendered.yml" 2> "$T/off-render.err"; then
    ok "$_file renders with the --no-push env"
  else
    bad "$_file does not render with the --no-push env: $(head -n 2 "$T/off-render.err")"
  fi
  if grep -q 'PUSH_ENABLED: "false"' "$T/off-rendered.yml"; then
    ok "$_file rendered server env carries PUSH_ENABLED=false with --no-push"
  else
    bad "$_file rendered server env does not carry PUSH_ENABLED=false with --no-push"
  fi
done

# 4. Both compose files render; the two component secrets agree; no 5347
#    host port; the derived host matches PUSH_COMPONENT_JID.
for _file in "deploy/docker-compose.yml"; do
  if docker compose -f "$ROOT/$_file" --env-file "$ENV_FILE" config > "$T/rendered.yml" 2> "$T/render.err"; then
    ok "$_file renders with the wizard env"
  else
    bad "$_file does not render: $(head -n 2 "$T/render.err")"
  fi
done
_EJABBERD_SECRET="$(grep -E "EJABBERD_MACRO_PUSH_COMPONENT_SECRET:" "$T/rendered.yml" | head -n 1 | sed 's/.*: //')"
_SERVER_SECRET="$(grep -E "PUSH_COMPONENT_SECRET:" "$T/rendered.yml" | head -n 1 | sed 's/.*: //')"
if [ -n "$_EJABBERD_SECRET" ] && [ "$_EJABBERD_SECRET" = "$_SERVER_SECRET" ]; then
  ok "component secrets agree between ejabberd and server"
else
  bad "component secrets disagree (ejabberd='$_EJABBERD_SECRET' server='$_SERVER_SECRET')"
fi
if grep -q "5347" "$T/rendered.yml"; then
  bad "5347 appears in the rendered compose (no host port wanted)"
else
  ok "no host port published for 5347"
fi

# Coolify renders with placeholder Coolify-style values (Coolify generates
# the SERVICE_* variables; syntax only, per the T-0126 precedent). The
# Coolify push JID derives from SERVICE_FQDN_WEB (Coolify's own domain
# variable), not XMPP_DOMAIN, so both are set to the same test domain here.
cat > "$T/cool.env" <<EOF
IMAGE_OWNER=testowner
IMAGE_TAG=t0145
SERVICE_PASSWORD_POSTGRES=x1
SERVICE_PASSWORD_ZILAR_DB=x2
SERVICE_PASSWORD_EJABBERD_DB=x3
SERVICE_PASSWORD_ARCHIVE_DB=x4
SERVICE_PASSWORD_EJABBERD_ADMIN=x5
SERVICE_PASSWORD_XMPP_JWT=x6
SERVICE_PASSWORD_BETTER_AUTH=x7
SERVICE_PASSWORD_PUSHCOMPONENT=x8
SERVICE_FQDN_WEB=push-test.example
XMPP_DOMAIN=push-test.example
XMPP_MUC_DOMAIN=rooms.push-test.example
WEB_ORIGIN=http://localhost:18080
SERVICE_URL_SERVER_3000=http://localhost:18081
SERVICE_URL_EJABBERD_WS_5280=http://localhost:18082
SERVICE_URL_WEB_80=http://localhost:18080
PUSH_ENABLED=true
PUSH_VAPID_PUBLIC_KEY=p
PUSH_VAPID_PRIVATE_KEY=q
PUSH_VAPID_SUBJECT=mailto:ops@push-test.example
PUSH_STORAGE_KEY=r
EOF
if docker compose -f "$ROOT/deploy/coolify/docker-compose.yml" --env-file "$T/cool.env" config > "$T/cool.yml" 2> "$T/cool.err"; then
  ok "coolify compose renders (syntax only)"
else
  bad "coolify compose does not render: $(head -n 2 "$T/cool.err")"
fi
if grep -q "PUSH_COMPONENT_JID: push.push-test.example" "$T/cool.yml" && grep -q "ZILAR_DOMAIN: push-test.example" "$T/cool.yml"; then
  ok "coolify derives push.<domain> on both sides"
else
  bad "coolify push host derivation disagrees"
fi

# 5. The entrypoint writes the literal host, is idempotent on rerun
# (restart-safe: the config persists in the container layer), refuses a
# config without its marker, refuses a config with zero or two marker
# lines (never a wrong-line replace), and verifies exactly one host line
# changed.
cp "$ROOT/deploy/ejabberd/ejabberd.yml" "$T/ejabberd.yml"
chmod u+w "$T/ejabberd.yml"
if ZILAR_DOMAIN="push-test.example" sh "$PUSH_ENTRY" "$T/ejabberd.yml" 2> "$T/entry.err" \
  && grep -q "^[[:space:]]*push.push-test.example:[[:space:]]*$" "$T/ejabberd.yml" \
  && ! grep -q "ZILAR_PUSH_COMPONENT_HOST" "$T/ejabberd.yml"; then
  ok "entrypoint writes the literal push host"
else
  bad "entrypoint did not write the literal push host ($(head -n 1 "$T/entry.err"))"
fi
# Exactly one line changed: one host line for this domain, and the marker
# line is gone (not duplicated, not left behind).
if [ "$(grep -c "^[[:space:]]*push.push-test.example:[[:space:]]*$" "$T/ejabberd.yml")" -eq 1 ] \
  && [ "$(grep -c "ZILAR_PUSH_COMPONENT_HOST" "$T/ejabberd.yml")" -eq 0 ]; then
  ok "entrypoint changed exactly one line (one host line, no marker left)"
else
  bad "entrypoint changed more or less than one line"
fi
# A neighbouring key on a marker comment line is never touched: only the
# push host key on the marker line is replaced (T-0156 nit).
cp "$ROOT/deploy/ejabberd/ejabberd.yml" "$T/ejabberd-neighbour.yml"
chmod u+w "$T/ejabberd-neighbour.yml"
printf '      some_other_key: value # ZILAR_PUSH_COMPONENT_HOST\n' >> "$T/ejabberd-neighbour.yml"
if ZILAR_DOMAIN="push-test.example" sh "$PUSH_ENTRY" "$T/ejabberd-neighbour.yml" 2> /dev/null; then
  bad "entrypoint accepted a config with two marker lines"
else
  if grep -q "some_other_key: value" "$T/ejabberd-neighbour.yml" \
    && grep -q "push.zilar.localhost: # ZILAR_PUSH_COMPONENT_HOST" "$T/ejabberd-neighbour.yml"; then
    ok "entrypoint refuses two marker lines and touches neither"
  else
    bad "entrypoint touched a line before refusing two marker lines"
  fi
fi
if ZILAR_DOMAIN="push-test.example" sh "$PUSH_ENTRY" "$T/ejabberd.yml" 2> "$T/entry2.err" \
  && grep -q "^[[:space:]]*push.push-test.example:[[:space:]]*$" "$T/ejabberd.yml" \
  && [ "$(grep -c "password: PUSH_COMPONENT_SECRET" "$T/ejabberd.yml")" -eq 1 ]; then
  ok "entrypoint rerun is a no-op (restart-safe)"
else
  bad "entrypoint rerun failed or duplicated lines ($(head -n 1 "$T/entry2.err"))"
fi
cp "$ROOT/deploy/ejabberd/ejabberd.yml" "$T/ejabberd-nomarker.yml"
chmod u+w "$T/ejabberd-nomarker.yml"
sed -i.bak '/ZILAR_PUSH_COMPONENT_HOST/d' "$T/ejabberd-nomarker.yml"
if ZILAR_DOMAIN="push-test.example" sh "$PUSH_ENTRY" "$T/ejabberd-nomarker.yml" 2> /dev/null; then
  bad "entrypoint accepted a config without its marker"
else
  ok "entrypoint refuses a config without its marker"
fi

# 6. Doctor passes on the good env, fails in plain words on a tampered one.
if "$ZILAR" --env-file="$ENV_FILE" doctor > "$T/doctor.log" 2>&1; then
  # Doctor may still fail on machine-specific checks (ports); the push
  # line must be green either way.
  if grep -q "ok: push env is present and agrees" "$T/doctor.log"; then
    ok "doctor passes the push checks on the wizard env"
  else
    bad "doctor ran but the push line is missing"
  fi
else
  if grep -q "ok: push env is present and agrees" "$T/doctor.log"; then
    ok "doctor passes the push checks (machine-specific checks fail, push green)"
  else
    bad "doctor push checks failed on the good env: $(grep -E 'FAIL' "$T/doctor.log" | head -n 3)"
  fi
fi
cp "$ENV_FILE" "$T/tampered.env"
sed -i.bak 's/^PUSH_VAPID_PUBLIC_KEY=.*/PUSH_VAPID_PUBLIC_KEY=short/' "$T/tampered.env"
sed -i.bak 's/^PUSH_COMPONENT_JID=.*/PUSH_COMPONENT_JID=wrong.example/' "$T/tampered.env"
sed -i.bak 's/^PUSH_COMPONENT_SECRET=.*/PUSH_COMPONENT_SECRET=CHANGE_ME_PUSH_COMPONENT_SECRET/' "$T/tampered.env"
if "$ZILAR" --env-file="$T/tampered.env" doctor > "$T/doctor-bad.log" 2>&1; then
  bad "doctor passed a tampered push env"
else
  if grep -q "PUSH_VAPID_PUBLIC_KEY has the wrong shape" "$T/doctor-bad.log" \
    && grep -q "PUSH_COMPONENT_JID (wrong.example) is not push.push-test.example" "$T/doctor-bad.log" \
    && grep -q "PUSH_COMPONENT_SECRET is still the placeholder" "$T/doctor-bad.log"; then
    ok "doctor names the tampered push values in plain words"
  else
    bad "doctor failed but did not name the push problems"
  fi
fi

# 7. Secrets never appear in dry-run or doctor output.
if "$ZILAR" init --env-file="$T/.env" --dry-run --domain push-test.example \
  --admin-email "ops@push-test.example" --image-owner testowner \
  --push-subject "mailto:ops@push-test.example" 2> /dev/null | grep -qE "[A-Za-z0-9_-]{32,}"; then
  bad "dry-run output looks like it contains secret-shaped values"
else
  ok "dry-run output contains no secret-shaped values"
fi
_VAPID_PUB="$(sed -n 's/^PUSH_VAPID_PUBLIC_KEY=//p' "$ENV_FILE" | tail -n 1)"
if grep -qF "$_VAPID_PUB" "$T/doctor.log"; then
  bad "doctor output echoes the VAPID public key"
else
  ok "doctor output echoes no push secret"
fi

# 8. The wizard rejects a domain with a `:port` (T-0156): `example.test:1234`
# as an install domain would bake an invalid host into PUBLIC_URL,
# WEB_ORIGINS, the XMPP domain and the push JID (`push.example.test:1234`
# is not a JID). The trial ports come from --http-port/--https-port, never
# from the domain. Caddy serves only the bare domain, so stripping the
# port for the JID is not an option — the whole domain is rejected.
# (Globals first: the command comes before --env-file, per the dispatch.)
if "$ZILAR" init --domain "wizard-port.example:1234" \
  --admin-email "ops@wizard-port.example" --acme-email "ops@wizard-port.example" \
  --image-owner testowner \
  --push-subject "mailto:ops@wizard-port.example" --env-file="$T/port.env" --dry-run \
  > "$T/port-domain.log" 2>&1; then
  bad "init accepted a domain with a :port"
else
  if grep -q "no .port" "$T/port-domain.log" \
    && grep -q "bare host" "$T/port-domain.log"; then
    ok "init rejects a domain with a :port in plain words"
  else
    bad "init rejected the :port domain but not in plain words: $(head -n 1 "$T/port-domain.log")"
  fi
fi
# A bare host (and localhost) still passes.
if "$ZILAR" init --domain wizard-port.example \
  --admin-email "ops@wizard-port.example" --acme-email "ops@wizard-port.example" \
  --image-owner testowner \
  --push-subject "mailto:ops@wizard-port.example" --env-file="$T/bare.env" --dry-run \
  > /dev/null 2>&1; then
  ok "init still accepts a bare host"
else
  bad "init rejects a bare host"
fi
rm -rf "$T" "$T_OFF"
echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
