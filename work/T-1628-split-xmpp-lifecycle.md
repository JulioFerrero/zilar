---
id: T-1628
title: "Size split: packages/xmpp-core/src/core-effect/lifecycle.ts is at exactly 400 lines — move one cohesive block (the keepalive ping or the stuck-client restart) into its own file, no behaviour change"
status: merged
milestone: M5
branch: task/T-1628-split-xmpp-lifecycle
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1628: Split xmpp-core's lifecycle.ts

## Spec (written by Claude, do not edit)

### Why
`packages/xmpp-core/src/core-effect/lifecycle.ts` is at exactly 400 lines, so any change to it would cross the limit. This is the core of the message pipeline (connect, keepalive, reconnect), so the split must not change behaviour.

### Facts (the lead read them on 2026-10-16)
- **The file** is one factory, `createLifecycle(runtime: CoreRuntime): LifecycleApi` (`:41`), with inner effects:
  - `restartStuckClient` (`:94`), `stopAfterFailure` (`:165`), `sendKeepalivePing` (`:238`);
  - `afterOnline` (`:295`), `connectEffect` (`:335`), `disconnectEffect` (`:366`).
- **`LifecycleApi`** is at `:23-39`.
- **Siblings in `packages/xmpp-core/src/core-effect/`:** `config.ts`, `operations.ts`, `operations-types.ts`, `presence.ts`, `stanza-router.ts`, `suspend.ts`, `token-auth.ts`.
- **Tests:** `packages/xmpp-core/src/connection-resilience.test.ts`, `stream-management.test.ts` and `stanza.test.ts`.

### Steps
1. **Move one cohesive inner effect** into its own file in `core-effect/`, either `sendKeepalivePing` and what only it uses, or `restartStuckClient`.
   - Make it a function that takes `runtime` (and anything else it closes over) as explicit arguments, and call it from `createLifecycle`.
   - Keep its comments.
2. **No behaviour change:** the same effects, order, timers and logging.
3. **Say in the Report** what moved and the new line counts.

### Allowed files
- `packages/xmpp-core/src/core-effect/lifecycle.ts`
- `packages/xmpp-core/src/core-effect/keepalive.ts`
- `packages/xmpp-core/src/core-effect/stuck-client.ts`
- `work/T-1628-split-xmpp-lifecycle.md`

Use only the one new file you need.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/connection-resilience.test.ts src/stream-management.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`lifecycle.ts` is under 350 lines.**
- **The xmpp-core tests pass unchanged.**

---

## Report (written by the worker when done)

### What I did

Moved the cohesive XEP-0199 keepalive block out of `packages/xmpp-core/src/core-effect/lifecycle.ts` into a new `packages/xmpp-core/src/core-effect/keepalive.ts`.

- New factory `createKeepalive(runtime: CoreRuntime, disconnectQuietly: (current: XmppClient) => void): KeepaliveApi`, returning `{ stopKeepalive, startKeepalive, keepaliveEnabled, handleKeepaliveReply }`.
- Moved functions (comments kept verbatim): `keepaliveEnabled`, `stopKeepalive`, `startKeepalive`, `sendKeepalivePing`, `reconnectDeadConnection`, `handleKeepaliveReply`. These are exactly `sendKeepalivePing` and what only it/the keepalive uses.
- `lifecycle.ts` keeps `disconnectQuietly` (also used by `core-effect.ts:276`) and `setReconnectDelay` (used by the connect path); both are passed/kept in place, not moved. It builds the keepalive once (`const keepalive = createKeepalive(runtime, disconnectQuietly)`) and wires `stopKeepalive` / `startKeepalive` / `keepaliveEnabled` / `handleKeepaliveReply` from it into the returned `LifecycleApi`. `resetOnlineState` now calls `keepalive.stopKeepalive()`.
- No behaviour change: the same effects, call order, timers, logging and `LifecycleApi` shape. `disconnectQuietly` is supplied as an explicit argument (its function declaration is hoisted, so passing it before its definition is safe). `keepalive.ts` imports only `config`, `stanza` and `timers`, so there is no import cycle with `lifecycle.ts`.
- Line counts: `lifecycle.ts` 400 → 314; `keepalive.ts` new 113 lines. Acceptance (`lifecycle.ts` under 350) met.

Files changed: `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect/keepalive.ts` (new), `work/T-1628-split-xmpp-lifecycle.md`.

### Checks run

- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/connection-resilience.test.ts src/stream-management.test.ts` → **2 test files passed, 49 tests passed** (637ms).
- `pnpm gate` → **GATE PASS**. Summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.9s)
  PASS  lint  (1.3s)
  PASS  typecheck  (4.3s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/xmpp-core (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The first `pnpm gate` run failed only on `format` (Prettier wanted the now-shorter `../stanza` import on one line); I fixed that single import and reran, which passed.

### Notes for the lead

- The gate reported `SKIP tests @zilar/xmpp-core (no nearby test files)`: the changed source is in `core-effect/` while the tests sit elsewhere in the package, so the gate's "nearest tests" found none. I therefore ran the two test files the task names directly (49 passed) — the keepalive paths (`connection-resilience`, `stream-management`) are covered there.
- I chose the keepalive block over `restartStuckClient`: moving only `sendKeepalivePing` + `reconnectDeadConnection` (about 37 lines) would leave `lifecycle.ts` at ~363 lines, over the 350 target, so the whole keepalive group was the smallest cohesive block that meets the acceptance. `restartStuckClient` was the messier option (it closes over `resetOnlineState`, `armWatchdog` and `isOnline`).
- No deviations from the spec, no new dependencies, no test changes, no open questions.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean. It confirmed the moved bodies are byte-identical and the API is unchanged.
- **The split:** `lifecycle.ts` went from 400 to 314 lines, and the new `keepalive.ts` is 113.
- **The tests:** the gate skipped the xmpp-core tests (none sit in `core-effect/`), so the lead ran `connection-resilience.test.ts` and `stream-management.test.ts`: 49 passed.
