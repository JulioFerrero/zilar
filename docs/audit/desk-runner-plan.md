# Desk and runner plan (audit) — T-1402

Written 2026-10-14 for the P2/P3 work. This audit **changes no code and nothing on the VPS**. It maps the
existing runner, tunnel and machines code, makes the P2 (Zilar cloud) and P3 (user runner) plans exact,
and splits the build into ordered tasks.

Read with: `docs/design/agent-system.md` (design), `docs/PROJECT_PLAN.md` §10–§13 (§10 engine, §11 runners,
§12 git, §13 search/browsing). The facts about the VPS (8 vCPU, ~7.5 GB free, 1 TB disk, no `/dev/kvm`, a
VM itself) come from `work/T-1402-desk-runner-plan-audit.md:31` and were not re-checked from the host.

## 0. Summary

- **The runner, tunnel and machines feature is a solid spike we keep.** Pairing is an atomic one-time
  code plus an ed25519 proof-of-possession (`apps/server/src/machines/pairing.ts:81`,
  `apps/server/src/machines/crypto.ts:16`); the hub authenticates every connection with a signed
  challenge, caches approved keys and closes live sockets on revoke
  (`apps/server/src/machines/hub.ts:50`, `packages/runner-tunnel/src/server.ts:443`); the mux streams
  bytes with real backpressure (`packages/runner-tunnel/src/mux.ts:50`); the machines API and its web
  and mobile UI already cover pair / approve / deny / rename / revoke / delete
  (`packages/api-contract/src/machines.ts:132`, `apps/web/src/routes/MachinesPage.tsx:26`,
  `apps/mobile/src/app/settings/machines.tsx:31`); capabilities detection (`apps/runner/src/capabilities.ts:123`)
  and the IP guard (`apps/server/src/sandbox/ip-guard.ts:175`) are reusable as-is.
- **The tunnel today carries model traffic, not desk commands.** The only data path is
  `model.open` → the LiteLLM gateway (`packages/runner-tunnel/src/protocol.ts:107`,
  `packages/runner-tunnel/src/server.ts:523`) plus `tunnel.open` to a fixed `exposedPorts` allowlist
  (`packages/runner-tunnel/src/runner.ts:567`). The runner CLI pairs with `exposedPorts: []` and the
  model listener off (`apps/runner/src/connect.ts:76-77`) and the README says it "cannot execute
  commands" (`apps/runner/README.md:44`). **The desk command set does not exist yet.** We add it to the
  same protocol; we delete the model listener and `model.open`, because under the design the jail never
  calls a model (design §2.1, T-1399).
- **The current "sandbox" is not a computer.** It is a QuickJS interpreter in a `worker_threads` Worker
  for small JS actions, reachable only through `request_action`/`tool.run`
  (`apps/server/src/sandbox/run-tool.ts:99`, `apps/server/src/agents/tools/definitions.ts:144`). The desk
  needs real Linux processes: a gVisor jail image plus a tool daemon, in a new `packages/desk`.
- **The hands interface is `provision / execute / stop / snapshot`** (design §2.4). One cloud adapter
  (gVisor on the VPS) and one runner adapter share the **same tool daemon** over a byte stream, so the
  same image and the same tools behave everywhere (design §2.6).
- **Egress is one proxy per host**, open web by default, private ranges blocked by the existing
  `classifyIp`, hosts logged, and short-lived GitHub credentials injected at the proxy so the jail never
  holds a token (design §2.3, §3.2, §3.9). Recommended token: a **GitHub App installation token**.
- **The VPS can run jails, but the RAM, not the CPU, sets the cap.** With 2 GB hard caps per jail and
  ~7.5 GB free the honest starting cap is about 3 running jails, not 10; 10 is a target for the later
  dedicated KVM host (design §2.4). This, disk-quota support and the Docker access path are the open
  questions for Julio (§9).

## 1. Inventory: what we reuse, rework or delete

Legend: **solid** = keep and build on; **spike** = reusable shape but needs P2/P3 work; **delete** = the
design replaces it or it contradicts the design.

### 1.1 Runner pairing and identity — solid

| Piece | Where | Notes |
| --- | --- | --- |
| Key pair generation | `packages/runner-tunnel/src/keys.ts:18` | ed25519, SPKI public / PKCS8 private, base64 |
| Sign / verify a challenge | `packages/runner-tunnel/src/keys.ts:32`, `:45` | `verifyNonce` returns false, never throws |
| Pairing code | `apps/server/src/machines/codes.ts:8`, `:14` | 8 chars, unambiguous alphabet, TTL 10 min |
| Code storage (hash only) | `apps/server/src/machines/codes.ts:38` | SHA-256 hex; the plain code is returned once |
| Atomic code consume | `apps/server/src/machines/pairing.ts:81` | single `UPDATE … WHERE used_at IS NULL AND expires_at > now` |
| Quotas at insert | `apps/server/src/machines/pairing.ts:109` | 20 machines, 5 pending, 5 codes (`service.ts:9-11`) |
| Pairing signature check | `apps/server/src/machines/crypto.ts:16` | ed25519 over `zilar-pair:v1:<code>` (`codes.ts:45`) |
| Public pair route | `apps/server/src/machines/api.ts:279` | global 30/min + per-IP 10/min, one `invalid_code` for every failure (`:285-333`) |
| Runner side of pairing | `apps/runner/src/pair.ts:97` | POST `/api/runner/pair` (`:132`), saves identity on 201 (`:152`) |
| Identity on disk | `apps/runner/src/identity.ts:43`, `:144` | `identity.json`, dir `0700`, file `0600`, temp+rename; refuses a group/world-readable file (`:126`) |
| Identity summary | `apps/runner/src/identity.ts:223` | machine id, fingerprint; never the private key |

This is exactly the "pairing in two steps, no tokens to copy" the design wants (design §2.6). We reuse
it unchanged.

### 1.2 The hub and tunnel — solid core, spike edges

