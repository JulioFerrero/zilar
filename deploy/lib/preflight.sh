# shellcheck shell=sh
#
# preflight — the host report the installer prints before it changes anything.
#
# Sourced by deploy/install.sh from the fetched release, after the bootstrap
# host checks and before Docker is touched. It defines preflight_run and its
# per-item helpers and uses the shared helpers in install.sh (die/info/warn,
# port_free, stop_no_docker, MIN_DISK_MB/MIN_RAM_MB/WARN_RAM_MB, DIR). It is
# not a standalone script.
#
# One aligned line per item, each `ok`, `warn` or `stop` with a short reason,
# then the decision: Coolify (exit 0, untouched host), a container-based VPS
# that cannot run Docker (the clear stop), or the plain Docker path.

PREFLIGHT_OK=0
PREFLIGHT_WARN=0
PREFLIGHT_STOP=0
PREFLIGHT_COOLIFY=0
PREFLIGHT_DOCKER=0
PREFLIGHT_VIRT="unknown"

pf_line() { # LABEL STATUS REASON
  printf '    %-9s %-4s %s\n' "$1" "$2" "$3"
}

pf_os() {
  _os=""
  if [ -r /etc/os-release ]; then
    _os="$(unset NAME PRETTY_NAME; . /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-${NAME:-unknown}}")"
  fi
  if [ -n "$_os" ]; then
    pf_line "os" "ok" "$_os"
  else
    pf_line "os" "warn" "unknown (no /etc/os-release)"
  fi
}

pf_arch() {
  _arch="$(uname -m)"
  case "$_arch" in
    x86_64|amd64|aarch64|arm64) pf_line "arch" "ok" "$_arch" ;;
    *) pf_line "arch" "stop" "unsupported architecture '$_arch' (need x86_64 or arm64)"; PREFLIGHT_STOP=1 ;;
  esac
}

pf_ram() {
  _ram="$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || true)"
  _ram="${_ram:-0}"
  if [ "$_ram" -eq 0 ]; then
    pf_line "ram" "warn" "unknown (no /proc/meminfo)"
  elif [ "$_ram" -lt "$MIN_RAM_MB" ]; then
    pf_line "ram" "stop" "only ${_ram} MB (need ${MIN_RAM_MB} MB)"; PREFLIGHT_STOP=1
  elif [ "$_ram" -lt "$WARN_RAM_MB" ]; then
    pf_line "ram" "warn" "${_ram} MB (under ${WARN_RAM_MB} MB — a few AI turns at once may be slow)"
  else
    pf_line "ram" "ok" "${_ram} MB"
  fi
}

pf_disk() {
  _parent="$DIR"
  while [ ! -d "$_parent" ] && [ "$_parent" != "/" ]; do
    _parent="$(dirname "$_parent")"
  done
  _free="$(df -Pk "$_parent" 2>/dev/null | awk 'NR==2 { print int($4 / 1024) }' || true)"
  _free="${_free:-0}"
  if [ "$_free" -eq 0 ]; then
    pf_line "disk" "warn" "unknown under $_parent"
  elif [ "$_free" -lt "$MIN_DISK_MB" ]; then
    pf_line "disk" "stop" "${_free} MB free under $_parent (need ${MIN_DISK_MB} MB)"; PREFLIGHT_STOP=1
  else
    pf_line "disk" "ok" "${_free} MB free under $_parent"
  fi
}

pf_port() { # PORT
  if port_free "$1"; then
    pf_line "port $1" "ok" "free"
  else
    pf_line "port $1" "stop" "in use (stop the service using it, then retry)"; PREFLIGHT_STOP=1
  fi
}

pf_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    pf_line "docker" "warn" "not installed"
    return 0
  fi
  if docker info >/dev/null 2>&1; then
    PREFLIGHT_DOCKER=1
    pf_line "docker" "ok" "installed and running"
  else
    pf_line "docker" "warn" "installed but not running"
  fi
}

pf_virt() {
  _virt="unknown"
  if command -v systemd-detect-virt >/dev/null 2>&1; then
    _virt="$(systemd-detect-virt 2>/dev/null || true)"
    [ -n "$_virt" ] || _virt="unknown"
  fi
  PREFLIGHT_VIRT="$_virt"
  case "$_virt" in
    none) pf_line "virt" "ok" "none (bare metal)" ;;
    unknown) pf_line "virt" "warn" "unknown (no systemd-detect-virt)" ;;
    openvz) pf_line "virt" "stop" "openvz (a container-based VPS)"; PREFLIGHT_STOP=1 ;;
    lxc)
      if [ "$PREFLIGHT_DOCKER" -eq 1 ]; then
        pf_line "virt" "warn" "lxc (a container-based VPS)"
      else
        pf_line "virt" "stop" "lxc (a container-based VPS) and Docker is missing"; PREFLIGHT_STOP=1
      fi
      ;;
    *) pf_line "virt" "ok" "$_virt" ;;
  esac
}

pf_coolify() {
  _found=0
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'coolify'; then
    _found=1
  fi
  if [ "$_found" -eq 0 ] && [ -d /data/coolify/source ]; then
    _found=1
  fi
  if [ "$_found" -eq 1 ]; then
    PREFLIGHT_COOLIFY=1
    pf_line "coolify" "stop" "found — install Zilar from the Coolify template instead"
  else
    pf_line "coolify" "ok" "not found"
  fi
}

# The decision after the report. On a host that runs Coolify it prints the
# template path and the --desks-host command, then exits 0 with the host
# untouched; a host that cannot run Docker stops with the clear message;
# otherwise it returns so install.sh follows the plain Docker path.
preflight_decide() {
  if [ "$PREFLIGHT_COOLIFY" -eq 1 ]; then
    echo ""
    info "Coolify found. Install Zilar from Coolify: New Resource → Docker Compose Empty → paste https://raw.githubusercontent.com/JulioFerrero/zilar/main/deploy/coolify/docker-compose.yml (or pick \"Zilar\" once it is in Coolify's catalog), set the domain on web, deploy."
    info "AI computers on this host: curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host (the desk services already run in the stack; nothing to set there)"
    exit 0
  fi
  case "$PREFLIGHT_VIRT" in
    openvz) stop_no_docker "this host is a container-based VPS (openvz)" ;;
    lxc) [ "$PREFLIGHT_DOCKER" -eq 1 ] || stop_no_docker "this host is a container-based VPS (lxc) and Docker is not installed" ;;
  esac
  if [ "$PREFLIGHT_STOP" -eq 1 ]; then
    die "the host report has stop items above — fix them, then run this installer again"
  fi
}

preflight_run() {
  pf_os
  pf_arch
  pf_ram
  pf_disk
  pf_port 80
  pf_port 443
  pf_docker
  pf_virt
  pf_coolify
  preflight_decide
}
