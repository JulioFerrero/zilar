---
id: T-1043
title: "Dedup F6a: one server errorName/errorClassName and one isUniqueViolation in effect/error-utils.ts, replacing 11 local copies"
status: merged
milestone: M5
branch: task/T-1043-server-shared-error-helpers
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1043: Shared server error helpers

## Spec (written by Claude, do not edit)

### Why
`docs/audit/size-plan.md` §4.1 F6 lists `errorName` ×7 and `isUniqueViolation` ×6 as copies. The lead read every copy (main, 2026-10-10), and they are not all the same.

**`errorName`** has two different bodies, and both stay. Each caller must log the same string as today.
- **A, `error.name`:**
  - `apps/server/src/actions/support.ts:42` (exported);
  - `apps/server/src/agents/gateway/contracts.ts:253` (out of scope, see below);
  - `apps/server/src/routines/scheduler.ts:218`.
- **B, `error.constructor.name`:**
  - `apps/server/src/push/api-util.ts:42` (exported);
  - `apps/server/src/files/api.ts:83`;
  - `apps/server/src/media/api.ts:186`;
  - `apps/server/src/topics/room-sync.ts:96` (exported; `topics/room-push.ts:11` imports it).

**`isUniqueViolation`** has five variants. The widest is `apps/server/src/handles/store.ts:273`: it checks `SqlError` `UniqueViolation`, then walks up to 5 `cause`s for code `23505` or a "duplicate key" / "UNIQUE constraint" message. The narrower copies are:
- `apps/server/src/pins/service.ts:225` and `apps/server/src/roles/service.ts:37`: the SqlError check plus top-level `23505`;
- `apps/server/src/topics/service.ts:371`: top-level `23505` only;
- `apps/server/src/machines/pairing.ts:165`: the SqlError check plus the cause walk for `23505`, with no message check;
- `apps/server/src/push/api-util.ts:16`: the cause walk with the message check, but no SqlError check.

The wide version returns true wherever a narrow one did, so using it everywhere can only catch more duplicates. That change is deliberate and is stated in the Report.

### What to build
1. **The new file:** create `apps/server/src/effect/error-utils.ts` (the folder holds `edge.ts`, `http-core.ts`, `logger.ts`, `node-serve.ts`, `rate-limit-middleware.ts`, `runtime.ts` and `sql.ts`) with three exports:
   - `errorName`, the exact body of A from `actions/support.ts:42`;
   - `errorClassName`, the exact body of B from `push/api-util.ts:42`;
   - `isUniqueViolation`, the exact body of `handles/store.ts:273`, with its imports.
2. **Variant A:**
   - `actions/support.ts` drops its copy and re-exports `errorName` from `../effect/error-utils`, so `actions/decisions.ts`, `actions/queries.ts` and `actions/recovery.ts` stay untouched;
   - `routines/scheduler.ts` drops its copy and imports `errorName`.
3. **Variant B:**
   - `files/api.ts`, `media/api.ts` and `topics/room-sync.ts` drop their copies, import `errorClassName`, and call it where they called `errorName`;
   - `topics/room-push.ts` imports `errorClassName` from `../effect/error-utils` instead of `errorName` from `./room-sync`;
   - `push/api-util.ts` drops both copies, and `push/api-handlers.ts` and `push/api-subscribe.ts` import `errorClassName` and `isUniqueViolation` from `../effect/error-utils`.
4. **`isUniqueViolation`:**
   - `handles/store.ts` drops its copy and re-exports `isUniqueViolation` from `../effect/error-utils`, so `groups/service.ts` and `groups/visibility.ts` stay untouched;
   - `pins/service.ts`, `roles/service.ts`, `topics/service.ts` and `machines/pairing.ts` drop their copies and import the shared one.
5. **Out of scope:** `agents/gateway/contracts.ts` and its importers (`agents/gateway/group-turn.ts`, `agents/gateway/tool-exec.ts`) are message-pipeline files, so leave them as they are.
6. **No other code changes.** Every call site keeps its arguments and its use of the result.

### Read first
`AGENTS.md`, `docs/audit/size-plan.md` §4.1 (F6), and every file named above.

### Allowed files
`apps/server/src/effect/error-utils.ts`, `apps/server/src/actions/support.ts`, `apps/server/src/routines/scheduler.ts`, `apps/server/src/files/api.ts`, `apps/server/src/media/api.ts`, `apps/server/src/topics/room-sync.ts`, `apps/server/src/topics/room-push.ts`, `apps/server/src/push/api-util.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/handles/store.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/topics/service.ts`, `apps/server/src/machines/pairing.ts`, `work/T-1043-server-shared-error-helpers.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/roles/roles.test.ts src/invite-links/invite-links.test.ts src/push/candidates.test.ts
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "function errorName\|function isUniqueViolation" apps/server/src` lists only `effect/error-utils.ts` and `agents/gateway/contracts.ts`.
- The Report names each call site with the helper it now uses.
- The Report states which `isUniqueViolation` callers got the wider check.

---

## Report (written by the worker when done)

### What I did

Created `apps/server/src/effect/error-utils.ts` with three exports, each the exact
body from its source: `errorName` (variant A, from `actions/support.ts:42`),
`errorClassName` (variant B, from `push/api-util.ts:42`) and `isUniqueViolation`
(the widest copy, from `handles/store.ts:273`, with its `effect/sql` `SqlError`
import). Every duplicate was then removed and replaced by an import of the
shared helper. All call sites keep their arguments and their use of the result.

### Files changed (all under Allowed files)

New: `apps/server/src/effect/error-utils.ts`.

