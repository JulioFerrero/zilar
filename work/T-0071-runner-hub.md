---
id: T-0071
title: Runner hub (M3, server) — approved machines can connect over the tunnel WebSocket; revoke drops them; last-seen and online state
status: todo
milestone: M3
branch: task/T-0071-runner-hub
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0068, T-0008]
estimate: 1 day
---

# T-0071: The runner hub

## Spec (written by Claude, do not edit)

### Goal

T-0068 stores machines, their public keys and their approval state. T-0008 proved the tunnel (`TunnelServer` in `@galena/runner-tunnel`: hello, a signed challenge, heartbeat, streams). This task connects the two: the Galena server starts a tunnel listener whose trust comes from the machines table, so an **approved** machine can connect and prove its key, a **revoked** one is dropped at once, and the owner's machine list shows who is online. It still carries no desks or AI work; that comes later.

### Design (decided; follow it)

The tunnel package's `KeyRegistry` is **synchronous** (`getPublicKey(runnerId): string | null`), and its handshake code depends on that (it re-reads the key after the challenge to catch a mid-handshake revoke). **Do not change `packages/runner-tunnel`.** Instead the hub keeps an **in-memory cache of approved keys**, and the cache is what implements `KeyRegistry`:
- `runnerId` on the wire = the **machine id** (a UUID string).
- The cache is loaded at start and refreshed from the database every 30 s, and it is updated **synchronously** by two events from the machines routes: `notifyApproved(machineId, publicKey)` and `notifyRevoked(machineId)` (already exists). A revoke therefore removes the key before the route even responds, and the tunnel's own `onRevoke` closes the live connection (close code `CLOSE_REVOKED`).
- The hub is **off by default** (`RUNNER_HUB_ENABLED=true` to turn on). It listens on its own port (`RUNNER_HUB_PORT`, default `3189`), bound to `127.0.0.1` exactly as `TunnelServer.start` does today. Exposing it (wss, a reverse proxy path) is a deployment task, not this one.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §11.8 and §11.13 (one outbound WebSocket, the protocol sketch), §11.9 (trust in both directions)
- `packages/runner-tunnel/src/server.ts` (`TunnelServer.start`, `isRunnerLive`, `disconnectRunner`, how `KeyRegistry` is used, `gatewayUrl`), `keys.ts` (`KeyRegistry`, `InMemoryKeyRegistry`, `generateRunnerKeypair`, `signNonce`), `runner.ts` (`RunnerClient`, used in tests), `protocol.ts` (close codes)
- `apps/server/src/machines/registry.ts`, `routes.ts`, `service.ts` (T-0068), `apps/server/src/config.ts` (zod env config; how the gateway flag and optional URLs are declared), `apps/server/src/index.ts` (startup and the shutdown sequence, which was just fixed to close connections and exit hard after 15 s: keep that behavior), `apps/server/src/ai/litellm-client.ts` (`LITELLM_BASE_URL` default)
- Look at how `packages/runner-tunnel/src/runner.test.ts` or `test-harness.ts` start a server and a client in tests.

