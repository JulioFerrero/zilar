---
id: T-0208
title: Lead tooling: pre-reviews and the doctor run on the free Muse listing (opencode/muse-spark-1.3-contributor-free)
status: merged
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

Did exactly what the spec asked:
- `packages/devtools/src/lead/start-prereview.ts`: `PREREVIEW_MODEL` now `{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }`.
- `packages/devtools/src/lead/doctor.ts`: `DOCTOR_MODEL` now `{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }`.
- `packages/devtools/src/lead/doctor.test.ts`: model assertion updated to the new value.
- New `packages/devtools/src/lead/start-prereview.test.ts`: asserts `PREREVIEW_MODEL` equals the new value.
- Changed nothing else (`isCostlyMetaModel` untouched).

Security checklist: no secrets/tokens touched; no deletes/updates, caps, permissions, routes, or audit entries involved — N/A for this model-constant change.

Commands (real results):
- `pnpm install`: exit 0 (11.7s).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts src/lead/start-prereview.test.ts`: 2 files passed, 19 tests passed.
- `pnpm gate` (repo root): GATE PASS. Summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (13.0s)`
  - `PASS  lint  (1.5s)`
  - `PASS  typecheck  (3.1s)`
  - `PASS  tests @zilar/devtools  (1.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

No deviations, no open questions.

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review. `PREREVIEW_MODEL` and `DOCTOR_MODEL` now point at `{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }`; the doctor test is updated and a new test pins the pre-review model. The lead read the full diff (5 lines of code, one new test file). First task done end to end on the free Muse listing. The autopilot is restarted after the merge so new pre-reviews and doctor runs use it.
