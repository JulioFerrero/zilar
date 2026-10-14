# @zilar/desk

The desk jail: the base image and the `desk-tool` daemon that gives an AI a real
Linux computer for commands, git, code search and file edits. Zilar cloud and a
user's runner run **the same image and the same daemon**, so the tools behave
identically everywhere (`docs/audit/desk-runner-plan.md` §3).

Nothing here is wired into the agent loop yet. The cloud sidecar
(`src/agent`) is the host-side service that runs the jails; Task C puts it in
the agent loop and Task D installs it with gVisor on the VPS.

## The protocol

`desk-tool serve` reads one JSON request per line on stdin and writes one JSON
response per line on stdout. Requests may overlap; each response carries the
request's `id`.

```
request  {"id":1,"tool":"bash","args":{"command":"pytest -q","timeout_ms":600000}}
stdout   {"id":1,"stream":"stdout","data":"..."}          # repeated
stderr   {"id":1,"stream":"stderr","data":"..."}
done     {"id":1,"done":true,"exit_code":0,"truncated":false}
error    {"id":1,"error":{"code":"path_escape","message":"outside the workspace"}}
```

A request gets its own timeout (default 10 min; `timeout_ms` in `args` overrides
it) and a total output cap (default 1 MB, `DESK_MAX_OUTPUT_BYTES`). A command
that hits either is killed **with its whole process group**; capped output is
reported with `truncated: true`.

Error codes are a fixed set, never raw host text:
`not_provisioned | queue_full | jail_unavailable | timeout | output_too_large |
path_escape | host_blocked | tool_failed`.

## The tools

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `bash` | `{ command, cwd?, timeout_ms? }` | `/bin/bash -lc` in a fresh shell, own process group |
| `read` | `{ path, offset?, limit? }` | text file, 1-based line window; refuses binary and huge files |
| `write` | `{ path, content }` | creates parent dirs inside the root |
| `edit` | `{ path, oldString, newString, replaceAll? }` | exact replace; fails if `oldString` is not unique unless `replaceAll` |
| `grep` | `{ pattern, path?, glob?, max_results? }` | ripgrep `--json`, capped |
| `glob` | `{ pattern, path? }` | sorted file paths, capped |
| `git` | `{ args: string[] }` | hardened `git` (below) |

Every path resolves inside the workspace root (default `/workspace`,
`DESK_WORKSPACE_ROOT` to override). `..`, an absolute path outside the root and
a symlink that leaves the root are refused with `path_escape`; the check
`realpath`s the deepest existing parent, so a symlink cannot be smuggled in.

`git` never trusts a repository's config. It runs with
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`,
`GIT_CONFIG_NOSYSTEM=1`, `core.hooksPath=/dev/null`, `core.fsmonitor=false`,
`protocol.file.allow=never`, `GIT_LFS_SKIP_SMUDGE=1` and
`GIT_TERMINAL_PROMPT=0`. It refuses `-c`, `--config-env`, `--exec` and
`--upload-pack` in `args`, and accepts only `https://` remotes (the operator's
token is injected by the egress proxy, never by the daemon).

## The desk-agent sidecar (`src/agent`)

`desk-agent` is the host service the app talks to instead of the Docker socket
(plan §4.4). It owns the Docker socket, speaks newline-JSON over
`/run/zilar/desk.sock`, and only ever runs the configured pinned image with the
fixed run flags in code: no host path, no image, no runtime flag and no
arbitrary command is accepted from the caller. `provision` is idempotent per
`DeskKey`, a new jail starts only under the running cap and while the shared
memory pool is below 75%, and idle jails stop after two minutes.

Environment (all optional except the image):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DESK_IMAGE` | — | the pinned `…@sha256:…` image every jail runs |
| `DESK_AGENT_SOCKET` | `/run/zilar/desk.sock` | the unix socket |
| `DESK_RUNTIME` | `runsc` | gVisor on the VPS, `runc` locally |
| `DESK_NETWORK` | `desk-net` | the jail's network |
| `DESK_EGRESS_PROXY` | unset | the egress proxy base URL the jail reaches the web through (`http://desk-egress:3128`); per-desk credentials are added at provision |
| `DESK_EGRESS_REGISTRY` | `/run/zilar/egress.sock` | the unix socket where the proxy's registry accepts register/unregister |
| `DESK_CGROUP_PARENT` | `zilar-desks.slice` | the parent cgroup (empty to omit) |
| `DESK_WORKSPACE_ROOT` | `/var/lib/zilar/desks` | workspace images and folders |
| `DESK_WORKSPACE_MODE` | `image` | `image` = ext4 loop mount (VPS), `dir` = plain folder (macOS) |
| `DESK_MAX_RUNNING` | `12` | the running-jail cap |
| `DESK_IDLE_MS` | `120000` | idle stop after this long |
| `DESK_ALLOW_UNPINNED_IMAGE` | unset | local development only; skips the digest check |

