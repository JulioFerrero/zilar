---
id: T-0335
title: "Autopilot: a worker fix round that hits a free-model rate limit while the task is in review falls back to the paid Muse"
status: merged
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

Did: added the worker in-place fallback at the start of the review branch in
`decide()` (paid model returns `undefined` from `fallbackModel`, so the
existing "quota handling only applies to todo/in-progress" test still passes
unchanged), three new review-quota tests, and one sentence in
`docs/LEAD_HANDOFF.md` (line 24).

Changed files (all inside Allowed files):
- `packages/devtools/src/lead/decide.ts` — review branch now calls
  `pushWorkerFallback` and returns when `quotaError` and
  `fallbackModel(record.model)` is defined, before pre-review logic.
- `packages/devtools/src/lead/decide.test.ts` — 3 new tests: review/idle/free
  + quota error → worker fallback to paid Muse + FALLBACK line, no send-prompt;
  DeepSeek flash + quota error → same fallback; review/idle/free without quota
  error → no worker fallback, `start-prereview` unchanged.
- `docs/LEAD_HANDOFF.md` — FALLBACK sentence now mentions fix rounds in review (T-0335).
- `work/T-0335-autopilot-review-fallback.md` — this report.

Commands (real results):
- `pnpm install`: ok (10.9s).
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot decide`:
  1 file, 42 passed (39 existing + 3 new).
- `pnpm gate`: PASS install (1.4s), format (17.8s), lint (1.4s), typecheck
  (3.4s), tests @zilar/devtools (1.0s); "scope: every changed file is inside
  the Allowed files"; GATE PASS; 4 changed files against main.

Security checklist: no secrets/logs changes; no deletes/updates; no caps or
uniqueness rules; no permission changes; no new routes; audit untouched. Only
behaviour change: a quota error in `review` falls back in place instead of
going idle, using the existing FALLBACK escalation.

Problems / deviations: none. Spec followed as written.

status: review

## Review (written by Claude)

**Approved** (pre-review clean, 0 nits). In `review` status, a worker quota error now falls back in place (free Muse or DeepSeek flash to paid Muse), before the pre-review logic. It cannot loop: after the switch, `record.model` is the paid model, which has no fallback. The new tests cover free Muse, DeepSeek and the no-quota case, and the existing "review + paid model" test still passes. `LEAD_HANDOFF.md` notes the new coverage. The lead restarts the autopilot after the merge.
