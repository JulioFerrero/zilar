---
id: T-0958
title: "Size split T8: apps/server/src/stickers/service.ts (1,388 lines) into stickers/{schemas,packs,panel,favorites,storage,telegram}.ts, the old path a barrel; its own 8 runPromise sites onto runSql"
status: todo
milestone: M5
branch: task/T-0958-split-server-stickers-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0958: Split `stickers/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/stickers/service.ts` is 1,388 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #5 (task T8): `stickers/schemas.ts`, `stickers/packs.ts`, `stickers/panel.ts`, `stickers/favorites.ts`, `stickers/storage.ts`, `stickers/telegram.ts`, under `apps/server/src/`. `stickers/service.ts` becomes the barrel. The existing `stickers/telegram-import.ts` stays as it is.

The entry's Dedup is in scope, because it stays inside this file: the 8 `sqlRuntimeFor(deps.db).runPromise(…)` sites move onto `runSql` from `apps/server/src/effect/sql.ts:111`, the way the other services already call it (see any `*/service.ts` that imports `runSql`). The behaviour, including errors, must stay the same.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #5, `apps/server/src/stickers/service.ts`, and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/stickers/service.ts`, `apps/server/src/stickers/schemas.ts`, `apps/server/src/stickers/packs.ts`, `apps/server/src/stickers/panel.ts`, `apps/server/src/stickers/favorites.ts`, `apps/server/src/stickers/storage.ts`, `apps/server/src/stickers/telegram.ts`, `work/T-0958-split-server-stickers-service.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for, plus the 8 `runSql` sites with their old and new lines.

---

## Report (written by the worker when done)

## Review (written by Claude)
