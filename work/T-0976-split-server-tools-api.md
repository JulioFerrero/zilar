---
id: T-0976
title: "Size split T29: apps/server/src/tools/api.ts (799 lines) into tools/{routes,wire,access}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0976-split-server-tools-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0976: Split `tools/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/tools/api.ts` is 799 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #25 (task T29): `tools/routes.ts` (the HttpApi group handlers), `tools/wire.ts` (the wire mappers plus the body and limit helpers) and `tools/access.ts` (`toolAccess`, `requireReadable*`, `listToolsForGroup`, `findOwnedAiRow`, `findMembership`), under `apps/server/src/`. `tools/api.ts` becomes the barrel.

Skip the entry's Dedup: the `withServiceErrors` swap and the ais and groups query copies cross files. `access.ts` is permissions code, so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #25, and `apps/server/src/tools/api.ts`.

### Allowed files
`apps/server/src/tools/api.ts`, `apps/server/src/tools/routes.ts`, `apps/server/src/tools/wire.ts`, `apps/server/src/tools/access.ts`, `work/T-0976-split-server-tools-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
