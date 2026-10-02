#!/bin/sh
#
# ejabberd container entrypoint (production copy of
# infra/ejabberd/jwt-entrypoint.sh).
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
# The wrapper also registers the admin account listed in EJABBERD_MACRO_ADMIN
# on first start (the image's documented `REGISTER_ADMIN_PASSWORD` mechanism).
# It also writes the push component host (`push.<ZILAR_DOMAIN>`) into the
# config via push-entrypoint.sh (same directory): ejabberd does not expand
# macros in map keys, so the host is generated at container start and must
# equal PUSH_COMPONENT_JID in the server env. The wrapper fails fast when
# ejabberd refuses a bad configuration instead of looping on a restart
# policy.
set -eu

: "${ZILAR_XMPP_JWT_SECRET:?ZILAR_XMPP_JWT_SECRET is required}"
: "${ZILAR_DOMAIN:?ZILAR_DOMAIN is required for the push component host}"

JWK_PATH=/opt/ejabberd/conf/jwt.jwk

# base64url(secret) per RFC 7515 §2 ("+" -> "-", "/" -> "_", padding removed).
# busybox base64, tr and sed are the tools available in this image.
key=$(printf '%s' "$ZILAR_XMPP_JWT_SECRET" | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')

umask 077
cat > "$JWK_PATH" <<EOF
{"kty":"oct","k":"$key","alg":"HS256","use":"sig"}
EOF

# The config is baked into the image read-write (deploy/ejabberd/Dockerfile),
# so the push host is written in place. push-entrypoint.sh refuses to start
# when its marker is missing, so a bad config edit fails loudly here.
"$(dirname -- "$0")/push-entrypoint.sh" /opt/ejabberd/conf/ejabberd.yml

exec /sbin/tini -- ejabberdctl "$@"
