# AI computers without variables: audit and plan (T-1599, 2026-10-15)

**No code in this task.** Everything below is a map of the change: `file:line` as the code is on
`task/T-1599-audit-ai-computers-auto`, the current line quoted, and one or two sentences on what
changes. The task split is in §3.

Julio, on turning cloud computers on:

> needs to be easy to do, dont write and made commands and installs, needs to be part of the zilar
> flow of install and updates

The target the lead chose (the six points) is restated in each section below.

---

## 0. What the audit found: every gate that has to go

Today one feature is gated by four separate switches in four places, and the jail image is pinned
once and never moved:

| Gate | Where | Current state |
| --- | --- | --- |
| Compose profile | `deploy/docker-compose.yml:301` | `profiles: ['desks']` — the services do not exist for a platform that ignores profiles but does honour them here |
| In-container guard | `deploy/docker-compose.yml:318` | `test "$${DESKS_ENABLED:-false}" = "true" \|\| … exit 0` |
| Variables | `deploy/docker-compose.yml:322` | `DESKS_ENABLED: ${DESKS_ENABLED:-false}` |
| Server wiring | `apps/server/src/hands/wiring.ts:10` | `config.DESK_AGENT_SOCKET === undefined ? null : createCloudHands(...)` |
| Server requires the image | `apps/server/src/hands/wiring.ts:24-28` | `DESK_IMAGE` unset → the whole desk client is `null` |
| Agent requires the image | `packages/desk/src/agent/config.ts:80-88` | `DESK_IMAGE is required`, else the sidecar throws at start-up |
| Image pinned once | `deploy/lib/desk-image.sh:60` | `[ -z "$(env_get DESK_IMAGE)" ] || return 0` — an existing pin is never touched again |
| Manual digest | `deploy/install.sh:344-352` | `--desks-host` resolves a digest and prints four variables to paste into Coolify |

Three consequences fall out of that:

1. **A Coolify user must paste four variables** and redeploy (`docs/INSTALL_DOCKER.md:151-158`).
2. **The pin never moves** on `./zilar update` (`deploy/lib/desk-image.sh:60`), so an install keeps
   running an old jail image until someone edits `.env`.
3. **The server guesses**: "cloud is available" means "a socket path is configured"
   (`apps/server/src/startup/components.ts:184`), not "the agent is there and ready".

---

## 1. The change, point by point

### 1.1 Point 1 — the desk services are in every stack, no profile, no variables

**Files that change:** `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`,
`deploy/coolify/docker-compose.app.yml`, and `deploy/coolify/zilar-core.yml` (a fourth file the
spec did not name — it is the split-service definition of the live stack, `zilar-core.yml:7`, and
its header says the desk guards are "copied from that file unchanged", `zilar-core.yml:27-28`, so
it must not drift).

| File:line | Now | Change |
| --- | --- | --- |
| `deploy/docker-compose.yml:301` | `profiles: ['desks']` | delete: `desk-agent` is in the stack |
| `deploy/docker-compose.yml:305` | `restart: on-failure` | `restart: unless-stopped`: with the guard gone the container must come back after a crash and stay up while idle |
| `deploy/docker-compose.yml:314-320` | the `command:` guard, `… exit 0` | delete: the agent now starts and waits for gVisor instead of exiting |
| `deploy/docker-compose.yml:322` | `DESKS_ENABLED: ${DESKS_ENABLED:-false}` | delete |
| `deploy/docker-compose.yml:353` | `profiles: ['desks']` (desk-egress) | delete |
| `deploy/docker-compose.yml:366-370` | desk-egress guard + `DESKS_ENABLED` | delete, `restart: unless-stopped` |
| `deploy/docker-compose.yml:205-214` | `DESK_AGENT_SOCKET: ${DESK_AGENT_SOCKET:-}` / `DESK_IMAGE: ${DESK_IMAGE:-}` | socket becomes fixed (`/run/zilar/desk.sock`, or simply removed and left to the new config default — §1.4); `DESK_IMAGE` stays only as an optional override |
| `deploy/coolify/docker-compose.yml:43-48` | header: "set DESKS_ENABLED=true, COMPOSE_PROFILES=desks, DESK_IMAGE=… and DESK_AGENT_SOCKET=…" | rewrite: computers are in the stack; `--desks-host` is the host prep only |
| `deploy/coolify/docker-compose.yml:273, 290-292, 294` | `profiles` / guard / `DESKS_ENABLED` | delete (same as the plain file) |
| `deploy/coolify/docker-compose.app.yml:282, 296-302, 304` | `profiles` / guard / `DESKS_ENABLED` | delete |
| `deploy/coolify/docker-compose.app.yml:222-228` | socket/`DESK_IMAGE` env | same as the plain file |
| `deploy/coolify/zilar-core.yml:123, 138-140, 142` | `profiles` / guard / `DESKS_ENABLED` | delete |
| `deploy/coolify/zilar-core.yml:115-118` | comment: "set COMPOSE_PROFILES=desks … to start these" | rewrite |

