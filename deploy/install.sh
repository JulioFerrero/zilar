#!/bin/sh
#
# Zilar one-line installer: a fresh Debian/Ubuntu host to a running Zilar.
#   curl -fsSL https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/install.sh | sh
#
# Read it first; it never prints a secret, and the last line calls main() so a
# cut-off download runs nothing. Test-only env: ZILAR_INSTALL_TARBALL, ZILAR_INSTALL_SKIP_CHECKS, ZILAR_INSTALL_API_URL; --help lists the flags.

set -eu

PROG="zilar-install"
REPO="JulioFerrero/zilar"
IMAGE_OWNER="julioferrero"
DEFAULT_DIR="/opt/zilar"
CODELOAD="https://codeload.github.com"
API_URL="${ZILAR_INSTALL_API_URL:-https://api.github.com}"
MIN_DISK_MB=10240
MIN_RAM_MB=2048
WARN_RAM_MB=4096

VERSION=""
DIR="$DEFAULT_DIR"
DOMAIN=""
ADMIN_EMAIL=""
COMMIT=""
DESKS=0
YES=0
DRY_RUN=0

die() {
  echo "$PROG: error: $*" >&2
  exit 1
}

info() {
  echo "$PROG: $*"
}

warn() {
  echo "$PROG: WARNING: $*" >&2
}

# A section header, one per planned step, so `--dry-run` reads as a plan.
phase() {
  echo ""
  echo "==> $1"
}

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + $*"
  else
    "$@"
  fi
}

run_in() { # DIR CMD...
  _run_in_dir="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + (cd $_run_in_dir && $*)"
  else
    ( cd "$_run_in_dir" && "$@" )
  fi
}

# Ask on the terminal even when stdin is the piped script (empty answer: default).
ask() {
  if [ -n "${2-}" ]; then
    printf '%s [%s]: ' "$1" "$2" >&2
  else
    printf '%s: ' "$1" >&2
  fi
  _answer=""
  if ( : < /dev/tty ) 2>/dev/null; then
    IFS= read -r _answer < /dev/tty || _answer=""
  else
    IFS= read -r _answer || _answer=""
  fi
  if [ -z "$_answer" ]; then
    printf '%s' "${2-}"
  else
    printf '%s' "$_answer"
  fi
}

# Yes/no question. `--yes` answers yes without asking.
consent() {
  if [ "$YES" -eq 1 ]; then
    info "$1 yes (--yes)"
    return 0
  fi
  case "$(ask "$1" "n")" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
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

# --- 1. host checks -----------------------------------------------------
port_free() {
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | grep -q ":$1 "; then return 1; fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | grep -q ":$1 "; then return 1; fi
  else
    warn "cannot check port $1 (no ss or netstat on PATH)"
    return 0
  fi
  return 0
}

# $SUDO is empty as root, "sudo" when present, else fail clearly (get.docker.com style).
resolve_sudo() {
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else die "run this as root, or install sudo"; fi
}

check_host() {
  _os="$(uname -s)"
  [ "$_os" = "Linux" ] || die "this installer runs on Linux only (found $_os)"
  case "$(uname -m)" in
    x86_64|amd64|aarch64|arm64) ;;
    *) die "unsupported architecture '$(uname -m)' (need x86_64 or arm64)" ;;
  esac
  command -v curl >/dev/null 2>&1 || die "needs 'curl' on PATH"
  command -v tar >/dev/null 2>&1 || die "needs 'tar' on PATH"
  resolve_sudo
  _parent="$DIR"
  while [ ! -d "$_parent" ]; do
    _parent="$(dirname "$_parent")"
  done
  _free_mb="$(df -Pk "$_parent" | awk 'NR==2 { print int($4 / 1024) }')"
  if [ -z "$_free_mb" ] || [ "$_free_mb" -lt "$MIN_DISK_MB" ]; then
    die "need at least 10 GB free under $_parent (found ${_free_mb:-0} MB)"
  fi
  _ram_mb="$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || echo 0)"
  if [ -z "$_ram_mb" ] || [ "$_ram_mb" -lt "$MIN_RAM_MB" ]; then
    die "need at least 2 GB RAM (found ${_ram_mb:-0} MB)"
  fi
  if [ "$_ram_mb" -lt "$WARN_RAM_MB" ]; then
    warn "only ${_ram_mb} MB RAM — a few AI turns at once may be slow"
  fi
  for _port in 80 443; do
    port_free "$_port" || die "port $_port is already in use (stop the service using it, then retry)"
  done
  info "host checks passed (Linux $(uname -m), ${_free_mb} MB free, ${_ram_mb} MB RAM, ports 80/443 free)"
}

