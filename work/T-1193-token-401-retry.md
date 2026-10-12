---
id: T-1193
title: "MP-F7: a 401/403 from the XMPP token fetch during an automatic reconnect is retried once after 2 s before it counts as bad credentials, and a core that stops on auth failure gets the client's connect-retry ladder instead of staying offline until the app restarts"
status: merged
milestone: M5
branch: task/T-1193-token-401-retry
model: auto
effort: default
depends_on: [T-1153]
estimate: 0.3 day
---

# T-1193: Don't give up on one token 401

## Spec (written by Claude, do not edit)

### Why
`docs/audit/message-pipeline-audit.md` MP-10 (P1, suspected) and fix **F7**. A single 401 on the token fetch during a reconnect stops XMPP for good, until the app restarts.
- **The 401 counts as bad credentials:** `isFatalTokenError` treats any 401 or 403 from `getToken` that way (`packages/xmpp-core/src/core-effect/config.ts:126-130`).
- **That flag stops the core:** `authenticateWithFreshToken` sets `runtime.authFailed = true` (`packages/xmpp-core/src/core-effect/lifecycle.ts:122-150`, the flag at `:137`), and the error handler then calls `stopAfterFailure()` with no auto-reconnect (`packages/xmpp-core/src/core-effect.ts:176-180`).
- **Why a 401 can be transient:** a session refresh racing a deploy, or the session cache.
- **The client already has a retry ladder** for token and login failures: `scheduleConnectRetry` in `packages/client-core/src/store/lifecycle.ts:252-285`, used at `:321,367`.
- **Size:** `core-effect/lifecycle.ts` is **400 lines**, so the token step moves into a new file.

### What to build
1. **A new `packages/xmpp-core/src/core-effect/token-auth.ts`.** Move `authenticateWithFreshToken` there, so `lifecycle.ts` gets shorter, and add the retry:
   - on a fatal-looking token error (`isFatalTokenError`), wait 2 s and call `getToken()` **once more**;
   - only a second fatal error sets `runtime.authFailed = true`;
   - a non-fatal error behaves as today (`transientTokenError`);
   - make the 2 s delay a constant that tests can override through the existing options pattern (see how `reconnectWatchdogFirstMs` was added in T-1153), or through a parameter.
