# shellcheck shell=sh
#
# coolify-mode — the installer's Coolify path (docs/deploy/one-line-install-plan.md
# step 5). Sourced by deploy/install.sh from the fetched release, after
# deploy/lib/coolify-api.sh and before deploy/lib/preflight.sh.
#
# When the host report finds Coolify, preflight_decide calls coolify_run: it asks
# for a Coolify API token (read without echo, kept in a root-only file) and builds
# the target layout (deploy/coolify/LAYOUT.md) through Coolify's API — project
# "Zilar", the zilar-core Service, the zilar-server and zilar-web image Apps,
# generated secrets, volumes, deploys, a health wait, AI computers when the
# sandbox passes, a root-only secrets copy and the first invite code. It reuses
# install.sh's helpers (die/info/warn/phase/ask/consent/run/desk_sandbox) and its
# variables (DRY_RUN, YES, DOMAIN, ADMIN_EMAIL, DESKS, SUDO, VERSION, IMAGE_OWNER,
# _root). Nothing here has been run against a live Coolify: the rehearsal does it.

COOLIFY_URL="" COOLIFY_API="" COOLIFY_TMP="" COOLIFY_TOKEN_FILE="" COOLIFY_IMAGE_TAG=""
COOLIFY_SERVER_UUID="" COOLIFY_DESTINATION_UUID="" COOLIFY_PROJECT_UUID="" COOLIFY_CORE_UUID=""
COOLIFY_SERVER_APP_UUID="" COOLIFY_WEB_APP_UUID="" COOLIFY_DESK_IMAGE=""
COOLIFY_POSTGRES_PASSWORD="" COOLIFY_ZILAR_DB_PASSWORD="" COOLIFY_EJABBERD_DB_PASSWORD=""
COOLIFY_ARCHIVE_DB_PASSWORD="" COOLIFY_EJABBERD_ADMIN_PASSWORD="" COOLIFY_XMPP_JWT_SECRET=""
COOLIFY_PUSH_COMPONENT_SECRET="" COOLIFY_BETTER_AUTH_SECRET="" COOLIFY_KEY_ENCRYPTION_KEY=""

# A generated secret: 48 hex chars, so it clears the 32-character minimum the
# server enforces (BETTER_AUTH_SECRET, ZILAR_KEY_ENCRYPTION_KEY,
# ZILAR_XMPP_JWT_SECRET) and stays URL-safe where it goes into DATABASE_URL.
_cm_secret() {
  if [ "$DRY_RUN" -eq 1 ]; then printf 'CHANGE_ME'; return 0; fi
  openssl rand -hex 24
}

# The `{ data: [...] }` envs/bulk body, from "KEY=VALUE" lines on stdin.
# is_literal keeps Coolify from interpolating the value (a `$` in a password).
_cm_envs_body() {
  jq -nc --argjson data "$(jq -R -s 'split("\n") | map(select(length > 0))
    | map(split("=") | {key: .[0], value: (.[1:] | join("=")), is_literal: true})')" '{data: $data}'
}

# A created resource's uuid, or a placeholder under --dry-run (the API returns
# nothing then, and the flow must still print the calls that follow).
_cm_created_uuid() {
  if [ "$DRY_RUN" -eq 1 ]; then printf '<%s-uuid>' "$1"; else jq -r '.uuid'; fi
}

# --- inputs and checks --------------------------------------------------

