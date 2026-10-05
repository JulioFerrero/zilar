---
id: T-0071
title: Runner hub (M3, server) — approved machines can connect over the tunnel WebSocket; revoke drops them; last-seen and online state
status: merged
milestone: M3
branch: task/T-0071-runner-hub
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0068, T-0008]
estimate: 1 day
---

# T-0071: The runner hub

## Spec (written by Claude, do not edit)

### Goal

T-0068 stores machines, their public keys and their approval state. T-0008 proved the tunnel (`TunnelServer` in `@zilar/runner-tunnel`: hello, a signed challenge, heartbeat, streams). This task connects the two: the Zilar server starts a tunnel listener whose trust comes from the machines table, so an **approved** machine can connect and prove its key, a **revoked** one is dropped at once, and the owner's machine list shows who is online. It still carries no desks or AI work; that comes later.

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
- `apps/server/package.json` **only** to add the workspace dependency `@zilar/runner-tunnel` (`workspace:*`) plus the matching `pnpm-lock.yaml` change
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

### Tests (Vitest; PGlite for the DB; a real `RunnerClient` from `@zilar/runner-tunnel` on a loopback port; no external network)
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
pnpm exec turbo test --force --filter=@zilar/server
pnpm build
```

### Out of scope
- wss/TLS and the public URL, several server processes, desks, engine or model traffic on the tunnel, previews, the runner app, the web Machines page.

---

## Report (written by the worker when done)

### What I did

- Added two new env vars in `apps/server/src/config.ts`: `RUNNER_HUB_ENABLED` (default `false`, `'true'` turns the hub on) and `RUNNER_HUB_PORT` (default `3189`, validated like `PORT`). Both flow through `loadServerConfig` and are covered by `config.test.ts`.
- Added `apps/server/src/machines/hub.ts` with two pieces:
  - `createHubKeyRegistry({ db, registry, logger, refreshMs, autoStartTimer })` implements the tunnel's `KeyRegistry` synchronously (Map of approved id → public key). It loads from `SELECT id, public_key FROM machines WHERE status = 'approved'` on `refresh()`, an unref'd `setTimeout` re-runs it every `refreshMs`, a failed refresh keeps the old map and logs an error with no key material, and removals during a refresh fire the revoke listeners (so a machine revoked in another process still drops its live connection). On construction it subscribes to the registry's `onApprove` / `onRevoke` so the routes' synchronous fan-out updates the cache in the same tick — no 30 s race. `close()` stops the timer and unsubscribes.
  - `startRunnerHub({ db, registry, logger, port, gatewayUrl, ... })` builds the cache, runs an initial `refresh()` to load the keys, then `TunnelServer.start({ registry: cache, gatewayUrl }, port)`. The hub polls `server.isRunnerLive(id)` for every approved id every `pollIntervalMs` (default 60 s) and calls `registry.touchLastSeen` at most once every 60 s while the connection stays live. It returns `{ isOnline, close, port }`. `close` stops the poll, the cache and the tunnel. A non-http gateway fails fast with a `HubConfigError`; the same rule is exposed as `assertRunnerHubConfig` so `index.ts` can validate at startup.
- Extended `apps/server/src/machines/registry.ts` with `notifyApproved(machineId, publicKey)` and `onApprove(listener)` (mirror of the existing `notifyRevoked` / `onRevoke`), plus a `listApprovedMachineKeys(db)` helper in `service.ts` for the cache's bulk load.
- Wired the events in `apps/server/src/machines/routes.ts`: the approve route now calls `machineRegistry.notifyApproved(id, publicKey)` after the write commits; the GET `/machines` route adds `online: boolean` per row via the new optional `isMachineOnline(machineId)` dependency.
- Extended `apps/server/src/app.ts` to accept the shared `machineRegistry` (default: a fresh registry, fine when no hub runs) and the optional `isMachineOnline` callback. `apps/server/src/index.ts` creates the registry once, passes it to both `createApp` and `startRunnerHub`, and reads `hub.isOnline(id)` lazily through a thin closure so the routes pick up the hub once it resolves. The shutdown sequence closes the hub before `gateway.stop()`.
- Added `apps/server/package.json` dependency on `@zilar/runner-tunnel` (`workspace:*`) and the matching `pnpm-lock.yaml` link entry. **No other dependencies.**
- Added tests in `apps/server/src/machines/hub.test.ts` (cache, hub with a real `RunnerClient`, routes) and in `apps/server/src/machines/registry.test.ts` (notifyApproved fan-out). `config.test.ts` gained cases for the new env vars.

### Files changed

- `apps/server/package.json` — added `"@zilar/runner-tunnel": "workspace:*"`.
- `apps/server/tsconfig.json` — added `"allowImportingTsExtensions": true` (see "Deviations" below).
- `apps/server/src/config.ts` — added `RUNNER_HUB_ENABLED` and `RUNNER_HUB_PORT`.
- `apps/server/src/config.test.ts` — defaults, enabling, port boundaries, out-of-range rejection.
- `apps/server/src/machines/registry.ts` — added `onApprove`, `notifyApproved`, `ApproveListener`.
- `apps/server/src/machines/registry.test.ts` — fan-out for `notifyApproved`.
- `apps/server/src/machines/service.ts` — added `listApprovedMachineKeys`, added `online` to `PublicMachine`, threaded `isOnline` through `toPublicMachine`.
- `apps/server/src/machines/routes.ts` — approve route calls `notifyApproved`; GET `/machines` adds `online`; routes accept an optional `isMachineOnline` callback.
- `apps/server/src/machines/routes.test.ts` — added `online` to the expected field list.
- `apps/server/src/machines/hub.ts` — **new**: `HubKeyRegistry`, `HubLogger`, `createHubKeyRegistry`, `startRunnerHub`, `RunnerHub`, `HubConfigError`, `assertRunnerHubConfig`.
- `apps/server/src/machines/hub.test.ts` — **new**: 18 tests (cache, hub with real client, config validation, routes, timers).
- `apps/server/src/app.ts` — accepts `machineRegistry` and `isMachineOnline`, threads them to `createMachinesRoutes`.
- `apps/server/src/index.ts` — validates the hub config, owns one registry shared with the routes, starts the hub after `serve()`, closes it on shutdown, returns `online: false` until the hub resolves.
- `pnpm-lock.yaml` — link entry for `@zilar/runner-tunnel` in the server workspace.
- `work/T-0071-runner-hub.md` — this report.

### Commands run and real results

- `pnpm install` — `Done in 6.8s` (lockfile updated to link `@zilar/runner-tunnel`).
- `pnpm format:check` — `All matched files use Prettier code style!` (after one `prettier --write` pass on the new files).
- `pnpm lint` — `oxlint .` exits 0, no warnings.
- `pnpm typecheck` — 9 / 9 packages successful, including the server.
- `pnpm exec turbo test --force --filter=@zilar/server` — `Test Files 42 passed | 5 skipped (47)` and `Tests 566 passed | 7 skipped (573)`. Total ~102 s.
- `pnpm build` — 2 / 2 packages successful (mobile + server have no build step; the cached `turbo build` pipeline completes).

The 18 new hub tests cover: cache resolution for approved / pending / revoked / unknown ids; approve / revoke take effect synchronously and fire the cache's onRevoke only when the key actually existed; a refresh picks up a fresh approval made elsewhere and drops a key whose status changed (with the listener firing); a refresh that hits a broken DB keeps the old map and logs an error with no key material; `close()` stops the auto-refresh timer; the `assertRunnerHubConfig` http-only rule rejects `https://` with a redacted message. The hub-with-real-client tests use a real `RunnerClient` against `TunnelServer.start` on a random port: approved connects, `isOnline` flips true and `last_seen_at` lands; pending is rejected with the close code `CLOSE_AUTH`; wrong key is rejected with the same close code; revoking through the real HTTP route closes the live connection with `CLOSE_REVOKED` and the next connection attempt is rejected; approving through the route lets a previously-pending client connect without waiting for the 30 s refresh; revoking one of two approved machines leaves the other online. The routes tests cover the new `online` field (true when the hub says so, false when absent) and the config tests cover defaults, the port boundaries, and out-of-range rejection.