| Piece | Where | Notes |
| --- | --- | --- |
| Handshake (hello → challenge → auth → ready) | `packages/runner-tunnel/src/server.ts:423`, `:443` | re-reads the key mid-handshake so a revoke wins (`:452`) |
| Version gate | `packages/runner-tunnel/src/protocol.ts:4`, `server.ts:424` | one version today; the protocol is already versioned |
| Approved-key cache | `apps/server/src/machines/hub.ts:50` | 30 s refresh + synchronous approve/revoke events |
| Revoke closes the socket | `packages/runner-tunnel/src/server.ts:149`, `CLOSE_REVOKED` | instant; the hub's cache fires it (`apps/server/src/machines/hub.ts:148`) |
| Reconnect with backoff | `packages/runner-tunnel/src/runner.ts:85`, `:265` | fatal close codes stop the loop (`:626`) |
| Mux: streams, framing, backpressure | `packages/runner-tunnel/src/mux.ts:50`, `:398` | 5-byte header, 256 KiB frames (`protocol.ts:21`), 256 KiB window (`:31`), pause/resume |
| Socket bridge both ways | `packages/runner-tunnel/src/mux.ts:398` | used for desk sockets, gateway sockets, previews |
| Health | `packages/runner-tunnel/src/runner.ts:501`, `server.ts:537` | heartbeat + ping/pong timeout |
| Preview tunnel (unauthenticated) | `packages/runner-tunnel/src/server.ts:232`, `:559` | spike: a token is the only capability; M3 work if reused |
| Hub startup | `apps/server/src/machines/hub.ts:238` | requires an `http://` gateway for model traffic (`:263`) |
| Config | `apps/server/src/config.ts:234`, `:271` | `RUNNER_HUB_ENABLED` off by default; port 3189 |
| Deploy | `deploy/coolify/docker-compose.app.yml:187-188` | off; no Docker socket mounted anywhere |

**Solid:** handshake, revoke, reconnect, mux and backpressure. **Spike:** `model.open` and the model
listener (delete, see 1.6), the preview tunnel's lack of authorization (out of scope here), and the
missing desk command set (add).

### 1.3 Machines API, data and UI — solid

| Piece | Where | Notes |
| --- | --- | --- |
| Contract + routes | `packages/api-contract/src/machines.ts:132` | `/api` prefix; list, approve, deny, revoke, rename, remove, public pair (`:134-168`) |
| Server handlers | `apps/server/src/machines/api.ts:150` | mount and deps `:93`, `app.ts:315` |
| Row reads/writes | `apps/server/src/machines/machines.ts:81`, `:123` | revoke is a transaction that also clears `ais.machine_id` (`:141`) |
| Owner-scoped lookup (404 on foreign id) | `apps/server/src/machines/machines.ts:65` | |
| Durable registry for the hub | `apps/server/src/machines/registry.ts:31` | approved-only key lookup |
| Owner view | `apps/server/src/machines/view.ts:28` | never returns the public key; fingerprint only |
| DB tables | `apps/server/drizzle/0010_bumpy_talkback.sql:11`, `:1` | `machines`, `machine_pairing_codes` |
| AI home machine column | `apps/server/drizzle/0015_late_randall_flagg.sql:1` | `ais.machine_id`, FK `ON DELETE set null` |
| Web UI | `apps/web/src/routes/MachinesPage.tsx:26`, route `apps/web/src/routes/AppRoutes.tsx:174` | pages + `apps/web/src/components/machines/*` |
| Web API client | `apps/web/src/lib/api/machines.ts:16` | |
| Web AI picker | `apps/web/src/components/ais/AiMachineSection.tsx:14` | select "Runs on", approved machines + "The platform" |
| Mobile UI | `apps/mobile/src/app/settings/machines.tsx:31`, `apps/mobile/src/components/machines/*` | same flows; the row shows less (`machine-card.tsx:22`) |
| Mobile API client | `apps/mobile/src/lib/machines-api.ts:48` | `setAiMachine` at `:65` |
| AI home machine route | `packages/api-contract/src/ais.ts:171` | `PUT /api/ais/:id/machine` |
| Shared settings entry | `packages/chat-core/src/settings-items.ts:58` | "Machines" (web + mobile) |
| Mock backend | `packages/mock-backend/src/domains/machines/routes.ts:16` | for `?mock=1` |

This is a lot of finished surface. The `ais.machine_id` column and the "Runs on" picker already
implement a home machine; P3 only extends the value into `cloud / runner / auto` (§6.6).

### 1.4 Capability detection — solid

`apps/runner/src/capabilities.ts:47` defines the report schema and `:123` detects it (os, arch, cores,
RAM, disk free, a Docker driver probe at `:105`). The server validates the same shape strictly
(`packages/api-contract/src/machines.ts:92`) and stores it as jsonb. `PublicMachine` exposes only the
safe subset (`apps/server/src/machines/view.ts:37-44`). The P2/P3 work extends the `drivers` list and the
`tools` map (`capabilities.ts:156` sends `tools: {}` today) to report gVisor / bubblewrap / apple-container
availability, which the server uses to refuse a host that cannot run a jail (design §2.6).

### 1.5 IP guard and guarded fetch — solid, reuse the guard not the fetcher

