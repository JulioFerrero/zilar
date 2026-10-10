---
id: T-0883
title: "Web panels: one roleLabel/GroupAiRow/pick-row and one set of shared tagged errors instead of copies in GroupPanel, ChannelPanel, TopicPanel and others"
status: todo
milestone: M5
branch: task/T-0883-web-panels-dedupe
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0883: Web panels: one roleLabel/GroupAiRow/pick-row and one set of shared tagged errors instead of copies in GroupPanel, ChannelPanel, TopicPanel and others

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding D-W4 in `docs/audit/simplify-2026-10-09/D-web.md` (read it for the exact sites).
- **Panel copies:** `GroupPanel` and `ChannelPanel` duplicate `roleLabel`, `GroupAiRow` and the error plumbing.
- **Tagged errors:** there are 35 local `Data.TaggedError` classes; `StoreFailed` is declared 3 times, `KeyMissing` and `SaveFailed` twice each.
- **Pick rows:** the checkbox-plus-avatar pick row is hand-rolled 5 times.
- **Big components:** `TopicPanel` is 1,170 lines with one 700-line body.

Estimate: 300-500 lines removable.

Line numbers come from the audit and may have moved since: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Extract the duplicated helpers and components into `apps/web/src/components/panels/` (or the existing kit folder, if that is where similar pieces live), with the same rendered output.
2. Use one shared module for the repeated tagged errors.
3. Split `TopicPanel`'s 700-line body into named sub-components in the same file or folder, without changing behaviour.

Do not touch `MessageBubble`, `Composer`, `ChatView` or the store; other tasks own them. Count the lines removed.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`), the audit section and task Reports cited above, and the files listed.

### Allowed files
`apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/ChannelPanel.tsx`, `apps/web/src/components/TopicPanel.tsx`, `apps/web/src/components/AiPanel.tsx`, `apps/web/src/components/panels/**`, `apps/web/src/components/*Panel*.tsx`, `apps/web/src/components/*.test.tsx`, `apps/web/src/lib/errors.ts`, `work/T-0883-web-panels-dedupe.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web test --reporter=dot
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit. The machine is shared, so note `uptime` next to any timing.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Lines removed (and every other number the spec asks for) are in the Report, measured.

---

## Report (written by the worker when done)

## Review (written by Claude)
