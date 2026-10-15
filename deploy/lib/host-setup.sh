# shellcheck shell=sh
#
# host-setup — the one-time host prep for AI computers (desks).
#
# Sourced by deploy/zilar; this file only defines cmd_host_setup and its
# helpers and uses the shared helpers there (die/info/run/need_cmd/DRY_RUN).
# `./zilar host-setup` is idempotent, needs root, and honours --dry-run.
#
# It prepares the host pieces Docker Compose cannot: a pinned gVisor runtime
# for the Docker daemon, and the shared cgroup memory pool every jail joins.
# The desk services themselves are Compose services (deploy/docker-compose.yml
# and deploy/coolify/docker-compose.app.yml) that run in every stack and stay
# idle until this prep runs.
#
# Plan: docs/audit/desk-runner-plan.md §4.1-4.2.

# Pinned, dated gVisor release (never `latest`). gVisor changed its release
# layout in 2026-07: from 20260714.0 on, a release ships a gvisor.tar.bz2
# bundle (runsc + the containerd shim + a gvisor-bin/ tree) instead of a bare
# `runsc`. The archive is extracted under /usr/local/bin so runsc finds
# gvisor-bin/ next to itself. .tar.bz2 needs no zstd on the host.
GVISOR_VERSION="20261005.0"
GVISOR_BUNDLE="gvisor.tar.bz2"
# systrap is the platform for a host without /dev/kvm (the VPS uses no KVM).
GVISOR_PLATFORM="systrap"
GVISOR_BASE="https://storage.googleapis.com/gvisor/releases/release/$GVISOR_VERSION"

DESK_DAEMON_JSON="/etc/docker/daemon.json"
DESK_SLICE_UNIT="/etc/systemd/system/zilar-desks.slice"
DESK_WORKSPACE_ROOT="/var/lib/zilar/desks"

# The systemd slice that caps every desk jail together (plan §4.2). The sidecar
# gives each jail `--cgroup-parent zilar-desks.slice`, so this one file is the
# whole memory pool: 4 GB hard, 3.5 GB soft, no swap, and a lower CPU weight
# than chat so a heavy desk never squeezes the app.
_desk_slice_body() {
  cat <<'EOF'
[Unit]
Description=Zilar desk jails memory pool (shared ceiling)
# Every desk jail joins this slice through the sidecar's
# --cgroup-parent zilar-desks.slice, so all of them together are capped below.
# This, not any per-jail limit, is what keeps a desk from taking the VPS down.

[Slice]
MemoryMax=4G
MemoryHigh=3500M
MemorySwapMax=0
TasksMax=4096
# Below the default 100, so under CPU contention chat wins.
CPUWeight=50
EOF
}

# Desks need Docker's runtime registration (step 2). Verify it took effect
# (SIGHUP reloads runtimes; if the running Docker is older and did not, fail
# loudly instead of pretending the install is done).
_desk_verify_runsc() {
  docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"' && return 0
  die "docker does not list runsc after the reload — the config is written, but this Docker needs 'systemctl restart docker' to pick it up"
}