coolify_collect_inputs() {
  COOLIFY_URL="${ZILAR_COOLIFY_URL:-http://localhost:8000}"
  COOLIFY_API="${COOLIFY_URL%/}/api/v1"
  COOLIFY_TMP="$(mktemp -d "${_tmp:-${TMPDIR:-/tmp}}/zilar-coolify.XXXXXX")"
  chmod 700 "$COOLIFY_TMP"
  # A v* release keeps its own image tag; every other ref pulls :latest (CI
  # publishes :latest, never :main) — the same rule as phase_configure.
  case "$VERSION" in v*) COOLIFY_IMAGE_TAG="$VERSION" ;; *) COOLIFY_IMAGE_TAG="latest" ;; esac
  if [ "$DRY_RUN" -eq 1 ]; then
    [ -n "$DOMAIN" ] || DOMAIN="chat.example.com"
    info "dry run: Coolify mode would install Zilar on https://$DOMAIN through $COOLIFY_API"
    return 0
  fi
  command -v jq >/dev/null 2>&1 ||
    die "Coolify mode needs 'jq' to build the API bodies (install it: apt-get install -y jq)"
  command -v openssl >/dev/null 2>&1 ||
    die "Coolify mode needs 'openssl' to generate the secrets (install it: apt-get install -y openssl)"
  info "using jq $(jq --version)"
  [ -n "$DOMAIN" ] || DOMAIN="$(ask 'Public domain for Zilar (e.g. chat.example.com)')"
  [ -n "$DOMAIN" ] || die "a public domain is required"
  [ -n "$ADMIN_EMAIL" ] || ADMIN_EMAIL="$(ask 'Admin email address')"
  [ -n "$ADMIN_EMAIL" ] || die "an admin email is required"
  coolify_read_token
}

# The token is read without echo and only ever written to a root-only file that
# _api_request hands curl with `-H @file`, so it never reaches argv or a log.
coolify_read_token() {
  _token=""
  if [ "$YES" -eq 1 ]; then
    _token="${ZILAR_COOLIFY_TOKEN:-}"
    [ -n "$_token" ] || die "--yes needs ZILAR_COOLIFY_TOKEN (create one in Coolify under Keys & Tokens)"
  else
    printf 'Coolify API token (create one under Keys & Tokens; input hidden): ' >&2
    if ( : < /dev/tty ) 2>/dev/null; then
      _tty_state="$(stty -g < /dev/tty 2>/dev/null || true)"
      stty -echo < /dev/tty 2>/dev/null || true
      IFS= read -r _token < /dev/tty || _token=""
      [ -z "$_tty_state" ] || stty "$_tty_state" < /dev/tty 2>/dev/null || true
      echo "" >&2
    else
      IFS= read -r _token || _token=""
    fi
    [ -n "$_token" ] || die "no Coolify token given"
  fi
  COOLIFY_TOKEN_FILE="$COOLIFY_TMP/token"
  ( umask 077; printf 'Authorization: Bearer %s\n' "$_token" >"$COOLIFY_TOKEN_FILE" )
  unset _token
}

coolify_check_version() {
  _version="$(coolify_api_version)"
  [ "$DRY_RUN" -eq 1 ] && return 0
  if coolify_api_version_is_old "$_version"; then
    warn "Coolify $_version is older than 4.4; the POST /services and envs/bulk calls may differ"
  fi
}

# The server this host is on (localhost / host.docker.internal, or the only one),
# and its destination only when it has more than one.
coolify_pick_server() {
  _servers="$(coolify_api_servers)"
  if [ "$DRY_RUN" -eq 1 ]; then COOLIFY_SERVER_UUID="<server-uuid>"; return 0; fi
  printf '%s' "$_servers" | jq -e 'type == "array"' >/dev/null 2>&1 ||
    die "unexpected GET /servers answer from Coolify"
  COOLIFY_SERVER_UUID="$(printf '%s' "$_servers" | jq -r \
    '[.[] | select(.name == "localhost" or .ip == "host.docker.internal" or .ip == "127.0.0.1")][0].uuid // empty')"
  if [ -z "$COOLIFY_SERVER_UUID" ]; then
    if [ "$(printf '%s' "$_servers" | jq -r 'length')" = "1" ]; then
      COOLIFY_SERVER_UUID="$(printf '%s' "$_servers" | jq -r '.[0].uuid')"
    else
      printf '%s\n' "$_servers" | jq -r '.[] | "    \(.name)  \(.uuid)  \(.ip // "")"' >&2
      _answer="$(ask 'Server uuid to install on')"
      COOLIFY_SERVER_UUID="$(printf '%s' "$_servers" | jq -r --arg u "$_answer" '.[] | select(.uuid == $u) | .uuid')"
      [ -n "$COOLIFY_SERVER_UUID" ] || die "no Coolify server matches '$_answer'"
    fi
  fi
  info "using Coolify server $COOLIFY_SERVER_UUID"
  # GET /servers does not embed a server's destinations, so ask the endpoint.
  _destinations="$(coolify_api_destinations "$COOLIFY_SERVER_UUID")"
  _dests="$(printf '%s' "$_destinations" | jq -r 'length' 2>/dev/null || echo 0)"
  if [ "${_dests:-0}" -gt 1 ]; then
    COOLIFY_DESTINATION_UUID="$(printf '%s' "$_destinations" | jq -r '.[0].uuid')"
    info "using destination $COOLIFY_DESTINATION_UUID (of $_dests)"
  fi
}

