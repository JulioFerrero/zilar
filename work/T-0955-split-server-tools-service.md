---
id: T-0955
title: "Size split T10: apps/server/src/tools/service.ts (1,200 lines) into tools/{queries,mutations,hosts,runner}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0955-split-server-tools-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0955: Split `tools/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/tools/service.ts` is 1,200 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #7 (task T10): `tools/queries.ts`, `tools/mutations.ts`, `tools/hosts.ts`, `tools/runner.ts`, under `apps/server/src/`. `tools/service.ts` becomes the barrel.

The entry's Dedup of `hostsEqual` applies only inside these files.

This is permissions code (tool hosts and approvals), so it is crucial: move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #7, and `apps/server/src/tools/service.ts`.

### Allowed files
`apps/server/src/tools/service.ts`, `apps/server/src/tools/queries.ts`, `apps/server/src/tools/mutations.ts`, `apps/server/src/tools/hosts.ts`, `apps/server/src/tools/runner.ts`, `work/T-0955-split-server-tools-service.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
