---
id: T-1043
title: "Dedup F6a: one server errorName/errorClassName and one isUniqueViolation in effect/error-utils.ts, replacing 11 local copies"
status: todo
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

## Review (written by Claude)
