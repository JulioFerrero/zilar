#!/bin/sh
#
# Zilar one-line installer: a fresh Debian/Ubuntu host to a running Zilar.
#   curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh
#
# Read it first; it never prints a secret, and the last line calls main() so a
# cut-off download runs nothing. Test-only env: ZILAR_INSTALL_TARBALL,
# ZILAR_INSTALL_SKIP_CHECKS, ZILAR_INSTALL_API_URL; --help lists the flags.
# It is a bootstrap: fetch the release, run its host report, then the phases.

set -eu

PROG="zilar-install"; REPO="JulioFerrero/zilar"; IMAGE_OWNER="julioferrero"; DEFAULT_DIR="/opt/zilar"
CODELOAD="https://codeload.github.com"; API_URL="${ZILAR_INSTALL_API_URL:-https://api.github.com}"
MIN_DISK_MB=10240; MIN_RAM_MB=2048; WARN_RAM_MB=4096
VERSION=""; DIR="$DEFAULT_DIR"; DOMAIN=""; ADMIN_EMAIL=""; COMMIT=""
DESKS=0; YES=0; DRY_RUN=0; SUDO=""; DESK_SANDBOX_ERR=""

die() { echo "$PROG: error: $*" >&2; exit 1; }
info() { echo "$PROG: $*"; }
warn() { echo "$PROG: WARNING: $*" >&2; }
phase() { echo ""; echo "==> $1"; }

run() { if [ "$DRY_RUN" -eq 1 ]; then echo "    + $*"; else "$@"; fi; }

run_in() { _d="$1"; shift; if [ "$DRY_RUN" -eq 1 ]; then echo "    + (cd $_d && $*)"; else ( cd "$_d" && "$@" ); fi; }

# Ask on the terminal even when stdin is the piped script (empty answer: default).
ask() {
  if [ -n "${2-}" ]; then printf '%s [%s]: ' "$1" "$2" >&2; else printf '%s: ' "$1" >&2; fi
  _answer=""
  if ( : < /dev/tty ) 2>/dev/null; then IFS= read -r _answer < /dev/tty || _answer=""; else IFS= read -r _answer || _answer=""; fi
  if [ -z "$_answer" ]; then printf '%s' "${2-}"; else printf '%s' "$_answer"; fi
}

# Yes/no question. `--yes` answers yes without asking.
consent() {
  if [ "$YES" -eq 1 ]; then info "$1 yes (--yes)"; return 0; fi
  case "$(ask "$1" "n")" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

usage() {
  cat <<EOF
Usage: install.sh [--version TAG|main] [--dir PATH] [--domain HOST]
                  [--admin-email EMAIL] [--desks] [--yes] [--dry-run]

  --version  release to install (default: the latest v* tag, else main)
  --dir      where deploy/ is extracted (default: $DEFAULT_DIR)
  --domain / --admin-email  passed to ./zilar init; it prompts when omitted
  --desks    also run ./zilar host-setup   --yes  no prompts   --dry-run  plan
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version=*) [ -n "${1#*=}" ] || die "--version needs a value"; VERSION="${1#*=}"; shift ;;
      --dir=*) [ -n "${1#*=}" ] || die "--dir needs a value"; DIR="${1#*=}"; shift ;;
      --domain=*) [ -n "${1#*=}" ] || die "--domain needs a value"; DOMAIN="${1#*=}"; shift ;;
      --admin-email=*) [ -n "${1#*=}" ] || die "--admin-email needs a value"; ADMIN_EMAIL="${1#*=}"; shift ;;
      --version) [ "$#" -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
      --dir) [ "$#" -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
      --domain) [ "$#" -ge 2 ] || die "--domain needs a value"; DOMAIN="$2"; shift 2 ;;
      --admin-email) [ "$#" -ge 2 ] || die "--admin-email needs a value"; ADMIN_EMAIL="$2"; shift 2 ;;
      --desks) DESKS=1; shift ;;
      --yes|-y) YES=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option '$1' (try --help)" ;;
    esac
  done
}

validate_args() {
  if [ "$YES" -eq 1 ]; then
    [ -n "$DOMAIN" ] || die "--yes needs --domain <host> (there are no prompts in --yes mode)"
    [ -n "$ADMIN_EMAIL" ] || die "--yes needs --admin-email <you@example.com> (there are no prompts in --yes mode)"
  fi
}

# --- 1. bootstrap checks ------------------------------------------------

# $SUDO is empty as root, "sudo" when present, else fail clearly (get.docker.com style).
resolve_sudo() {
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else die "run this as root, or install sudo"; fi
}

