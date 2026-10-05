---
id: T-0208
title: Lead tooling: pre-reviews and the doctor run on the free Muse listing (opencode/muse-spark-1.3-contributor-free)
status: planned
milestone: M5
branch: task/T-0208-reviews-on-free-muse
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0208: Pre-reviews and the doctor on the free Muse listing

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05, after the lead's benchmark of free models: "if we can use the free muse... use that then!". The same model, `muse-spark-1.3-contributor`, is offered free through OpenCode as `opencode/muse-spark-1.3-contributor-free`; it scored 5/5 on the lead's 5 hard prompts and was the fastest. Workers move to it through their spec's `model:` line; the pre-review and the doctor have the model hardcoded, so they need this change.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/start-prereview.ts` line 9: `export const PREREVIEW_MODEL = { providerID: 'meta', id: 'muse-spark-1.3-contributor' };`
- `packages/devtools/src/lead/doctor.ts` line 12: `export const DOCTOR_MODEL = { providerID: 'meta', id: 'muse-spark-1.3-contributor' };`
- `packages/devtools/src/lead/doctor.test.ts` lines 252-255 assert the doctor's model equals `{ providerID: 'meta', id: 'muse-spark-1.3-contributor' }`. No test asserts `PREREVIEW_MODEL` today.
- The lead checked that `opencode2 run -m "opencode/muse-spark-1.3-contributor-free#low"` (also `#high`, `#default`) answers.

### What to build
1. Set both constants to `{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }`.
2. Update the assertion in `doctor.test.ts` (lines 252-255) to the new value.
3. Add one test (in a new `packages/devtools/src/lead/start-prereview.test.ts`) that `PREREVIEW_MODEL` equals the new value.
4. Change nothing else (the cost guard `isCostlyMetaModel` in `task-file.ts` stays as it is).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/start-prereview.ts`, `packages/devtools/src/lead/doctor.ts` (lines 1-20), `packages/devtools/src/lead/doctor.test.ts` (lines 240-260).

### Allowed files
`packages/devtools/src/lead/start-prereview.ts`, `packages/devtools/src/lead/start-prereview.test.ts` (new), `packages/devtools/src/lead/doctor.ts`, `packages/devtools/src/lead/doctor.test.ts`, `work/T-0208-reviews-on-free-muse.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts src/lead/start-prereview.test.ts
pnpm gate
```

### Acceptance
- Both constants point at the free listing; the two tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Fallback to the billed model on quota errors, any other model setting.

---

## Report (written by the worker when done)

## Review (written by Claude)
