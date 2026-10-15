---
id: T-1602
title: "AI computers T1 (agent): the desk agent starts without DESK_IMAGE, waits for the gVisor runtime (re-checks every 30 s), then pulls and pins its own release's jail image and turns ready; status reports ready / imageDigest / detail; jails are refused until ready"
status: merged
milestone: M5
branch: task/T-1602-desk-agent-readiness
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1602: Desk agent readiness and a self-pinned jail image

## Spec (written by Claude, do not edit)

### Why
- **Julio wants AI computers to turn on** with one host command and no variables (2026-10-15).
- **The plan:** `docs/deploy/ai-computers-auto-plan.md` (T-1599), §1.2 and §1.3. This is task T1 of its split.
- **Today the agent refuses to start without `DESK_IMAGE`** (`packages/desk/src/agent/config.ts:80-83`) and never checks that gVisor exists.
- **After this task:** the agent always starts, listens on its socket, answers `status`, waits for the runtime, then pins its own jail image and becomes ready, without a restart.

### Facts (the lead read them on 2026-10-15, main after T-1599)
- **`packages/desk/src/agent/config.ts`:**
  - `:79-88`: `DESK_IMAGE` is required, and must be pinned by digest unless `DESK_ALLOW_UNPINNED_IMAGE=true`;
  - `:7-15`: `DockerSettings.image: string`;
  - `:111`: `runtime: textFromEnv(env.DESK_RUNTIME, 'runsc')`, where `null` means the daemon's default runtime;
  - `:112`: `image`.
- **`packages/desk/src/agent/docker.ts`:** `:12-26` is the `DockerLayer` interface; `:213` is `createDockerLayer(settings)`, with one `docker` CLI per operation and no shell; the file is 296 lines.
- **`packages/desk/src/agent/lifecycle.ts`** (256 lines):
  - `:60-64`: `assertPinnedImage` compares `spec.imageDigest` with `config.docker.image` and throws `DeskError('jail_unavailable', …)`;
  - `:78-79`: `provision` calls it first;
  - `:210-215`: `status()` returns `{ running, queued }`;
  - `:11`: the `DeskStatus` interface.
- **`packages/desk/src/agent/main.ts`:**
  - `:38`: `loadAgentConfig(env)`;
  - `:52-53`: the server is created and listening;
  - `:13`: `IDLE_SWEEP_MS = 30_000`;
  - `:60-65`: the idle-sweep interval.
- **`packages/desk/src/agent/server.ts:83-86`:** `case 'status'` replies `{ id, ok: true, status: lifecycle.status() }`.
- **`packages/desk/src/agent/wire.ts:85-89`:** `StatusReply.status` is `{ running, queued }`.
- **The commands to reuse:**
  - the pull and digest commands in `deploy/lib/desk-image.sh:46-53`: `docker pull <ref>`, then `docker image inspect --format '{{index .RepoDigests 0}}' <ref>`, which must contain `@sha256:`;
  - the runtime probe in `deploy/zilar` doctor: `docker info --format '{{json .Runtimes}}'`.
- **Published jail images** (`.github/workflows/images.yml`): `ghcr.io/<owner>/zilar-desk:<v tag>` and `:latest` on a version tag; `:latest` and `:sha-<12>` on every green main.
- **The server today** sends `spec.imageDigest` from its own `DESK_IMAGE` (`apps/server/src/hands/wiring.ts:24`). T-1603 (running in parallel) changes the server to read this agent's pin from `status` and echo it. So `spec.imageDigest` stays required in `packages/desk/src/hands.ts:70`. **Do not change that file.**

### The status shape (shared with T-1603, exactly this)
`status()` returns:
```ts
{
  running: DeskRef[];
  queued: number;
  ready: boolean;
  imageDigest: string | null;                              // the pinned ref `<repo>@sha256:<hex>`, or null until resolved
  detail: 'host_not_set_up' | 'image_unresolved' | null;   // null when ready
}
```

