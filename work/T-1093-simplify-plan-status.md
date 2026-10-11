---
id: T-1093
title: "Audit: status of every docs/audit/simplify-plan.md item on main (done / partly / open), with evidence and the next slices for the open low-risk ones"
status: todo
milestone: M5
branch: task/T-1093-simplify-plan-status
model: auto
effort: default
depends_on: [T-1092]
estimate: 0.25 day
---

# T-1093: Simplify plan status (audit, docs only)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/simplify-plan.md` §3 (`:60-140`) lists the simplify programme in seven phases:
- **Phase 0:** bugs and cheap performance, 0.1-0.8;
- **Phase 1:** deletions, 1.1-1.5;
- **Phase 2:** server boilerplate, 2.1-2.8;
- **Phase 3:** one API contract, 3.1-3.4;
- **Phase 4:** one client core, 4.1-4.4;
- **Phase 5:** tests and CI, 5.1-5.7;
- **Phase 6:** build and runtime, 6.1-6.5.

Many tasks since 2026-10-09 carried out parts of it (for example T-1052 `runSql`, T-1055 `handler()`, the mock rebuild, and the 400-line splits). The plan has no status column, so the lead cannot tell what is left without guessing. Some items are Julio's decisions: 1.4, 1.5, the failed send in 0.2, and the security dedups listed in `docs/audit/dedup-status.md` §8.

### What to build
Write a new doc, `docs/audit/simplify-status.md` (at most 300 lines). It has one table per phase with the columns **#**, **item**, **status**, **evidence** and **what is left**.
- **status** is `done`, `partly` or `open`.
- **evidence** is `file:line` on main, plus the merged task ids when `git log --oneline --grep` finds them.
- **what is left** is concrete. For each `partly` or `open` item, give the files and an estimate in changed lines.

Then a section "**Next slices**": the open or partly-done items that are low risk and need no decision from Julio, in a sensible order. Each one is at most about 800 changed lines, with its Allowed files as full repo paths. Mark plainly the items that touch auth, keys, permissions, money or the message pipeline.

**Check, do not assume.** For 0.5 (the mock backend out of the production bundles), say how each app keeps `@zilar/mock-backend` out of a release build today, with `file:line` (for example `apps/web/src/mock/load.ts` and the guarded `require('@/mock/backend')` in the mobile hooks), and whether `vite build` output still contains it. You may run `pnpm --filter @zilar/web build` and grep the output for a string unique to the mock backend; report the command and the result.

Do not change code. Do not run the apps beyond that one web build.

### Read first
`AGENTS.md`, `docs/audit/simplify-plan.md`, `docs/audit/dedup-status.md`, `docs/audit/size-plan.md`, and `git log --oneline -400`.

### Allowed files
`docs/audit/simplify-status.md`, `work/T-1093-simplify-plan-status.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Every plan item has a row, and every status has evidence.

---

## Report (written by the worker when done)

## Review (written by Claude)
