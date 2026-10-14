---
id: T-1418
title: "Wire the cloud desk client into the agent gateway: DESK_IMAGE config (pinned digest), buildDeskClient in hands/wiring.ts, pass it from main.ts; server gets DESK_IMAGE in both compose files"
status: merged
milestone: M5
branch: task/T-1418-wire-cloud-hands
model: auto
effort: default
depends_on: [T-1409, T-1411, T-1413]
estimate: 0.3 day
---

# T-1418: Wire the cloud desk client

## Spec (written by Claude, do not edit)

### Why
T-1409 put the desk tools in the agent loop behind an optional `deps.desk`, but **nothing in production sets it** (T-1409 follow-up). T-1411 ships the sidecar behind `DESKS_ENABLED`. This task connects the two, so that once the desks are switched on (with Julio's OK), an AI with `computer_mode = 'cloud'` can use its computer.

**While the env is unset nothing changes.**

### Facts (the lead checked them on main, 2026-10-14)
- **The gateway option** is `desk?: DeskClient` at `apps/server/src/agents/gateway/contracts.ts:63-66`. `DeskClient` is `{ hands, imageDigest }` (`apps/server/src/agents/gateway/desk-exec.ts:28-32`).
- **`buildHands(config)`** is in `apps/server/src/hands/wiring.ts:9`; it returns null without `DESK_AGENT_SOCKET`.
- **Config:** `DESK_AGENT_SOCKET` is at `apps/server/src/config.ts:276-281` (an optional non-empty string; empty is treated as unset via the list at about `:420`). **`config.ts` is 518 lines and `main.ts` is 560, both over 400:** add at most 6 lines to `config.ts` and at most 3 to `main.ts`, and put the logic in `hands/wiring.ts`.
- **The gateway is built in `apps/server/src/main.ts:472-494`** (`createAgentGateway({ … })`).
- **Compose:** `DESK_IMAGE` is passed only to `desk-agent` (`deploy/docker-compose.yml:330`, `deploy/coolify/docker-compose.app.yml:307`). `server` gets `DESK_AGENT_SOCKET: ${DESK_AGENT_SOCKET:-}`. The variable is documented in `deploy/.env.example:195-212`.

### What to build
1. **Config:** `DESK_IMAGE`, optional, must be a pinned reference (`<name>@sha256:<64 hex>`); refuse a tag-only value at start-up with a clear message. An empty value counts as unset (add it to the same empty-as-unset list).
2. **`hands/wiring.ts`:** `buildDeskClient(config): DeskClient | null`. It returns `{ hands, imageDigest }` only when **both** `DESK_AGENT_SOCKET` and `DESK_IMAGE` are set. Log once at start-up (ids only): "desks: on" or "desks: off (reason)".
3. **`main.ts`:** pass `...(desk === null ? {} : { desk })` into `createAgentGateway`.
4. **Compose (both files):** `server` gets `DESK_IMAGE: ${DESK_IMAGE:-}`. Nothing else changes, and the default stays empty.

### Tests (few)
`apps/server/src/hands/wiring.test.ts` (new):
- with neither variable → null;
- with only the socket → null;
- with both → a client with that digest;
- a tag-only image is refused by the config.

### Allowed files
`apps/server/src/config.ts`, `apps/server/src/main.ts`, `apps/server/src/hands/*.ts`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/.env.example`, `work/T-1418-wire-cloud-hands.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/hands --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; `config.ts` grows by at most 6 lines and `main.ts` by at most 3.
- With both variables unset, the start-up log says "desks: off" and nothing else changes.

---

## Report (written by the worker when done)

### What I did
- **`config.ts`:** added `DESK_IMAGE`, optional, decoded by a new
  `isPinnedImage` filter that only accepts `<name>@sha256:<64 hex>` and rejects
  a tag-only value with the message `invalid pinned image` (so a config error
  reads `DESK_IMAGE (invalid pinned image)`). Added `DESK_IMAGE` to
  `EMPTY_MEANS_UNSET_KEYS`, so an empty value counts as unset. Net growth of
  `config.ts`: **+6 lines** (I condensed the now-stale `DESK_AGENT_SOCKET`
  comment to stay inside the budget).
- **`hands/wiring.ts`:** added `buildDeskClient(config, logger): DeskClient | null`.
  It returns the client only when `buildHands(config)` is non-null AND
  `config.DESK_IMAGE` is set; otherwise it logs `desks: off (DESK_AGENT_SOCKET
  unset)` / `desks: off (DESK_IMAGE unset)` and returns null. With both set it
  logs `desks: on` (image digest only) and returns `{ hands, imageDigest }`.
  `buildHands` is unchanged and now used by `buildDeskClient`.
- **`main.ts`:** built the client once at start-up
  (`const desk = buildDeskClient(config, logger);`) and passed
  `...(desk === null ? {} : { desk })` into `createAgentGateway`. Net growth:
  **+3 lines**.
- **Compose (both files):** the `server` service now gets `DESK_IMAGE:
  ${DESK_IMAGE:-}` right after `DESK_AGENT_SOCKET`, default empty.
- **`.env.example`:** noted that the server reads `DESK_IMAGE` with
  `DESK_AGENT_SOCKET` to build its desk client.

### Files changed
`apps/server/src/config.ts`, `apps/server/src/hands/wiring.ts`,
`apps/server/src/hands/wiring.test.ts` (new), `apps/server/src/main.ts`,
`deploy/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`,
`deploy/.env.example`, `work/T-1418-wire-cloud-hands.md`. All inside Allowed
files.

### Commands and real results
- `pnpm install` — done, 1137 packages, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/hands` —
  Test Files 2 passed (2), Tests 6 passed (6), 5.62s.
- `pnpm gate` — GATE PASS:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.9s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (6.0s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  GATE PASS
  ```

### Tests
`apps/server/src/hands/wiring.test.ts` (new, 4 cases): null with neither
variable; null with only the socket; a client carrying the pinned digest with
both; a tag-only `DESK_IMAGE` throws `ConfigError`. It also asserts the
`desks: off` / `desks: on` log lines.

### Deviations from the spec
- `buildDeskClient` takes a second parameter, `logger: Logger`. The spec wrote
  the signature as `buildDeskClient(config)`, but the log line must happen once
  at start-up and `main.ts` has a 3-line budget (import, `const`, spread), so
  the logger is injected into the wiring function instead of logged in
  `main.ts`. No behaviour differs otherwise.
- I condensed the old `DESK_AGENT_SOCKET` comment in `config.ts` (it still said
  "nothing in the agent loop uses it yet"), which both corrects it and keeps
  `config.ts` at +6 net lines.
- `.env.example` is in Allowed files but not in the spec's "What to build"; I
  added one clarifying line there. Trivial to drop if unwanted.

### Problems / open questions
None.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 1.
- Size: config.ts +6 net, main.ts +3.
- The wiring tests pass locally (6).
- Compose gives server DESK_IMAGE with an empty default, so production stays 'desks: off'.
- After deploy: check the 'desks: off' log line.
