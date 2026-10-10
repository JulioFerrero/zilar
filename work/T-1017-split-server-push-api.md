---
id: T-1017
title: "Size split T89: apps/server/src/push/api.ts (484 lines) into push/{api-handlers,api-subscribe,api-util}.ts, api.ts keeps deps, group and mount"
status: todo
milestone: M5
branch: task/T-1017-split-server-push-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1017: Split `push/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/push/api.ts` is 484 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #85 (task T89): `push/api-handlers.ts`, `push/api-subscribe.ts`, `push/api-util.ts`, under `apps/server/src/`. `push/api.ts` keeps the deps, the group declaration, the layer, the mount and every export it has today.

Move the code unchanged, and skip all three Dedup items:
- `isUniqueViolation` and `errorName` cross files;
- the room-sync helper would merge three code paths, which is a separate task.

The subscribe handler stores the device's push keys, so not one line of its logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #85, and `apps/server/src/push/api.ts`.

### Allowed files
`apps/server/src/push/api.ts`, `apps/server/src/push/api-handlers.ts`, `apps/server/src/push/api-subscribe.ts`, `apps/server/src/push/api-util.ts`, `work/T-1017-split-server-push-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