- `apps/server/src/actions/support.ts` — dropped the `errorName` body, imports it
  from `../effect/error-utils` and re-exports it (`export { errorName };`), so
  `actions/decisions.ts`, `actions/queries.ts` and `actions/recovery.ts` are
  untouched.
- `apps/server/src/routines/scheduler.ts` — dropped its copy, imports `errorName`
  (used at both existing log sites).
- `apps/server/src/files/api.ts`, `apps/server/src/media/api.ts`,
  `apps/server/src/topics/room-sync.ts` — dropped their `errorName` copies, import
  `errorClassName`, and every former `errorName(...)` call now calls
  `errorClassName(...)`.
- `apps/server/src/topics/room-push.ts` — now imports `errorClassName` from
  `../effect/error-utils` instead of `errorName` from `./room-sync`; all sites
  updated.
- `apps/server/src/push/api-util.ts` — dropped both the `errorName` and
  `isUniqueViolation` copies; keeps `STRICT_DECODE` and `createRequirePush`.
- `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-subscribe.ts`
  — import `errorClassName` (and `isUniqueViolation` in api-subscribe) from
  `../effect/error-utils`.
- `apps/server/src/handles/store.ts` — dropped its copy, imports and re-exports
  `isUniqueViolation` (`export { isUniqueViolation };`), so `groups/service.ts`
  and `groups/visibility.ts` are untouched. Dropped the now-unused `SqlError`
  import.
- `apps/server/src/pins/service.ts`, `apps/server/src/roles/service.ts`,
  `apps/server/src/topics/service.ts`, `apps/server/src/machines/pairing.ts` —
  dropped their copies, import the shared `isUniqueViolation`; each also dropped
  its now-unused `SqlError` import.

Out of scope and untouched: `agents/gateway/contracts.ts` and its importers
`agents/gateway/group-turn.ts` / `agents/gateway/tool-exec.ts`.

### Call sites and the helper each now uses

- `errorName` (variant A): `actions/support.ts` (re-export + its own log),
  `routines/scheduler.ts` (2 sites). `actions/decisions.ts`, `actions/queries.ts`,
  `actions/recovery.ts` keep importing it from `./support`.
- `errorClassName` (variant B): `files/api.ts` (2 sites), `media/api.ts` (1),
  `topics/room-sync.ts` (5), `topics/room-push.ts` (5), `push/api-handlers.ts` (1),
  `push/api-subscribe.ts` (2).
- `isUniqueViolation`: `handles/store.ts` (local + re-export for
  `groups/service.ts` and `groups/visibility.ts`), `pins/service.ts`,
  `roles/service.ts`, `topics/service.ts`, `machines/pairing.ts`,
  `push/api-subscribe.ts`.

### Which `isUniqueViolation` callers got the wider check

The shared body is the widest: `SqlError` `UniqueViolation`, then a 5-deep
`cause` walk matching code `23505` or a "duplicate key" / "UNIQUE constraint"
message. Callers whose old copy was narrower and therefore catch more now:
- `pins/service.ts` and `roles/service.ts` — were `SqlError` + top-level `23505`;
  now also the cause walk and the message fallback.
- `topics/service.ts` — was top-level `23505` only; now the full check.
- `machines/pairing.ts` — was `SqlError` + cause walk for `23505` (no message
  check); now also the message fallback.
- `push/api-subscribe.ts` — was the api-util copy (cause walk + message, no
  `SqlError` check); now also the `SqlError` check.
`handles/store.ts` (and its importers `groups/service.ts`, `groups/visibility.ts`)
keeps the exact behaviour it had.

### Commands and real results

- `pnpm install` — done, all 15 workspace projects (18.8s).
- `pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/roles/roles.test.ts src/invite-links/invite-links.test.ts src/push/candidates.test.ts`
  — `Test Files 3 passed (3)`, `Tests 48 passed (48)`.
- `pnpm gate` — summary:
  ```
  gate: 16 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.9s)
  PASS  tests @zilar/server  (14.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance

- `grep -rn "function errorName\|function isUniqueViolation" apps/server/src` lists
  only `apps/server/src/effect/error-utils.ts` (both) and
  `apps/server/src/agents/gateway/contracts.ts` (`errorName`, out of scope).

### Deviations

- Updated the now-stale header comment in `push/api-util.ts` (it described the
  removed unique-violation walk and error-class namer). Comment only, no code
  behaviour change.
- The new file carries short header/summary comments; the three bodies are the
  exact copies required. No other code changes.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The change:** a new `apps/server/src/effect/error-utils.ts` holds three helpers, replacing 11 local copies.
  - `errorName` is the `error.name` variant.
  - `errorClassName` is the `constructor.name` variant.
  - `isUniqueViolation` is the widest copy, from `handles/store.ts`.
  - `grep` finds only these three and the out-of-scope `agents/gateway/contracts.ts` copy.
- **The lead checked each caller keeps its old variant:**
  - `actions/support.ts` (re-export) and `routines/scheduler.ts` use `errorName`;
  - `files/api.ts`, `media/api.ts`, `topics/room-sync.ts`, `topics/room-push.ts`, `push/api-handlers.ts` and `push/api-subscribe.ts` use `errorClassName`.

  Every log string stays the same.
- **The deliberate widening:** pins, roles, topics, machine pairing and push now get the wider unique check. It matches the SqlError tag, or code `23505` / a duplicate message up to 5 causes deep. It can only catch more duplicates than before.
- **Check:** the lead ran `roles.test.ts`, `invite-links.test.ts` and `candidates.test.ts` on the branch (3 files, 48 passed). The gate passed.