The health checks (`deploy/docker-compose.yml:345` `test -S /run/zilar/desk.sock`) stay: the agent
always listens now, so the socket is there on every install. The `zilar` network membership
(`:343`), the Docker socket and `/dev` (`:336-339`) do not change — see the risk in §2.1.

Nothing in the compose files needs `env_file` edits: the removed keys simply become inert
(`DESKS_ENABLED`, `COMPOSE_PROFILES`) and the pinned `DESK_IMAGE` keeps working as an override.

### 1.2 Point 2 — the desk agent waits for gVisor

**Files that change:** `packages/desk/src/agent/docker.ts`, `main.ts`, `lifecycle.ts`, `server.ts`,
`wire.ts` (and their tests `server.test.ts`, `lifecycle.test.ts`, `test-harness.ts`).

| File:line | Now | Change |
| --- | --- | --- |
| `packages/desk/src/agent/docker.ts:12-26` | `DockerLayer` has create/start/inspect/run/remove/listDeskNames | add `runtimeAvailable(): Promise<boolean>` (and §1.3's pull) |
| `packages/desk/src/agent/docker.ts:213` | `createDockerLayer(settings)` | implement it with the same probe `deploy/zilar:844` already uses: `docker info --format '{{json .Runtimes}}'` and a substring check for the configured runtime name (`config.docker.runtime`, `config.ts:111`), never a hard-coded `runsc` |
| `packages/desk/src/agent/main.ts:52-53` | `createAgentServer(config, lifecycle); await server.listen();` | keep listening first: the socket must answer `status` while not ready (that is what tells the server "host not set up") |
| `packages/desk/src/agent/main.ts:60-65` | the 30 s `IDLE_SWEEP_MS` interval (`main.ts:13`) | poll readiness on the same interval (or a second, same-period timer): while not ready call `runtimeAvailable()`, and on the first `true` resolve the image and flip ready |
| `packages/desk/src/agent/lifecycle.ts:46-57` | `Lifecycle` fields | add a readiness state (`ready`, `detail`) and the pinned image (§1.3) |
| `packages/desk/src/agent/lifecycle.ts:60-64` | `assertPinnedImage` throws `jail_unavailable` | keep the "only one image" invariant, but against the resolved pin, and refuse earlier and more clearly while not ready |
| `packages/desk/src/agent/lifecycle.ts:78-79` | `provision` → `assertPinnedImage(spec)` | a not-ready agent refuses with `jail_unavailable` (the code the server already maps to "your computer is unavailable right now", `apps/server/src/agents/gateway/desk-exec.ts:71`) |
| `packages/desk/src/agent/lifecycle.ts:210-215` | `status()` → `{ running, queued }` | add `ready: boolean`, `imageDigest: string \| null` and a fixed `detail` code (`'host_not_set_up' \| 'image_unresolved' \| null`), never raw host text |
| `packages/desk/src/agent/server.ts:83-86` | `case 'status'` → `lifecycle.status()` | unchanged shape-wise; the new fields ride along |
| `packages/desk/src/agent/wire.ts:44` / `:85-89` | `status` request / `StatusReply.status` | widen `StatusReply.status` with the fields above |
| `deploy/lib/host-setup.sh:169-175` | "Smoke test (after starting the desk services with DESKS_ENABLED=true) … host-setup done. Enable desks with DESKS_ENABLED=true, then '$PROG up'" | rewrite: nothing to enable; the agent picks gVisor up on its own within a minute |

The `MAX_...` limits, admission and workspace code are untouched: readiness sits in front of
`provision`, it does not change the jail flags (`docker.ts:83-124`).

### 1.3 Point 3 — the jail image follows the release

**Files that change:** `packages/desk/src/agent/config.ts`, `docker.ts`, `lifecycle.ts`, the four
compose files (agent env), and (only if the spec digest becomes optional)
`packages/desk/src/hands.ts`, `apps/server/src/hands/*`, `apps/server/src/agents/gateway/desk-exec.ts`.

| File:line | Now | Change |
| --- | --- | --- |
| `packages/desk/src/agent/config.ts:79-88` | `const image = env.DESK_IMAGE; if (image === undefined …) throw new Error('DESK_IMAGE is required')` and the digest check | `DESK_IMAGE` becomes optional: when set it is still the pinned override and is still digest-checked; when absent the agent resolves its own image |
| `packages/desk/src/agent/config.ts:7-15` | `DockerSettings.image: string` | add `imageRepository` and `imageTag` (from new `DESK_IMAGE_OWNER`, default `julioferrero`, and `DESK_IMAGE_TAG`, default `latest`) |
| `packages/desk/src/agent/docker.ts:12-26` | no pull | add `pullAndResolveDigest(ref): Promise<string>` with the exact two commands `deploy/lib/desk-image.sh:46-53` already uses (`docker pull`, then `docker image inspect --format '{{index .RepoDigests 0}}'`), and reject a tag that has no digest |
| `packages/desk/src/agent/lifecycle.ts:60-64` | compares `spec.imageDigest` to `config.docker.image` | compare to the pin resolved once at readiness; it lives for the process lifetime (a new release = a new agent container = a new pin, no restart dance) |
| `deploy/docker-compose.yml:321-334` | agent env (no tag/owner) | add `DESK_IMAGE_OWNER: ${IMAGE_OWNER:-julioferrero}` and `DESK_IMAGE_TAG: ${IMAGE_TAG:-latest}`; `DESK_IMAGE: ${DESK_IMAGE:-}` (`:329`) stays as the override |
| `deploy/coolify/docker-compose.yml:294-306`, `docker-compose.app.yml:303-314`, `zilar-core.yml:142-152` | same env lists | same two keys |

**The tag a git build gets.** `images.yml` builds the jail image at `:92-95` and publishes
`:271-273` (`:<v tag>` and `:latest` on a version tag) and `:303-305` (`:latest` and
`:sha-<short>` on every green main). `deploy/coolify/docker-compose.app.yml` sets no `IMAGE_TAG` or
`IMAGE_OWNER` (the only image-side variable there is `ZILAR_COMMIT`, `:125`) and builds the agent
locally (`:283-286`). So a git build has no self-known version and the defined fallback is
**`latest`**, which the workflow publishes on every green main. That is the answer to "find what
`images.yml` publishes": `latest` + `sha-<first 12>` for main, `<v tag>` + `latest` for a tag.

**The server's side of the digest.** Today the server owns the digest:
`apps/server/src/hands/wiring.ts:24-30` builds `{ hands, imageDigest }`,
`apps/server/src/agents/gateway/desk-exec.ts:93-105` sends it in every `provision`, and
`packages/desk/src/hands.ts:70` makes it a required field (`imageDigest`). With the agent resolving
its own image the server should stop being the source of truth: report the pin in `status` and let
the server echo it back (or leave the field optional, `hands.ts:66-73`, and let the agent use its
own pin when it is absent). `runner-hands.ts:86` still needs the field for runner desks, so
"optional" is the safer shape than "removed".

### 1.4 Point 4 — the server asks rather than assumes

**Files that change:** `apps/server/src/config/server-schema.ts`,
`apps/server/src/hands/wiring.ts`, `apps/server/src/hands/cloud-hands.ts`, a new small probe,
`apps/server/src/app/deps.ts`, `apps/server/src/app/routes-ai.ts`,
`apps/server/src/ais/api.ts`, `apps/server/src/startup/components.ts`, and the gateway path
(`apps/server/src/agents/gateway/desk-exec.ts`, `apps/server/src/hands/resolve.ts`).

| File:line | Now | Change |
| --- | --- | --- |
| `apps/server/src/config/server-schema.ts:190` | `DESK_AGENT_SOCKET: Schema.optional(nonEmptyStringSchema)` | `withDefault(nonEmptyStringSchema, '/run/zilar/desk.sock')` — the path is known on every install |
| `apps/server/src/config/server-schema.ts:192` | `DESK_IMAGE: Schema.optional(pinnedImageSchema)` | stays optional, now purely an override the agent may not need |
| `apps/server/src/hands/wiring.ts:9-11` | `config.DESK_AGENT_SOCKET === undefined ? null : createCloudHands(...)` | `buildHands` always returns a client (the default path is always set) |
| `apps/server/src/hands/wiring.ts:18-30` | `buildDeskClient` returns `null` without `DESK_IMAGE` and logs `desks: off` | it no longer needs the image; availability comes from the probe, not from env |
| `apps/server/src/hands/cloud-hands.ts:120-163` | `createCloudHands` has provision/execute/stop/snapshot | add `status()`: send `{ id, method: 'status' }` through the existing `requestReply` (`:105-118`) and decode a new reply schema; this is the only new socket call |
| new `apps/server/src/hands/desk-status.ts` | — | one function `deskAvailable(): Promise<boolean>` with a short TTL cache (~10 s): `status().ready === true`; any error, timeout or missing socket → `false`; never throws, never logs raw host text |
| `apps/server/src/app/deps.ts:55-56` | `/** T-1425: whether Zilar cloud desks are wired. Defaults to false. */ cloud?: boolean;` | becomes a probe (`cloud?: () => Promise<boolean>`), so the picker reads live state |
| `apps/server/src/app/routes-ai.ts:111` | `cloud: deps.ais?.cloud ?? false` | pass the probe through (default: `async () => false`) |
| `apps/server/src/ais/api.ts:55` | `cloud: boolean` doc "true when the cloud desk client is wired (`DESK_AGENT_SOCKET` and `DESK_IMAGE` set)" | the doc becomes "true when the agent answers ready"; field type follows §deps |
| `apps/server/src/ais/api.ts:178-181` | `handler(…, () => Effect.succeed({ cloud }))` | await the probe; a missing or not-ready agent answers `false` |
| `apps/server/src/startup/components.ts:174-176` | `const desk = buildDeskClient(config, logger);` | keep building the client, but hand the routes the probe (`cloud: deskStatus`) instead of `desk !== null` |
| `apps/server/src/startup/components.ts:184` | `ais: { cloud: desk !== null }` | `ais: { cloud: deskStatus }` |
| `apps/server/src/startup/components.ts:240` | `...(desk === null ? {} : { desk })` | the gateway should resolve per turn through the probe (below) |
| `apps/server/src/agents/gateway/desk-exec.ts:161-185` | `resolveTurnDesk` uses `deps.desk ?? null` | ask the probe once per turn; not ready → `{ waiting: false }` (no computer), so a turn never ends in a `jail_unavailable` loop |
| `apps/server/src/hands/resolve.ts:39-53` | `cloud: CloudDesk \| null` | unchanged in shape; the input is now `null` while the agent is not ready |

Cache: one short TTL (`~10 s`) shared by the picker and the gateway keeps the probe cheap; the UI
already treats a pending/failed read as unavailable (`AiComputerSection.tsx:72-75`) and flips
within a minute of the host becoming ready.

### 1.5 Point 5 — the UI says "Set up on your server"

**Files that change:** `apps/web/src/components/ais/AiComputerSection.tsx`,
`apps/mobile/src/components/ais/computer-picker.tsx`, and the contract comment
`packages/api-contract/src/ais.ts:28-33`. Text only, in the existing card — no layout change (that
would need a D24 canvas first).

| File:line | Now | Change |
| --- | --- | --- |
| `apps/web/src/components/ais/AiComputerSection.tsx:39` | `description: cloud ? 'Runs on a Zilar cloud computer' : 'Not available yet',` | not available → a fixed sentence that names the one command, e.g. "Set up on your server: `curl -fsSL https://get.zilar.app \| sudo sh -s -- --desks-host`" |
| `apps/mobile/src/components/ais/computer-picker.tsx:38` | the same string | same sentence (watch `numberOfLines={1}` at `:118`: a full command truncates on a phone, so either allow two lines or use a short sentence and keep the command on the web card — open question 4) |
| `packages/api-contract/src/ais.ts:28-30` | `// … the picker disables the cloud option with "Not available yet".` | update the comment |

The create flows show no reason at all today (`apps/web/src/components/ais/new-ai/SetupStep.tsx:9`
and `apps/mobile/src/components/ais/new-ai/setup-step.tsx:14,32` only disable the option), so they
are out of scope for a text-only change: point 5 says "in the existing card".

### 1.6 Point 6 — the install and update flows

**Files that change:** `deploy/zilar`, `deploy/lib/desk-image.sh`, `deploy/install.sh`,
`deploy/lib/preflight.sh`, `deploy/.env.example`, and the docs (`docs/INSTALL.md`,
`docs/INSTALL_DOCKER.md`, `docs/RELEASING.md`, `deploy/coolify/LAYOUT.md`).

| File:line | Now | Change |
| --- | --- | --- |
| `deploy/zilar:52-54` | sources `lib/desk-image.sh` "so `./zilar up` fills an empty DESK_IMAGE" | drop the source if the pin step goes |
| `deploy/zilar:89-109` | `compose()` derives `--profile desks` and `DESK_AGENT_SOCKET` from `DESKS_ENABLED=true` | both derivations go: one stack, and the socket has a default (§1.4) |
| `deploy/zilar:514` / `:551` | `pin_desk_image` in `cmd_up` / `cmd_update` | remove both calls: `up`/`update` must not write `DESK_IMAGE`; the agent follows the release |
| `deploy/lib/desk-image.sh:58-78` | `pin_desk_image` fills an empty `DESK_IMAGE` from the published image | delete the pin function (and `resolve_desk_digest` `:46-53` if nothing else uses it after `--desks-host` stops printing); keep `_desk_image_ref` only if a check that the image exists is still wanted |
| `deploy/zilar:475-494` | `.env` template: "1. sudo ./zilar host-setup / 2. set DESKS_ENABLED=true / 3. ./zilar up" and `DESK_IMAGE` comments | rewrite: `host-setup` is the only step; `DESK_IMAGE` is an optional override |
| `deploy/.env.example:189-214` | the file self-hosters copy: same old template ("set `DESKS_ENABLED=true`", "`./zilar up` pulls the published jail image and pins `DESK_IMAGE`"), which the Coolify path's `COMPOSE_PROFILES=desks` note also still names | rewrite like the `deploy/zilar` template (`host-setup` only, keys inert, `DESK_IMAGE` an optional override) so a copied `.env` does not set a now-inert flag; drop the Coolify `COMPOSE_PROFILES=desks` sentence |
| `deploy/zilar:843-893` | `doctor` desks block only runs `if DESKS_ENABLED=true` | run it whenever the socket/stack is there (the desk services are always on); keep the runsc and slice checks as the "host not prepared" diagnosis |
| `deploy/install.sh:287-310` | `phase_desks` asks, runs host-setup, then `set_env_var DESKS_ENABLED true` (`:308`) | keep host-setup and the sandbox check; drop the `DESKS_ENABLED` write and the "turns them on" wording (`:294, 305`) — nothing to turn on |
| `deploy/install.sh:318-353` | `desks_host` resolves a digest (`:344-345`) and prints four variables (`:347-352`) | keep host-setup + the sandbox check; replace the print with "computers turn on within a minute; nothing to set on the service" |
| `deploy/install.sh:45-52` | usage: "print the variables to set on the Zilar service in Coolify" | rewrite |
| `deploy/lib/preflight.sh:139-145` | Coolify branch prints the template and the `--desks-host` command | the command stays; the message after it changes |
| `docs/INSTALL.md:26-27, 40-41, 64-75` | "turns them on (`DESKS_ENABLED=true`)", "prints the four variables", "prints `DESKS_ENABLED`, `COMPOSE_PROFILES`, `DESK_IMAGE`, `DESK_AGENT_SOCKET`" | rewrite to "one host command; computers turn on by themselves" |
| `docs/INSTALL_DOCKER.md:151-158` | "It prints four variables; set them … and redeploy" | rewrite |
| `docs/RELEASING.md:197-217` | "Turn desks on and start the stack: DESKS_ENABLED=true", the `up`-pins-`DESK_IMAGE` paragraph, and the Coolify "set four variables" paragraph | rewrite both paths |
| `deploy/coolify/LAYOUT.md:52-54, 151-162, 266-268` | "stay behind `profiles: ['desks']` … start them with `COMPOSE_PROFILES=desks` and `DESKS_ENABLED=true`" | rewrite; `DESKS_ENABLED` leaves the variable table |

**Tests that encode the old flow** (they will fail until updated, and they are the safety net for
this change): `deploy/tests/host-setup.test.sh` asserts `init` writes `DESKS_ENABLED=false`
(`:89-92`), that `DESKS_ENABLED=true` adds `--profile desks` (`:97-112`), that it sets
`DESK_AGENT_SOCKET` (`:119-128`), and that both services carry the guard and `restart: on-failure`
(`:226-234`); `deploy/tests/install.test.sh` cases 15-17 (`:30-32`) assert the `--desks` and
`--desks-host` behaviour, including "prints the four Coolify variables once the sandbox passes"
(`:302-324`).

**Does the plain installer still fit with no `DESKS_ENABLED`?** Yes, and it gets simpler: the
installer's job today is `host-setup` plus a flag (`install.sh:287-310`); with the flag gone it is
just `host-setup`. The one thing it must keep is the gVisor sandbox check (`install.sh:281-285`),
because `host-setup` only reloads Docker (`deploy/lib/host-setup.sh:137`) and a host where `runsc`
cannot actually run would otherwise look ready to the agent.

---

## 2. Risks, with the evidence

### 2.1 A privileged agent with the Docker socket runs on every install, idle

Evidence: `deploy/docker-compose.yml:308-309` (`user: '0:0'`, `privileged: true`), `:336`
(`/var/run/docker.sock`), `:338-339` (`/var/lib/zilar/desks`, `/dev`), `:306-307` the comment
"it creates the jails with gVisor and loop-mounts each desk's ext4 workspace image".

While not ready it can still use all of that: it only declines to *create jails*
(`lifecycle.ts:78-79`). The Docker socket is the real power — root on the host by definition — so
the container's blast radius equals the host's. Two things bound it and both must survive the
change:

- the wire protocol is closed: every request decodes with `onExcessProperty: 'error'`
  (`server.ts:112-114`, schemas at `wire.ts:23-46`), so a caller can never pass a host path, an
  image or a run flag;
- the socket file is world-writable inside its volume — `chmodSync(config.socketPath, 0o666)`
  (`server.ts:170`) — so anyone who can reach the `desk-socket` volume can drive the agent.
  Today only `server` and `desk-agent` mount that volume (`deploy/docker-compose.yml:235, 340`);
  that must stay true, and the agent must not be reachable from the `zilar` network by anything
  but the server. `desk-agent` is on the `zilar` network (`:343`), so it can also reach postgres
  and ejabberd; that is unchanged by this plan but worth stating out loud, because the container
  now runs everywhere instead of only where an operator opted in.

Recommendation for the lead/Julio: if "silently privileged on every install" is unacceptable, the
fallback is to keep one switch — but it must be a *host* switch (whether `host-setup` ran), not
four variables.

### 2.2 How Coolify shows a service that runs but is idle

Evidence: the guard exists precisely because a platform may ignore profiles — `deploy/docker-compose.yml:311-313`
"even if a platform ignores the `desks` profile, the container exits 0 at once unless
DESKS_ENABLED=true"; `restart: on-failure` with the comment `:303-304` "an exit-0 container must
stay stopped".

With the guard removed, the container starts and stays: good for the socket, but `test -S
/run/zilar/desk.sock` (`:345`) passes as soon as `listen()` creates the socket (`server.ts:157-174`),
so Coolify will show a green "healthy" agent on a host that has no gVisor at all. The truth then
lives only in the AI card (§1.5), which reads the agent's `status` (§1.4). `restart: on-failure`
must become `unless-stopped` or the first non-zero exit leaves the agent down until a manual
restart.

### 2.3 The jail tag for a git build

Evidence: `.github/workflows/images.yml:92-95` builds `zilar-desk`; `:303-305` publishes `:latest`
and `:sha-<first 12>` on a green main; `:271-273` publishes `:<v tag>` and `:latest` on a version
tag; `deploy/coolify/docker-compose.app.yml:283-286` builds the agent from git and sets no
`IMAGE_TAG`/`IMAGE_OWNER` (only `ZILAR_COMMIT`, `:125`); `docs/RELEASING.md:149-168` says live is
that git-built Application.

So the fallback tag must be `latest` (`DESK_IMAGE_TAG: ${IMAGE_TAG:-latest}`), which means live
follows every green main — the intended "image follows the release" — but it also means a git
build cannot name an immutable jail image. `sha-<short>` is the alternative if the app.yml can pass
`IMAGE_TAG=${SOURCE_COMMIT}`-style; that needs the workflow to keep publishing `sha-*` (it does,
`:305`) and the tag to be exactly 12 chars (`images.yml:122`).

### 2.4 An older server talking to a newer agent, or the reverse

Evidence: the server decodes replies with `Schema.decodeUnknownSync`
(`apps/server/src/hands/cloud-hands.ts:124, 139, 154`), which ignores unknown fields; the agent
decodes requests with `onExcessProperty: 'error'` (`server.ts:112`); zero-downtime deploys run two
server versions at once (`AGENTS.md`, migrations section) while the agent is a single container.

- **New server + old agent:** `status` already exists in the old agent (`server.ts:83-86`), so the
  call succeeds, but the reply has no `ready`. The probe must treat a missing `ready` as `true`
  (an old agent only ever started when `DESK_IMAGE` was set, `config.ts:80-88`, so it was ready) —
  otherwise every install on an old agent reads "not available" until the agent is replaced.
- **Old server + new agent:** the old server only builds a Hands client when `DESK_AGENT_SOCKET`
  is set (`wiring.ts:9-11`), which an existing install may still have; it never calls `status`,
  and it still sends `DESK_IMAGE` in `provision`, which the new agent must keep honouring as an
  override (§1.3). So the compatibility rule is: **the agent keeps `DESK_IMAGE` as an override
  forever.**
- **New server + no agent at all** (socket path defaulted but the volume is empty): every probe
  fails; the probe must swallow that (`deskAvailable` returns `false`), or the AI list breaks on a
  plain install.

### 2.5 An existing install with `DESKS_ENABLED=true` and a pinned `DESK_IMAGE`

Evidence: `deploy/lib/desk-image.sh:59-60` only fills an empty value, so `.env` on such an install
holds a real `DESK_IMAGE=…@sha256:…`; `deploy/zilar:514, 551` run the pin on `up`/`update`;
the spec says live has `DESKS_ENABLED=false`.

After this change the pinned line still wins as an override (§1.3), so that install silently keeps
its old jail image after an update — exactly the bug this task fixes, just moved from the script to
the override. `./zilar update` should either clear a stale auto-written pin or warn that the pin is
being kept (open question 2). The other two keys (`DESKS_ENABLED`, `COMPOSE_PROFILES`) become inert
and need no migration; leave them.

Live itself (`DESKS_ENABLED=false`) gets the privileged agent on its next push. Until `host-setup`
runs there once, the server's probe answers "not ready" and the AI card shows the one-command
sentence (§1.5). That is the intended rollout, but it should be a planned step in the release
notes, not a surprise on the next green main.

### 2.6 The new socket default makes the server always build a Hands client

Evidence: `apps/server/src/hands/wiring.ts:9-11`; the new default in §1.4; `buildHands` today also
returns `null` and logs "desks: off" (`wiring.ts:20-22`).

After the change there is no "off" value for `DESK_AGENT_SOCKET`, so `deps.ais.cloud` no longer
means "the operator turned desks off" and must mean "the agent answered ready". Anything that
today reads `desk === null` as "no cloud at all" (`components.ts:176, 184, 240`) needs the probe
instead. This is the one place where the change is not local and must be done in one piece (§3, T2).

---

## 3. Task split

Five tasks; T1-T4 are code, T5 is the live check. Sizes are the diff, not the file: none reaches
400 lines per file. "Touches auth/keys/permissions" means the task needs tests plus the security
checklist in `AGENTS.md`.

**T1 — Agent readiness and self-pinned jail image (points 2, 3; agent side).**
- Does: `runtimeAvailable()` and `pullAndResolveDigest()` on the Docker layer; the ready/not-ready
  state and its `status` fields; the image ref resolved from `DESK_IMAGE_OWNER`/`DESK_IMAGE_TAG`
  with `DESK_IMAGE` as the override; the four compose files get only the two new env keys.
- Allowed files: `packages/desk/src/agent/config.ts`, `docker.ts`, `lifecycle.ts`, `main.ts`,
  `server.ts`, `wire.ts`, `test-harness.ts`, `server.test.ts`, `lifecycle.test.ts`;
  `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`,
  `deploy/coolify/docker-compose.app.yml`, `deploy/coolify/zilar-core.yml`.
- Tests: `packages/desk` vitest (`server.test.ts`, `lifecycle.test.ts`) — the not-ready refusal,
  the ready flip, the digest pin, and the "only one image" refusal. **Touches the sandbox
  confinement (privileged daemon + image pinning): needs tests.**
- Parallel: yes, with T3 and T4. Must land before T2 depends on the `status` shape it defines.

**T2 — The server asks the agent (point 4).**
- Does: the socket default; `buildHands`/`buildDeskClient` without `DESK_IMAGE`; `status()` on the
  cloud client; the short-cache `deskAvailable` probe; `cloud` becomes a probe through
  `deps`/`routes-ai`/`ais/api`; the gateway resolves per turn and answers "no computer" while not
  ready; `hands.ts` makes `imageDigest` optional and the server echoes the agent's pin.
- Allowed files: `apps/server/src/config/server-schema.ts`, `apps/server/src/hands/wiring.ts`,
  `apps/server/src/hands/cloud-hands.ts`, `apps/server/src/hands/wiring.test.ts`,
  `apps/server/src/hands/cloud-hands.test.ts`, `apps/server/src/hands/desk-status.ts` (new),
  `apps/server/src/hands/resolve.ts`, `apps/server/src/app/deps.ts`,
  `apps/server/src/app/routes-ai.ts`, `apps/server/src/ais/api.ts`,
  `apps/server/src/ais/provisioning.test.ts`, `apps/server/src/startup/components.ts`,
  `apps/server/src/agents/gateway/desk-exec.ts`, `packages/desk/src/hands.ts`.
- Tests: a vitest for the probe (ready / not ready / socket missing / missing `ready` field) and
  the `computer-options` truth table (`provisioning.test.ts:141-148` is the existing case).
  **Touches a permission gate** (who is offered a cloud computer, and the 401 sweep on
  `/api/ais/computer-options`): needs tests.
- Parallel: after T1's `status` shape.

**T3 — Always-on services and the install/update flow (points 1, 6).**
- Does: remove the profiles, the guards and `DESKS_ENABLED` from the four compose files; the
  server env lines; `./zilar up`/`update` stop pinning; `doctor` always checks desks; `--desks`
  and `--desks-host` become host-prep only; the `desk-image.sh` pin function goes; the docs.
- Allowed files: the four compose files (the parts T1 does not own), `deploy/zilar`,
  `deploy/lib/desk-image.sh`, `deploy/install.sh`, `deploy/lib/preflight.sh`,
  `deploy/lib/host-setup.sh`, `deploy/.env.example`, `deploy/tests/install.test.sh`,
  `deploy/tests/host-setup.test.sh`, `docs/INSTALL.md`, `docs/INSTALL_DOCKER.md`,
  `docs/RELEASING.md`, `deploy/coolify/LAYOUT.md`.
- Tests: `deploy/tests/install.test.sh` and `deploy/tests/host-setup.test.sh` are the safety net
  and must be updated in the same task (the assertions listed in §1.6).
- Parallel: no, it edits the same four compose files as T1 — run after T1 (or split the files by
  ownership: T1 owns only the `environment:` keys, T3 owns profiles/guards/scripts; if that split
  is used they can run together).

**T4 — UI text (point 5).**
- Does: the two card descriptions; the contract comment.
- Allowed files: `apps/web/src/components/ais/AiComputerSection.tsx`,
  `apps/mobile/src/components/ais/computer-picker.tsx`, `packages/api-contract/src/ais.ts`.
- Parallel: yes, with everything (no shared files). No tests (UI text; `AGENTS.md` "UI code gets
  no tests").
- Note: the phone line is `numberOfLines={1}` (`computer-picker.tsx:118`) — see open question 4.

**T5 — Live verification (no code; the lead/Julio).**
- Does: push to main, watch the app deploy, run
  `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host` once on the host, then in the UI
  set one AI to Zilar and run a real job. Confirms: the agent turns ready without a redeploy, the
  card flips from the setup sentence to "Runs on a Zilar cloud computer", and `./zilar doctor`
  style checks pass on the Coolify path. Evidence needed: the agent's `status` reply and a jail
  run. This is the acceptance Julio actually cares about.
- Depends on T1-T4.

Dependencies: T1 → T2 → T5, and T1 → T3 → T5; T4 anywhere. T1 and T3 must not be merged as one
PR if the reviewer wants the agent change isolated from the compose change.

---

## 4. Open questions for Julio

1. **The privileged agent on every install** — is it acceptable that `desk-agent` (root, Docker
   socket, `/dev`) runs on every server by default (§2.1), or should one host step still be the
   switch (i.e. the services exist but only start once `host-setup` has run)?
2. **Existing hand-pinned `DESK_IMAGE`** — on `./zilar update`, should a pin in `.env` be kept
   (current override semantics) or cleared so the jail image follows the release automatically?
3. **Git builds have no version** — accept `latest` as the fallback jail tag (moves on every green
   main), or make the git-built app pass a `sha-<short>` tag instead (§2.3)?
4. **The phone card** — one line (`computer-picker.tsx:118`) or two? A full command sentence
   truncates on one line, so: two lines on the phone, or a short sentence there and the command
   only on the web card?
5. **What the card says** — is
   `Set up on your server: curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host` the
   sentence you want, and does it need the `sudo`/`sh -s --` part spelled out for a non-technical
   reader?
