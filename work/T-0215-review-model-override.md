---
id: T-0215
title: Lead tooling: ZILAR_REVIEW_MODEL overrides the pre-review and doctor model (fallback when the free Muse is rate-limited)
status: merged
milestone: M5
branch: task/T-0215-review-model-override
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: []
estimate: 0.2 day
---

# T-0215: Review model override

## Spec (written by Claude, do not edit)

### Why
On 2026-10-05 the free Muse listing (`opencode/muse-spark-1.3-contributor-free`) answered 429 "Rate limit exceeded" for every session. Workers can be moved with `lead switch-model`, but the pre-review and the doctor have their model hard-coded (T-0208), so every pre-review stalls until the limit clears. The lead needs to point them at the billed fallback `meta/muse-spark-1.3-contributor` by restarting the autopilot with an environment variable.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/start-prereview.ts` line 9: `export const PREREVIEW_MODEL = { providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' };`, used at line 41 (`model: PREREVIEW_MODEL`).
- `packages/devtools/src/lead/doctor.ts` line 12: `export const DOCTOR_MODEL = { ... same ... };`, used at line 128.
- `packages/devtools/src/lead/task-file.ts`: `splitModel(model)` (lines 33-39) turns `provider/model` into `{ providerID, id }` and throws on a bad shape; `assertAllowedModel(model)` (line 61) refuses banned and costly models.
- Tests: `packages/devtools/src/lead/start-prereview.test.ts` asserts `PREREVIEW_MODEL`; `packages/devtools/src/lead/doctor.test.ts` lines 252-255 assert the doctor's model.

### What to build
1. In `packages/devtools/src/lead/task-file.ts`, a new exported function `reviewModel(env: NodeJS.ProcessEnv = process.env): { providerID: string; id: string }`: when `env.ZILAR_REVIEW_MODEL` is set and not empty, run `assertAllowedModel` on it and return `splitModel(...)` of it; otherwise return `{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }`.
2. Keep `PREREVIEW_MODEL` and `DOCTOR_MODEL` exported (as the default), but at the two use sites (start-prereview line 41, doctor line 128) use `reviewModel()` instead, read at call time (not at import time).
3. Tests in `packages/devtools/src/lead/task-file.test.ts` (or a new `packages/devtools/src/lead/review-model.test.ts`): unset gives the free default; `meta/muse-spark-1.3-contributor` gives that model; an empty string gives the default; `meta/muse-spark-1.3` (costly) throws; `nonsense` throws. One test in `packages/devtools/src/lead/start-prereview.test.ts` or `doctor.test.ts` that the session is created with the override when the env is set (restore the env after).
4. Add one line under "Commands" in `docs/LEAD_HANDOFF.md`: `ZILAR_REVIEW_MODEL=meta/muse-spark-1.3-contributor` before the autopilot command moves pre-reviews and the doctor to the billed Muse (use only while the free listing is rate-limited).

### Read first
`AGENTS.md`, `packages/devtools/src/lead/start-prereview.ts`, `packages/devtools/src/lead/doctor.ts` (lines 1-20 and 115-135), `packages/devtools/src/lead/task-file.ts` (lines 25-75).

### Allowed files
`packages/devtools/src/lead/task-file.ts`, `packages/devtools/src/lead/task-file.test.ts`, `packages/devtools/src/lead/review-model.test.ts` (new, optional), `packages/devtools/src/lead/start-prereview.ts`, `packages/devtools/src/lead/start-prereview.test.ts`, `packages/devtools/src/lead/doctor.ts`, `packages/devtools/src/lead/doctor.test.ts`, `docs/LEAD_HANDOFF.md`, `work/T-0215-review-model-override.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/task-file.test.ts src/lead/start-prereview.test.ts src/lead/doctor.test.ts
pnpm gate
```

### Acceptance
- With `ZILAR_REVIEW_MODEL=meta/muse-spark-1.3-contributor` the pre-review and doctor sessions use that model; without it they use the free listing; a costly or malformed value is refused.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Automatic fallback on a 429, worker models.

---

## Report (written by the worker when done)

### What I did
- Added `reviewModel(env = process.env)` in `packages/devtools/src/lead/task-file.ts`: returns `splitModel(env.ZILAR_REVIEW_MODEL)` after `assertAllowedModel` when the override is a non-empty string, otherwise the free Muse default `{ providerID: 'opencode', id: 'muse-spark-1.3-contributor-free' }`.
- Replaced `PREREVIEW_MODEL` at the `startPrereviewSession` call site with `reviewModel()`, and `DOCTOR_MODEL` at the `startDoctorSession` call site with `reviewModel()`. Both `PREREVIEW_MODEL` and `DOCTOR_MODEL` are still exported (the existing tests assert them), but the live path now reads the env at call time.
- Added a `reviewModel` describe block to `task-file.test.ts` covering unset, empty, valid override, costly Meta tier, and malformed value.
- Added one test to `start-prereview.test.ts` that creates the session with the override when `ZILAR_REVIEW_MODEL` is set (env restored in `afterEach`).
- Added the single-line bullet under "Commands" in `docs/LEAD_HANDOFF.md`.

### Files changed
- `packages/devtools/src/lead/task-file.ts` — new `reviewModel` export.
- `packages/devtools/src/lead/task-file.test.ts` — `reviewModel` tests.
- `packages/devtools/src/lead/start-prereview.ts` — use `reviewModel()` at the call site; export `PREREVIEW_MODEL` kept as the default.
- `packages/devtools/src/lead/start-prereview.test.ts` — override test (env saved and restored).
- `packages/devtools/src/lead/doctor.ts` — use `reviewModel()` at the call site; export `DOCTOR_MODEL` kept as the default.
- `docs/LEAD_HANDOFF.md` — one new bullet under "Commands".
- `work/T-0215-review-model-override.md` — front matter and Report.

### Commands run
- `pnpm install`: succeeded (then `git checkout pnpm-lock.yaml` to discard unrelated optional-deps churn; gate later passed with frozen lockfile).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/task-file.test.ts`: 34 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/start-prereview.test.ts`: 2 passed.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/doctor.test.ts`: 18 passed.
- `pnpm gate` (final):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (0.8s)
  PASS  format  (10.8s)
  PASS  lint  (0.5s)
  PASS  typecheck  (0.6s)
  PASS  tests @zilar/devtools  (11.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- The first gate run failed on prettier for `task-file.ts` (return-type placement); I applied prettier's preferred layout and re-ran — green.
- `pnpm install` (run before the gate per task instructions) produced unrelated `pnpm-lock.yaml` churn — restored with `git checkout pnpm-lock.yaml`; the subsequent frozen install in the gate passed.

## Review (written by Claude)

**Verdict:** Approved, clean on the first pre-review (MiniMax worker, pre-review moved to paid Muse in place after the free listing's rate limit). `reviewModel(env)` in `task-file.ts` reads `ZILAR_REVIEW_MODEL` at call time, refuses costly or malformed values through `assertAllowedModel`/`splitModel`, and both call sites (`start-prereview.ts`, `doctor.ts`) use it; the defaults stay exported; one doc line in `LEAD_HANDOFF.md`. Read the whole code diff. Accepted nit: `doctor.test.ts` would fail if the env var were set in the shell running the tests.