`classifyIp` (`apps/server/src/sandbox/ip-guard.ts:175`) is pure and total for IPv4/IPv6: it blocks
RFC1918, loopback, link-local, CGNAT, multicast, reserved, IPv6 ULA/multicast/link-local, and the
IPv4-embedding ranges (Teredo `:153`, 6to4 `:159`, NAT64 `:169`), and anything it cannot parse
(`:192`). `isIpLiteral` (`:195`) refuses IP-literal hosts. The egress proxy **reuses `classifyIp`**; it
does **not** reuse `guardedGet` (`apps/server/src/web-tools/guarded-fetch.ts:154`) as-is, because that
fetcher is deliberately GET-only, HTTPS/443-only, no-credentials, no-redirects and allowlist-first
(`:183-214`) — the right shape for a reader tool and the wrong shape for a proxy that must carry
`CONNECT` TLS and (on the owner's allowlist) push traffic. The proxy copies its good ideas: resolve, then
classify **every** address (`guarded-fetch.ts:202-214`), connect to a pinned IP, hard deadline
(`:239`), never follow a redirect without re-checking (`:245`).

### 1.6 What is a spike to rework, and what to delete

**Rework:**

- `tunnel.open` + `exposedPorts` (`packages/runner-tunnel/src/runner.ts:567`) is a generic port-forward
  spike. The desk does not need arbitrary ports; it needs the four desk operations (§2). Keep the message
  and the mux for previews/engine later, add desk ops beside it.
- `createPreviewToken`/`handlePreviewRequest` (`packages/runner-tunnel/src/server.ts:232`, `:559`) has no
  room-member authorization; out of scope for P2/P3, leave as a spike.
- `capabilities.tools` is always `{}` (`apps/runner/src/capabilities.ts:156`); fill it with the jail
  drivers and tool packs we detect.

**Delete (with the P2/P3 change, not before):**

- The runner **model listener** and its `modelUrl`/`modelBindAddress`
  (`packages/runner-tunnel/src/runner.ts:594`, `:163`, `:173`) and the runner option
  `enableModelListener` (`:46`). The design keeps model calls in the server; a jail never holds a key
  (design §2.1, §3.1, T-1399).
- The **`model.open`** control message and the server's `handleModelOpen` + `gatewayUrl` requirement
  (`packages/runner-tunnel/src/protocol.ts:107`, `server.ts:523`, `apps/server/src/machines/hub.ts:263-269`,
  `:4`). The runner-tunnel demo/harness paths that only exercise `model.open` follow
  (`packages/runner-tunnel/src/demo.ts`, `test-harness.ts`).
- The README sentence "This runner cannot execute commands from the server; desks are a later step"
  (`apps/runner/README.md:42-46`) becomes wrong and is rewritten in the same task.
- **Docs only:** `packages/sandbox-drivers/` in the tree sketch (`docs/PROJECT_PLAN.md:1423`) is superseded
  by `packages/desk`. `packages/agent-drivers` is already gone (`docs/audit/simplify-plan.md:166`,
  `docs/audit/simplify-status.md:51`).

Nothing else is deleted: deletion of the current sandbox would break `request_action` before the desk
tools exist, so the QuickJS sandbox stays until the desk replaces `tool.run` (`apps/server/src/sandbox/run-tool.ts:99`).

## 2. The hands interface

The brain calls exactly four operations (design §2.4). They live in a new package, `packages/desk`
(`hands.ts`), and are implemented once for Zilar cloud and once for a runner. Both adapters speak to the
**same tool daemon** (§3) over a duplex byte stream, so `execute` has one shape everywhere.

```ts
export interface DeskKey {
  readonly aiId: string;
  readonly projectId: string; // the repo / project the desk is bound to
}

export interface DeskLimits {
  readonly memoryBytes: number; // 1-2 GiB hard cap
  readonly pids: number; // 256
  readonly cpuShares: number; // relative share, no pinning
  readonly diskBytes: number; // workspace quota, e.g. 5 GiB
  readonly commandTimeoutMs: number; // per command, e.g. 600_000
  readonly taskWallClockMs: number; // per task
}

export interface DeskEgressPolicy {
  /** Omitted = open web (Julio's default); set = allowlist for this AI. */
  readonly allowedHosts?: readonly string[];
  /** The owner's GitHub repo this desk may push to, if any. */
  readonly git?: { readonly host: string; readonly ownerRepo: string };
}

export interface DeskSpec {
  readonly key: DeskKey;
  readonly ownerUserId: string;
  readonly imageDigest: string; // pinned (design §3.8)
  readonly limits: DeskLimits;
  readonly egress?: DeskEgressPolicy;
}

export interface DeskRef {
  readonly id: string;
  readonly key: DeskKey;
}

export interface DeskToolCall {
  readonly tool: 'bash' | 'read' | 'write' | 'edit' | 'grep' | 'glob' | 'git';
  readonly args: unknown; // validated by the daemon against the tool's schema
  readonly timeoutMs?: number;
}

export type DeskChunk =
  | { readonly type: 'stdout'; readonly data: string }
  | { readonly type: 'stderr'; readonly data: string }
  | { readonly type: 'exit'; readonly code: number; readonly truncated: boolean };

export interface SnapshotRef {
  readonly deskId: string;
  readonly label: string;
  readonly bytes: number;
}

export interface Hands {
  /** Idempotent per DeskKey: a second call returns the live desk, never a second jail. */
  provision(spec: DeskSpec): Promise<DeskRef>;
  /** Runs one tool; yields stdout/stderr chunks and a final exit chunk. */
  execute(ref: DeskRef, call: DeskToolCall, signal?: AbortSignal): AsyncIterable<DeskChunk>;
  /** Kills the jail. The workspace volume survives unless keepWorkspace is false. */
  stop(ref: DeskRef, opts?: { readonly keepWorkspace?: boolean }): Promise<void>;
  snapshot(ref: DeskRef, label: string): Promise<SnapshotRef>;
}
```

**Messages.** On the runner link the four operations are new control frames over the existing tunnel,
carrying the same fields as the types, snake_cased like the current protocol (`protocol.ts:53-110`):

```
server → runner
  desk.provision  { desk_id, ai_id, project_id, image_digest, limits, egress }
  desk.exec       { desk_id, stream_id }     # then JSON-RPC lines over the mux stream
  desk.stop       { desk_id, keep_workspace }
  desk.snapshot   { desk_id, label }
runner → server
  desk.ready      { desk_id }
  desk.stopped    { desk_id }
  desk.snapshot   { desk_id, label, bytes }
  desk.error      { desk_id, code, message }
```

`desk.exec` opens a stream and the frames on it are the daemon's newline-delimited JSON (below); the
mux already gives framing, backpressure and teardown (`mux.ts:50`, `:398`).

**The daemon protocol** (independent of transport; identical for cloud and runner):

```
request  {"id":1,"tool":"bash","args":{"command":"pytest -q","timeout_ms":600000}}
stdout   {"id":1,"stream":"stdout","data":"..."}          # repeated
stderr   {"id":1,"stream":"stderr","data":"..."}
done     {"id":1,"done":true,"exit_code":0,"truncated":false}
error    {"id":1,"error":{"code":"path_escape","message":"outside the workspace"}}
```

**Cloud transport.** A privileged host sidecar (`desk-agent`, §4.4) starts the jail and then opens one
`docker exec -i --user desk <jail> /opt/desk/desk-tool serve` per `execute`, piping the stream to the
app over a unix socket. **Runner transport.** The server sends `desk.exec` and the runner runs the same
command locally with its isolation driver, then attaches the stream (`attachSocketToStream`,
`mux.ts:398`). The tool daemon is byte-for-byte the same.

**Limits and errors.** Every ceiling is enforced host-side as well as daemon-side: command timeout,
total output cap (the daemon truncates and sets `truncated`), and the desk's memory/pids/CPU shares.
Errors are a fixed mini-taxonomy, never raw host text:
`not_provisioned | queue_full | jail_unavailable | timeout | output_too_large | path_escape | host_blocked | tool_failed`.
`queue_full` is the design's "queued (2 ahead)" case (design §4.8) and is never a hard failure.

## 3. `packages/desk`: the base image and the tool daemon

### 3.1 The base image, pinned by digest

One image, built once in `packages/desk` and used by cloud and runner (design §2.6). Tools: git, a shell,
ripgrep, node, python3, build-essential, and the daemon. Dockerfile sketch:

```dockerfile
FROM node:24-bookworm-slim@sha256:<PINNED_DIGEST>
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ripgrep python3 python3-pip build-essential ca-certificates jq \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system core.hooksPath /dev/null \
    && git config --system core.fsmonitor false \
    && useradd -u 10001 -m -d /workspace desk
COPY dist/desk-tool /opt/desk/desk-tool
USER 10001
WORKDIR /workspace
ENTRYPOINT ["/opt/desk/desk-tool", "serve"]
```

The build pins the base digest and the daemon is a single file; the deploy pins the image digest
(`imageDigest` in `DeskSpec`). The workspace is the only writable mount; `/tmp` and `/home/desk` are
tmpfs (§4.2). Read-only base, dropped capabilities, no-new-privileges are properties of how the jail is
*run*, not of the image.

### 3.2 The tool daemon (`desk-tool`)

A small Node program in the jail. It reports its tools, enforces the path rules, and runs each tool. All
paths are resolved inside the workspace root; `..`, absolute escapes and symlink escapes are refused
(`path_escape`). Tools:

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `bash` | `{ command, cwd?, timeout_ms? }` | `/bin/bash -lc` in a fresh shell; daemon kills the process tree on timeout; stdout+stderr capped and truncated |
| `read` | `{ path, offset?, limit? }` | text file, line window; refuses binary and huge files |
| `write` | `{ path, content }` | creates parent dirs inside the root; refuses escape |
| `edit` | `{ path, oldString, newString, replaceAll? }` | exact string replace; **fails if `oldString` is not unique** unless `replaceAll` |
| `grep` | `{ pattern, path?, glob?, max_results? }` | ripgrep, JSON output, capped |
| `glob` | `{ pattern, path? }` | sorted file paths, capped |
| `git` | `{ args: string[] }` | `git` with the hooks/LFS hardening below |

The names are OpenCode's where they overlap (`bash`, `read`, `write`, `edit`, `grep`, `glob`), matching
the design's "OpenCode-style set" (design §2.3, `docs/PROJECT_PLAN.md:790`).

**Git hardening** (design §2.3): the daemon never trusts a repo's config. It runs git with
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null` (plus `GIT_CONFIG_NOSYSTEM=1`),
`core.hooksPath=/dev/null`, `GIT_LFS_SKIP_SMUDGE=1`, `GIT_TERMINAL_PROMPT=0`, `protocol.file.allow=never`,
and it refuses `-c`/`--config-env`/`--exec`/`--upload-pack` in `args` so a task cannot re-enable a hook,
a filter or a local exec path. Only `https://` remotes are accepted; the token is injected by the proxy,
never by the daemon (§5.4).

### 3.3 How the server's agent loop exposes them

The model already sees a small tool array built by `buildTools` / `buildGroupTools`
(`apps/server/src/agents/tools/definitions.ts:229`, `:246`) and dispatched by `createToolExec`
(`apps/server/src/agents/gateway/tool-exec.ts:54`, `:64`). The desk tools are added the same way:

- New `apps/server/src/agents/tools/desk-definitions.ts`: one `ChatToolDefinition`
  (`definitions.ts:15`) per tool, with descriptions and JSON-Schema parameters matching the daemon table
  in 3.2. Kept stable across turns (design §2.5; no tool churn).
- `buildTools` / `buildGroupTools` append the desk set only when the AI has a computer enabled
  (`ai.computerMode !== absent`); an AI without one never advertises them.
- `executeToolCall` (`gateway/tool-exec.ts:64`) gains one branch that calls
  `hands.execute(ref, { tool, args })` and streams the chunks into the existing
  `<untrusted-tool-output>` wrapper and the 8 KiB result truncation
  (`apps/server/src/agents/tool-exec.ts:183`). Big outputs go to a file in the workspace and only the
  path is returned (design §2.5).
- The turn-level caps already exist and apply unchanged (`TOOL_TURN_WALL_CLOCK_MS`,
  `TOOL_TURN_MAX_CALLS`, `TOOL_RESULT_MAX_CHARS` in `apps/server/src/agents/tool-loop.ts:382-389`, and
  `AGENT_TOOL_MAX_ROUNDS` in `apps/server/src/config.ts:266`), plus the desk's own command timeout.

## 4. Zilar cloud (P2) on the VPS

### 4.1 gVisor (`runsc`, systrap) install — for the lead to run later, with Julio's OK

The VPS has no `/dev/kvm`, so gVisor uses the **systrap** platform automatically (design §2.3,
`work/T-1402-desk-runner-plan-audit.md:31`). Nothing here is run by this audit. The lead runs it once,
on the host, as root:

```bash
# 1. Install runsc (pin the release; verify the checksum before installing).
ARCH=$(uname -m)                       # expect x86_64
URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"
curl -fsSL "${URL}/runsc" -o /usr/local/bin/runsc
curl -fsSL "${URL}/runsc.sha512" -o /tmp/runsc.sha512
(cd /usr/local/bin && sha512sum -c /tmp/runsc.sha512)
chmod 0755 /usr/local/bin/runsc

# 2. Register the runtime with Docker and restart it.
runsc install                          # writes the runtimes block into /etc/docker/daemon.json
systemctl restart docker

# 3. Prove it works and that it is gVisor, not the host kernel.
docker run --rm --runtime=runsc alpine uname -r      # gVisor reports 4.4.0
runsc --version
cat /etc/docker/daemon.json                          # confirm the "runsc" runtime is present
```

Rollback is deleting the `runsc` runtime key from `/etc/docker/daemon.json` and restarting Docker;
jails already gone, nothing else changes. Cost of admission: gVisor adds tens of MB per jail and slows
syscall-heavy work (design §5, §9). If the release host is unreachable, the fallback is `apt` from the
gVisor repo or building from source; a systemd-cached copy under `/usr/local/bin` is the artefact to
pin.

### 4.2 Per-task jail lifecycle

- **One jail per active task**, mounted on the AI's **per-project workspace**. The workspace path is
  `/var/lib/zilar/desks/<aiId>/<projectId>` (cloud), one volume per `DeskKey`.
- **Provision on first use**, idempotent per `DeskKey` (design §2.3). A pool of 2–3 pre-started jails is
  a later optimisation (design §2.3, §6 P6) — not P2.
- **Idle stop after ~2 minutes.** A timer per desk resets on each `execute`; on idle the jail is killed
  and the volume stays, so an idle AI costs only disk (design §2.3).
- **Run flags** (the exact host-side create call):

```bash
docker create --name "desk-<id>" --runtime=runsc \
  --read-only --tmpfs /tmp:rw,size=256m,exec --tmpfs /home/desk:rw,size=64m \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 2g --memory-swap 2g --pids-limit 256 --cpu-shares 512 \
  --mount type=volume,src="desk-<ai>-<proj>",dst=/workspace \
  --network desk-net \
  --env HTTP_PROXY=http://desk-egress:3128 --env HTTPS_PROXY=http://desk-egress:3128 \
  --env NO_PROXY=localhost,127.0.0.1 \
  "<image>@<digest>"
```

- **Limits are ceilings, not reservations** (design §2.3): memory 1–2 GB hard, pids 256, CPU share (no
  pinning), disk quota per workspace (e.g. 5 GB), per-command wall clock (10 min) and per-task wall
  clock. The daemon enforces the command timeout; the runtime enforces memory/pids/CPU; an idle jail
  uses almost nothing.
- **`--read-only`** root, the only writable mount is `/workspace` (plus tmpfs). Nothing from the host is
  mounted except the workspace volume.
- **Disk quota** needs a filesystem that supports it: XFS project quotas (`pquota`) are the clean path;
  overlay2 + ext4 cannot cap a named volume. If the data filesystem is ext4 this needs a decision
  (reformat a dedicated disk XFS, or a size-limited per-desk image file on a loop device). **Open
  question — see §9.** The lead's check is `findmnt -no FSTYPE /var/lib/docker`.

### 4.3 Concurrency cap and fair queue

- One **running**-jail cap per host. The design starts at 10 (design §2.3); on the current VPS the RAM
  budget, not the CPU, is the limit: ~7.5 GB free ÷ 2 GB per jail ≈ 3 safe running jails (§9). Make the
  cap configuration (`DESK_MAX_RUNNING`, default 3 on the VPS, 10+ on the KVM host).
- A **fair queue per user**: FIFO within an owner, round-robin across owners, so one user's burst cannot
  starve another. A request over the cap waits and the chat card says "Queued (n ahead)" (design §4.8).
- The queue lives in the same host-side component that owns the jail lifecycle (§4.4), because it must be
  the single serialiser of the cap.

### 4.4 Who talks to Docker: socket vs sidecar — recommendation

The app runs in a container and no compose file mounts `/var/run/docker.sock`
(`deploy/coolify/docker-compose.app.yml:120-249`, verified: no socket, no `privileged`, no `pid: host`).

- **Giving the app container the Docker socket** means a compromise of the server (or of one AI's
  output that reaches an unhardened path) is a **host root** compromise: a container started with
  `--privileged -v /:/host` is a full escape. This contradicts the design's isolation goal (§3.3).
- **Recommended: a small privileged sidecar `desk-agent` on the host**, a systemd service that owns the
  Docker socket and exposes **only** the four operations over a unix socket
  (`/run/zilar/desk.sock`) mounted into the app container. It validates every field with a schema,
  never accepts a host path, a `--privileged` flag, an arbitrary image or an arbitrary command, and
  only ever runs the pinned image with the fixed run flags in §4.2. The mux/JSON contract in §2 is its
  API. The app never sees the Docker socket.
- Even the sidecar is privileged, so it stays tiny (one file, no user input beyond the schema), is
  pinned, and gets the same revoke/kill path (a `Stop all` that removes every `desk-*` container).

The sidecar is a **production change** (a new host service and a socket mount in the compose file) and
therefore needs Julio's OK when P2 is installed — see §9.

## 5. The egress proxy

### 5.1 Where it runs

One proxy **per host**: on the VPS it is `desk-egress` on the `desk-net` bridge, reachable only by
jails; on a runner it is a component of the runner binary, outside every jail (design §2.6, §2.3). Jails
get `HTTP(S)_PROXY` and, on the cloud, a network where the proxy's port is the only route out (the
`desk-net` bridge with an egress firewall). Nothing dials the panel or the database directly.