port_free() {
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1 "; then return 1; fi
  if command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q ":$1 "; then return 1; fi
  if ! command -v ss >/dev/null 2>&1 && ! command -v netstat >/dev/null 2>&1; then warn "cannot check port $1 (no ss or netstat on PATH)"; fi
  return 0
}

# The one stop message for a host that cannot run Docker (a container-based VPS,
# or a Docker that fails its smoke run). $1 is the reason, one short line.
stop_no_docker() {
  echo "" >&2
  echo "$PROG: Docker cannot run on this host: $1" >&2
  echo "  why: a container-based VPS usually cannot run Docker unless the provider turns on nesting." >&2
  echo "  what works: a VM-based VPS (KVM, Xen, VMware, Hyper-V; most cloud VPS plans)," >&2
  echo "              or ask the provider to enable nesting." >&2
  echo "" >&2
  exit 1
}

phase_check() {
  phase "check"
  resolve_sudo
  if [ "${ZILAR_INSTALL_SKIP_CHECKS:-}" = "1" ]; then echo "    host checks skipped (ZILAR_INSTALL_SKIP_CHECKS=1)"; return 0; fi
  if [ "$DRY_RUN" -eq 1 ]; then echo "    Linux; curl and tar on PATH; root or sudo."; return 0; fi
  _os="$(uname -s)"
  [ "$_os" = "Linux" ] || die "this installer runs on Linux only (found $_os)"
  command -v curl >/dev/null 2>&1 || die "needs 'curl' on PATH"
  command -v tar >/dev/null 2>&1 || die "needs 'tar' on PATH"
  info "host checks passed (Linux $(uname -m))"
}

# --- 2. fetch the release into a temp dir -------------------------------

