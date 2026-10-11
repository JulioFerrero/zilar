---
id: T-1093
title: "Audit: status of every docs/audit/simplify-plan.md item on main (done / partly / open), with evidence and the next slices for the open low-risk ones"
status: merged
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

**What I did.** Wrote `docs/audit/simplify-status.md` (169 lines, under the 300
cap): one table per phase of `docs/audit/simplify-plan.md` §3 (41 rows), with the
columns **#**, **item**, **status**, **evidence** (`file:line` on main plus the
merged task ids) and **what is left** (files and changed-line estimates for every
`partly` / `open` row), then a **Next slices** section and the required 0.5 mock
check. No code changed.

**Result of the audit.** 32 done, 6 partly, 3 open. Everything in Phases 0, 1, 3,
4, 5 and 6 is done except 0.2 (search-debounce constant still copied per app),
0.4 (mobile windowing, medium risk), 1.5 (kept by Julio's decision) and 3.3 (the
web API transports are still hand-written). Phase 2 is where the work is: 2.1,
2.2 and 2.5 are done, 2.3 (rate-limit factory), 2.4 (`HttpError`-as-defect), 2.7
(crypto envelope, `scrubTokenText`) are partly, and 2.6 (`groups/access.ts`) and
2.8 (error-code constructors) are open.

**Files changed.**
- `docs/audit/simplify-status.md` (new).
- `work/T-1093-simplify-plan-status.md` (status + this Report).

**Commands I ran (real results).**
- `pnpm install`: done, "Done in 10.6s" (one pre-existing peer warning: `@types/react-dom` 19.3.0 vs `@types/react` 19.2.18).
- `pnpm --filter @zilar/web build`: "✓ built in 1.02s", 34 files in `apps/web/dist/assets`.
- `grep -rl "Acme Announcements" apps/web/dist`: no output (the string is in `packages/mock-backend/src/domains/*/seed.ts`), so the web release bundle has no mock backend. Same for `Not worth faking` and `AMD Ryzen 9 7950X`.
- `pnpm gate`: `gate: 2 changed file(s) against main`; `PASS install (frozen) (1.0s)`, `PASS format (1.1s)`, `PASS lint (1.0s)`, `PASS typecheck (1.3s)`, `SKIP effect (no source files changed)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. No test run was needed (docs only).
- I ran no single test file: the change is docs-only, so `pnpm gate` is the only check.

**Deviations from the spec.** None. I did not run the apps beyond the one web
build and I changed no code. The mobile side of 0.5 is code inspection only,
because the spec forbids building the app; that is stated in the doc.

**Open questions.** None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:** a new `docs/audit/simplify-status.md` (169 lines) with one row per item of the 41 in `simplify-plan.md`: 32 done, 6 partly and 3 open, each with `file:line` and task ids.
- **Mock bundle check:** `pnpm --filter @zilar/web build`, then a grep of `dist` for seed-only strings, finds nothing, so the web release build carries no mock backend. Mobile is checked by inspection: guarded `require`s.
- **Next slices N1-N7:** the security-flagged items (2.3, 2.6, the rest of 2.7, S15) and 0.4 are kept out.
- **The lead's plan for the night:** N2, N7 and N3-N5. N1 waits for Julio, because it changes client-visible codes.
- **Check:** the gate passed.
