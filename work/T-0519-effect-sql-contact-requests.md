---
id: T-0519
title: "Effect C1: contact-requests service on effect/sql (same advisory locks, cap, race recovery outside the aborted tx, same answers); only the drizzle-shaped recovery test is re-seamed"
status: todo
milestone: M5
branch: task/T-0519-effect-sql-contact-requests
model: auto
effort: low
depends_on: [T-0510]
estimate: 1 day
---

# T-0519: contact requests on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle. T-0510 (merged) moved `blocks` and registered the runtime in `createApp`. Its pre-review flagged that blocks' effect/sql transactions and contact requests' drizzle transactions share **one** PGlite connection in tests, and can interleave. **Moving `contact-requests/service.ts` too removes that mix.**

The recipe is in `docs/audit/effect-sql-migration.md` §(a), with `apps/server/src/pins/service.ts` and `apps/server/src/blocks/service.ts` as the examples.

### Verified facts (do not re-derive)
- **`apps/server/src/contact-requests/service.ts`** (672 lines; its only importer is `apps/server/src/contact-requests/api.ts`):
  - **`resolveHandleUser(db: TxDatabase, handle)`** (line 60) takes the plain db or a transaction;
  - **`createContactRequest(deps, fromId, handle)`** (line 160):
    - `deps.db.transaction`, then `pg_advisory_xact_lock(hashtext('contact-sender:' + fromId))` (line 171);
    - the handle is resolved **inside** the tx, under the sender lock;
    - the pending cap is 20 per sender, giving `too_many_requests` (429);
    - the reverse-pending check, then the insert.
    - **Race recovery runs outside the tx** (lines 290-334). For a non-`HttpError` that is `isPendingPairViolation(error)`, it re-reads on **`deps.db`** (a fresh connection, never the aborted tx). A same-direction row gives `HttpError(409, 'request_exists', …)`; a reverse row gives `{ request: reverse, reverseOf: reverse }`; otherwise it rethrows.
  - **`isPendingPairViolation(error)`** (line 336, exported) walks a `cause` chain up to 5 levels for `code === '23505'`, with the constraint undefined, `contact_requests_pending_idx` or `contact_requests_pending_pair_idx`.
  - **`acceptContactRequest`** (482): a tx with `pg_advisory_xact_lock(hashtext('contact-accept:' + id))` (498); the roster sync runs outside the tx and is idempotent.
  - **The rest:** `listContactRequests` (383), `declineContactRequest` (583), `cancelContactRequest` (593), `relationFor` (606) and `profileForHandle` (639).
- **The lock-order rule:** `apps/server/src/blocks/service.ts` (effect/sql since T-0510) takes `contact-sender:<sender>` before `user-block:` in both transactions that need both. Read its comment and keep the same order.
- **effect/sql errors:** `SqlError.SqlError` with `error.reason._tag === 'UniqueViolation'` (`apps/server/src/pins/service.ts:292-299`, which also keeps the raw `code === '23505'` fallback). **Check whether the effect/sql error exposes the constraint name** (read `effect/dist/unstable/sql/SqlError.d.ts` or the `@effect/sql-pg` source in `node_modules`). If it does not, decide how `isPendingPairViolation` keeps "never match by message text", and explain it in the Report.
- **Tests:** `apps/server/src/contact-requests/contact-requests.test.ts` (582 lines):
  - "creates exactly one pending row for simultaneous opposite-direction requests" (around line 128) and **"caps pending outgoing at 20, atomically per sender"** (around line 305) call `createContactRequest({ db }, …)` directly with the drizzle handle; that stays valid if `deps.db` keeps being the key that `sqlRuntimeFor(db)` uses;
  - **"recovers outside the aborted tx when the insert hits the pair index"** (around lines 160-260) is built on **drizzle internals**: a `Proxy` over `db.transaction`, a tx double whose `insert().values().returning()` throws a fake 23505, a traced outer `select`, and direct `isPendingPairViolation({...})` assertions.
  - Also covered by `apps/server/src/blocks/blocks.test.ts`.

### What to build
1. **`contact-requests/service.ts` on effect/sql,** following the pins and blocks recipe:
   - the same exported functions, signatures and return values;
   - `sql.withTransaction` with **the same advisory lock statements and order**;
   - the same cap, the same `HttpError`s, and the same accept and roster flow;
   - **race recovery still re-reads outside the transaction** on a fresh connection, never inside the failed tx;
   - no drizzle imports left in this file.
   
   `resolveHandleUser` becomes an Effect (or a helper that runs inside the caller's transaction); `api.ts` must keep compiling, adjusted only if its import changes.
2. **`isPendingPairViolation`** must recognise **the effect/sql unique violation** on those two indexes, **and** the plain `{ code: '23505', constraint }` objects the test asserts. Never match by message text.
3. **Re-seam only the recovery test.** Rewrite "recovers outside the aborted tx…" so it forces a pair-index unique violation on the insert **through an effect/sql seam** (for example a small test hook in `service.ts`, such as an optional `deps.onInsert` that only tests pass, or a wrapped `SqlClient` layer). It must still prove three things:
   - the recovered result equals the winner's row (`reverseOf` set);
   - **the recovery reads ran outside the aborted transaction;** trace them at the seam;
   - the `isPendingPairViolation` assertions, kept as they are.
   
   **No other test changes.** Every other test in the file and in `blocks.test.ts` passes unchanged.
4. Add a short Report note for the guide: how a unique-violation race is tested on effect/sql.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/effect/sql.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/blocks/service.ts`, `apps/server/src/contact-requests/service.ts` (all), `apps/server/src/contact-requests/contact-requests.test.ts` (all).

### Allowed files
`apps/server/src/contact-requests/service.ts`, `apps/server/src/contact-requests/api.ts`, `apps/server/src/contact-requests/contact-requests.test.ts`, `work/T-0519-effect-sql-contact-requests.md`.

`contact-requests.test.ts` may change **only** in the recovery test.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot contact-requests blocks authz-sweep
pnpm gate
```

### Acceptance
- `contact-requests` runs on effect/sql with the same locks, cap, race recovery and answers.
- Only the recovery test is re-seamed, and it proves the same three things.
- Every other test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
