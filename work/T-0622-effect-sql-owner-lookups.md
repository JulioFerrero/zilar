---
id: T-0622
title: "effect/sql: the owner and owner-email lookups in integrations/routes.ts and voice-transcription/routes.ts off drizzle (isOwner twice, ownerEmailFor); same answers, same 404; tests unchanged"
status: todo
milestone: M5
branch: task/T-0622-effect-sql-owner-lookups
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.25 day
---

# T-0622: owner lookups on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive)
- **`apps/server/src/integrations/routes.ts`** has two statements, the only drizzle use in that file (imports at 10 and 17):
  - `isOwner` (76-83): the first user by `created_at`, then `id`; `true` when that is `userId`;
  - `ownerEmailFor` (187-197): the email by id; a missing row throws `notFound()` (404 `not_found`).
- **`apps/server/src/voice-transcription/routes.ts`** has a copy of `isOwner` (89-96), the only drizzle use in that file (imports at 43 and 49).
- **The table is `"user"`** (`apps/server/src/auth/auth-schema.ts:4`; a reserved word, so quote it in SQL), with the columns `id`, `email` and `created_at`.
- **Callers** pass the top-level `db`, never a transaction: `integrations/api.ts:158,194,277,427` and `voice-transcription/api.ts:441,474`. Keep each signature, `db: ServerDatabase` included.

### What to build
1. Move the three functions to effect/sql in their own files, with the same ordering (`ORDER BY created_at ASC, id ASC LIMIT 1`), the same answers and the same 404. Neither file keeps a value import from `drizzle-orm` or `db/schema`.
2. **Tests:** everything under `apps/server/src/integrations` and `apps/server/src/voice-transcription` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), and the two routes files.

### Allowed files
`apps/server/src/integrations/routes.ts`, `apps/server/src/voice-transcription/routes.ts`, `work/T-0622-effect-sql-owner-lookups.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/integrations src/voice-transcription
pnpm gate
```

### Acceptance
- The three lookups run on effect/sql with the same behaviour.
- Every test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