phase_check() {
  phase "check"
  resolve_sudo
  if [ "${ZILAR_INSTALL_SKIP_CHECKS:-}" = "1" ]; then
    echo "    host checks skipped (ZILAR_INSTALL_SKIP_CHECKS=1)"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    Linux x86_64 or arm64; root or sudo; 10 GB free disk; 2 GB RAM (warn under 4 GB);"
    echo "    ports 80 and 443 free; curl and tar on PATH."
    return 0
  fi
  check_host
}

# --- 2. Docker ----------------------------------------------------------

phase_docker() {
  phase "docker"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "    Docker with the Compose plugin is already installed."
    return 0
  fi
  echo "    Docker with the Compose plugin is missing."
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + curl -fsSL -o <tmp>/get-docker.sh https://get.docker.com"
    echo "    + $SUDO sh <tmp>/get-docker.sh"
    return 0
  fi
  if ! consent "Install Docker from get.docker.com?"; then
    die "Docker is required — install it yourself, then run this installer again"
  fi
  info "installing Docker (this can take a minute)"
  _docker_sh="$(mktemp "${TMPDIR:-/tmp}/zilar-get-docker.XXXXXX")"
  curl -fsSL -o "$_docker_sh" https://get.docker.com || die "could not download the Docker installer"
  $SUDO sh "$_docker_sh"
  rm -f "$_docker_sh"
}

# --- 3. fetch the release -----------------------------------------------

