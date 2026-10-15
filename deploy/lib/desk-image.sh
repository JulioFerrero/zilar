# shellcheck shell=sh
#
# desk-image — pin DESK_IMAGE to the published jail image's digest.
#
# Sourced by deploy/zilar the way lib/host-setup.sh is. When `./zilar up` runs
# with DESKS_ENABLED=true and DESK_IMAGE empty, it pulls the published jail
# image (ghcr.io/<IMAGE_OWNER>/zilar-desk:<IMAGE_TAG>), reads its repo digest
# and writes `DESK_IMAGE=<repo>@sha256:<digest>` into the env file, so a
# self-host install needs no hand build. A value set by hand always wins.
#
# Plan: docs/deploy/one-line-install-plan.md step 1.

# The published jail image reference. $1 is the owner and $2 the tag; both are
# optional and fall back to IMAGE_OWNER/IMAGE_TAG in the env file, the same
# defaults as the server and web images in deploy/docker-compose.yml. The
# installer passes both so it can name the image before any env file exists.
_desk_image_ref() { # [OWNER] [TAG]
  _owner="${1:-}"
  _tag="${2:-}"
  [ -n "$_owner" ] || _owner="$(env_get IMAGE_OWNER)"
  [ -n "$_tag" ] || _tag="$(env_get IMAGE_TAG)"
  printf 'ghcr.io/%s/zilar-desk:%s' "${_owner:-julioferrero}" "${_tag:-latest}"
}

# Replace `KEY=…` in the env file (or uncomment `# KEY=…`, else append). Writes
# through the file in place, so its mode 0600 and owner never change.
_desk_env_set() { # KEY VALUE
  _tmp="$(mktemp)"
  if grep -q "^$1=" "$ENV_FILE"; then
    sed "s|^$1=.*|$1=$2|" "$ENV_FILE" >"$_tmp"
  elif grep -q "^# $1=" "$ENV_FILE"; then
    sed "s|^# $1=.*|$1=$2|" "$ENV_FILE" >"$_tmp"
  else
    cat "$ENV_FILE" >"$_tmp"
    printf '\n%s=%s\n' "$1" "$2" >>"$_tmp"
  fi
  cat "$_tmp" >"$ENV_FILE"
  rm -f "$_tmp"
}

# Pull $1 and print its repo digest (`<repo>@sha256:<digest>`) on success.
# Returns non-zero, printing nothing, when the pull or the inspect fails or the
# image has no repo digest — a tag without a digest never passes, so the caller
# can word the fix. Runs through `$SUDO docker` (empty when the whole script
# already runs as root). Pull output goes to stderr to keep stdout for the digest.
resolve_desk_digest() { # REF
  ${SUDO:-} docker pull "$1" >&2 || return 1
  _digest="$(${SUDO:-} docker image inspect --format '{{index .RepoDigests 0}}' "$1" 2>/dev/null)" || _digest=""
  case "$_digest" in
    *@sha256:*) printf '%s' "$_digest" ;;
    *) return 1 ;;
  esac
}

# Resolve and pin DESK_IMAGE before `up` starts the desks profile. No-op while
# desks are off or DESK_IMAGE is already set. A pull or inspect failure stops
# `up`: never write a tag without a digest.
pin_desk_image() {
  [ "$(env_get DESKS_ENABLED)" = "true" ] || return 0
  [ -z "$(env_get DESK_IMAGE)" ] || return 0

  _ref="$(_desk_image_ref)"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ docker pull $_ref"
    echo "+ docker image inspect --format '{{index .RepoDigests 0}}' $_ref"
    echo "+ write DESK_IMAGE=<repo>@sha256:<digest> to $ENV_FILE"
    return 0
  fi

  need_cmd docker "install Docker and make sure the daemon is running"
  info "desks are on and DESK_IMAGE is empty; pulling $_ref to pin its digest"
  _digest="$(resolve_desk_digest "$_ref")" ||
    die "cannot pin the jail image $_ref — check the network and that the image is published, or set DESK_IMAGE by hand in $ENV_FILE"

  _desk_env_set DESK_IMAGE "$_digest"
  info "pinned DESK_IMAGE=$_digest in $ENV_FILE"
}
