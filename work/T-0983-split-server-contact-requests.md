---
id: T-0983
title: "Size split T40: apps/server/src/contact-requests/service.ts (730 lines) into contact-requests/{queries,reads,errors}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0983-split-server-contact-requests
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0983: Split `contact-requests/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/contact-requests/service.ts` is 730 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #36 (task T40): `contact-requests/queries.ts`, `contact-requests/reads.ts`, `contact-requests/errors.ts`, under `apps/server/src/`. `contact-requests/service.ts` becomes the barrel.

Move the code unchanged, and skip both Dedup items:
- `isUniqueViolation` crosses files;
- the pending-insert helper would change the SQL code paths, which is a separate task with tests.

Who can send, accept and block requests is permissions code.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #36, and `apps/server/src/contact-requests/service.ts`.

### Allowed files
`apps/server/src/contact-requests/service.ts`, `apps/server/src/contact-requests/queries.ts`, `apps/server/src/contact-requests/reads.ts`, `apps/server/src/contact-requests/errors.ts`, `work/T-0983-split-server-contact-requests.md`.

### Checks
```bash
pnpm gate
```
Also run any kept server test that imports `contact-requests` (find them with grep), with `--reporter=dot`, and list them.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
