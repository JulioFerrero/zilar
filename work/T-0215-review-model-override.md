---
id: T-0215
title: Lead tooling: ZILAR_REVIEW_MODEL overrides the pre-review and doctor model (fallback when the free Muse is rate-limited)
status: planned
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

## Review (written by Claude)