resolve_version() {
  if [ -n "$VERSION" ]; then return 0; fi
  info "resolving the latest release tag"
  _json="$(curl -fsSL "$API_URL/repos/$REPO/tags" 2>/dev/null || true)"
  _tag="$(printf '%s\n' "$_json" | sed -n 's/^[[:space:]]*"name": *"\(v[0-9][^"]*\)".*/\1/p' | head -n 1)"
  if [ -n "$_tag" ]; then VERSION="$_tag"; else VERSION="main"; warn "no release tag found; falling back to main"; fi
  return 0
}

resolve_commit() {
  COMMIT="unknown"
  if [ -n "${ZILAR_INSTALL_TARBALL:-}" ]; then return 0; fi
  _json="$(curl -fsSL "$API_URL/repos/$REPO/commits/$VERSION" 2>/dev/null || true)"
  _sha="$(printf '%s\n' "$_json" | sed -n 's/^[[:space:]]*"sha": *"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -n 1)"
  if [ -n "$_sha" ]; then COMMIT="$_sha"; fi
  return 0
}

# Download and extract the release under a temp dir (sets $_root). $DIR stays
# untouched: a cut-off download, or a stop in the report, must change nothing.
fetch_release() {
  _tmp="$(mktemp -d "${TMPDIR:-/tmp}/zilar-install.XXXXXX")"
  trap 'rm -rf "$_tmp"' EXIT INT TERM
  if [ -n "${ZILAR_INSTALL_TARBALL:-}" ]; then
    [ -f "$ZILAR_INSTALL_TARBALL" ] || die "ZILAR_INSTALL_TARBALL=$ZILAR_INSTALL_TARBALL is not a file"
    cp "$ZILAR_INSTALL_TARBALL" "$_tmp/zilar.tar.gz"
  else
    _url="$CODELOAD/$REPO/tar.gz/$VERSION"
    ( cd "$_tmp" && curl -fsSL -o zilar.tar.gz "$_url" ) || die "download failed ($_url)"
  fi
  mkdir -p "$_tmp/x"
  tar -xzf "$_tmp/zilar.tar.gz" -C "$_tmp/x" || die "could not extract the archive"
  _root=""
  for _candidate in "$_tmp/x"/*; do _root="$_candidate"; break; done
  if [ -z "$_root" ] || [ ! -d "$_root/deploy" ]; then die "the archive has no deploy/ directory"; fi
}

phase_fetch() {
  phase "fetch"
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -z "$VERSION" ]; then VERSION="<latest v* tag>"; fi
    if [ -n "${ZILAR_INSTALL_TARBALL:-}" ]; then _url="$ZILAR_INSTALL_TARBALL"; else _url="$CODELOAD/$REPO/tar.gz/$VERSION"; fi
    echo "    version: $VERSION"
    echo "    + curl -fsSL $_url -o <tmp>/zilar.tar.gz"
    echo "    + tar -xzf <tmp>/zilar.tar.gz -C <tmp>/x"
    return 0
  fi
  resolve_version
  fetch_release
}

# --- 3. the host report, then the plain path ----------------------------

# --dry-run: the report items it would check, and its decision branches.
preflight_plan() {
  echo "    items: os and version (/etc/os-release); CPU architecture, RAM and free disk;"
  echo "           ports 80 and 443; Docker (docker info); virtualization (systemd-detect-virt);"
  echo "           Coolify (a container named coolify, or /data/coolify/source)."
  echo "    branch: Coolify found -> Coolify mode (needs a Coolify API token; not in this version)"
  echo "    branch: container-based VPS (openvz, or lxc without Docker) -> stop and explain"
  echo "    branch: Docker cannot run (docker run --rm hello-world fails) -> stop and explain"
  echo "    branch: otherwise -> the plain Docker install below"
  echo "    + $SUDO cp -R <tmp>/x/zilar-*/deploy/. $DIR/    (plain path only; an existing .env is kept)"
}

install_deploy() {
  $SUDO mkdir -p "$DIR"
  $SUDO cp -R "$_root/deploy/." "$DIR/" || die "could not write to $DIR"
  resolve_commit
  info "installed Zilar $VERSION (commit $COMMIT) into $DIR"
}

phase_report() {
  phase "host report"
  if [ "$DRY_RUN" -eq 1 ]; then preflight_plan; return 0; fi
  [ -f "$_root/deploy/lib/preflight.sh" ] || die "the release has no deploy/lib/preflight.sh"
  . "$_root/deploy/lib/preflight.sh"
  preflight_run      # prints the report; exits 0 on Coolify, or stops clearly
  install_deploy     # plain path only (the Coolify branch exited above)
}

# --- 4. Docker ----------------------------------------------------------

# Prove Docker really runs on this host, not just that the CLI is installed.
docker_smoke() {
  if [ "$DRY_RUN" -eq 1 ]; then echo "    + docker run --rm hello-world   # proves Docker really runs"; return 0; fi
  if _err="$($SUDO docker run --rm hello-world 2>&1)"; then info "Docker runs (hello-world passed)"; return 0; fi
  stop_no_docker "docker run --rm hello-world failed: $(printf '%s\n' "${_err:-no output}" | head -n 1)"
}

phase_docker() {
  phase "docker"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "    Docker with the Compose plugin is already installed."
    docker_smoke
    return 0
  fi
  echo "    Docker with the Compose plugin is missing."
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + curl -fsSL -o <tmp>/get-docker.sh https://get.docker.com"
    echo "    + $SUDO sh <tmp>/get-docker.sh"
    echo "    + docker run --rm hello-world   # proves Docker really runs"
    return 0
  fi
  if ! consent "Install Docker from get.docker.com?"; then die "Docker is required — install it yourself, then run this installer again"; fi
  info "installing Docker (this can take a minute)"
  _docker_sh="$(mktemp "${TMPDIR:-/tmp}/zilar-get-docker.XXXXXX")"
  curl -fsSL -o "$_docker_sh" https://get.docker.com || die "could not download the Docker installer"
  $SUDO sh "$_docker_sh"
  rm -f "$_docker_sh"
  docker_smoke
}

# --- 5. configure -------------------------------------------------------

phase_configure() {
  phase "configure"
  if [ -f "$DIR/.env" ]; then info "keeping the existing $DIR/.env (run '$DIR/zilar init --force' to regenerate it)"; return 0; fi
  # CI publishes :latest for every release tag and for green main, but :main
  # never exists: a v* release keeps its own tag (reproducible), every other
  # ref (main, or the latest-tag fallback) pulls :latest.
  _tag="$VERSION"
  case "$_tag" in v*) ;; *) _tag="latest" ;; esac
  set -- init
  if [ -n "$DOMAIN" ]; then set -- "$@" --domain "$DOMAIN"; fi
  if [ -n "$ADMIN_EMAIL" ]; then set -- "$@" --admin-email "$ADMIN_EMAIL"; fi
  if [ "$YES" -eq 1 ]; then set -- "$@" --acme-email "$ADMIN_EMAIL" --push-subject "mailto:$ADMIN_EMAIL"; fi # --yes must not prompt: init also asks for the ACME email and the push contact address
  set -- "$@" --image-owner "$IMAGE_OWNER" --image-tag "$_tag"
  run_in "$DIR" $SUDO ./zilar "$@"
}

# --- 6. AI computers (optional) -----------------------------------------