### 5.2 Policy

- **Open web by default** (Julio's decision, design §7.3): any public host on 443 (and 80 for
  redirects).
- **Private and internal ranges always blocked**, by reusing `classifyIp`
  (`apps/server/src/sandbox/ip-guard.ts:175`): resolve the name, classify **every** address, refuse if
  any is blocked, then connect to a pinned public IP (`guarded-fetch.ts:202-215`). IP-literal hosts are
  refused (`isIpLiteral`, `:195`), as are credentials in the URL, non-standard ports and non-TLS
  schemes.
- **Optional per-AI allowlist** (`DeskEgressPolicy.allowedHosts`): when set, only those hosts pass;
  exact-host match like `guarded-fetch.ts:196-201`. The default AI has none.
- **No redirect is followed blindly**: a `Location` to a new host is re-checked against the policy
  before the next hop (`guarded-fetch.ts:245-247` is the reader behaviour; the proxy re-checks each
  connection).

### 5.3 Logging the hosts

The proxy logs, per request: timestamp, desk id, `host`, allowed/denied, bytes, and the proxy's own
decision code. It logs **no** URLs, query strings, headers or bodies (AGENTS.md: audit entries carry ids
only). The host list is attached to the task's session log and shown in "View steps" (design §2.3,
§3.7). Denied hosts are visible too, so the owner sees what the AI tried to reach.