# Find the "Zilar" project, or create it. If it is there with one of our
# resources in it, stop before changing anything.
coolify_find_or_create_project() {
  _projects="$(coolify_api_projects)"
  if [ "$DRY_RUN" -eq 1 ]; then
    COOLIFY_PROJECT_UUID="<project-uuid>"
    coolify_api_create_project '{"name":"Zilar"}' >/dev/null
    return 0
  fi
  _existing="$(printf '%s' "$_projects" | jq -r '[.[] | select(.name == "Zilar")][0] // empty')"
  if [ -z "$_existing" ]; then
    COOLIFY_PROJECT_UUID="$(coolify_api_create_project \
      "$(jq -nc '{name: "Zilar", description: "Zilar chat, created by the installer"}')" | _cm_created_uuid project)"
    [ -n "$COOLIFY_PROJECT_UUID" ] && [ "$COOLIFY_PROJECT_UUID" != "null" ] ||
      die "Coolify did not return a uuid for the new Zilar project"
    info "created the Coolify project Zilar ($COOLIFY_PROJECT_UUID)"
    return 0
  fi
  COOLIFY_PROJECT_UUID="$(printf '%s' "$_existing" | jq -r '.uuid')"
  if printf '%s' "$_existing" | jq -e \
    '((.services // []) + (.applications // [])) | any(.name == "zilar-core" or .name == "zilar-server" or .name == "zilar-web")' \
    >/dev/null 2>&1; then
    die "Zilar is already installed in Coolify (the Zilar project holds zilar-core); nothing was changed"
  fi
  # No resources in the payload: this projection does not say what the project
  # holds, so change nothing rather than create a second copy of the layout.
  printf '%s' "$_existing" | jq -e 'has("services") or has("applications")' >/dev/null 2>&1 ||
    die "the Coolify project Zilar already exists and this API does not list its resources; delete it in Coolify first — nothing was changed"
  info "using the existing Coolify project Zilar ($COOLIFY_PROJECT_UUID)"
}

coolify_generate_secrets() {
  COOLIFY_POSTGRES_PASSWORD="$(_cm_secret)"; COOLIFY_ZILAR_DB_PASSWORD="$(_cm_secret)"; COOLIFY_EJABBERD_DB_PASSWORD="$(_cm_secret)"
  COOLIFY_ARCHIVE_DB_PASSWORD="$(_cm_secret)"; COOLIFY_EJABBERD_ADMIN_PASSWORD="$(_cm_secret)"; COOLIFY_XMPP_JWT_SECRET="$(_cm_secret)"
  COOLIFY_PUSH_COMPONENT_SECRET="$(_cm_secret)"; COOLIFY_BETTER_AUTH_SECRET="$(_cm_secret)"; COOLIFY_KEY_ENCRYPTION_KEY="$(_cm_secret)"
}

# --- the three resources ------------------------------------------------

