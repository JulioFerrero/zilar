---
id: T-XXXX
title: Short title
status: todo            # planned | todo | in-progress | blocked | review | changes-requested | approved | merged
milestone: M0
branch: task/T-XXXX-short-name
model: deepseek/deepseek-v4-pro
depends_on: []
estimate: 1 day
---

# T-XXXX: Short title

## Spec (written by Claude, do not edit)

### Goal
What this task delivers, in 2–4 sentences, and why it matters.

### Read first
- `docs/PROJECT_PLAN.md` §X.Y (the relevant sections only)
- Any existing files the worker must understand

### Allowed files
Only create or edit these. Anything else goes in the Report as a question.
- `path/to/folder/**`
- `path/to/file.ts`

### Steps and hints
1. …
2. …

### Acceptance criteria
- [ ] Criterion that can be checked, e.g. "`pnpm test` passes with tests for X and Y"
- [ ] …

### Checks (all must pass)
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

### Out of scope
- Things the worker must NOT do in this task.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
- `pnpm test`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:** approved / changes requested

### Findings
-

### Follow-ups
-