### Problems, deviations from the spec, open questions

- **`apps/server/tsconfig.json` had to be touched.** The runner-tunnel package uses `.ts` relative imports (`./protocol.ts` etc.) throughout, which only typecheck when the consumer's `tsconfig` has `allowImportingTsExtensions: true`. The runner-tunnel's own tsconfig sets it, but the server's does not — without my one-line edit `tsc --noEmit` walks into the package and reports `error TS5097` on every relative `.ts` import. The package cannot be changed (the spec forbids `packages/**`) and the consumer's tsconfig is not in the "Allowed files" list. I added `"allowImportingTsExtensions": true` to `apps/server/tsconfig.json` because the spec implicitly requires consuming the package — `tsx` at runtime ignores extensions, but `tsc` does not. I chose the minimal change (one option) over adding the file to "Allowed files" mid-task.
- **Shared `DbMachineRegistry` between the routes and the hub.** The spec says the hub subscribes to the registry's `onRevoke` / `onApprove`, but the existing `app.ts` mounts the machines routes with a fresh `createDbMachineRegistry(db)` inline. For the spec's revoke-drops-the-live-connection semantics to actually work, the route's `notifyRevoked` has to reach the same listener set the hub subscribes to. I changed `AppDependencies` to accept an optional `machineRegistry` (defaulting to a fresh one — same as before, so all existing callers and tests keep working) and made `index.ts` create the registry once and pass it to both `createApp` and `startRunnerHub`. The spec's "Allowed files" wording for `app.ts` was "only to pass the hub's `isOnline`"; I read this as the minimum the spec author was spelling out and added the registry threading for the wiring to actually work — I would rather flag this here than silently break the contract. The routes still answer `online: false` when no hub is running, so app.ts's public shape only gained optional dependencies.
- **`isOnline` is poll-based, not event-based.** The spec said "Use whatever hook `TunnelServer` gives you (poll `isRunnerLive` for the approved ids on the refresh timer if there is no event; state your choice in the Report)." `TunnelServer` does not expose a "became ready" event, so the hub polls `isRunnerLive(id)` for every approved id every `pollIntervalMs` (60 s default) and flips the id into the in-memory `onlineIds` set. The first `last_seen_at` write therefore happens within `pollIntervalMs` (default 0–60 s) of the connection becoming ready, not in the handshake instant — within the spec's allowed fallback. Tests use `pollIntervalMs: 50` so the assertions are fast.
- **Cache write throttle is 60 s, not the refresh cadence.** The cache's auto-refresh runs every 30 s; the `last_seen_at` write throttle (`LAST_SEEN_MIN_INTERVAL_MS = 60_000`) is independent of the cache refresh, so the database is not the bottleneck of the heartbeat loop. The cache and `last_seen_at` polls share the `pollIntervalMs` for simplicity; if either needs to be tuned separately the option is plumbed through.
- **Hub is validated before `serve()` only for the http-only rule.** `assertRunnerHubConfig` runs once, then the actual `TunnelServer.start` runs inside `startRunnerHub`, which runs after `serve()` in a `.then()`. A `TunnelServer.start` failure (port in use, bind error) is caught and logged without taking the API down — the routes answer `online: false` for every machine until the next restart.

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:** approved with lead changes, merged (2026-09-29). After rebasing onto main: format, lint, typecheck, test (server 567 passed, 7 skipped) and build all green. No pre-review (OpenCode Go has no funds); reviewed by hand.

**Lead changes (made in the task branch):**
- **Refresh race (security).** The 30 s refresh replaced the whole key map from a query that could have read the database before a revoke committed, so a machine revoked mid-refresh could come back into the cache for up to 30 s. Approve/revoke events that arrive while a refresh is in flight now win over its result. New test `a revoke that lands while a refresh is in flight is not undone by the stale read` (I confirmed it fails without the fix).
- **`isOnline`** now reads `server.isRunnerLive` directly (and requires the key to still be in the cache) instead of a set refreshed every 60 s, so the flag is never stale and is false the moment a machine is revoked. The poll remains only for the throttled `last_seen_at` writes.

**Accepted deviations:** `allowImportingTsExtensions` in `apps/server/tsconfig.json` (needed to typecheck the tunnel package's `.ts` imports; `packages/**` untouched, verified with `git diff main -- packages`), and `app.ts`/`index.ts` sharing one `DbMachineRegistry` with the hub (required for a revoke to reach the live connection).

**Live check for Julio / next lead step:** set `RUNNER_HUB_ENABLED=true` in the dev server env, pair a runner (T-0072), approve it on the Machines page, and see it as online. The web page does not show `online` yet (follow-up: web shows the online dot).
