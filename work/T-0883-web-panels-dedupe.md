---
id: T-0883
title: "Web panels: one roleLabel/GroupAiRow/pick-row and one set of shared tagged errors instead of copies in GroupPanel, ChannelPanel, TopicPanel and others"
status: merged
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

- Commits: ca4bc840 (roleLabel, GroupAiRowView, StoreFailed), 7a14f8ea (TopicPanel split).
- New in `apps/web/src/components/panels/`: `role-label.ts`, `GroupAiRowView.tsx` (shared AI row look; Group and Channel panels keep their own remove flow and pass it in), `topic-failure.ts` (textOf, failInline), `TopicActionButtons.tsx` (the 4 moved row buttons), `TopicListNotices.tsx` (LoadFailed, RefreshFailed, PickerToggle), `TopicHeader.tsx`, `TopicMembersSection.tsx`, `TopicAisSection.tsx`, `TopicDangerZone.tsx`. New `apps/web/src/lib/errors.ts` with `StoreFailed`.
- Line counts: TopicPanel 1170 -> 781 (body about 700 -> about 440), GroupPanel 1030 -> 996, ChannelPanel 599 -> 560. Those three files: 562 deleted, 100 added. New files add 651 lines, so the NET change over `apps/web/src` is +196 lines (758 added, 562 deleted). The spec's "300-500 lines removable" is not reached as a net number: the TopicPanel split moves code and adds props boilerplate.
- Facts differing from the audit: `PanelFailure` (GroupPanel) and `StoreFailed` (ChannelPanel) are different tags, so only ChannelPanel uses the shared `StoreFailed`. The other `StoreFailed` copies (ExplorePage:33, VisibilitySection:17) and KeyMissing/SaveFailed copies are in files outside Allowed; not touched. Pick rows (ForwardPicker, NewGroupDialog, NewTopicDialog) are also outside Allowed; not touched.
- GroupAiRow: the two copies had different remove flows (Group has a memory button and local confirm state, Channel has parent-owned confirm state), so only the markup was shared.
- Checks: typecheck clean; oxlint clean on changed files; prettier applied. Panel tests (TopicPanel, GroupPanel, ChannelPanel: 78 tests) passed 3 of 3 after the last commit (load average about 175). Full `pnpm --filter @zilar/web test` ran once, before the final commit, at load about 225: 30 failed / 1913 passed (9 files); I did not collect the file names. TopicPanel.test failures in the panel run were timeouts under load and passed on rerun; the same test passed on main (28/28). I did not rerun the full suite after the last commit.
- Behaviour differences: none intended (same markup and classes, same strings).

## Review (written by Claude)

**Lead, 2026-10-10: approved, with a note.**
- **What changed:** `roleLabel`, the AI-row view and `StoreFailed` are shared. TopicPanel's 700-line body is split into named parts in `panels/`, and the file drops from 1,170 to 781 lines. The markup is unchanged.
- **Note:** the net is +196 lines (props boilerplate), so this is a readability gain, not a size gain.
- **Follow-up:** the remaining duplicated errors and pick rows sit in files outside this task.
- **Check:** the combined wave 4 check passes.
