---
id: T-0951
title: "Size split T9: packages/xmpp-core/src/core-effect.ts (1,206 lines) into core-effect/{config,lifecycle,presence,stanza-router,operations}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0951-split-xmpp-core-effect
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0951: Split `core-effect.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `packages/xmpp-core/src/core-effect.ts` is 1,206 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #6 (task T9 in §4.2): `core-effect/config.ts`, `core-effect/lifecycle.ts`, `core-effect/presence.ts`, `core-effect/stanza-router.ts`, `core-effect/operations.ts`, under `packages/xmpp-core/src/`. `core-effect.ts` becomes the barrel.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #6, and `packages/xmpp-core/src/core-effect.ts`.

### Allowed files
`packages/xmpp-core/src/core-effect.ts`, `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect/presence.ts`, `packages/xmpp-core/src/core-effect/stanza-router.ts`, `packages/xmpp-core/src/core-effect/operations.ts`, `work/T-0951-split-xmpp-core-effect.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot src/connection-resilience.test.ts src/stream-management.test.ts src/mam.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `packages/xmpp-core/src/core-effect.ts` (1,206 lines) into the five files the plan names under `core-effect/`; the old path is now a thin barrel with the same exports. `createCoreEffect` stays the closure: it owns the mutable state in one `CoreRuntime` object (declared in `core-effect/config.ts`) and wires the module factories; each module closes over the runtime and reads its functions at call time, so nothing outside the task's files changed.

- `core-effect/config.ts` — constants, `ClientOptions`/`ClientFactory`/`CoreDependencies`/`Pending*` types, the pure predicates (`attempt`, `errorMessage`, `toError`, `isSaslError`, `isFatalTokenError`, `reconnectDelayFor`, `isConflictError`, `redact`, the id/resource/client factories) and the `CoreRuntime` type.
- `core-effect/presence.ts` — roster/occupants/MUC, `parseContext`, presence and roster-push handling.
- `core-effect/stanza-router.ts` — `handleStanza`, `handleMamResult`, `handleIq`.
- `core-effect/lifecycle.ts` — status, watchdog/reconnect, keepalive, auth, connect/disconnect.
- `core-effect/operations.ts` — the `request` helper plus join/leave/send/history/upload/push.
- `core-effect.ts` — barrel plus the closure; `attachHandlers`, `ensureClient`, `emitEvent`, `emitError` and `sendQuietly` stay with `createCoreEffect`, and the runtime is assembled there.

### `wc -l` (old and new)

- old `packages/xmpp-core/src/core-effect.ts` at main: **1206**
- new: `core-effect.ts` **231**, `core-effect/config.ts` **216**, `core-effect/lifecycle.ts` **393**, `core-effect/operations.ts` **388**, `core-effect/presence.ts` **155**, `core-effect/stanza-router.ts` **115**. Every file is under 400.

### Export list before and after (`grep -E "^export"`)

Before, on main `core-effect.ts` (5 names, unchanged kinds):

```
109:export type ClientOptions = {
116:export type ClientFactory = (options: ClientOptions) => XmppClient;
118:export type CoreDependencies = {
222:export type CoreEffect = XmppCoreEffect & { on: XmppCore['on'] };
224:export function createCoreEffect(
```

After, the barrel re-exports the same five names and kinds (`export type { ClientFactory, ClientOptions, CoreDependencies } from './core-effect/config';`, `export type CoreEffect = XmppCoreEffect & { on: XmppCore['on'] };`, `export function createCoreEffect(`). The new modules also export internal names (`createPresence`/`createLifecycle`/`createStanzaRouter`/`createOperations`, `CoreRuntime`, `attempt`, `errorMessage`, `reconnectDelayFor`, `redact`, the constants and the `*Api`/`Pending*` types) used only inside the package; no name the old path exported was dropped or changed kind, and no importer changed.

### Dedup

- One `sendStanzaEffect()` now backs the four send ops (`sendMessage`, `sendReactions`, `sendCorrection`, `sendRetraction`): it takes a `build(id)` callback, requires online, generates the id once and sends.
- One `resetOnlineState()` now backs the teardown shared by `restartStuckClient`, `stopAfterFailure` and `disconnectEffect`. **Deviation:** the plan names the whole teardown, but the three differ — `restartStuckClient` keeps `desiredOnline` true and stops the already-detached client, `stopAfterFailure` and `disconnectEffect` set status and clear rosters and reject pending iqs with different errors, and only `disconnectEffect` clears `transientTokenError`. `resetOnlineState` therefore resets the genuinely common part (`reconnectAttempt = 0`, `coldAttemptSeen = false`, `stopKeepalive()`) and the rest stays per-function, to keep behaviour unchanged.

### Effect ratchet

No `// effect-plain:` marker was needed: every new file imports `effect` as a value, so all classify as `effect` and the ratchet step passed.

### Commands and results

- `pnpm install` — done (per the task).
- Task Checks, run with the shared-machine worker cap: `pnpm --filter @zilar/xmpp-core exec vitest run --maxWorkers=2 --reporter=dot src/connection-resilience.test.ts src/stream-management.test.ts src/mam.test.ts` — **3 files, 44 tests passed**.
- `pnpm gate` (from the repo root) — **GATE PASS**:

```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (1.1s)
PASS  lint  (0.9s)
PASS  typecheck  (2.6s)
PASS  effect  (1.1s)
PASS  tests @zilar/xmpp-core  (2.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 7 changed files are the six source files under `packages/xmpp-core/src/` and this task file; all are inside the Allowed files.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `core-effect.ts` (1,206 lines) becomes a 231-line barrel plus `core-effect/{config,lifecycle,presence,stanza-router,operations}.ts`, the largest `lifecycle.ts` at 393.
- **Check:** the gate passed, with the xmpp-core resilience, stream-management and MAM tests.