2. **`client-core` `lifecycle.ts`:** when the core ends `offline` after an auth failure, call `scheduleConnectRetry` (the existing ladder) instead of staying offline. The UI goes to login only when the server says the session is gone: find how sign-out or an expired session is detected today, cite it, and keep that path. `lifecycle.ts` stays at most 400 lines (it's 382).
3. **Test** (auth, the message pipeline), 1, in `packages/xmpp-core/src/connection-resilience.test.ts`: `getToken` rejects with a 401 once, then resolves, and the core reaches `online`, not `authFailed`.

### Read first
`AGENTS.md`, `docs/audit/message-pipeline-audit.md` (MP-10, F7), `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect.ts:150-200`, `packages/client-core/src/store/lifecycle.ts:240-380` and `packages/xmpp-core/src/connection-resilience.test.ts:1-80`.

### Allowed files
`packages/xmpp-core/src/core-effect/token-auth.ts`, `packages/xmpp-core/src/core-effect/lifecycle.ts`, `packages/xmpp-core/src/core-effect/config.ts`, `packages/xmpp-core/src/core-effect.ts`, `packages/xmpp-core/src/connection-resilience.test.ts`, `packages/client-core/src/store/lifecycle.ts`, `work/T-1193-token-401-retry.md`.

### Checks
```bash
pnpm --filter @zilar/xmpp-core exec vitest run src/connection-resilience.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines, and `core-effect/lifecycle.ts` gets shorter.

---

## Report (written by the worker when done)

### What I did
- **New `packages/xmpp-core/src/core-effect/token-auth.ts`** (64 lines): the token step
  (`authenticateWithFreshToken`) moved out of `core-effect/lifecycle.ts`. On a fatal-looking
  token error (`isFatalTokenError`: 401/403) it now waits `TOKEN_RETRY_DELAY_MS` (2 000 ms,
  overridable through `XmppCoreOptions.tokenRetryDelayMs`) and calls `getToken()` **once more**.
  Only a second fatal error sets `runtime.authFailed = true`; a non-fatal error (first attempt
  or retry) keeps the old transient behavior, failing with the same thrown object so the error
  handler's `error === runtime.transientTokenError` identity check still works. A successful
  retry proceeds to SASL unchanged.
- **`core-effect/config.ts`**: new exported `TOKEN_RETRY_DELAY_MS`, plus two module
  augmentations (the `types-ack.ts` pattern, so `types.ts` keeps its single re-export):
  `XmppCoreOptions.tokenRetryDelayMs` and an `authFailed` event (`EventPayloadMap.authFailed`
  and the matching `XmppCore.on` overload).
- **`core-effect.ts`**: the fatal branch now emits `authFailed` (token path only, not SASL)
  after stopping the core.
- **`packages/client-core/src/store/lifecycle.ts`**: `subscribeToCore` now receives the session
  and `me` and subscribes to `authFailed`; on it, it calls the existing `scheduleConnectRetry`
  ladder (`CONNECT_RETRY_DELAYS_MS`). The core no longer stays offline after a token auth
  failure.
- **Test** in `connection-resilience.test.ts`: `getToken` rejects with a 401 once, then resolves;
  the connection reaches `online` (not `offline`), `authenticate` gets the fresh token and
  `stopCalls` is 0. I also updated the pre-existing `it.each([401, 403])` test, which asserted a
  single 401 is fatal — the behavior this task deliberately changes — to assert two fatal
  answers.

### Why the new `authFailed` event
The store must revive a core that stopped on a token auth failure but must **not** revive one that
stopped on a `conflict` (`replaced`), which deliberately has no auto-reconnect (two clients must
not kick each other in a loop). Only the core knows which happened, and `connect()`'s rejection is
not available during an automatic reconnect (there is no pending connect at that point). I surfaced
it as an event using the augmentation pattern already used for `acked`/`unacked`/`replaced`. An
alternative without new public API — retry on any `offline` unless `replaced` — would also retry
after deliberate stops and changes more behavior; I did not take it. Flag it if you want it
different.

### Session-gone / login path (kept, not changed)
The client-core change only retries; the decision to send the user to login is still made by the
app's own session layer on a 401, as today:
- mobile `apps/mobile/src/auth/session-store.ts:69-71` (`isUnauthorized`) and `:94-102` (`bootstrap`
  clears the stored token and sets `guest` on a 401).
- web `apps/web/src/auth/AuthProvider.tsx:29,86-88` (Better Auth `useSession()` reports `guest`
  when the session is gone).

### Files changed
- `packages/xmpp-core/src/core-effect/token-auth.ts` (new)
- `packages/xmpp-core/src/core-effect/lifecycle.ts`
- `packages/xmpp-core/src/core-effect/config.ts`
- `packages/xmpp-core/src/core-effect.ts`
- `packages/xmpp-core/src/connection-resilience.test.ts`
- `packages/client-core/src/store/lifecycle.ts`
- `work/T-1193-token-401-retry.md`

### Commands run (real results)
- `pnpm install` → `Done in 10.7s` (peer-dependency warnings only, pre-existing).
- `pnpm --filter @zilar/xmpp-core test --maxWorkers=2 --reporter=dot src/connection-resilience.test.ts`
  → `Test Files 1 passed (1)`, `Tests 30 passed (30)`.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/lifecycle.test.ts`
  → `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
- `pnpm gate` → `GATE PASS`. Summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.6s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/client-core  (1.6s)
  PASS  tests @zilar/xmpp-core  (0.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Line counts (400-line rule)
`token-auth.ts` 64; `core-effect/lifecycle.ts` 400 → **366** (shorter, as required); `config.ts`
252; `core-effect.ts` 266; `client-core/src/store/lifecycle.ts` 394.
`connection-resilience.test.ts` is 798 lines, but it was already **756** before this change and the
spec requires adding a test to it, so the 400-line cap cannot apply to the test file; every source
file is ≤ 400. Correct me if the cap is meant to include tests.

### Deviations / notes
- Added the `authFailed` event and the `tokenRetryDelayMs` option (see above); neither was spelled
  out in the spec, but the store cannot tell a token auth failure from a `conflict` without a
  signal.
- The pre-existing "single 401 is fatal" test now asserts two fatal answers.
- The delay option is used by the retry path but not overridden by a test: the new test exercises
  the real 2 000 ms default (it asserts the core is still `reconnecting` and SASL has not run
  before the timers advance, then advances 2 000 ms).
- Security checklist: no secrets or tokens reach logs (the token is only kept in
  `runtime.latestToken` and redacted from error text, as before); no new routes, deletes or
  updates; nothing changes before a permission check.

### Round 2 (fix round)
- **Finding 1 (should-fix, store-level `authFailed` → retry test): NOT fixed — needs a decision.**
  I drafted the test the finding describes (a fake core capturing the
  `authFailed` handler, then asserting the event arms `connectRetryPending` /
  bumps `connectRetryAttempt`): it fails — the counter stays 0, so
  `scheduleConnectRetry` early-returns in the harness (suspects: the
  `ctx.rt.session() !== session` guard or the forked sleep not firing under the
  worker). I reverted the draft instead of iterating, because the test would
  live in `packages/client-core/src/store/lifecycle.test.ts`, which is **not**
  in this task's Allowed files (they name the source `lifecycle.ts` only), and
  the fix-round instruction says not to change anything outside them — the
  gate's scope check would flag it. See Disagreements below.
- **Findings 2–4 (nits): left as-is**, per the rule not to touch nits except on
  lines already changed.
- Follow-up F1 (retry ladder has no attempt ceiling / login routing) is outside
  this task's Allowed files; unchanged.
- Single tests: `connection-resilience.test.ts` 30 passed; `lifecycle.test.ts`
  9 passed (`--reporter=dot`, `--maxWorkers=2`).
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.4s)
  PASS  lint  (0.6s)
  PASS  typecheck  (1.0s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/client-core  (1.6s)
  PASS  tests @zilar/xmpp-core  (0.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Disagreements
- Finding 1 asks for a test in `packages/client-core/src/store/lifecycle.test.ts`,
  but that file is outside the task's Allowed files (which name
  `packages/client-core/src/store/lifecycle.ts` only — the source, not its
  test). Adding it would break the gate's scope check, so I left the file
  untouched. Either the Allowed files should gain that test path, or the finding
  should be accepted as a spec-level gap (the Spec's mandated single test only
  covers the core retry) rather than a worker-round fix.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 auto round. The pre-review is clean, with 3 nits and 2 follow-ups.**
- **xmpp-core:**
  - `authenticateWithFreshToken` moved to `core-effect/token-auth.ts`, so `lifecycle.ts` got shorter;
  - a 401/403 token error is retried once after 2 s (overridable in tests), and only a second fatal error sets `authFailed`;
  - the core then emits `authFailed`.
- **client-core:** `subscribeToCore` turns `authFailed` into `scheduleConnectRetry` (the existing ladder).
- **Tests:** xmpp-core connection resilience 30 of 30, client-core lifecycle 9 of 9, run by the lead.
- **Follow-ups:**
  - F1, no store test for `authFailed` to the ladder (the worker's draft failed; likely `flags.connectRetry` off in the test ctx), moved into T-1197;
  - F2, the ladder has no ceiling on a truly dead session (every 60 s) and doesn't route to login. Accepted for now; noted on the plan.
- **The lead rejected** one debug permission (a `/tmp` scratch dir with `rm -rf`) during the round.