### Allowed files
- `apps/server/src/machines/hub.ts` (new), `hub.test.ts` (new), `registry.ts`, `registry.test.ts`, `routes.ts`, `routes.test.ts`, `service.ts` (only for a helper like `listApprovedMachineKeys`)
- `apps/server/src/config.ts`, `config.test.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts` (only to pass the hub's `isOnline` into the machines routes)
- `apps/server/package.json` **only** to add the workspace dependency `@galena/runner-tunnel` (`workspace:*`) plus the matching `pnpm-lock.yaml` change
- `work/T-0071-runner-hub.md`

**Not allowed:** `packages/**`, web, mobile, `docs/**`, the schema and migrations (no new columns: `last_seen_at` already exists). No other dependencies.

### What to build

1. **Config.** `RUNNER_HUB_ENABLED` (`'true'` → on, default off), `RUNNER_HUB_PORT` (default 3189, validated like `PORT`). If enabled without a LiteLLM base URL, use the same default the AI module uses for the gateway URL; the tunnel only accepts an `http://` gateway URL (`TunnelServer` validates it), so a non-http value must make startup fail with a clear config error, not a crash later.
2. **Key cache (`hub.ts`).** `createHubKeyRegistry({ db, registry, logger, refreshMs = 30_000 })` implements the tunnel's `KeyRegistry`:
   - `getPublicKey(machineId)` reads the in-memory map; **only approved** machines are ever in it;
   - `refresh()` replaces the map from `SELECT id, public_key FROM machines WHERE status = 'approved'` (a failed refresh keeps the old map and logs the error with no key material);
   - `approve(machineId, publicKey)` and `revoke(machineId)` update the map synchronously; `revoke` also calls the tunnel's revoke listeners (`onRevoke`), so `TunnelServer` closes the live connection;
   - `onRevoke(listener)` as the interface requires;
   - a timer refreshes every `refreshMs` (unref'd, stopped by `close()`).
   Also **removals through refresh must notify**: a machine that disappears from the approved set during a refresh (revoked or deleted by another process) triggers the revoke listeners.
3. **Wiring the events.** `DbMachineRegistry` (T-0068) gets `notifyApproved(machineId, publicKey)` (synchronous fan-out like `notifyRevoked`), and the `approve` route calls it after the write commits. The hub subscribes to both.
4. **The hub (`hub.ts`).** `startRunnerHub({ db, registry, logger, port, gatewayUrl, ... })`:
   - loads the cache, then `TunnelServer.start({ registry: cache, gatewayUrl, ... }, port)`;
   - **last seen:** when a machine's connection becomes ready, and then at most once every 60 s while it stays connected, call `registry.touchLastSeen`. Use whatever hook `TunnelServer` gives you (poll `isRunnerLive` for the approved ids on the refresh timer if there is no event; state your choice in the Report). A failed write only logs an id;
   - returns `{ isOnline(machineId): boolean, close(): Promise<void>, port }`; `close` stops the timer and the tunnel;
   - logs only machine ids, close codes and counts, **never keys, nonces, signatures or names**.
5. **Startup and shutdown (`index.ts`).** Start the hub only when enabled (after the server listens); the shutdown sequence closes it. If the hub fails to start (port in use), log the error and continue: the API must not die because of the runner hub.
6. **Online flag.** `GET /api/machines` adds `online: boolean` per machine (true only when the hub says so; false when the hub is off). The public shape stays otherwise identical.

### Tests (Vitest; PGlite for the DB; a real `RunnerClient` from `@galena/runner-tunnel` on a loopback port; no external network)
- Key cache: approved machines resolve; pending, revoked and unknown ids do not; `approve`/`revoke` events take effect immediately; a refresh picks up an approval made elsewhere; a refresh that drops a key calls the revoke listeners; a failing refresh keeps the old map.
- Hub with a real client, all against the real `TunnelServer`:
  - an **approved** machine with the right key connects and shows `isOnline`; `last_seen_at` is written;
  - a **pending** machine cannot authenticate;
  - a client that signs with a **different key** cannot authenticate;
  - **revoking** through the route (the real route, with a session as in the T-0068 tests) closes the live connection with the revoked close code, and reconnecting fails;
  - approving a pending machine through the route lets it connect without waiting for the 30 s refresh;
  - two machines are independent.
- Routes: `online` appears in `GET /api/machines` and is false when the hub is off.
- Config: the new variables, defaults and the http-only rule.
- Timers must not leak: tests close the hub, and the suite finishes without open handles.

### Live check (the lead does it)
Not needed from you; say in the Report that no live proof was done.

### Acceptance criteria
- [ ] Only approved machines can authenticate; revoke drops a live connection within the same request.
- [ ] `packages/runner-tunnel` is untouched.
- [ ] The hub is off by default and can't take the API down.
- [ ] No key material, nonce or signature in any log line.
- [ ] No `any`, no `@ts-ignore`; the only new dependency is the workspace package.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
pnpm build
```

### Out of scope
- wss/TLS and the public URL, several server processes, desks, engine or model traffic on the tunnel, previews, the runner app, the web Machines page.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