# Replace KEY=VALUE in $DIR/.env in place, or append it (a temp file; `sed -i`
# differs between GNU and BSD).
set_env_var() { # KEY VALUE
  _file="$DIR/.env"
  [ -f "$_file" ] || return 0
  _new="$(mktemp "${TMPDIR:-/tmp}/zilar-env.XXXXXX")"
  _found=0
  while IFS= read -r _line || [ -n "$_line" ]; do
    case "$_line" in "$1="*) printf '%s=%s\n' "$1" "$2"; _found=1 ;; *) printf '%s\n' "$_line" ;; esac
  done <"$_file" >"$_new"
  [ "$_found" -eq 1 ] || printf '%s=%s\n' "$1" "$2" >>"$_new"
  cat "$_new" >"$_file"
  rm -f "$_new"
}

# One real gVisor sandbox (0 = pass). On a failure DESK_SANDBOX_ERR holds the
# first error line, and desks stay off.
desk_sandbox() {
  if _err="$($SUDO docker run --rm --runtime=runsc hello-world 2>&1)"; then return 0; fi
  DESK_SANDBOX_ERR="$(printf '%s\n' "${_err:-docker run failed}" | head -n 1)"
  return 1
}

phase_desks() {
  if [ "$DESKS" -eq 0 ]; then
    if [ "$YES" -eq 1 ]; then return 0; fi
    if [ "$DRY_RUN" -eq 1 ]; then
      phase "host-setup"
      echo "    asks 'Enable AI computers?'; installs gVisor and changes Docker's config (reload, no restart)"
      echo "    + $SUDO docker run --rm --runtime=runsc hello-world   # proves the sandbox runs"
      echo "    + sets DESKS_ENABLED=true in $DIR/.env when the sandbox passes"
      return 0
    fi
    if ! consent "Enable AI computers (gVisor + a Docker config change; Docker is reloaded, never restarted)?"; then return 0; fi
    DESKS=1
  fi
  phase "host-setup"
  info "installing gVisor and changing Docker's config; Docker is reloaded (SIGHUP), never restarted"
  run $SUDO "$DIR/zilar" host-setup
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + $SUDO docker run --rm --runtime=runsc hello-world   # proves the sandbox runs"
    echo "    + sets DESKS_ENABLED=true in $DIR/.env when the sandbox passes"
    return 0
  fi
  if desk_sandbox; then set_env_var DESKS_ENABLED true; info "AI computers are on (DESKS_ENABLED=true)"
  else info "AI computers stay off: $DESK_SANDBOX_ERR"; fi
}

# --- 7. start -----------------------------------------------------------

phase_up() { phase "up"; run_in "$DIR" $SUDO ./zilar up; }

phase_doctor() {
  phase "doctor"
  if [ "$DRY_RUN" -eq 1 ]; then echo "    + (cd $DIR && $SUDO ./zilar doctor)"; return 0; fi
  if ( cd "$DIR" && $SUDO ./zilar doctor ); then return 0; fi
  warn "doctor found problems above — fix them, then run '$DIR/zilar doctor' again"
  return 1
}

finish() {
  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then info "dry run complete — nothing was changed"; return 0; fi
  info "Zilar is installed in $DIR"
  _env_domain="$(sed -n 's/^ZILAR_DOMAIN=//p' "$DIR/.env" 2>/dev/null | head -n 1)" # the running stack follows .env when it exists
  _finish_domain="${_env_domain:-$DOMAIN}" # so a kept .env wins over a new --domain
  if [ -n "$_env_domain" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "$_env_domain" ]; then warn ".env kept: domain is $_env_domain; run '$DIR/zilar init --force' to change it"; fi
  if [ -z "$_finish_domain" ] || [ "$_finish_domain" = "localhost" ]; then echo "  Open: https://localhost (Caddy's local CA — accept the browser warning)"
  else echo "  Open: https://$_finish_domain"; fi
  echo "  Next: cd $DIR && ./zilar create-admin   (sign up with your admin email)"
}

main() {
  parse_args "$@"
  validate_args
  if [ "$DRY_RUN" -eq 1 ]; then info "dry run: printing the plan, changing nothing"
  else info "installing Zilar into $DIR (read deploy/install.sh if you have not)"; fi
  phase_check
  phase_fetch
  phase_report
  phase_docker
  phase_configure
  phase_desks
  phase_up
  _doctor_failed=""
  if ! phase_doctor; then _doctor_failed=1; fi
  finish
  if [ -n "$_doctor_failed" ]; then exit 1; fi
}

main "$@"
