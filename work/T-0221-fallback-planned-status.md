---
id: T-0221
title: "Lead tooling: the in-place fallback also covers a worker rate-limited before it set in-progress"
status: merged
milestone: M5
branch: task/T-0221-fallback-planned-status
model: minimax-coding-plan/MiniMax-M3
effort: default
depends_on: [T-0216]
estimate: 0.1 day
---

# T-0221: Fallback for a worker still at `planned`

## Spec (written by Claude, do not edit)

### Why
2026-10-05: T-0219 was launched on the free Muse and its very first turn failed with 429 before the worker edited its task file, so the task status was still `planned`. `decide` returns early for any status other than `todo` and `in-progress` (`packages/devtools/src/lead/decide.ts` lines 223-225), so the T-0216 fallback (lines 227-235) never ran and the worker sat idle. The lead switched it by hand.

### Verified facts (do not re-derive)
- `packages/devtools/src/lead/decide.ts` lines 223-225: `if (input.taskStatus !== 'todo' && input.taskStatus !== 'in-progress') { return actions; }`.
- Lines 227-235: `if (input.quotaError) { const fallback = fallbackModel(input.record.model); if (fallback !== undefined) { actions.push({ kind: 'fallback-model', session: 'worker', model: fallback }); escalate(...FALLBACK...); return actions; } ...`.
- `packages/devtools/src/lead/decide.test.ts`: `describe('decide quota backoff'` at line 133; the free-model fallback test at line 134; a `base(...)` helper builds the input (line ~38 sets `quotaError: false`).

### What to build
1. In `decide.ts`, just before the status gate at line 223, add: when `input.taskStatus === 'planned'` and `input.quotaError` and `fallbackModel(input.record.model)` is defined, push the same `fallback-model` action (session `worker`) and the same `LEAD: FALLBACK ...` escalation as lines 230-233, and return. Reuse the code (a small local function for the two pushes is fine); do not change anything else, and do not let `planned` tasks reach the nudge or retry code.
2. Tests in `decide.test.ts` (inside the quota describe): a `planned` task on the free model with a quota error gives `fallback-model` + the FALLBACK line; a `planned` task on the paid model with a quota error gives no actions; a `planned` task on the free model without a quota error gives no actions.

### Read first
`AGENTS.md`, `packages/devtools/src/lead/decide.ts` (lines 200-260), `packages/devtools/src/lead/decide.test.ts` (lines 1-60 and 130-200).

### Allowed files
`packages/devtools/src/lead/decide.ts`, `packages/devtools/src/lead/decide.test.ts`, `work/T-0221-fallback-planned-status.md`.

### Checks
```bash
pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/decide.test.ts
pnpm gate
```

### Acceptance
- A worker still at `planned` that hits a free-Muse quota error is switched in place once, like an `in-progress` one; nothing else changes for `planned` tasks.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Nudges for `planned` tasks, other models.

---

## Report (written by the worker when done)

### What I did
- Added a small `pushFreeFallback(model)` closure inside `decide()` (next to the existing `escalate` helper) that pushes the `fallback-model` action and the `LEAD: FALLBACK ...` escalation in one call. Both the existing in-progress quota branch and the new planned-quota branch now use it, so the two pushes are defined exactly once.
- Added a new branch just before the `todo`/`in-progress` status gate in `packages/devtools/src/lead/decide.ts`: if `taskStatus === 'planned'` and `quotaError` and `fallbackModel(input.record.model)` is defined, it calls `pushFreeFallback` and returns. Planned tasks with no fallback, no quota error, or both, fall through to the status gate and return `[]` (no nudge, no retry, no escalation).
- Added three tests in `packages/devtools/src/lead/decide.test.ts` inside the `decide quota backoff` describe block: planned + free Muse + quota error gives the fallback-model action and the FALLBACK line; planned + paid Muse + quota error gives `[]`; planned + free Muse + no quota error gives `[]`.
- Spec said "do not change anything else": the only out-of-scope edit was the autoformat from prettier collapsing the escalation string inside `pushFreeFallback` onto one line. The function body and behavior are identical.

### Files changed
- `packages/devtools/src/lead/decide.ts` (new `pushFreeFallback` helper + new planned-quota branch + use of the helper in the existing in-progress branch)
- `packages/devtools/src/lead/decide.test.ts` (3 new tests inside `'decide quota backoff'`)
- `work/T-0221-fallback-planned-status.md` (status + Report)

### Commands run (real outcomes)
- `pnpm install`: completed in 14s, 1053 packages installed, exit 0. Peer-dep warnings on `@types/react-dom` and a deprecation notice for 3 transitive packages — both pre-existing, not caused by this task.
- `pnpm --filter @zilar/devtools test --maxWorkers=2 --reporter=dot src/lead/decide.test.ts`: `Test Files 1 passed (1)`, `Tests 38 passed (38)`, exit 0. (Previously 35; the 3 new ones are the planned-fallback tests.)
- `pnpm gate` (after a one-shot prettier --write on my two touched files): all steps PASS, exit 0:
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (13.9s)`
  - `PASS  lint  (1.4s)`
  - `PASS  typecheck  (3.2s)`
  - `PASS  tests @zilar/devtools  (1.0s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- 3 files changed against `main`: the two source files and the task file. All inside the Allowed files.

### Problems / deviations
- The repo-wide `format:check` step (run by `pnpm gate`) flagged my new `pushFreeFallback` closure's `escalate(...)` call because prettier wanted the argument on one line. I ran prettier --write on the two files I touched (not the whole repo) to fix it; no other files were reformatted.

### Open questions
None.

## Review (written by Claude)

**Verdict:** Approved, clean first pre-review (MiniMax; pre-review switched in place by the fallback). A `planned` task with a free-Muse quota error now gets the same `fallback-model` + FALLBACK line before the status gate; the two pushes share `pushFreeFallback`; `planned` tasks reach nothing else. Read the whole `decide.ts` diff.
