---
id: T-1018
title: "Size split T90: apps/server/src/machines/service.ts (476 lines) into machines/{pairing,machines,crypto,view}.ts, the old path keeps constants and re-exports"
status: todo
milestone: M5
branch: task/T-1018-split-server-machines-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1018: Split `machines/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/machines/service.ts` is 476 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #86 (task T90): `machines/pairing.ts`, `machines/machines.ts`, `machines/crypto.ts`, `machines/view.ts`, under `apps/server/src/`. `machines/service.ts` keeps the constants, `MachineServiceError` and re-exports of every name it exports today. The folder already holds `api.ts`, `codes.ts`, `hub.ts` and `registry.ts`; leave them as they are.

Move the code unchanged, and skip both Dedup items, because they cross files. The pairing code and `crypto.ts` are keys code (pairing codes, fingerprints, machine secrets), so not one line of their logic changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #86, and `apps/server/src/machines/service.ts`.

### Allowed files
`apps/server/src/machines/service.ts`, `apps/server/src/machines/pairing.ts`, `apps/server/src/machines/machines.ts`, `apps/server/src/machines/crypto.ts`, `apps/server/src/machines/view.ts`, `work/T-1018-split-server-machines-service.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
