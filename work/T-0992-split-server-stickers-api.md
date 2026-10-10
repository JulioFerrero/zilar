---
id: T-0992
title: "Size split T56: apps/server/src/stickers/api.ts (595 lines) into stickers/{api-handlers,api-decode,api-upload}.ts, api.ts keeps the group and mount"
status: todo
milestone: M5
branch: task/T-0992-split-server-stickers-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0992: Split `stickers/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/stickers/api.ts` is 595 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #52 (task T56): `stickers/api-handlers.ts`, `stickers/api-decode.ts`, `stickers/api-upload.ts`, under `apps/server/src/`.

- **`api.ts` keeps:** the interface, the group declaration, the layer, the mount, and every export it has today.
- **Move unchanged:** move the code as it is, and skip the Dedup, because it crosses files.
- **The upload limits:** the size cap and the type checks stay byte for byte the same.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #52, and `apps/server/src/stickers/api.ts`.

### Allowed files
`apps/server/src/stickers/api.ts`, `apps/server/src/stickers/api-handlers.ts`, `apps/server/src/stickers/api-decode.ts`, `apps/server/src/stickers/api-upload.ts`, `work/T-0992-split-server-stickers-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
