---
id: T-0606
title: "effect/sql: avatars/service.ts and backgrounds/service.ts fully off drizzle, transactions included (advisory-locked replace/delete for avatars, cap check + insert and the cascading delete for backgrounds) via sql.withTransaction per the pins recipe; same rows, locks, caps and file cleanup order; tests unchanged"
status: todo
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

## Review (written by Claude)
