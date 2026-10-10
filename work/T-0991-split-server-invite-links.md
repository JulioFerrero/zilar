---
id: T-0991
title: "Size split T50: apps/server/src/invite-links/service.ts (631 lines) into invite-links/{tokens,queries,join}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0991-split-server-invite-links
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0991: Split `invite-links/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/invite-links/service.ts` is 631 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #46 (task T50): `invite-links/tokens.ts`, `invite-links/queries.ts`, `invite-links/join.ts`, under `apps/server/src/`. `invite-links/service.ts` becomes the barrel.

Move the code unchanged, and skip both Dedup items, because both cross files. The token hashing and the join checks are keys and permissions code: not one line of their logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #46, and `apps/server/src/invite-links/service.ts`.

### Allowed files
`apps/server/src/invite-links/service.ts`, `apps/server/src/invite-links/tokens.ts`, `apps/server/src/invite-links/queries.ts`, `apps/server/src/invite-links/join.ts`, `work/T-0991-split-server-invite-links.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