cmd_host_setup() {
  [ "$#" -eq 0 ] || die "host-setup takes no arguments"

  if [ "$DRY_RUN" -eq 0 ]; then
    [ "$(id -u)" -eq 0 ] || die "host-setup needs root (try: sudo $PROG host-setup)"
    need_cmd curl "install curl (apt-get install -y curl)"
    need_cmd jq "install jq (apt-get install -y jq)"
    need_cmd sha512sum "install coreutils"
    need_cmd tar "install tar"
    need_cmd systemctl "host-setup needs systemd (systemctl)"
    need_cmd docker "install Docker and make sure the daemon is running"
  fi

  case "$(uname -m)" in
    x86_64 | amd64) _arch="x86_64" ;;
    aarch64 | arm64) _arch="aarch64" ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac

  info "host-setup: gVisor $GVISOR_VERSION ($_arch), the zilar-desks.slice pool, and $DESK_WORKSPACE_ROOT"

  # 1. The pinned runsc binary. Skip the download when the pinned version is
  # already installed (idempotent; FORCE=1 reinstalls).
  _installed=""
  if [ -x /usr/local/bin/runsc ]; then
    _installed="$(/usr/local/bin/runsc --version 2>/dev/null | head -n 1 || true)"
  fi
  case "$_installed" in
    *"$GVISOR_VERSION"*)
      info "runsc $GVISOR_VERSION is already installed"
      ;;
    *)
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "+ curl -fsSL $GVISOR_BASE/$_arch/$GVISOR_BUNDLE -o <tmp>/$GVISOR_BUNDLE"
        echo "+ curl -fsSL $GVISOR_BASE/$_arch/$GVISOR_BUNDLE.sha512 -o <tmp>/$GVISOR_BUNDLE.sha512"
        echo "+ sha512sum -c $GVISOR_BUNDLE.sha512   # verify the pinned release before installing it"
        echo "+ tar -xjf $GVISOR_BUNDLE -C /usr/local/bin   # runsc + gvisor-bin/"
        echo "+ chmod 0755 /usr/local/bin/runsc"
      else
        _tmp="$(mktemp -d)"
        trap 'rm -rf "$_tmp"' EXIT INT TERM
        run curl -fsSL "$GVISOR_BASE/$_arch/$GVISOR_BUNDLE" -o "$_tmp/$GVISOR_BUNDLE"
        run curl -fsSL "$GVISOR_BASE/$_arch/$GVISOR_BUNDLE.sha512" -o "$_tmp/$GVISOR_BUNDLE.sha512"
        (cd "$_tmp" && sha512sum -c "$GVISOR_BUNDLE.sha512") ||
          die "gVisor checksum verification failed for $GVISOR_BUNDLE"
        run tar -xjf "$_tmp/$GVISOR_BUNDLE" -C /usr/local/bin
        [ -x /usr/local/bin/runsc ] || die "runsc is missing after extracting $GVISOR_BUNDLE"
        run chmod 0755 /usr/local/bin/runsc
        trap - EXIT INT TERM
        rm -rf "$_tmp"
      fi
      ;;
  esac

  # 2. Register the runtime with Docker by merging JSON (keep every existing
  # key; back the file up once), then reload — SIGHUP reloads runtimes, so the
  # 38 running containers keep running. Never a full daemon stop+start.
  _runtime_json="{\"path\":\"/usr/local/bin/runsc\",\"runtimeArgs\":[\"--platform=$GVISOR_PLATFORM\"]}"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ cp -p $DESK_DAEMON_JSON $DESK_DAEMON_JSON.bak   # once, the original"
    echo "+ jq '.runtimes = ((.runtimes // {}) + {runsc: {\"path\": \"/usr/local/bin/runsc\", \"runtimeArgs\": [\"--platform=$GVISOR_PLATFORM\"]}})' $DESK_DAEMON_JSON"
    echo "+ systemctl reload docker   # SIGHUP; the running containers are untouched"
  else
    [ -f "$DESK_DAEMON_JSON" ] || echo '{}' >"$DESK_DAEMON_JSON"
    jq empty "$DESK_DAEMON_JSON" || die "$DESK_DAEMON_JSON is not valid JSON"
    if jq -e --argjson runtime "$_runtime_json" '.runtimes.runsc == $runtime' "$DESK_DAEMON_JSON" >/dev/null 2>&1; then
      info "the runsc runtime is already registered in $DESK_DAEMON_JSON"
    else
      [ -f "$DESK_DAEMON_JSON.bak" ] || cp -p "$DESK_DAEMON_JSON" "$DESK_DAEMON_JSON.bak"
      jq --argjson runtime "$_runtime_json" \
        '.runtimes = ((.runtimes // {}) + {runsc: $runtime})' \
        "$DESK_DAEMON_JSON" >"$DESK_DAEMON_JSON.new"
      jq empty "$DESK_DAEMON_JSON.new" || die "refusing to install an invalid $DESK_DAEMON_JSON"
      mv "$DESK_DAEMON_JSON.new" "$DESK_DAEMON_JSON"
      info "registered the runsc runtime in $DESK_DAEMON_JSON"
    fi
    run systemctl reload docker
    _desk_verify_runsc
  fi

  # 3. The shared memory pool slice (idempotent: rewrite only when it differs).
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ write $DESK_SLICE_UNIT:"
    _desk_slice_body | sed 's/^/    /'
    echo "+ systemctl daemon-reload"
  else
    _slice_tmp="$(mktemp)"
    _desk_slice_body >"$_slice_tmp"
    if [ -f "$DESK_SLICE_UNIT" ] && cmp -s "$_slice_tmp" "$DESK_SLICE_UNIT"; then
      info "$DESK_SLICE_UNIT is already up to date"
    else
      cp "$_slice_tmp" "$DESK_SLICE_UNIT"
      run systemctl daemon-reload
      info "wrote $DESK_SLICE_UNIT (4 GB pool: MemoryMax=4G, MemoryHigh=3500M, TasksMax=4096, CPUWeight=50)"
    fi
    rm -f "$_slice_tmp"
  fi

  # 4. The workspace root: per-desk ext4 image files live here (plan §4.2).
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "+ mkdir -p -m 0700 $DESK_WORKSPACE_ROOT"
  else
    mkdir -p "$DESK_WORKSPACE_ROOT"
    chmod 0700 "$DESK_WORKSPACE_ROOT"
    info "$DESK_WORKSPACE_ROOT is ready (mode 0700)"
  fi

  echo ""
  echo "Smoke test:"
  echo "  docker run --rm --runtime=runsc alpine uname -r   # expect 4.4.0 (gVisor's kernel, not the host's)"
  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then
    info "host-setup: dry run — nothing changed"
  else
    info "host-setup done. The desk services pick it up within about a minute; nothing else to set."
  fi
}
