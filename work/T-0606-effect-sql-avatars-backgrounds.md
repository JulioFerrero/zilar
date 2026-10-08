---
id: T-0606
title: "effect/sql: avatars/service.ts and backgrounds/service.ts fully off drizzle, transactions included (advisory-locked replace/delete for avatars, cap check + insert and the cascading delete for backgrounds) via sql.withTransaction per the pins recipe; same rows, locks, caps and file cleanup order; tests unchanged"
status: merged
milestone: M5
branch: task/T-0606-effect-sql-avatars-backgrounds
model: auto
effort: low
depends_on: [T-0590]
estimate: 1 day
---

# T-0606: the avatar and background services on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The conversion recipe, with transactions, is `docs/audit/effect-sql-migration.md` §(a). It was proven on pins (`apps/server/src/pins/service.ts:179`) and also used in `apps/server/src/blocks/service.ts:111` and `apps/server/src/chat-folders/service.ts`.

These two sibling modules (storage upload, file and row) have **no caller that passes a transaction** in; the lead checked with grep.

### Verified facts (do not re-derive; read both files fully)
**`apps/server/src/avatars/service.ts`:**
- **The permission reads** (132-150): the user exists; the group role from `group_members`; the AI owner.
- **The upload transaction** (186-210): `pg_advisory_xact_lock(hashtext('avatar:' || kind || ':' || ownerId))`, then read the replaced `storage_key`, then the insert or upsert. **Read the exact statement:** if it uses `onConflictDoUpdate`, write the same `ON CONFLICT ... DO UPDATE` in SQL.
- **The delete transaction** (269-290): the same lock, read the key, delete.
- **`readAvatarFile`** (323) and **`avatarIdsByOwner`** (358): plain reads. `avatarIdsByOwner` takes an id list, so **guard against an empty list** as the code does now.
- **The order of file writes and deletes relative to the transaction must stay exactly the same**: when the file is written and when the old one is removed. Read the comments at 186-189.

**`apps/server/src/backgrounds/service.ts`:**
- **The upload transaction** (151-170): the lock `background:<userId>`, then `count(*)` against the per-user cap, then the insert. **The cap check and the insert stay in one transaction** (`AGENTS.md`, the uniqueness and caps rule).
- **The list and read queries** (200, 224, 233).
- **The delete transaction** (256-325): read the key, then update `chat_prefs`, `chat_background_defaults` and `groups` (clear the references), delete rows in `chat_prefs` and `chat_background_defaults`, then delete the `chat_backgrounds` row. **Keep the same statements in the same order.**

**The recipe** (`docs/audit/effect-sql-migration.md` §a, items 3-6):
- use `sql.withTransaction(effect)`;
- the lock stays raw SQL inside the transaction;
- counts use `count(*)::int AS total`;
- exported functions stay `async` and keep their signatures;
- a private `runSql(db, effect)` uses `sqlRuntimeFor(db)`;
- `SqlError` maps to the module's existing errors, so every route answer stays byte-identical.

Check what the modules throw today on a database error, and keep it.

**Rows:** `transformResultNames: snakeToCamel` gives camelCase. Type the rows with the drizzle inferred types (type-only imports).

**Tests (all unchanged):**
- `apps/server/src/avatars/*.test.ts`;
- `apps/server/src/backgrounds/*.test.ts`;
- `apps/server/src/auth/*.test.ts` (they read avatar ids);
- `apps/server/src/groups/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Convert both files completely: every query and both transactions in each, with the same locks, caps, statement order and file order. Neither file keeps a value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section, including transactions and race recovery), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/avatars/service.ts` and `apps/server/src/backgrounds/service.ts`.

### Allowed files
`apps/server/src/avatars/service.ts`, `apps/server/src/backgrounds/service.ts`, `work/T-0606-effect-sql-avatars-backgrounds.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot avatars backgrounds auth groups authz-sweep
pnpm gate
```

### Acceptance
- Both services run on effect/sql, transactions included, with the same behaviour.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted both services fully from drizzle to `effect/sql`, per the pins recipe
(`docs/audit/effect-sql-migration.md` §a) and the examples in
`apps/server/src/pins/service.ts`, `blocks/service.ts` and `chat-prefs/service.ts`.

`apps/server/src/avatars/service.ts`:
- Every query now runs through a private `runSql(db, effect)` that calls
  `sqlRuntimeFor(db).runPromise(effect)`. Exported signatures are unchanged and
  stay `async`.