### 5.4 Injecting short-lived, host-scoped credentials

The jail never holds a token (design §2.3, §3.1). For git push to the owner's connected GitHub:

- **Recommended token: a GitHub App installation token** — one GitHub App for the platform, as
  `docs/PROJECT_PLAN.md:1111-1116` already specifies. The server mints it per task
  (`POST /app/installations/{id}/access_tokens`) for **one repository**, with **`contents: write` and
  `pull_requests: write`**, valid **one hour**. It is scoped to the connected repo and the workspace, is
  revocable by uninstalling, and expires on its own. It is pushed to the host proxy **out of band** over
  the authenticated control channel (never through the jail).
- **Fallback:** a fine-grained PAT, only when a user brings their own. PATs cannot be minted per hour,
  so they are strictly worse; the plan is the App token.
- **Injection rule:** the proxy adds `Authorization: Basic base64("x-access-token:<token>")` only on
  requests whose host is the configured git host (`github.com` / `api.github.com`) **and** whose path
  belongs to `ownerRepo`. Any other host/path gets no header. This is the "host-scoped" requirement; the
  same mechanism injects MCP and other API tokens (design §3.1, §5).
- **Push scope:** the git proxy only allows pushes to `agent/<ai-name>/*` branches
  (`docs/PROJECT_PLAN.md:1118`); `main` stays human-merged.