# zilar-core's variables
_coolify_core_envs() {
  printf '%s\n' \
    "IMAGE_OWNER=${IMAGE_OWNER:-julioferrero}" "IMAGE_TAG=$COOLIFY_IMAGE_TAG" "ZILAR_DOMAIN=$DOMAIN" \
    "POSTGRES_PASSWORD=$COOLIFY_POSTGRES_PASSWORD" "ZILAR_DB_PASSWORD=$COOLIFY_ZILAR_DB_PASSWORD" \
    "EJABBERD_DB_PASSWORD=$COOLIFY_EJABBERD_DB_PASSWORD" "ARCHIVE_DB_PASSWORD=$COOLIFY_ARCHIVE_DB_PASSWORD" \
    "EJABBERD_ADMIN_PASSWORD=$COOLIFY_EJABBERD_ADMIN_PASSWORD" "XMPP_JWT_SECRET=$COOLIFY_XMPP_JWT_SECRET" \
    "PUSH_COMPONENT_SECRET=$COOLIFY_PUSH_COMPONENT_SECRET"
}

# zilar-server's variables, derived from the domain and the core uuid.
_coolify_server_envs() {
  printf '%s\n' \
    "PORT=3000" \
    "DATABASE_URL=postgres://zilar:$COOLIFY_ZILAR_DB_PASSWORD@postgres-$COOLIFY_CORE_UUID:5432/zilar" \
    "XMPP_ARCHIVE_DATABASE_URL=postgres://zilar_archive:$COOLIFY_ARCHIVE_DB_PASSWORD@postgres-$COOLIFY_CORE_UUID:5432/ejabberd" \
    "PUBLIC_URL=https://$DOMAIN" "WEB_ORIGINS=https://$DOMAIN" "TRUSTED_PROXY_HOPS=1" \
    "BETTER_AUTH_SECRET=$COOLIFY_BETTER_AUTH_SECRET" "ZILAR_KEY_ENCRYPTION_KEY=$COOLIFY_KEY_ENCRYPTION_KEY" \
    "EJABBERD_API_URL=http://ejabberd-$COOLIFY_CORE_UUID:5280/api" "EJABBERD_ADMIN_JID=admin@$DOMAIN" \
    "EJABBERD_ADMIN_PASSWORD=$COOLIFY_EJABBERD_ADMIN_PASSWORD" "ZILAR_XMPP_JWT_SECRET=$COOLIFY_XMPP_JWT_SECRET" \
    "XMPP_DOMAIN=$DOMAIN" "XMPP_MUC_DOMAIN=rooms.$DOMAIN" "XMPP_WS_PUBLIC_URL=wss://$DOMAIN/xmpp-ws/ws" \
    "PUSH_COMPONENT_JID=push.$DOMAIN" "PUSH_COMPONENT_SECRET=$COOLIFY_PUSH_COMPONENT_SECRET" \
    "PUSH_COMPONENT_HOST=ejabberd-$COOLIFY_CORE_UUID" \
    "STICKER_STORAGE_DIR=/data/stickers" "AVATAR_STORAGE_DIR=/data/avatars" \
    "BACKGROUND_STORAGE_DIR=/data/avatars/backgrounds" "RUNNER_HUB_PORT=3189"
}

coolify_create_core() {
  _urls="$(jq -nc --arg u "https://$DOMAIN/xmpp-ws,https://$DOMAIN/upload" '[{name: "ejabberd", url: $u}]')"
  _basis=""
  if [ "$DRY_RUN" -eq 0 ]; then _basis="$(cat "$_root/deploy/coolify/zilar-core.yml")"; fi
  _body="$(jq -nc --arg project "$COOLIFY_PROJECT_UUID" --arg server "$COOLIFY_SERVER_UUID" \
    --arg compose "$_basis" --argjson urls "$_urls" --arg dest "$COOLIFY_DESTINATION_UUID" \
    '{name: "zilar-core", project_uuid: $project, server_uuid: $server,
      environment_name: "production", docker_compose_raw: $compose, urls: $urls,
      instant_deploy: false}
     + (if $dest == "" then {} else {destination_uuid: $dest} end)')"
  COOLIFY_CORE_UUID="$(coolify_api_create_service "$_body" | _cm_created_uuid core)"
  [ -n "$COOLIFY_CORE_UUID" ] && [ "$COOLIFY_CORE_UUID" != "null" ] ||
    die "Coolify did not return a uuid for zilar-core"
  info "created zilar-core ($COOLIFY_CORE_UUID)"
  coolify_api_patch_service "$COOLIFY_CORE_UUID" \
    "$(jq -nc --argjson urls "$_urls" '{connect_to_docker_network: true, urls: $urls}')" >/dev/null
  coolify_api_set_service_envs "$COOLIFY_CORE_UUID" \
    "$(_coolify_core_envs | _cm_envs_body)" >/dev/null
  coolify_api_deploy "$COOLIFY_CORE_UUID" >/dev/null
  info "zilar-core is deploying"
}