- Permission reads (`checkAvatarWritePermission`): the `"user"` existence check,
  the `group_members` role read and the `ais.owner` read are raw SQL. Same 404s.
- Upload transaction: `sql.withTransaction`, raw
  `pg_advisory_xact_lock(hashtext('avatar:' + kind + ':' + ownerId))`, the previous
  `storage_key` read, then the identical upsert written as
  `INSERT INTO avatars (...) VALUES (...) ON CONFLICT (owner_kind, owner_id) DO UPDATE SET ...`
  (matching the drizzle `onConflictDoUpdate` target and set). The file write/delete
  order is untouched: file written before the transaction, old file removed after
  the commit. The `try/catch` still maps a non-`HttpError` failure to the same
  503 `xmpp_unavailable` and removes the just-written file.
- Delete transaction: same lock, read `storage_key`, then
  `DELETE ... WHERE owner_kind = ... AND owner_id = ... AND storage_key = ...`.
- `readAvatarFile`: `SELECT *`, same path guard.
- `avatarIdsByOwner`: empty-list guard kept, then
  `owner_id IN ${sql.in(unique)}` (the `IN` helper the other converted modules use).

`apps/server/src/backgrounds/service.ts`:
- Same `runSql` helper and unchanged exported signatures.
- Upload transaction: `sql.withTransaction`, raw
  `pg_advisory_xact_lock(hashtext('background:' + userId))`, then
  `SELECT count(*)::int AS total ...`, cap check and `INSERT` in the same
  transaction, with `mkdir`/`writeFile` still between the count and the insert.
  The 409 `too_many_backgrounds` and the outer 503 mapping are unchanged.
- `listBackgrounds` / `readBackgroundFile` (including the group-membership join)
  are raw reads; the same `null` answers are kept.
- Delete transaction: read `storage_key`, then `UPDATE chat_prefs`,
  `UPDATE chat_background_defaults`, `UPDATE groups`, `DELETE` back-at-defaults
  rows in `chat_prefs` and `chat_background_defaults`, then `DELETE` the
  `chat_backgrounds` row — same statements in the same order.

Neither file keeps a value import from `drizzle-orm` or `db/schema`; the rows are
typed with drizzle's inferred types via `import type { avatars }` /
`import type { chatBackgrounds }` (the pattern already used by
`chat-folders/service.ts`).

One deliberate, behaviour-neutral detail: the avatar upsert's
`created_at` is set with `${new Date().toISOString()}` where drizzle used a JS
`new Date()`; both are the same instant for a `timestamptz` column and
`createdAt` is not part of the upload response.

### Files changed

- `apps/server/src/avatars/service.ts`
- `apps/server/src/backgrounds/service.ts`
- `work/T-0606-effect-sql-avatars-backgrounds.md`

### Commands run (real results)

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars/routes.test.ts src/backgrounds/routes.test.ts`
  → `Test Files 2 passed (2)`, `Tests 31 passed (31)`.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth src/groups src/authz-sweep.test.ts`
  → `Test Files 8 passed (8)`, `Tests 154 passed (154)` (the 6 `auth/*.test.ts`,
  2 `groups/*.test.ts`, and `authz-sweep.test.ts`).
- `pnpm exec prettier --check apps/server/src/avatars/service.ts apps/server/src/backgrounds/service.ts`
  → `All matched files use Prettier code style!`.
- `pnpm gate` (from the repo root) summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.8s)
  PASS  format  (25.9s)
  PASS  lint  (1.0s)
  PASS  typecheck  (0.8s)
  PASS  tests @zilar/server  (2070.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Every listed test is unchanged.

### Problems / environment notes

- The sandbox restarted several times mid-command and killed the first `pnpm gate`
  runs (one ended `GATE_EXIT=143`, SIGTERM). The final run above was launched
  detached (`nohup`) and completed with `GATE PASS`. No code change was needed for
  that; it was purely the environment.
- `tests @zilar/server` took ~34.5 minutes because the machine is shared and
  `--changed main` selects the broad server set (the branch has no commits past
  `main` at the time of the run). Not a failure.

### Deviations / open questions

- No deviations from the spec.
- The tests were not modified in any way.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (18:11) is newer than HEAD cc0090a8.
- **No test file changed.**
- **Lead check:**
  - both services have only type imports from the schema;
  - the avatar replace and delete transactions keep the `avatar:<kind>:<owner>` lock, and the background upload keeps the `background:<user>` lock with the cap inside it;
  - the cascading delete is one `withTransaction`;
  - the gate passes.
- **Note:** the worker ran the gate detached; workers run it in the foreground.