## 6. The runner (P3)

The runner is `apps/runner` plus `packages/runner-tunnel`. The brain stays in the server; only the hands
move (design §2.6). We keep pairing, identity, the hub, the mux and the machine UI, and add the four
desk operations.

### 6.1 Runner protocol additions

Add the `desk.*` frames of §2 to `packages/runner-tunnel/src/protocol.ts` (snake_cased schemas, the same
`parseControlMessage` direction maps, `boundedString` caps) and route them in
`RunnerClient.routeControl` (`packages/runner-tunnel/src/runner.ts:532`) and the server's
`handleReadyMessage` (`packages/runner-tunnel/src/server.ts:480`). Reuse the mux for `desk.exec`
streams. **Delete** the `model.open` path (§1.6) in the same task. Bump `PROTOCOL_VERSION`
(`protocol.ts:4`): the server still accepts the previous version for a release so old runners keep
working (design §2.6, `docs/PROJECT_PLAN.md:1027`).

### 6.2 Isolation per host

The runner refuses to run without a working jail — there is **no unsandboxed mode** (design §2.6).
Detection extends `capabilities.drivers` (`apps/runner/src/capabilities.ts:105`), which today only probes
Docker:

| Host | Isolation | Notes |
| --- | --- | --- |
| Linux | gVisor (`runsc`), else bubblewrap + seccomp | `runsc` preferred; `bwrap --unshare-all --die-with-parent` with the workspace bind-mounted |
| macOS | Apple `container` (macOS 26), else Docker / OrbStack | one light VM per container; Docker Desktop's single VM is the fallback |
| Windows | WSL2 + gVisor | the same image inside WSL2 |

The runner runs the **same image and the same daemon** (§3); "equal or better" is kept by the plan's one
CI task that runs on cloud and on a runner (design §2.6, `docs/PROJECT_PLAN.md:1418`). Local CPU/RAM/
disk ceilings are the owner's (§6.4).

### 6.3 Runner-side egress proxy and token injection

The runner runs the same egress proxy as cloud (§5), outside the jail; it receives the per-task GitHub
token over the authenticated tunnel and injects it on the same host/path rule. The jail's `HTTP(S)_PROXY`
points at the runner's proxy; on a Mac the runner's VM/host firewall allows only that proxy out. The
proxy's host log flows back to the server with the tool results.

### 6.4 Local policy that can only tighten

A runner config file (`~/.zilar-runner/policy.json`, next to `identity.json`, `identity.ts:80`) with the
owner's ceilings: `allowNetwork` (false = no egress at all), `allowDomains`, `maxMemoryGb`,
`maxCpuShares`, `maxDiskGb`, availability windows, and whether folders may be mounted. The effective
policy is `min(server request, local policy)` for every field — **the runner can only tighten**
(design §2.6, §3.9). A server that asks for more is silently clamped to the local ceiling, and the
clamp is logged.

### 6.5 Stop all and signed auto-update

- **Stop all:** the tray applies the design's one-button kill (design §2.6) by removing every jail the
  runner owns. `desk.stop` is already per-desk; `Stop all` is the loop, host-side.
- **Signed auto-update:** a new `runner.update { version, url, sha256, signature }` frame; the runner
  downloads, verifies an ed25519 signature against an embedded public key, verifies the hash, then
  replaces the binary by atomic rename and restarts (design §2.6, §3.8). It refuses an unsigned or
  mismatched update and keeps running the old binary.

### 6.6 "Computer: Zilar cloud / My Mac / Auto" — data model and API

Today an AI has a nullable home machine id (`ais.machine_id`, `apps/server/drizzle/0015_late_randall_flagg.sql:1`;
`AiRow.machineId`, `apps/server/src/db/rows.ts:120`) set by `PUT /api/ais/:id/machine`
(`packages/api-contract/src/ais.ts:171`, `AssignMachinePayload` `:87`). P3 extends it into a three-way
choice:

- **Migrate (expand):** `ALTER TABLE ais ADD COLUMN computer_mode text NOT NULL DEFAULT 'cloud'` with a
  check in `('cloud','runner','auto')`. `machine_id` keeps meaning "the chosen runner". No column is
  dropped or renamed, so the previous server keeps working (AGENTS.md expand/contract).
- **Semantics:** `cloud` = Zilar cloud; `runner` = the chosen runner, and if it is offline the task
  **waits** (§6.7); `auto` = the runner when it is online, otherwise cloud.
- **API:** a new `PUT /api/ais/:id/computer` with `{ mode, machineId }`; the existing machine route stays
  as-is for compatibility and is retired in a later contract release.
- **UI:** web `AiMachineSection.tsx:14` and mobile `machine-picker.tsx` gain the mode selector; the task
  card shows "Running on: Julio's Mac" (design §2.6).

### 6.7 Offline waiting and moving a workspace