coolify_create_server() {
  _body="$(jq -nc --arg project "$COOLIFY_PROJECT_UUID" --arg server "$COOLIFY_SERVER_UUID" \
    --arg image "ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-server" --arg tag "$COOLIFY_IMAGE_TAG" \
    --arg domain "https://$DOMAIN/api,https://$DOMAIN/health" \
    '{project_uuid: $project, server_uuid: $server, environment_name: "production",
      docker_registry_image_name: $image, docker_registry_image_tag: $tag,
      domains: $domain, ports_exposes: "3000", is_stripprefix_enabled: false,
      connect_to_docker_network: true, health_check_enabled: true,
      health_check_path: "/health", health_check_port: "3000", instant_deploy: false}')"
  COOLIFY_SERVER_APP_UUID="$(coolify_api_create_image_app "$_body" | _cm_created_uuid server)"
  [ -n "$COOLIFY_SERVER_APP_UUID" ] && [ "$COOLIFY_SERVER_APP_UUID" != "null" ] ||
    die "Coolify did not return a uuid for zilar-server"
  info "created zilar-server ($COOLIFY_SERVER_APP_UUID)"
  coolify_api_add_storage "$COOLIFY_SERVER_APP_UUID" \
    "$(jq -nc '{type: "persistent", name: "sticker-data", mount_path: "/data/stickers"}')" >/dev/null
  coolify_api_add_storage "$COOLIFY_SERVER_APP_UUID" \
    "$(jq -nc '{type: "persistent", name: "avatar-data", mount_path: "/data/avatars"}')" >/dev/null
  coolify_api_set_app_envs "$COOLIFY_SERVER_APP_UUID" \
    "$(_coolify_server_envs | _cm_envs_body)" >/dev/null
  coolify_api_deploy "$COOLIFY_SERVER_APP_UUID" >/dev/null
  info "zilar-server is deploying"
}

coolify_create_web() {
  _body="$(jq -nc --arg project "$COOLIFY_PROJECT_UUID" --arg server "$COOLIFY_SERVER_UUID" \
    --arg image "ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-web" --arg tag "$COOLIFY_IMAGE_TAG" \
    --arg domain "https://$DOMAIN" \
    '{project_uuid: $project, server_uuid: $server, environment_name: "production",
      docker_registry_image_name: $image, docker_registry_image_tag: $tag,
      domains: $domain, ports_exposes: "80", health_check_enabled: true,
      health_check_path: "/", health_check_port: "80", instant_deploy: false}')"
  COOLIFY_WEB_APP_UUID="$(coolify_api_create_image_app "$_body" | _cm_created_uuid web)"
  [ -n "$COOLIFY_WEB_APP_UUID" ] && [ "$COOLIFY_WEB_APP_UUID" != "null" ] ||
    die "Coolify did not return a uuid for zilar-web"
  info "created zilar-web ($COOLIFY_WEB_APP_UUID)"
  coolify_api_deploy "$COOLIFY_WEB_APP_UUID" >/dev/null
  info "zilar-web is deploying"
}

# --- health, desks, secrets, first invite -------------------------------

# --resolve lets the wait reach a domain that does not resolve yet (the
# rehearsal's sslip.io case). Set ZILAR_COOLIFY_RESOLVE=1 to use it.
_cm_resolve_opt() {
  if [ "${ZILAR_COOLIFY_RESOLVE:-0}" = "1" ]; then printf -- '--resolve %s:443:127.0.0.1' "$DOMAIN"; fi
}