```bash
# Local check with plain runc (Docker Desktop has no loop devices, so `dir`):
DESK_IMAGE=zilar-desk:dev DESK_ALLOW_UNPINNED_IMAGE=true \
  DESK_RUNTIME=runc DESK_NETWORK=none DESK_CGROUP_PARENT= \
  DESK_WORKSPACE_MODE=dir DESK_WORKSPACE_ROOT=/tmp/zilar-desks \
  DESK_AGENT_SOCKET=/tmp/zilar-desk.sock \
  pnpm --filter @zilar/desk exec tsx src/agent/main.ts
```

On the VPS (`image` mode) the sidecar needs root for `mount`/`umount` and
`mkfs.ext4` (Task D installs it as a systemd service); the `dir` mode needs no
root.

## The egress proxy (`src/egress`)

An AI's computer reaches the open web through this proxy, never directly, and
private and internal ranges are always blocked (plan §5, design §2.3). The same
proxy runs on the VPS and inside a user's runner, so it lives here.

`desk-egress` is a small `node:http`/`node:net` proxy with no new dependency:

- `CONNECT host:443` tunnels; plain `http://` `GET`/`HEAD` are forwarded on port
  80 only, for redirects.
- For every connection it resolves the host, classifies **every** address with
  the shared IP guard (`src/egress/ip-guard.ts`, moved here from
  `apps/server/src/sandbox/ip-guard.ts`) and connects to the pinned public
  address, which defeats DNS rebinding.
- It refuses IP-literal hosts, ports other than 443 and 80, credentials in the
  URL, and private, loopback, link-local, ULA, Teredo and 6to4 addresses.
- An optional per-desk allowlist (exact host match) tightens the open web
  default; the default AI has none.
- `beforeForward(deskId, host)` is the credential-injection hook (Task F); it
  returns no headers today.

Each desk gets its own proxy credential. On provision the sidecar registers the
desk with the proxy and gives the jail the URL
`http://<deskId>:<secret>@desk-egress:3128`; on stop it unregisters. The proxy
keeps desks in memory (`src/egress/registry.ts`) and the sidecar talks to it over
the `DESK_EGRESS_REGISTRY` unix socket.

`src/egress/log.ts` writes one JSON line per connection — time, desk id, host,
allowed or denied with a fixed reason code, and the bytes sent back — and keeps
the recent distinct hosts per desk (`hostsFor`) for "View steps". It never logs a
URL, path, header or body.

```bash
# Run the proxy locally (defaults to 0.0.0.0:3128 and /run/zilar/egress.sock):
DESK_EGRESS_PORT=3128 DESK_EGRESS_REGISTRY=/tmp/zilar-egress.sock \
  pnpm --filter @zilar/desk exec tsx src/egress/main.ts
```

## Build and test

```bash
pnpm --filter @zilar/desk build                  # bundles dist/desk-tool (esbuild)
pnpm --filter @zilar/desk test --reporter=dot    # paths + git hardening tests
pnpm --filter @zilar/desk typecheck
```

`build.mjs` uses `esbuild`, which is already a dependency of `@zilar/server`, to
bundle the daemon (including `effect`) into one self-contained JS file with a
`node` shebang. The image installs no `node_modules`.

## Build the image

```bash
pnpm --filter @zilar/desk build
docker build -t zilar-desk:dev packages/desk
```

The base image is pinned by digest; the date it was resolved is in the
`Dockerfile` comment.

## Run one request by hand

Locally, against a scratch workspace:

```bash
mkdir -p /tmp/desk-ws
printf '%s\n' '{"id":1,"tool":"bash","args":{"command":"echo hello"}}' \
  | DESK_WORKSPACE_ROOT=/tmp/desk-ws node packages/desk/dist/desk-tool serve
```

Or through the built image (stdin is the protocol, so `-i` is required):

```bash
printf '%s\n' '{"id":1,"tool":"bash","args":{"command":"echo hello"}}' \
  | docker run --rm -i zilar-desk:dev
```