- **Offline waiting:** desk states are `none | provisioning | running | idle | waiting_runner | failed`.
  When the chosen runner is offline the task enters `waiting_runner`; the card says "Waiting for Julio's
  Mac" and resumes on reconnect (design §2.6). The append-only session log (P1) is what makes this safe;
  the brain replays it.
- **Moving a workspace** between cloud and a runner, with one confirm: either
  (a) **git** — the source desk pushes its WIP branches and the target clones them, or
  (b) **a compressed snapshot** — tar the workspace volume, store it in object storage (the existing
  storage), restore it on the target. Path (a) is the default for repos; (b) covers non-repo workspaces
  (design §2.6, `docs/PROJECT_PLAN.md:1011`). The `snapshot` operation of §2 is the primitive.

## 7. The browser (P4, short)

- **Cloud:** one shared **Playwright service** (Playwright + Chromium), a fresh incognito **context per
  task**, closed after, through the same egress proxy, with **no access to any workspace** (design §2.3,
  §3.2). Tools `browser_open`, `browser_click`, `browser_type`, `browser_screenshot` (design §2.3).
  Memory: Chromium base ~250–350 MB, each context ~50–100 MB, so ~5–10 concurrent contexts fit in
  ~1 GB (numbers to verify in the spike, §9). A separate service (not one Chromium per jail) is the
  design's "one shared browser service" (design §2.3, §5).
- **Runner:** on a runner the browser runs **inside the runner's jail** (design §7), so a Mac runner can
  offer Safari's engine (Playwright WebKit) for iOS-sized checks (`docs/PROJECT_PLAN.md:1062`,
  §11 tool packs `:977`).
- Later, Lightpanda for text-only pages (design §2.3, §9). Logged-in browsing with saved cookies stays
  out of scope (design §8).

## 8. Task split

Ordered, each at most ~600 changed lines and every file at most 400 lines (AGENTS.md; the lead's
`pnpm gate` enforces format/lint/typecheck/tests). Web and mobile twins are one task (parity rule).
Tests only where the AGENTS.md checklist says so: the IP guard, token-injection scoping, the
read/write/edit path escape, and runner auth — no UI tests.

### Task A — `packages/desk`: image + tool daemon

- Files: new `packages/desk/package.json`, `packages/desk/Dockerfile`, `packages/desk/src/serve.ts`
  (stdio JSON-RPC loop), `packages/desk/src/tools/bash.ts`, `read.ts`, `write.ts`, `edit.ts`,
  `grep.ts`, `glob.ts`, `git.ts`, `packages/desk/src/paths.ts` (resolve + escape check),
  `packages/desk/src/protocol.ts` (the request/response schemas).
- Deletes: nothing.
- Tests: `packages/desk/src/paths.test.ts` (the **path escape**: `..`, absolute, symlink, and a
  legitimately nested path); `packages/desk/src/git.test.ts` (hooks off, LFS smudge off, `-c` refused).
- Lead's check: build the image, `docker run --rm <image> desk-tool serve`, pipe a `bash` and an `edit`
  request; then the same inside a `--runtime=runsc` jail after Task D.

### Task B — the hands interface + the cloud desk-agent

- Files: new `packages/desk/src/hands.ts` (the §2 types), `packages/desk/src/cloud-agent.ts` (the
  sidecar: Docker create/exec/stop, the §4.3 cap and fair queue, the §4.2 run flags),
  `apps/server/src/hands/cloud-hands.ts` (the app-side client over the sidecar unix socket),
  `apps/server/src/hands/wiring.ts`.
- Deletes: nothing.
- Tests: `packages/desk/src/cloud-agent.test.ts` (provision is idempotent per `DeskKey`; the queue
  respects the running cap; `stop` keeps the volume) against a fake Docker API.
- Lead's check: on a staging host, ask the sidecar to provision, run `bash uname -a`, stop; confirm the
  container is gone and the volume remains; confirm `docker.sock` is **not** in the app container.

### Task C — the desk tools in the agent loop

- Files: new `apps/server/src/agents/tools/desk-definitions.ts`; edit
  `apps/server/src/agents/tools/definitions.ts:229`, `:246` (advertise when the AI has a computer),
  `apps/server/src/agents/gateway/tool-exec.ts:64` (the `hands.execute` branch), and
  `apps/server/src/agents/tools/schemas.ts` (the args).
- Deletes: nothing.
- Tests: `apps/server/src/agents/tools/desk-definitions.test.ts` (schemas reject bad args; the tools are
  advertised only for a computer-enabled AI).
- Lead's check: an AI with a computer runs `bash`, `read`, `write`, `edit`, `grep`, `glob`, `git` in a
  DM and in a room; a failed call stays in context (design §2.5).

### Task D — gVisor + jail lifecycle on the VPS

- Files: new `deploy/desk/install-gvisor.sh` (the §4.1 steps, idempotent, checksum-verified), new
  `deploy/desk/desk-agent.service`, edits to `deploy/coolify/docker-compose.app.yml` (the sidecar socket
  mount).
- Deletes: nothing.
- Tests: none (infra); the lead runs the checks in Appendix A and the §4.1 smoke.
- Lead's check: Appendix A, then a real jail `--runtime=runsc`; idle stop after ~2 minutes; the running
  cap and "Queued (n ahead)".

### Task E — the egress proxy

- Files: new `packages/egress-proxy/src/proxy.ts` (CONNECT + HTTP, policy, host log),
  `packages/egress-proxy/src/policy.ts` (reuses `classifyIp` and `isIpLiteral` from
  `apps/server/src/sandbox/ip-guard.ts`), `deploy/desk/egress.service`.
- Deletes: nothing (the reader-only `guarded-fetch.ts` stays).
- Tests: `packages/egress-proxy/src/policy.test.ts` — the **IP guard**: a public host is allowed, and
  loopback / RFC1918 / link-local / IPv6 ULA / Teredo / 6to4 / a redirect-to-private are denied.
- Lead's check: from a jail, `curl https://example.com` works, `curl http://127.0.0.1` and
  `curl http://169.254.169.254` fail, and "View steps" lists the host.

### Task F — credential injection

- Files: `packages/egress-proxy/src/inject.ts` (host+path scope, header injection),
  `apps/server/src/git/app-token.ts` (mint a GitHub App installation token, one repo, `contents` +
  `pull_requests`, one hour), and the control-channel push of the token to the host.
