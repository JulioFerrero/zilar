---
id: T-1565
title: "Split apps/server/src/push/api-handlers.ts (399 lines): the test-notification route moves to push/api-test.ts as createTestHandler (like createSubscribeHandler in api-subscribe.ts); TEST_WAKE_CHAT_ID moves to api-util.ts and stays exported from api-handlers.ts; no behaviour change"
status: merged
milestone: M5
branch: task/T-1565-split-push-api-handlers
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1565: Split push/api-handlers.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/push/api-handlers.ts` is 399 lines, one `createPushGroupLayer` function. T-1017 already moved the subscribe route out the same way (`./api-subscribe`). **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **The module:**
  - header comment `:1-4`; imports `:6-37`;
  - `export const TEST_WAKE_CHAT_ID = 'zilar:test'` (`:42`), used at `:212` (preview) and `:301` (test).
- **`createPushGroupLayer(api, deps, limiters)` (`:44`):**
  - `logger`, `now`, `requirePush` and `nativeSender` (`:54-60`);
  - then `HttpApiBuilder.group(api, 'push', …)` with `config` (`:64`), `subscribe` (`:76`, `handleRaw('subscribe', createSubscribeHandler(deps, limiters.subscribe, requirePush))`), `list` (`:77`), `remove` (`:90`), `settings` (`:144`), `preview` (`:155`), `updateSettings` (`:238`) and `test` (`.handleRaw('test', handler(logger, (request, user) => …))`, `:259-397`).
- **The model to copy:** `apps/server/src/push/api-subscribe.ts:22`, `export function createSubscribeHandler(deps: PushApiDependencies, …)`.
- **`TEST_WAKE_CHAT_ID`** is imported by no other server file (`git grep`). The phone has its own copy in `apps/mobile/src/lib/push/background.ts:33`.

### Steps
1. **`apps/server/src/push/api-util.ts`:** add `TEST_WAKE_CHAT_ID` with its comment, moved from `api-handlers.ts`.
2. **New `apps/server/src/push/api-test.ts`:** `export function createTestHandler(deps, limiter, nativeSender, now, logger)` (the exact parameter types the body needs) returns the `handler(logger, (request, user) => …)` value from `:261-396`, moved **unchanged**, with the imports only it uses. It must not import from `./api-handlers`.
3. **`api-handlers.ts`:**
   - `.handleRaw('test', createTestHandler(deps, limiters.test, nativeSender, now, logger))`;
   - `export { TEST_WAKE_CHAT_ID } from './api-util'` plus an import for the preview's own use;
   - remove the imports only the moved code used;
   - update the header comment to name `./api-test`.
4. **No behaviour change:** the same statuses, texts and order of checks.

### Tests
None new. The push tests must pass in the gate.

### Allowed files
- `apps/server/src/push/api-handlers.ts`
- `apps/server/src/push/api-test.ts` (new)
- `apps/server/src/push/api-util.ts`
- `work/T-1565-split-push-api-handlers.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of the three files;
  - the export list of `api-handlers.ts` before and after (identical);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/push/api-util.ts`: added `TEST_WAKE_CHAT_ID` with its original comment.
- New `apps/server/src/push/api-test.ts`: `createTestHandler(deps, limiter, nativeSender, now, logger)` returns the `handler(logger, (request, user) => …)` value moved out of `api-handlers.ts`. It imports only what it uses and does not import `./api-handlers`.
- `apps/server/src/push/api-handlers.ts`: the test route is now
  `.handleRaw('test', createTestHandler(deps, limiters.test, nativeSender, now, logger))`;
  added `import { createTestHandler } from './api-test'`, `import { STRICT_DECODE, TEST_WAKE_CHAT_ID, createRequirePush } from './api-util'` and `export { TEST_WAKE_CHAT_ID } from './api-util'`; removed the imports only the moved code used
  (`PushTestPayload`, `./crypto`, `./failure-reason`, `./sender`, and `markDeviceFailed`, `markDeviceUsed`, `openNativeDevice` from `./store`); updated the header comment to name `./api-test`.
- No behaviour change: same statuses, texts and order of checks.
- No new tests (split-rules §5).

**Deviation (one):** the spec's signature `createTestHandler(deps, limiter, nativeSender, now, logger)` has no `requirePush` parameter (the moved body calls `requirePush()`). `api-test.ts` therefore builds its own gate with `createRequirePush(deps)` — the same helper, a stateless closure over `deps.push` — instead of receiving the one built in `api-handlers.ts`. Behaviour is identical (`api-handlers.ts` still builds its own for `config`/`list`/`remove`/`settings`/`updateSettings`). I followed the exact call line the spec gives in step 3.

**Unchanged move, verified:** after stripping indentation/blank lines and replacing `limiters.test.` with `limiter.`, the moved body (old `api-handlers.ts:263-394`) and the new body are identical. The only textual difference is Prettier reflowing one `throw new HttpError(429, …)` from four lines to one line, because at the shallower indentation it now fits `printWidth: 100`.

### Checks run
- `pnpm install`: done (12s, up to date).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/api-subscribe.test.ts src/push/api-preview.test.ts`
  → `Test Files 2 passed (2)`, `Tests 13 passed (13)`.
- `pnpm gate` (repo root, `--base main`):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.5s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.7s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/server  (19.9s)
  scope: every changed file is inside the Allowed files
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Files and sizes (`wc -l`, after)
- `apps/server/src/push/api-handlers.ts`: 399 → **254**
- `apps/server/src/push/api-test.ts` (new): **167**
- `apps/server/src/push/api-util.ts`: 28 → **33**

### Export list, before and after
Before (`git show main:…/api-handlers.ts | grep -E "^export"`):
```
export const TEST_WAKE_CHAT_ID = 'zilar:test';
export function createPushGroupLayer(
```
After (`grep -E "^export" api-handlers.ts`):
```
export { TEST_WAKE_CHAT_ID } from './api-util';
export function createPushGroupLayer(
```
Same names and kinds (a value export of `TEST_WAKE_CHAT_ID`, a function). No server file other than the tests imported `TEST_WAKE_CHAT_ID`, so no importer had to change.

### Notes for the lead
- Effect ratchet: `api-test.ts` makes value imports from `effect` (`Effect`, `Option`, `Schema`), so the checker classifies it `effect`, not `needs-effect`; no `// effect-plain:` marker was added, and the gate printed `PASS effect`.
- Security checklist: unchanged by this task (pure move). The moved route keeps its limit-or-cap (`limiters.test`, shared from `./api`), its scoped device deletes (`removeDevice(db, user.id, target.id)`), its same-404 behaviour, and logs ids/reasons only.
- Only item I would like a second look at is the `requirePush` recreation noted under "Deviation" — I chose the spec's literal call line over the `api-subscribe.ts` pattern.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, with 2 nits.
- **What the lead checked:**
  - **Sizes:** `api-handlers.ts` 254, `api-test.ts` 167 and `api-util.ts` 33 lines (was 399).
  - **Exports:** the `^export` lines of `api-handlers.ts` differ from main only in that `TEST_WAKE_CHAT_ID` is re-exported from `./api-util`.
  - **No cycle:** neither new file imports `./api-handlers`.
  - **The moved body:** `diff -w` against main's `:261-396` shows only `limiters.test` → the `limiter` parameter and one reflowed `HttpError` call.
- **The `requirePush` rebuild:** fine. `createRequirePush` holds no state; it reads `deps.push` on every call.
- **Tests:** the push tests passed in the worker's gate.

