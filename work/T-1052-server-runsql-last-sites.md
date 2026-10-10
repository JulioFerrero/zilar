---
id: T-1052
title: "Dedup F1 (S1): the last service-level sqlRuntimeFor(db).runPromise calls use runSql"
status: todo
milestone: M5
branch: task/T-1052-server-runsql-last-sites
model: auto
effort: default
depends_on: [T-1051]
estimate: 0.1 day
---

# T-1052: The last `runSql` sites

## Spec (written by Claude, do not edit)

### Why
`docs/audit/dedup-status.md` §1 (slice S1): `apps/server/src/effect/sql.ts:111` `runSql(db, effect)` is exactly `sqlRuntimeFor(db).runPromise(effect)`. Four service files still call the runtime directly (lead read, main 2026-10-10):
- `apps/server/src/blocks/service.ts:138`
- `apps/server/src/pins/service.ts:129`
- `apps/server/src/roles/service.ts:84`
- `apps/server/src/voice-transcription/pipeline.ts:157`

### What to build
1. **The swap:** in each of the four files, replace `sqlRuntimeFor(X).runPromise(Y)` with `runSql(X, Y)`. Keep the argument expression exactly as it is (for example `insert.pipe(Effect.mapError(mapPinError))` in pins).
2. **Imports:** drop `sqlRuntimeFor` from each file's `../effect/sql` import once it has no other use there (`grep` first). `blocks`, `pins` and `roles` already import `runSql`.
3. **Out of scope, do not touch:**
   - `apps/server/src/pins/access.ts:48` and `apps/server/src/auth/sql-adapter.ts:155` (permissions and auth files);
   - `apps/server/src/app.ts:597` and `apps/server/src/db/migrate.ts:9`;
   - `apps/server/src/test-support.ts`.

### Read first
`AGENTS.md`, `apps/server/src/effect/sql.ts:95-120`, and the four files.

### Allowed files
`apps/server/src/blocks/service.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/roles/service.ts`, `apps/server/src/voice-transcription/pipeline.ts`, `work/T-1052-server-runsql-last-sites.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- `grep -rn "sqlRuntimeFor(" apps/server/src --include=*.ts | grep -v test` lists only `effect/sql.ts`, `app.ts`, `db/migrate.ts`, `pins/access.ts`, `auth/sql-adapter.ts` and `test-support.ts`.

---

## Report (written by the worker when done)

## Review (written by Claude)