resolve_version() {
  if [ -n "$VERSION" ]; then return 0; fi
  info "resolving the latest release tag"
  _json="$(curl -fsSL "$API_URL/repos/$REPO/tags" 2>/dev/null || true)"
  _tag="$(printf '%s\n' "$_json" | sed -n 's/^[[:space:]]*"name": *"\(v[0-9][^"]*\)".*/\1/p' | head -n 1)"
  if [ -n "$_tag" ]; then
    VERSION="$_tag"
  else
    VERSION="main"
    warn "no release tag found; falling back to main"
  fi
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

do_fetch() {
  _tmp="$(mktemp -d "${TMPDIR:-/tmp}/zilar-install.XXXXXX")"
  trap 'rm -rf "$_tmp"' EXIT INT TERM
  _archive="$_tmp/zilar.tar.gz"
  if [ -n "${ZILAR_INSTALL_TARBALL:-}" ]; then
    [ -f "$ZILAR_INSTALL_TARBALL" ] || die "ZILAR_INSTALL_TARBALL=$ZILAR_INSTALL_TARBALL is not a file"
    cp "$ZILAR_INSTALL_TARBALL" "$_archive"
  else
    _url="$CODELOAD/$REPO/tar.gz/$VERSION"
    ( cd "$_tmp" && curl -fsSL -o zilar.tar.gz "$_url" ) || die "download failed ($_url)"
  fi
  mkdir -p "$_tmp/x"
  tar -xzf "$_archive" -C "$_tmp/x" || die "could not extract the archive"
  _root=""
  for _candidate in "$_tmp/x"/*; do
    _root="$_candidate"
    break
  done
  if [ -z "$_root" ] || [ ! -d "$_root/deploy" ]; then
    die "the archive has no deploy/ directory"
  fi
  $SUDO mkdir -p "$DIR"
  $SUDO cp -R "$_root/deploy/." "$DIR/" || die "could not write to $DIR"
  resolve_commit
  info "installed Zilar $VERSION (commit $COMMIT) into $DIR"
}

phase_fetch() {
  phase "fetch"
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -z "$VERSION" ]; then VERSION="<latest v* tag>"; fi
    if [ -n "${ZILAR_INSTALL_TARBALL:-}" ]; then
      _url="$ZILAR_INSTALL_TARBALL"
    else
      _url="$CODELOAD/$REPO/tar.gz/$VERSION"
    fi
    echo "    version: $VERSION"
    echo "    + curl -fsSL $_url -o <tmp>/zilar.tar.gz"
    echo "    + tar -xzf <tmp>/zilar.tar.gz -C <tmp>/x"
    echo "    + $SUDO cp -R <tmp>/x/zilar-*/deploy/. $DIR/    (only deploy/; an existing .env is kept)"
    return 0
  fi
  resolve_version
  do_fetch
}

# --- 4. configure -------------------------------------------------------

phase_configure() {
  phase "configure"
  if [ -f "$DIR/.env" ]; then
    info "keeping the existing $DIR/.env (run '$DIR/zilar init --force' to regenerate it)"
    return 0
  fi
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

# --- 5. AI computers (optional) -----------------------------------------

phase_desks() {
  if [ "$DESKS" -eq 0 ]; then
    if [ "$YES" -eq 1 ]; then
      return 0
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      phase "host-setup"
      echo "    asks 'Enable AI computers?'; installs gVisor and changes Docker's config (reload, no restart)"
      return 0
    fi
    if ! consent "Enable AI computers (gVisor + a Docker config change; Docker is reloaded, never restarted)?"; then
      return 0
    fi
    DESKS=1
  fi
  phase "host-setup"
  info "installing gVisor and changing Docker's config; Docker is reloaded (SIGHUP), never restarted"
  run $SUDO "$DIR/zilar" host-setup
}

# --- 6. start -----------------------------------------------------------

phase_up() {
  phase "up"
  run_in "$DIR" $SUDO ./zilar up
}

phase_doctor() {
  phase "doctor"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    + (cd $DIR && $SUDO ./zilar doctor)"
    return 0
  fi
  if ( cd "$DIR" && $SUDO ./zilar doctor ); then
    return 0
  fi
  warn "doctor found problems above — fix them, then run '$DIR/zilar doctor' again"
  return 1
}

finish() {
  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry run complete — nothing was changed"
    return 0
  fi
  info "Zilar is installed in $DIR"
  _env_domain="$(sed -n 's/^ZILAR_DOMAIN=//p' "$DIR/.env" 2>/dev/null | head -n 1)" # the running stack follows .env when it exists
  _finish_domain="${_env_domain:-$DOMAIN}" # so a kept .env wins over a new --domain
  if [ -n "$_env_domain" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "$_env_domain" ]; then warn ".env kept: domain is $_env_domain; run '$DIR/zilar init --force' to change it"; fi
  if [ -z "$_finish_domain" ] || [ "$_finish_domain" = "localhost" ]; then
    echo "  Open: https://localhost (Caddy's local CA — accept the browser warning)"
  else
    echo "  Open: https://$_finish_domain"
  fi
  echo "  Next: cd $DIR && ./zilar create-admin   (sign up with your admin email)"
}

main() {
  parse_args "$@"
  validate_args
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dry run: printing the plan, changing nothing"
  else
    info "installing Zilar into $DIR (read deploy/install.sh if you have not)"
  fi
  phase_check
  phase_docker
  phase_fetch
  phase_configure
  phase_desks
  phase_up
  _doctor_failed=""
  if ! phase_doctor; then _doctor_failed=1; fi
  finish
  if [ -n "$_doctor_failed" ]; then
    exit 1
  fi
}

main "$@"
