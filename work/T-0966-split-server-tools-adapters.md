---
id: T-0966
title: "Size split T21: apps/server/src/tools/adapters.ts (944 lines) into tools/{tool-adapters,tool-arg-schemas,routine-adapters,adapter-support}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0966-split-server-tools-adapters
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0966: Split `tools/adapters.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/tools/adapters.ts` is 944 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #17 (task T21): `tools/tool-adapters.ts` (312–768), `tools/routine-adapters.ts` (167–215 and 769–932) and `tools/adapter-support.ts` (108–311 and 933–944), under `apps/server/src/`. `tools/adapters.ts` becomes the barrel.

- **One more split** (`split-rules.md` item 4): `tool-adapters.ts` would be about 456 lines, so its arg schemas go to `tools/tool-arg-schemas.ts`.
- **Skip the Dedup items.** They cross files: `truncateChars`, the hosts set-compares against `tools/hosts.ts` (which T-0955 just created), and the 503 mapping belong to the F tasks.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #17, and `apps/server/src/tools/adapters.ts`.

### Allowed files
`apps/server/src/tools/adapters.ts`, `apps/server/src/tools/tool-adapters.ts`, `apps/server/src/tools/tool-arg-schemas.ts`, `apps/server/src/tools/routine-adapters.ts`, `apps/server/src/tools/adapter-support.ts`, `work/T-0966-split-server-tools-adapters.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
