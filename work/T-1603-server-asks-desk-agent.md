---
id: T-1603
title: "AI computers T2 (server): DESK_AGENT_SOCKET defaults to /run/zilar/desk.sock; a cached status probe asks the agent whether it is ready and which image it pinned; the AI picker and every turn use the probe instead of DESK_IMAGE; old agents without `ready` count as ready"
status: merged
milestone: M5
branch: task/T-1603-server-asks-desk-agent
model: auto
effort: default
depends_on: []
estimate: 45 min
---

# T-1603: The server asks the desk agent

## Spec (written by Claude, do not edit)

### Why
- **The plan:** `docs/deploy/ai-computers-auto-plan.md` §1.4 and §2.4 (T-1599). This is task T2 of its split.
- **Today the server guesses:** cloud computers count as "available" when `DESK_AGENT_SOCKET` and `DESK_IMAGE` are set (`apps/server/src/hands/wiring.ts:18-31`, `apps/server/src/startup/components.ts:168`, `:176`, `:232`).
- **After this task:** the server asks the agent over its socket and uses the image the agent pinned. Nobody has to set `DESK_IMAGE` or the socket path.

### Facts (the lead read them on 2026-10-15, main after T-1599)
- **`apps/server/src/config/server-schema.ts`:** `:189` is `DESK_AGENT_SOCKET: Schema.optional(nonEmptyStringSchema)`; `:191` is `DESK_IMAGE: Schema.optional(pinnedImageSchema)`.
- **`apps/server/src/hands/wiring.ts`** (31 lines):
  - `:9-11`: `buildHands` returns `null` without the socket;
  - `:18-31`: `buildDeskClient` returns `null` without `DESK_IMAGE`, else `{ hands, imageDigest }`.
- **`apps/server/src/hands/cloud-hands.ts`** (207 lines):
  - `:105-118`: `requestReply(socketPath, payload)` sends one request and parses one reply line (not exported);
  - `:120`: `createCloudHands`.
- **`apps/server/src/agents/gateway/desk-exec.ts`:**
  - `:32-35`: `DeskClient { hands; imageDigest }`;
  - `:140-144`: `TurnDeskDeps.desk?: DeskClient`;
  - `:161-185`: `resolveTurnDesk` uses `deps.desk`, and `runnerImage: cloud?.imageDigest ?? null` (`:172`), so runner desks also take the image from the cloud client.
- **`apps/server/src/agents/gateway/contracts.ts:64-67`:** `desk?: DeskClient` on the gateway deps.
- **`apps/server/src/startup/components.ts`:**
  - `:17`: the import;
  - `:167-168`: `const desk = buildDeskClient(config, logger)`;
  - `:176`: `ais: { cloud: desk !== null }`;
  - `:232`: `...(desk === null ? {} : { desk })`.
- **The AI routes:**
  - `apps/server/src/app/deps.ts:55-56`: `cloud?: boolean`;
  - `apps/server/src/app/routes-ai.ts:111`: `cloud: deps.ais?.cloud ?? false`;
  - `apps/server/src/ais/api.ts:53-55` (doc and type), `:92` (`const cloud = deps.cloud`), `:178-181` (the `computerOptions` handler, `Effect.succeed({ cloud })`).
  - The existing route test is `apps/server/src/ais/provisioning.test.ts:143`.
- **The agent's `status` reply, after T-1602 (running in parallel):**
  ```ts
  { id, ok: true, status: { running, queued, ready: boolean, imageDigest: string | null, detail: 'host_not_set_up' | 'image_unresolved' | null } }
  ```
  An old agent answers `{ running, queued }` only. It only ever started with `DESK_IMAGE` set, so it was ready.