### Steps
1. **Config (`config.ts`):**
   - `DESK_IMAGE` becomes optional. When set, it is the override and keeps today's digest check (and `DESK_ALLOW_UNPINNED_IMAGE`).
   - New optional `DESK_IMAGE_OWNER` (default `julioferrero`) and `DESK_IMAGE_TAG` (default `latest`). They build `ghcr.io/<owner>/zilar-desk:<tag>`, used only when `DESK_IMAGE` is absent.
   - Validate owner and tag with a strict pattern: lowercase `[a-z0-9._-]`, and tag `[A-Za-z0-9._-]{1,128}`. Reject anything else at start-up, since this text reaches a `docker` argument.
   - Replace `DockerSettings.image` with the source (the override, or the ref to resolve). The resolved pin lives in the lifecycle (step 3).
2. **Docker layer (`docker.ts`):**
   - add `runtimeAvailable(): Promise<boolean>`: `docker info --format '{{json .Runtimes}}'`, then true when the configured runtime name is a key. A `null` runtime (the daemon's default) is always available.
   - add `pullAndResolveDigest(ref): Promise<string | null>`: the two commands above, returning `null` when either fails or there is no `@sha256:`.
   - Both run through the existing CLI helper with argument arrays and no shell. **Never put the runtime list or pull output into a log or a reply.**
   - If `docker.ts` would pass 400 lines, put these two in a new `packages/desk/src/agent/readiness.ts`.
3. **Readiness (`lifecycle.ts`, or `readiness.ts`):**
   - **The state:** `{ ready: boolean; imageDigest: string | null; detail }`, starting at `{ false, null, 'host_not_set_up' }`.
   - **`checkReadiness()`:**
     - if already ready, return;
     - if the runtime is missing, set `host_not_set_up`;
     - else take the override (already a pinned digest), or `pullAndResolveDigest(ref)`;
     - `null` means `image_unresolved`; a digest means ready.
     - Once ready, it stays ready for the life of the process.
   - **`assertPinnedImage`:** while not ready, throw `DeskError('jail_unavailable', 'this server has not set up AI computers yet')`. Once ready, compare `spec.imageDigest` with the resolved pin (the same error text as today on a mismatch).
   - **`status()`** returns the shared shape above.
4. **`main.ts`:**
   - keep `listen()` first, so the socket answers `status` at once;
   - then run `checkReadiness()` immediately and on the existing 30 s interval until ready;
   - log one line per state change (`desk-agent: ready (<digest>)`, `desk-agent: waiting for the <runtime> runtime`, `desk-agent: jail image not resolved, retrying`), never raw command output.
5. **`wire.ts`:** widen `StatusReply.status` to the shared shape. `server.ts` needs no change beyond types.
6. **Keep the rest unchanged:** `DESK_IMAGE` set with an existing digest behaves exactly as today once the runtime check passes. Admission, workspaces and jail flags are untouched.

### Tests
This touches sandbox confinement (a privileged sidecar and image pinning), so add tests in `packages/desk/src/agent/lifecycle.test.ts` and/or `server.test.ts`, using the fake Docker layer in `test-harness.ts`:
1. not ready → `provision` refuses with `jail_unavailable`, and `status` shows `ready: false, detail: 'host_not_set_up'`;
2. runtime present, image resolves → ready with that digest, and `provision` with that digest works;
3. once ready, a different `spec.imageDigest` is refused;
4. the pull fails → `image_unresolved`, then a later check that succeeds turns ready;
5. a `DESK_IMAGE` override → ready without a pull;
6. a bad `DESK_IMAGE_TAG` (e.g. `x;rm`) is rejected by `loadAgentConfig`.

Keep the existing tests green; update only what the new required-ness of readiness breaks (a harness helper that marks the agent ready is fine).

### Allowed files
- `packages/desk/src/agent/config.ts`
- `packages/desk/src/agent/docker.ts`
- `packages/desk/src/agent/readiness.ts` (new, only if needed for size)
- `packages/desk/src/agent/lifecycle.ts`
- `packages/desk/src/agent/main.ts`
- `packages/desk/src/agent/server.ts`
- `packages/desk/src/agent/wire.ts`
- `packages/desk/src/agent/index.ts`
- `packages/desk/src/agent/test-harness.ts`
- `packages/desk/src/agent/lifecycle.test.ts`
- `packages/desk/src/agent/server.test.ts`
- `apps/runner/src/desk/handler.ts` (added by the lead after the BLOCKED question: call `checkReadiness()` before `provision`)
- `work/T-1602-desk-agent-readiness.md`

### Checks
```bash
pnpm --filter @zilar/desk exec vitest run src/agent --reporter=dot
pnpm gate
```

### Acceptance
- **The agent starts with no `DESK_IMAGE`,** answers `status` with the shared shape, and turns ready without a restart once the fake layer reports the runtime.
- **No new log line or reply contains raw `docker` output.**
- **Every source file is within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- **`config.ts`**: `DESK_IMAGE` is now the optional override (kept the digest check and
  `DESK_ALLOW_UNPINNED_IMAGE`). New `DESK_IMAGE_OWNER` (default `julioferrero`) and
  `DESK_IMAGE_TAG` (default `latest`) build `ghcr.io/<owner>/zilar-desk:<tag>` when `DESK_IMAGE`
  is absent; both are validated with strict patterns (`/^[a-z0-9._-]+$/` and
  `/^[A-Za-z0-9._-]{1,128}$/`). `DockerSettings.image` now holds the *source* (the override or
  the ref to resolve).
- **`docker.ts`**: added `runtimeAvailable()` (`docker info --format '{{json .Runtimes}}'`, true
  when the configured runtime is a key; a `null` runtime is always available) and
  `pullAndResolveDigest(ref)` (`docker pull`, then `docker image inspect --format
  '{{index .RepoDigests 0}}'`, `null` unless the result has `@sha256:`). Both use the existing
  `execFile` helper with argument arrays, no shell, and never log or return raw command output.
  `createArgs` now runs the validated `spec.imageDigest` (the resolved pin) as the jail image,
  so a tag source is never the image a jail runs.
- **`lifecycle.ts`**: added the state `{ ready, imageDigest, detail }` (starts
  `{ false, null, 'host_not_set_up' }`) and `checkReadiness()`: runtime missing →
  `host_not_set_up`; else the override (`@sha256:`) → ready, or `pullAndResolveDigest(ref)` →
  `image_unresolved` on `null` / ready on a digest; once ready it stays ready.
  `assertPinnedImage` throws `jail_unavailable` `'this server has not set up AI computers yet'`
  while not ready, then compares `spec.imageDigest` with the resolved pin. `status()` returns
  the shared shape.
- **`main.ts`**: still `listen()` first, then `checkReadiness()` immediately and on the existing
  30 s sweep; logs one line per state change (`ready (<digest>)`, `waiting for the <runtime>
  runtime`, `jail image not resolved, retrying`), never raw command output. `RunningAgent` now
  also carries `config`.
- **`wire.ts`**: `StatusReply.status` is the shared `DeskStatus`. **`index.ts`**: exports
  `DeskReadinessDetail`. (`server.ts` needed no change; types line up.)
- **Tests** (`test-harness.ts`, `lifecycle.test.ts`, `server.test.ts`): `FakeDocker` implements
  the two new methods and the harness marks the agent ready (override → no pull). Added readiness
  tests 1-5 and config tests for the bad tag/owner and the ref from the defaults; marked the local
  lifecycles in the existing tests ready. No `readiness.ts` was needed (docker.ts is 333 lines).
- **Runner** (`apps/runner/src/desk/handler.ts`, added to Allowed files by the lead): before each
  `provision` on the shared `Lifecycle` it now calls `await lifecycle.checkReadiness()` (idempotent
  once ready), so runner desks stay available with the pinned-digest image the server sends, and
  refuse `jail_unavailable` only when the machine's runtime is missing. No other runner behaviour
  changed.

### Checks run

- `pnpm --filter @zilar/desk test --maxWorkers=2 --reporter=dot src/agent` →
  `Test Files 4 passed (4)`, `Tests 35 passed (35)`.
- `pnpm gate` (first run): `FAIL format` on `index.ts`, `lifecycle.test.ts`, `server.test.ts`;
  fixed with `pnpm exec prettier --write` on those three only.
- `pnpm --filter @zilar/runner typecheck` (`tsc --noEmit`): passed, no output.
- `pnpm --filter @zilar/runner exec vitest run --maxWorkers=2 --reporter=dot`:
  `Test Files 8 passed (8)`, `Tests 77 passed (77)`.
- `pnpm gate` (final run, `gate: 11 changed file(s)`, after the runner change), summary lines:
  - `PASS  install (frozen)  (1.3s)`
  - `PASS  format  (1.4s)`
  - `PASS  lint  (2.0s)`
  - `PASS  typecheck  (2.8s)`
  - `PASS  effect  (0.5s)`
  - `PASS  tests @zilar/desk  (1.1s)`
  - `PASS  tests @zilar/runner  (0.8s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Blocked / needs a decision

Resolved: the lead added `apps/runner/src/desk/handler.ts` to the Allowed files and confirmed the
readiness call. The runner now calls `checkReadiness()` before `provision` (see "What I did"), so
the regression noted here is fixed and the runner typecheck and tests pass.

### Notes for the lead

- **Interpretation.** I kept `DockerSettings.image` as the single "source" field rather than
  adding `imageRepository`/`imageTag` (plan §1.3). Reason: `apps/runner` sets `image` from a
  pinned digest, so the interface stays source-compatible and that package typechecks unchanged.
  The lifecycle tells an override from a ref with `image.includes('@sha256:')`.
- **Behaviour change.** `DESK_ALLOW_UNPINNED_IMAGE=true` with a non-digest `DESK_IMAGE` now
  resolves that ref with a pull instead of running the bare tag; a pinned override is unchanged.
- Every source file changed is within 400 lines (`docker.ts` 333, `lifecycle.ts` 307).
- Because `apps/runner` sets `DockerSettings.image` from a pinned digest, keeping the single
  source field means the runner needs no config change beyond the readiness call; its typecheck
  passes and the gate now runs `@zilar/runner` too.

## Review (written by Claude)

**Approved and merged. This is the first of the ordered merges** (T-1602, then T-1603, then T-1605).

- **Pre-review:** clean, 2 nits. The worker's BLOCKED question (runner desks never called the readiness check) was answered by adding `apps/runner/src/desk/handler.ts` to the Allowed files. The runner's typecheck and tests pass.
- **The lead read the security-relevant diff:**
  - **Image pin order:** `assertPinnedImage` (`lifecycle.ts:127`) runs before `docker.create` (`:159`). It refuses everything before readiness, and after that any `spec.imageDigest` other than the pin resolved at readiness. So `keepAliveFlags(spec.imageDigest)` can only ever run the pinned digest.
  - **Docker commands:**
    - `runtimeAvailable` runs `docker info --format '{{json .Runtimes}}'` as an argument array, checks the key with `hasOwnProperty`, and returns false on any error;
    - `pullAndResolveDigest` runs `docker pull`, then `image inspect`, as argument arrays, and accepts only a value containing `@sha256:`.
    - Neither puts raw output into a log or a reply.
  - **Input validation:** owner `^[a-z0-9._-]+$` and tag `^[A-Za-z0-9._-]{1,128}$` are validated at start-up. The ref always starts with `ghcr.io/`, so it can't become a `docker` flag.
  - **Logging:** `main.ts` polls readiness at start and every 30 s, logging one line per state change.
- **The worker's interpretation, accepted:** `DockerSettings.image` stays the single source field. An override is told apart by `@sha256:`, so the runner config is unchanged.
- **Before the next step:** the always-on compose change (T-1605) must wait for T-1603.

