---
id: T-0221
title: "Lead tooling: the in-place fallback also covers a worker rate-limited before it set in-progress"
status: planned
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

## Review (written by Claude)
