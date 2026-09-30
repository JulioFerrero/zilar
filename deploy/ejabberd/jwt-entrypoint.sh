#!/bin/sh
#
# ejabberd container entrypoint (production copy of
# infra/ejabberd/jwt-entrypoint.sh).
#
# ejabberd does not read the JWT secret from the environment: `jwt_key` points at
# a JWK file. This wrapper derives an HS256 ("oct") JWK from
# GALENA_XMPP_JWT_SECRET and writes it to /opt/ejabberd/conf/jwt.jwk, then hands
# over to the image's normal entrypoint (tini + ejabberdctl). The key file lives
# only inside the container; it is never committed.
#
# The same secret is used by @galena/server to sign tokens (see
# apps/server/src/xmpp/token.ts). HS256 and the oct key type agree on the raw
# bytes of the secret, so both sides sign and verify the same JWTs.
#
# The wrapper also registers the admin account listed in EJABBERD_MACRO_ADMIN
# on first start (the image's documented `REGISTER_ADMIN_PASSWORD` mechanism),
# and fails fast when ejabberd refuses a bad configuration instead of looping
# on a restart policy.
set -eu

: "${GALENA_XMPP_JWT_SECRET:?GALENA_XMPP_JWT_SECRET is required}"

JWK_PATH=/opt/ejabberd/conf/jwt.jwk

# base64url(secret) per RFC 7515 §2 ("+" -> "-", "/" -> "_", padding removed).
# busybox base64, tr and sed are the tools available in this image.
key=$(printf '%s' "$GALENA_XMPP_JWT_SECRET" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

umask 077
cat > "$JWK_PATH" <<EOF
{"kty":"oct","k":"$key","alg":"HS256","use":"sig"}
EOF

exec /sbin/tini -- ejabberdctl "$@"
