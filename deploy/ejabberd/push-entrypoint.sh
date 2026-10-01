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
# into the image read-write (the bind-mounted copy in the plain compose
# stack is read-only, so the plain stack runs the same sed against a temp
# copy instead — see the entrypoint).
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

if ! grep -q 'GALENA_PUSH_COMPONENT_HOST' "$CONFIG_PATH"; then
  echo "push-entrypoint: error: no GALENA_PUSH_COMPONENT_HOST marker in $CONFIG_PATH — refusing to guess the component host" >&2
  exit 1
fi

# The host key is YAML-indented under `hosts:` (six spaces). The domain was
# validated by `./galena init` (letters, digits, dots, hyphens, one optional
# :port — no spaces, slashes or `$`), so it cannot break the line shape.
# GNU and BSD sed both take the script after -i (BSD wants an empty backup
# suffix as a separate argument), so pick the flag by probing. The
# replacement touches only the host key text: the marker comment is
# stripped, and the existing `password:` line underneath is left alone
# (an earlier version re-added it and duplicated the line).
if sed --version >/dev/null 2>&1; then
  _sed_inplace="sed -i"
else
  _sed_inplace="sed -i ''"
fi
$_sed_inplace "s|^\\( *\\)[^ \t#][^:]*:[ \t]*# GALENA_PUSH_COMPONENT_HOST$|\\1$PUSH_HOST:|" "$CONFIG_PATH"

if ! grep -q "^[[:space:]]*$PUSH_HOST:[[:space:]]*$" "$CONFIG_PATH"; then
  echo "push-entrypoint: error: failed to write the push component host into $CONFIG_PATH" >&2
  exit 1
fi
