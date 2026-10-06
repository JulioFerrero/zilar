---
id: T-0335
title: "Autopilot: a worker fix round that hits a free-model rate limit while the task is in review falls back to the paid Muse"
status: todo
milestone: M5
branch: task/T-0335-autopilot-review-fallback
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0335: fallback for fix rounds in review

## Spec (written by Claude, do not edit)

### Why
On 2026-10-06, T-0332's automatic fix round started in a fresh worker session on the free Muse, hit the rate limit and went idle (`lead status`: `idle/failed`). Nothing happened for 25 minutes: no `FALLBACK` line and no `STALLED` line. The lead had to switch the model by hand.

The cause is in `packages/devtools/src/lead/decide.ts`:
- the in-place worker fallback (`pushWorkerFallback`) runs only for `planned` tasks (lines 241-247) and for `todo`/`in-progress` tasks (lines 249-259);
- during a fix round the task stays `status: review`, and the review branch (lines 188-239) never looks at `input.quotaError`.

### Verified facts (do not re-derive)
- **`decide.ts`:**
  - `DecideInput` (lines 21-43) has `quotaError` (for the worker session), `taskStatus`, `sessionState` and `record` (`record.model` is the worker's model);
  - `pushWorkerFallback(from, to)` (lines 119-124) pushes `{ kind: 'fallback-model', session: 'worker', model: to }` and escalates `LEAD: FALLBACK <task> <label> failed or rate-limited, worker continues on paid Muse`;
  - `fallbackModel` is imported from `./fallback.js` (line 2), and returns `undefined` for the paid model;
  - the review branch starts at line 188: `if (input.taskStatus === 'review' && input.sessionState === 'idle') {`.
- **`autopilot.ts`, around lines 168-185:** a `fallback-model` action for the worker switches the session's model in place and sends the `resume` prompt.
- **`packages/devtools/src/lead/decide.test.ts`:**
  - lines 218-224: "quota handling only applies to todo/in-progress" (review, paid model, quota error → no `send-prompt`). It must still pass: the paid model has no fallback.
  - lines 226-243 show how a fallback test is written.

### What to build
1. **`decide.ts`:** at the start of the review branch (line 188), before the pre-review logic, if `input.quotaError` is true and `fallbackModel(input.record.model)` is defined, call `pushWorkerFallback(input.record.model, fallback)` and return.
2. **New tests in `decide.test.ts`:**
   - review, idle, free Muse, quota error → a worker `fallback-model` to `meta/muse-spark-1.3-contributor`, plus the FALLBACK line;
   - review, idle, `deepseek/deepseek-flash`, quota error → falls back too;
   - review, idle, free Muse, no quota error → no worker fallback, and the existing pre-review behaviour is unchanged.
3. Update `docs/LEAD_HANDOFF.md` with one sentence where the FALLBACK line is described (line 16 or 24): it now also covers fix rounds while the task is in review.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/fallback.ts`, `packages/devtools/src/lead/decide.test.ts:130-270` and `:294-430`.

### Allowed files
`packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/decide.test.ts`, `docs/LEAD_HANDOFF.md`, `work/T-0335-autopilot-review-fallback.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot decide
pnpm gate
```

### Acceptance
- A worker session that hits a quota error while the task is `review` falls back in place to the paid Muse, and the new tests prove it.
- The existing decide tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
