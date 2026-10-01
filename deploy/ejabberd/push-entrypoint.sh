#!/bin/sh
#
# ejabberd container entrypoint step (production): write the push component
# host into the config before the JWT step hands over to ejabberd.
#
# ejabberd does not expand macros in map keys, so the `ejabberd_service`
# host (`push.<install domain>`) cannot be a macro like everything else in
# deploy/ejabberd/ejabberd.yml. This step replaces the
# `# GALENA_PUSH_COMPONENT_HOST` marker line with the literal host derived
# from GALENA_DOMAIN, and refuses to start when the marker is missing (a
# config edit that drops it must fail loudly, never ship a wrong host).
# The secret stays a macro (EJABBERD_MACRO_PUSH_COMPONENT_SECRET); only
# the host key needs this treatment.
#
# Called by deploy/ejabberd/jwt-entrypoint.sh. The config file is baked
# into the image and edited in place (it persists in the container layer
# across stop/start, which is why the script exits 0 when the literal host
# is already present).
#
# The replacement below deliberately matches a whole line (leading spaces,
# then the old host value, then the marker comment): it must never match a
# YAML comment line, so the comment text on the lines ABOVE the marker must
# not contain the marker string on its own line.
set -eu

: "${GALENA_DOMAIN:?GALENA_DOMAIN is required}"
: "${1:?usage: push-entrypoint.sh <ejabberd.yml path>}"

CONFIG_PATH="$1"
PUSH_HOST="push.$GALENA_DOMAIN"

# Restart-safe: the config persists in the container layer across stop/start,
# so a second run must be a no-op, not a failure. When neither the marker nor
# the literal host line is present, the file is truly unexpected — fail loudly
# instead of guessing.
if grep -q "^[[:space:]]*$PUSH_HOST:[[:space:]]*$" "$CONFIG_PATH"; then
  exit 0
fi
if ! grep -q 'GALENA_PUSH_COMPONENT_HOST' "$CONFIG_PATH"; then
  echo "push-entrypoint: error: no GALENA_PUSH_COMPONENT_HOST marker in $CONFIG_PATH — refusing to guess the component host" >&2
  exit 1
fi

# The host key is YAML-indented under `hosts:` (six spaces). The domain was
# validated by `./galena init` (letters, digits, dots, hyphens, one optional
# :port — no spaces, slashes or `$`), so it cannot break the line shape.
# Portable in-place edit: `sed -i` needs an argument on BSD (a backup
# suffix) but takes the script directly on GNU, so always pass a backup
# suffix and remove it afterwards — works on both. The replacement touches
# only the host key text: the marker comment is stripped, and the existing
# `password:` line underneath is left alone (an earlier version re-added it
# and duplicated the line).
sed -i.bak "s|^\\( *\\)[^ \t#][^:]*:[ \t]*# GALENA_PUSH_COMPONENT_HOST$|\\1$PUSH_HOST:|" "$CONFIG_PATH"
rm -f "$CONFIG_PATH.bak"

if ! grep -q "^[[:space:]]*$PUSH_HOST:[[:space:]]*$" "$CONFIG_PATH"; then
  echo "push-entrypoint: error: failed to write the push component host into $CONFIG_PATH" >&2
  exit 1
fi
