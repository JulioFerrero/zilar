---
id: T-0978
title: "Size split T36: apps/server/src/roles/service.ts (763 lines) into roles/{schemas,access,queries,sync}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0978-split-server-roles-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0978: Split `roles/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/roles/service.ts` is 763 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #32 (task T36): `roles/schemas.ts`, `roles/access.ts`, `roles/queries.ts`, `roles/sync.ts`, under `apps/server/src/`. `roles/service.ts` becomes the barrel.

Skip the entry's Dedup items (`isUniqueViolation`, `mapRoleError`, and the member-role reads), because they cross files. This is permissions code (`require*` and the role holders), so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #32, and `apps/server/src/roles/service.ts`.

### Allowed files
`apps/server/src/roles/service.ts`, `apps/server/src/roles/schemas.ts`, `apps/server/src/roles/access.ts`, `apps/server/src/roles/queries.ts`, `apps/server/src/roles/sync.ts`, `work/T-0978-split-server-roles-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/roles/roles.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
