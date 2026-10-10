---
id: T-1024
title: "Size split T103: apps/server/src/media/indexer.ts (435 lines) into media/{extract,rows}.ts, the old path keeps the types, buildIndexQuery, senderJidFor and indexChat"
status: todo
milestone: M5
branch: task/T-1024-split-server-media-indexer
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1024: Split `media/indexer.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/media/indexer.ts` is 435 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #99 (task T103): `media/extract.ts` and `media/rows.ts`, under `apps/server/src/`. `media/indexer.ts` keeps the types, `buildIndexQuery`, `senderJidFor`, `indexChat` and re-exports of every name it exports today.

Move the code unchanged, and skip the Dedup. The local `MediaItemRow` stays as it is: swapping it for the `db/rows.ts` type is a separate check.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #99, and `apps/server/src/media/indexer.ts`.

### Allowed files
`apps/server/src/media/indexer.ts`, `apps/server/src/media/extract.ts`, `apps/server/src/media/rows.ts`, `work/T-1024-split-server-media-indexer.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
