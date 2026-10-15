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

# The published jail image reference, with the same IMAGE_OWNER/IMAGE_TAG
# defaults as the server and web images in deploy/docker-compose.yml.
_desk_image_ref() {
  _owner="$(env_get IMAGE_OWNER)"
  _tag="$(env_get IMAGE_TAG)"
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
  docker pull "$_ref" ||
    die "cannot pull the jail image $_ref — check the network and that the image is published, or set DESK_IMAGE by hand in $ENV_FILE"

  _digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$_ref" 2>/dev/null)" || _digest=""
  case "$_digest" in
    *@sha256:*) ;;
    *) die "the jail image $_ref has no repo digest (was it pulled from a registry?) — set DESK_IMAGE=<repo>@sha256:... by hand in $ENV_FILE" ;;
  esac

  _desk_env_set DESK_IMAGE "$_digest"
  info "pinned DESK_IMAGE=$_digest in $ENV_FILE"
}