### Steps
1. **Config:** `DESK_AGENT_SOCKET` defaults to `/run/zilar/desk.sock`; use the existing default helper in `schema-helpers.ts`. `DESK_IMAGE` stays optional, as the override for old agents.
2. **The probe, in the new `apps/server/src/hands/desk-status.ts`:**
   - `createDeskProbe({ socketPath, hands, overrideImage, logger, ttlMs = 10_000, now })` returns `() => Promise<DeskClient | null>`.
   - It sends `{ id: 1, method: 'status' }`; export `requestReply` from `cloud-hands.ts` for this.
   - It decodes leniently: `ready`, `imageDigest` and `detail` are optional.
   - `ready = status.ready ?? true`, and `digest = status.imageDigest ?? overrideImage ?? null`. It returns `{ hands, imageDigest: digest }` only when ready and a digest exists; otherwise `null`.
   - **Any error, timeout (2 s) or missing socket gives `null`.** It never throws.
   - It caches the result (positive or negative) for `ttlMs`. Concurrent callers share one in-flight request.
   - It logs only on a change between available and unavailable, with fixed text plus the `detail` code; never raw socket text or paths.
3. **Wiring:** `buildDeskClient` becomes `buildDeskProbe(config, logger)`, which always returns a probe (the socket path is always known). `buildHands` always builds the cloud Hands.
4. **Gateway:**
   - `contracts.ts:67` and `desk-exec.ts:142` become `desk?: () => Promise<DeskClient | null>`;
   - `resolveTurnDesk` awaits it once per turn: `const cloud = (await deps.desk?.()) ?? null`;
   - `runnerImage` keeps reading `cloud?.imageDigest ?? null`;
   - the rest is unchanged. Not ready means no cloud computer for that turn (the existing `{ waiting: false }` path), never a `jail_unavailable` loop.
5. **Routes:**
   - `cloud` becomes `() => Promise<boolean>` through `deps.ts`, `routes-ai.ts` (default `async () => false`) and `ais/api.ts`;
   - `computerOptions` answers `{ cloud: await probe() }`, using `Effect.promise` or the file's existing pattern;
   - update the `api.ts:53-55` doc to "true when the desk agent answers ready".
6. **`components.ts`:** build the probe once; pass `cloud: async () => (await probe()) !== null` to the routes and `desk: probe` to the gateway.

### Tests
This touches the gate on who is offered a cloud computer. Add `apps/server/src/hands/desk-status.test.ts`, using a real Unix socket in a temp dir that answers canned lines:
1. ready with a digest → a client with that digest;
2. `ready: false` → `null`;
3. no socket file → `null`, and no throw;
4. an old agent (no `ready`) with `overrideImage` set → a client with the override; without it → `null`;
5. two calls within the TTL → one socket request;
6. a malformed reply → `null`.

Update `wiring.test.ts` for the new builder, and keep `provisioning.test.ts`'s `computer-options` case green: the probe default answers `false`. The route stays session-required (the 401 sweep).

### Allowed files
- `apps/server/src/config/server-schema.ts`
- `apps/server/src/hands/wiring.ts`
- `apps/server/src/hands/wiring.test.ts`
- `apps/server/src/hands/cloud-hands.ts`
- `apps/server/src/hands/desk-status.ts` (new)
- `apps/server/src/hands/desk-status.test.ts` (new)
- `apps/server/src/agents/gateway/desk-exec.ts`
- `apps/server/src/agents/gateway/contracts.ts`
- `apps/server/src/startup/components.ts`
- `apps/server/src/app/deps.ts`
- `apps/server/src/app/routes-ai.ts`
- `apps/server/src/ais/api.ts`
- `apps/server/src/ais/provisioning.test.ts`
- `work/T-1603-server-asks-desk-agent.md`