coolify_wait_health() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    + wait up to 10 minutes for GET https://%s/health to answer "ok":true\n' "$DOMAIN" >&2
    return 0
  fi
  info "waiting up to 10 minutes for https://$DOMAIN/health ..."
  _waited=0
  while [ "$_waited" -lt 600 ]; do
    # shellcheck disable=SC2046
    if _health="$(curl -fsS --max-time 10 $(_cm_resolve_opt) "https://$DOMAIN/health" 2>/dev/null)" &&
       printf '%s' "$_health" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
      info "Zilar is up: https://$DOMAIN/health answers ok"
      return 0
    fi
    sleep 10
    _waited=$((_waited + 10))
  done
  die "Zilar did not come up in 10 minutes. Open Coolify (project Zilar) and check zilar-core, then zilar-server and zilar-web, in that order; fix the first one that is not running and deploy it again"
}

coolify_desks() {
  if [ "$DESKS" -eq 0 ]; then
    if [ "$YES" -eq 1 ]; then return 0; fi
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '    + asks "Enable AI computers?"; then runs host-setup, the sandbox and the desk variables\n' >&2
      return 0
    fi
    consent "Enable AI computers (gVisor + a Docker config change; Docker is reloaded, never restarted)?" ||
      return 0
    DESKS=1
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    + %s%s/deploy/zilar host-setup then%s docker run --rm --runtime=runsc hello-world\n' "$SUDO " "$_root" "$SUDO" >&2
    printf '    + pin the jail image, set DESKS_ENABLED, COMPOSE_PROFILES and DESK_IMAGE on zilar-core, then POST /deploy\n' >&2
    printf '    + set DESK_AGENT_SOCKET and the desk-socket storage on zilar-server, then POST /deploy\n' >&2
    return 0
  fi
  phase "host-setup"
  info "installing gVisor and changing Docker's config; Docker is reloaded (SIGHUP), never restarted"
  run $SUDO "$_root/deploy/zilar" host-setup
  if desk_sandbox; then coolify_enable_desks; else info "AI computers stay off: $DESK_SANDBOX_ERR"; fi
}

# The jail image's digest, the same pull-and-read pin_desk_image does for the
# plain stack, kept here because that one writes to deploy/.env and Coolify has
# no env file.
coolify_enable_desks() {
  _ref="ghcr.io/${IMAGE_OWNER:-julioferrero}/zilar-desk:$COOLIFY_IMAGE_TAG"
  info "desks are on; pulling $_ref to pin its digest"
  $SUDO docker pull "$_ref" ||
    die "cannot pull the jail image $_ref — check the network, or set DESK_IMAGE on zilar-core by hand"
  COOLIFY_DESK_IMAGE="$($SUDO docker image inspect --format '{{index .RepoDigests 0}}' "$_ref" 2>/dev/null)" || COOLIFY_DESK_IMAGE=""
  case "$COOLIFY_DESK_IMAGE" in
    *@sha256:*) ;;
    *) die "the jail image $_ref has no repo digest — set DESK_IMAGE=<repo>@sha256:... on zilar-core by hand" ;;
  esac
  info "pinned the jail image ($COOLIFY_DESK_IMAGE)"
  coolify_api_set_service_envs "$COOLIFY_CORE_UUID" \
    "$(printf '%s\n' "DESKS_ENABLED=true" "COMPOSE_PROFILES=desks" "DESK_IMAGE=$COOLIFY_DESK_IMAGE" | _cm_envs_body)" >/dev/null
  coolify_api_deploy "$COOLIFY_CORE_UUID" >/dev/null
  coolify_api_add_storage "$COOLIFY_SERVER_APP_UUID" \
    "$(jq -nc '{type: "persistent", name: "desk-socket", mount_path: "/run/zilar"}')" >/dev/null
  coolify_api_set_app_envs "$COOLIFY_SERVER_APP_UUID" \
    "$(printf '%s\n' "DESK_AGENT_SOCKET=/run/zilar/desk.sock" "DESK_IMAGE=$COOLIFY_DESK_IMAGE" | _cm_envs_body)" >/dev/null
  coolify_api_deploy "$COOLIFY_SERVER_APP_UUID" >/dev/null
  info "AI computers are on"
}

