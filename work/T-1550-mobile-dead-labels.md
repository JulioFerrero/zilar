---
id: T-1550
title: "Phone dead code after the lean UI tasks: delete runStateLabel, formatLimits, SCREEN_DECISIONS, approvalStatusLabel, and the topic strip labels (topicTypeLabel, topicStatusLabel, topicOwnerLabel with TYPE_LABEL and STATUS_LABEL); nothing imports them"
status: merged
milestone: M5
branch: task/T-1550-mobile-dead-labels
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1550: Phone dead labels

## Spec (written by Claude, do not edit)

### Why
The lean UI tasks removed every status word from the phone:
- approvals (T-1513);
- My AIs health (T-1517);
- the topic marks and the task strip (T-1539, T-1540).

Their helpers are now unused. The lead ran `git grep -n "\b<name>\b" -- apps/mobile/src packages` on main on 2026-10-15: each name below appears only at its own definition.

### What to delete
- `runStateLabel` and its doc comment: `apps/mobile/src/components/ais/run-state.ts:25-39`. Keep the rest of the file. If nothing else is left in it, delete the file and say so.
- `formatLimits` and its doc comment: `apps/mobile/src/components/ais/limits.ts:11-24`. Keep the re-export line `:9`.
- `SCREEN_DECISIONS` and its doc comment: `apps/mobile/src/components/approvals/rows.ts:93-106`.
- `approvalStatusLabel`: `apps/mobile/src/lib/approval-state.ts:15-30`.
- In `apps/mobile/src/lib/topics.ts`:
  - `TYPE_LABEL` (`:156-162`) and `topicTypeLabel` (`:164-173`);
  - `STATUS_LABEL` (`:175-181`) and `topicStatusLabel` (`:183-186`);
  - `topicOwnerLabel` (`:188-195`).
  
  Keep `httpsTopicUrl` and everything else.

### Steps
1. Before deleting each name, run `git grep -n "\b<name>\b" -- apps packages` again; if anything other than its definition uses it, keep it and say so in the Report.
2. Remove imports that become unused, such as `TopicKind` or `TopicStatus` in `topics.ts`, `formatLimit` in `limits.ts`, or `ApprovalDecision` in `rows.ts`. Typecheck and lint will tell you.
3. **No behaviour change.**

### Tests
None. The nearest tests must pass; delete a test case only if it tests a deleted function, and name it in the Report.

### Allowed files
- `apps/mobile/src/components/ais/run-state.ts`
- `apps/mobile/src/components/ais/limits.ts`
- `apps/mobile/src/components/approvals/rows.ts`
- `apps/mobile/src/lib/approval-state.ts`
- `apps/mobile/src/lib/topics.ts`
- any `*.test.ts` next to those files that tests a deleted function
- `work/T-1550-mobile-dead-labels.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The listed names no longer exist in `apps/mobile/src`, and the gate passes.

---

## Report (written by the worker when done)

### What I did

Ran the required pre-delete check (`git grep -n "\b<name>\b" -- apps packages`) for each name before removing it. Every name appeared only at its own definition inside `apps/mobile/src`, except:
- `formatLimits` also appears at `apps/web/src/components/ais/limits.ts:12`, the web twin. It is a separate definition outside this task's Allowed files, so it was left untouched; the mobile copy was deleted.
- `STATUS_LABEL` also appears in `packages/devtools/src/plan-page/page.js`, an unrelated local constant. Left untouched.
- `TYPE_LABEL` in `topics.ts` is only read by the deleted `topicTypeLabel`; `STATUS_LABEL` only by the deleted `topicStatusLabel`.

Deleted, exactly as specified:
- `runStateLabel` and its doc comment from `apps/mobile/src/components/ais/run-state.ts`. The file keeps `RunAction` and `runAction`, so it was not deleted.
- `formatLimits` and its doc comment from `apps/mobile/src/components/ais/limits.ts`. The re-export line `:9` still exports `formatLimit`, so that import stayed.
- `SCREEN_DECISIONS` and its doc comment from `apps/mobile/src/components/approvals/rows.ts`. `ApprovalDecision` is still used by `confirmationForDecision` and others, so the import stayed.
- `approvalStatusLabel` from `apps/mobile/src/lib/approval-state.ts`. `PublicApproval` and `ApprovalDecision` remain in use.
- `TYPE_LABEL` + `topicTypeLabel`, `STATUS_LABEL` + `topicStatusLabel`, and `topicOwnerLabel` from `apps/mobile/src/lib/topics.ts`. `httpsTopicUrl` and the rest of the file are untouched.

Removed imports that became unused: `type TopicKind` and `type TopicStatus` in `apps/mobile/src/lib/topics.ts`. No other import cleanup was needed. No test case tested any deleted function, so no test was changed. No behaviour change.

### Checks run

- `pnpm install`: done, 17 workspace projects, no errors.
- Pre-delete greps: each target name showed only its own definition in `apps/mobile/src` (see Notes).
- Post-delete `git grep -nw` for the nine names under `apps/mobile/src`: exit 1 (no matches).
- `pnpm gate` (from repo root), first run: `GATE FAIL` on `format` (`[warn] apps/mobile/src/lib/topics.ts`). Fixed by running `pnpm exec prettier --write apps/mobile/src/lib/topics.ts` (collapsed the now-shorter `@zilar/chat-core` import to one line).
- `pnpm gate` (final):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (0.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (2.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- Single test files run while working: none. No test referenced a deleted function (`git grep` over `*.test.ts` found nothing), and the gate's nearest-tests step ran `@zilar/mobile` (the only package touched) green.

### Notes for the lead

- Files changed: `apps/mobile/src/components/ais/run-state.ts`, `apps/mobile/src/components/ais/limits.ts`, `apps/mobile/src/components/approvals/rows.ts`, `apps/mobile/src/lib/approval-state.ts`, `apps/mobile/src/lib/topics.ts`, plus this task file. All inside Allowed files; the gate agrees (6 changed files, all in scope).
- The web twin `apps/web/src/components/ais/limits.ts:12` has its own now-unused `formatLimits`. It is outside this task's Allowed files, so I did not touch it; a follow-up task may want to remove it.
- No blockers, no deviations from the spec.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - `git grep` finds none of `runStateLabel`, `SCREEN_DECISIONS`, `approvalStatusLabel`, `topicStatusLabel`, `topicTypeLabel` or `topicOwnerLabel` anywhere;
  - the one remaining `formatLimits` is web's (`apps/web/src/components/ais/limits.ts`).
  
  110 lines removed.
- **Follow-up:** web `formatLimits` looks unused too; it goes on the NOW list for a small web clean-up.
