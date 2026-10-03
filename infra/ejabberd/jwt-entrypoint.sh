#!/bin/sh
#
# ejabberd container entrypoint.
#
# ejabberd does not read the JWT secret from the environment: `jwt_key` points at
# a JWK file. This wrapper derives an HS256 ("oct") JWK from
# ZILAR_XMPP_JWT_SECRET and writes it to /opt/ejabberd/conf/jwt.jwk, then hands
# over to the image's normal entrypoint (tini + ejabberdctl). The key file lives
# only inside the container; it is never committed.
#
# The same secret is used by @zilar/server to sign tokens (see
# apps/server/src/xmpp/token.ts). HS256 and the oct key type agree on the raw
# bytes of the secret, so both sides sign and verify the same JWTs.
#
# The wrapper also registers the admin account in EJABBERD_MACRO_ADMIN from
# EJABBERD_ADMIN_PASSWORD (T-0167). It deliberately does NOT use the base
# image's documented `REGISTER_ADMIN_PASSWORD` mechanism: that path echoes
# the `ejabberdctl register ... <password>` command line into the container
# log, and logs get pasted into issues and shipped to log tools.
set -eu

: "${ZILAR_XMPP_JWT_SECRET:?ZILAR_XMPP_JWT_SECRET is required}"

JWK_PATH=/opt/ejabberd/conf/jwt.jwk

# base64url(secret) per RFC 7515 §2 ("+" -> "-", "/" -> "_", padding removed).
# busybox base64, tr and sed are the tools available in this image.
key=$(printf '%s' "$ZILAR_XMPP_JWT_SECRET" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

umask 077
cat > "$JWK_PATH" <<EOF
{"kty":"oct","k":"$key","alg":"HS256","use":"sig"}
EOF

# Register the admin account without ever printing the password (T-0167).
# The base image would echo `ejabberdctl register ... <password>` into the
# log via CTL_ON_CREATE, so REGISTER_ADMIN_PASSWORD must stay unset and the
# registration happens here instead: a background step waits (bounded) for
# the server to answer, then registers the account — or changes its password
# when the account already exists, so a password change in the environment
# still takes effect. All output of the register/change_password call is
# discarded and a failure prints a fixed message that names no secret, so
# the password never reaches the container log. The background step ignores
# the container's stop signals: a slow or stuck registration cannot delay
# `docker stop` (at most one 2s sleep), and when the main server process
# (the exec below) exits the step dies with it.
if [ -z "${EJABBERD_ADMIN_PASSWORD-}" ] || [ -z "${EJABBERD_MACRO_ADMIN-}" ]; then
  echo "admin-register: warning: EJABBERD_ADMIN_PASSWORD or EJABBERD_MACRO_ADMIN is unset; the admin account will not be registered" >&2
else
  (
    trap '' TERM INT HUP
    tries=0
    until ejabberdctl status > /dev/null 2>&1; do
      tries=$((tries + 1))
      if [ "$tries" -ge 60 ]; then
        echo "admin-register: error: ejabberd did not answer within 120s; admin account was not registered" >&2
        exit 1
      fi
      sleep 2
    done
    user="${EJABBERD_MACRO_ADMIN%%@*}"
    host="${EJABBERD_MACRO_ADMIN##*@}"
    if ejabberdctl check_account "$user" "$host" > /dev/null 2>&1; then
      if ! ejabberdctl change_password "$user" "$host" "$EJABBERD_ADMIN_PASSWORD" > /dev/null 2>&1; then
        echo "admin-register: error: could not set the admin account password" >&2
        exit 1
      fi
    elif ! ejabberdctl register "$user" "$host" "$EJABBERD_ADMIN_PASSWORD" > /dev/null 2>&1; then
      echo "admin-register: error: could not register the admin account" >&2
      exit 1
    fi
  ) < /dev/null &
fi

exec /sbin/tini -- ejabberdctl "$@"