If a test file that builds gateway deps with `desk: <DeskClient>` breaks, adapt it, and list it in the Report.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/hands src/ais/provisioning.test.ts src/agents/gateway --reporter=dot
pnpm gate
```

### Acceptance
- **With no `DESK_IMAGE` and no `DESK_AGENT_SOCKET` set,** the server starts, `GET /api/ais/computer-options` answers `{ cloud: false }` when nothing listens, and `{ cloud: true }` once a socket answers ready.
- **Every source file is within 400 lines** (`ais/api.ts` is 367 now).

---

## Report (written by the worker when done)

### What I did

- **Config:** `DESK_AGENT_SOCKET` now defaults to `/run/zilar/desk.sock` via the
  existing `withDefault` helper; `DESK_IMAGE` stays optional as the override for
  an old agent (`server-schema.ts`). The key stays in `EMPTY_MEANS_UNSET_KEYS`,
  so an empty value still falls back to the default.
- **New probe `hands/desk-status.ts`:** `createDeskProbe({ socketPath, hands,
  overrideImage, logger, ttlMs = 10_000, now })` returns a `DeskProbe`
  (`() => Promise<DeskClient | null>`). It sends `{ id: 1, method: 'status' }`
  over `requestReply`, decodes leniently (`ready`/`imageDigest`/`detail`
  optional), treats a missing `ready` as ready and falls back to `overrideImage`
  for the digest; it returns a client only when ready with a non-empty digest,
  `null` otherwise. Any error, a 2 s timeout or a missing socket yields `null`
  and never throws. The result (ready or not) is cached for `ttlMs`, concurrent
  callers share one in-flight request, and it logs only on a change between
  available and unavailable with a fixed message plus the `detail` code (no
  paths, no raw socket text).
- **`requestReply`** is now exported from `cloud-hands.ts` with an optional
  `AbortSignal`, so the probe's timeout destroys the socket instead of leaking
  it (the abort pattern already used by `runExecuteOverSocket`).
- **Wiring:** `buildHands` always builds the cloud `Hands`; `buildDeskClient`
  became `buildDeskProbe(config, logger)`, which always returns a probe.
- **Gateway:** `contracts.ts` and `TurnDeskDeps.desk` are now
  `desk?: () => Promise<DeskClient | null>`; `resolveTurnDesk` awaits it once per
  turn (`const cloud = (await deps.desk?.()) ?? null`). `runnerImage` still reads
  `cloud?.imageDigest ?? null`. A not-ready agent is the existing
  `{ waiting: false }` path, never a `jail_unavailable` loop.
- **Routes:** `deps.ais.cloud` is `() => Promise<boolean>`; `routes-ai.ts` passes
  it through `opt('cloud', ...)` and `ais/api.ts` keeps an optional `cloud` that
  defaults to a probe answering `false` (so the 401 sweep and the
  `computer-options` test stay green). `computerOptions` answers
  `{ cloud: await cloud() }`; its doc now says "true when the desk agent answers
  ready". The default lives in `api.ts` (an Effect file) rather than
  `routes-ai.ts` on purpose: `routes-ai.ts` is a plain file, and adding an
  `async` arrow there tripped the gate's Effect ratchet (H1).
- **`components.ts`:** builds the probe once and passes `cloud: async () =>
  (await deskProbe()) !== null` to the routes and `desk: deskProbe` to the
  gateway.
- **Tests:** added `hands/desk-status.test.ts` (real Unix socket in a temp dir,
  canned reply lines) covering ready+digest, `ready: false`, no socket, old agent
  with/without `overrideImage`, TTL caching (two calls → one request) and a
  malformed reply. Rewrote `hands/wiring.test.ts` for `buildDeskProbe` (always a
  probe, default socket, missing socket → `null`, `DESK_IMAGE` validation) and
  kept `ais/provisioning.test.ts` green unchanged.

### Checks run

- `pnpm --filter @zilar/server exec vitest run src/hands src/ais/provisioning.test.ts src/agents/gateway --reporter=dot --maxWorkers=2` → `Test Files 15 passed (15)`, `Tests 79 passed (79)` (I added `--maxWorkers=2` to the task's command per AGENTS.md).
- Also run per file while working: `src/hands/desk-status.test.ts src/hands/wiring.test.ts` → 11 passed; `src/agents/gateway-desk.test.ts src/ais/provisioning.test.ts src/hands/cloud-hands.test.ts src/hands/resolve.test.ts` → 17 passed.
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 14 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.0s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/server  (25.0s)
  scope: 1 file(s) outside the Allowed files:
    apps/server/src/agents/gateway-desk.test.ts
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (Earlier runs failed on format, lint, typecheck and the Effect ratchet; those
  were fixed before this pass.)

### Round 2 (fix round)

Fix round after the PREREVIEW. Findings fixed: 1 and 2; nit 3 left as-is (see
below). `status` stays `review`.

- **Finding 1 (must-fix):** the probe schema demanded `running: Schema.Number`,
  but the agent sends `running` as a `DeskRef[]` (`packages/desk/src/agent/wire.ts:88`),
  so a real reply failed to decode and the probe always answered `null`.
  `desk-status.ts` now types `running` and `queued` as `Schema.optional(Schema.Unknown)`
  (the probe reads neither). Added the test "accepts the real agent wire shape,
  where running is a list of desks", which sends a real-shaped status with a
  non-empty `running` array. Commit `466e37b`.
- **Finding 2 (should-fix):** the fixtures sent `running: 0` (a number), a shape
  no real agent sends, so they could not catch finding 1. `statusReply` now
  defaults to `{ running: [], queued: 0, ...status }` and the ready/digest and
  old-agent fixtures drop the numeric `running`. Commit `6dd6756`.
- **Nit 3 (timeout on a hung connect, `cloud-hands.ts:113-117`):** not fixed.
  Per the fix-round rules nits are only touched in lines already changed, and
  this round does not otherwise change `requestReply`. Left for a follow-up.
- Tests added: 1 (the real-wire-shape case above). Existing fixtures adjusted as
  described for finding 2.
- Checks this round:
  - `pnpm --filter @zilar/server exec vitest run src/hands src/ais/provisioning.test.ts src/agents/gateway --reporter=dot --maxWorkers=2` → **15 files, 80 passed** (was 79; +1 new test).
  - `pnpm gate` (repo root): **GATE PASS** — install/format/lint/typecheck/effect/tests all PASS; scope still lists only the authorised `apps/server/src/agents/gateway-desk.test.ts`; size/migration/images clean.

### Notes for the lead

- **The one file outside the Allowed files is the authorised test adaptation.**
  `apps/server/src/agents/gateway-desk.test.ts` built gateway deps with
  `desk: { hands, imageDigest }`; the new type is a probe, so it became
  `desk: async () => ({ hands, imageDigest: 'zilar-desk@sha256:abc' })`. The
  task's Allowed files section says "If a test file that builds gateway deps with
  `desk: <DeskClient>` breaks, adapt it, and list it in the Report", which is
  exactly this one-line change. It is the only file the gate lists outside scope.
- **Fixture test:** an old agent is modelled as `{ id, ok: true, status: {
  running, queued } }` (no `ready`/`imageDigest`/`detail`), per the spec's "an old
  agent answers `{ running, queued }` only". If a real old agent instead replies
  without the `ok`/`status` wrapper, the lenient decode would read it as not
  ready; the spec's shape is what I implemented.
- I did not touch `work/BOARD.md` or any other task file.

## Review (written by Claude)

**Approved and merged. This is the second of the ordered merges** (after T-1602; T-1605 follows).

- **Pre-review:** clean after one automatic round.
  - **The round fixed a real must-fix:** the first probe schema typed `running` as a number, but the agent sends a list, so cloud computers would never have been offered.
  - The test fixtures had the same wrong shape. Both are now fixed, and the fixtures use the real `running: []`.
- **The lead read `hands/desk-status.ts` and the wiring diff:**
  - a lenient decode of the real wire shape;
  - a 2 s timeout;
  - any error, missing socket or malformed reply means `null`, never a throw;
  - a 10 s TTL cache with one shared in-flight request;
  - logs only on a change, with a fixed message plus the agent's `detail` code;
  - an old agent (no `ready`) counts as ready, with `DESK_IMAGE` as the digest fallback.
- **The rest of the wiring:**
  - `DESK_AGENT_SOCKET` defaults to `/run/zilar/desk.sock`;
  - the gateway awaits the probe once per turn (`desk-exec.ts`);
  - `GET /api/ais/computer-options` awaits it and stays session-required;
  - `components.ts` builds one probe for both.
- **On live after this deploy:** with no agent running (still behind the profile until T-1605), the probe answers `null`, so the card keeps "Needs setup on your server". No change for users.