- Deletes: nothing.
- Tests: `packages/egress-proxy/src/inject.test.ts` — **token-injection scoping**: the header is added
  only for the configured host and `ownerRepo` path, never to another host, another repo, or a request
  the jail controls; requests with an `Authorization` header from the jail are stripped.
- Lead's check: a desk clones, commits and pushes `agent/<ai>/*` through the proxy; the jail's env and
  `/proc` show no token; a push to another repo or to `main` is refused.

### Task G — the runner desk operations + isolation

- Files: `apps/runner/src/desk/` (`driver.ts`, `linux.ts` gVisor/bwrap, `macos.ts` apple-container,
  `windows.ts` WSL2, `egress.ts`), edits to `apps/runner/src/cli.ts` (the `run` command wires the desk
  handlers) and `apps/runner/src/capabilities.ts:105` (report the drivers); protocol edits in
  `packages/runner-tunnel/src/protocol.ts`, `runner.ts:532`, `server.ts:480`.
- Deletes: the model listener and `model.open` (§1.6): `packages/runner-tunnel/src/runner.ts:594`,
  `:163`, `:173`, `:46`; `packages/runner-tunnel/src/server.ts:523`; the `gatewayUrl` block
  `apps/server/src/machines/hub.ts:263-269`; the README claims `apps/runner/README.md:42-46`.
- Tests: `packages/runner-tunnel/src/auth.test.ts` (extended: an unauthenticated `desk.exec` is refused;
  a revoked runner is closed); `apps/runner/src/desk/driver.test.ts` (a missing jail driver refuses to
  start — no unsandboxed mode).
- Lead's check: pair a Mac and a Linux runner; run the one CI/shared test task (clone, test, edit, push)
  on cloud and on each runner and compare the results (design §2.6).

### Task H — Computer: cloud / runner / auto

- Files: `packages/api-contract/src/ais.ts` (new `PUT /ais/:id/computer`), a new migration in
  `apps/server/drizzle/` (`computer_mode`, expand-only; the file starts with `SET lock_timeout = '5s';`
  per AGENTS.md), `apps/server/src/ais/` (the write and the resolver that turns a mode into a target),
  web `apps/web/src/components/ais/AiMachineSection.tsx:14`
  and mobile `machine-picker.tsx`; offline waiting in the desk/client state.
- Deletes: nothing this release; the old `PUT /ais/:id/machine` is retired in a later contract release.
- Tests: `apps/server/src/ais/computer-mode.test.ts` (mode resolution: `auto` falls back to cloud only
  when the runner is offline; a revoked runner never resolves).
- Lead's check: set an AI to each mode; pull the runner's network; the card shows "Waiting for
  Julio's Mac" and resumes on reconnect.

### Task I — the browser service (P4)

- Files: new `apps/browser-service/` (one Playwright Chromium, context per task, egress through the
  proxy) and the four `browser_*` tools in `apps/server/src/agents/tools/desk-definitions.ts`-style
  definitions plus their `hands`-like dispatch.
- Deletes: nothing.
- Tests: none (UI/service); the lead's smoke covers it.
- Lead's check: a task opens a page, clicks, screenshots; two tasks never share a context; the memory
  reading matches §7.

## 9. Risks and open questions

1. **RAM, not CPU, sets the cloud cap.** ~7.5 GB free ÷ 2 GB per jail ≈ **3 running jails** on Today's
   VPS, not the design's "start at 10" (`work/T-1402-desk-runner-plan-audit.md:31`, design §2.3). Which
   number does Julio want as the default (3 safe, or 10 with a hard memory cap and a risk of OOM)?
2. **gVisor overhead and speed.** Tens of MB per jail + slower syscalls (design §5, §9). Prove the
   overhead on the VPS before fixing the cap; needs the `docker info` / `runsc --version` checks (the
   lead, Appendix A).
3. **Disk quota.** Named-volume quotas need XFS project quotas (or similar). If `/var/lib/docker` is
   ext4 there is no 5 GB cap without a decision (dedicated XFS disk, or per-desk image files). Which?
   (Appendix A checks the filesystem.)
4. **The privileged sidecar is a production change** (§4.4): a new host service + a socket mount in
   `deploy/coolify/docker-compose.app.yml`. Needs Julio's OK with the gVisor install.
5. **GitHub App.** Token injection needs the platform GitHub App to exist (creation, permissions
   `contents`/`pull_requests`, per-repo installs). `docs/PROJECT_PLAN.md:1111-1116` assumes it; who
   creates it and when? A fine-grained PAT is the weaker fallback.
6. **Runner OS coverage cost.** macOS Apple `container` (macOS 26+) and Windows WSL2 are extra drivers;
   macOS-only and Windows-only paths are hard to CI. Is a Mac-only first cut (Julio's M1/M3) acceptable
   for P3?
7. **gVisor root causes.** `runsc install` edits `/etc/docker/daemon.json` and restarts Docker — a short
   blip for every container on the VPS, including the panel. Confirm the window.
8. **Jail memory per desk is a guess** (1–2 GB). The spike should measure a `git clone` + `npm install`
   + build on the VPS and on a Mac runner and set the real number.
9. **Token lifetime vs long tasks.** A one-hour installation token can expire mid-task; the proxy must
   re-mint on a 401 (with the server) rather than fail the push. Include this in Task F.

## Appendix A — checks the lead must run on the VPS (read-only)

This audit did not use SSH. The lead runs these on the host (no changes) before the §4.1 install and
records the output in the P2 task:

```bash
uname -r; . /etc/os-release && echo "$PRETTY_NAME"
nproc; free -m; df -h /
findmnt -no FSTYPE,SOURCE /var/lib/docker        # disk-quota feasibility (§9.3)
ls -l /dev/kvm 2>&1 || true                       # expected: not found (systrap, design §2.3)
docker info --format '{{json .Runtimes}}'          # runsc absent before §4.1
cat /etc/docker/daemon.json 2>/dev/null || true
docker ps --format 'table {{.Names}}\t{{.Image}}'  # what is running now (blip window, §9.7)
```

After the §4.1 install, the smoke is `docker run --rm --runtime=runsc alpine uname -r` (must report
gVisor's `4.4.0`, not the host kernel) and `runsc --version`.