# /root only, mode 600: the secrets are on the server exactly once, and the
# owner is told to move them off it. Live has no such copy today (OPS-9).
coolify_write_secrets_copy() {
  _file="/root/zilar-secrets-$(date +%Y%m%d).env"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    + write %s (mode 600) with the generated secrets\n' "$_file" >&2
    return 0
  fi
  _content="$(printf '%s\n' \
    "# Zilar Coolify install secrets ($(date -u +%Y-%m-%dT%H:%M:%SZ)) — keep off the server." \
    "ZILAR_DOMAIN=$DOMAIN" "POSTGRES_PASSWORD=$COOLIFY_POSTGRES_PASSWORD" \
    "ZILAR_DB_PASSWORD=$COOLIFY_ZILAR_DB_PASSWORD" "ARCHIVE_DB_PASSWORD=$COOLIFY_ARCHIVE_DB_PASSWORD" \
    "EJABBERD_DB_PASSWORD=$COOLIFY_EJABBERD_DB_PASSWORD" "EJABBERD_ADMIN_PASSWORD=$COOLIFY_EJABBERD_ADMIN_PASSWORD" \
    "XMPP_JWT_SECRET=$COOLIFY_XMPP_JWT_SECRET" "PUSH_COMPONENT_SECRET=$COOLIFY_PUSH_COMPONENT_SECRET" \
    "BETTER_AUTH_SECRET=$COOLIFY_BETTER_AUTH_SECRET" "ZILAR_KEY_ENCRYPTION_KEY=$COOLIFY_KEY_ENCRYPTION_KEY")"
  ( umask 077; : | $SUDO tee "$_file" >/dev/null )   # empty first (tee may ignore umask under sudo)
  $SUDO chmod 600 "$_file" || die "could not make $_file read only for root (mode 600)"
  printf '%s\n' "$_content" | $SUDO tee "$_file" >/dev/null
  info "the secrets are in $_file (mode 600, root only)"
  echo "    Copy this file to your password manager, then delete it from the server."
}

coolify_first_invite() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '    + docker exec <zilar-server container> node /opt/tsx/node_modules/tsx/dist/cli.mjs src/auth/invite-cli.ts --uses 1 --days 7\n' >&2
    return 0
  fi
  _container="$($SUDO docker ps --filter 'name=zilar-server' --format '{{.Names}}' 2>/dev/null | head -n 1)"
  # A rerun stops at "already installed", so name the manual command instead.
  [ -n "$_container" ] ||
    die "no zilar-server container is running; open Coolify (project Zilar), check zilar-server, then mint the first invite by hand: $SUDO docker exec <zilar-server container> node /opt/tsx/node_modules/tsx/dist/cli.mjs src/auth/invite-cli.ts --uses 1 --days 7"
  info "minting the first invite code (single use, 7 days)..."
  echo ""
  $SUDO docker exec "$_container" \
    node /opt/tsx/node_modules/tsx/dist/cli.mjs src/auth/invite-cli.ts --uses 1 --days 7
  echo ""
  echo "Open https://$DOMAIN and sign up with $ADMIN_EMAIL, pasting the code above."
}

# The whole Coolify path, called by preflight_decide when the host report finds
# Coolify. Under --dry-run every API call and host step is printed, no token is
# read and nothing is changed.
coolify_run() {
  phase "coolify"
  coolify_collect_inputs
  coolify_check_version
  coolify_pick_server
  coolify_find_or_create_project
  coolify_generate_secrets
  coolify_create_core
  coolify_create_server
  coolify_create_web
  coolify_wait_health
  coolify_desks
  coolify_write_secrets_copy
  coolify_first_invite
  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry run complete — nothing was changed"
  else
    info "Zilar is installed into Coolify (project Zilar on server $COOLIFY_SERVER_UUID)"
  fi
}
