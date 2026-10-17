---
id: T-1835
title: "General never offers 'Mark as done' (it is the whole group's room, not a piece of work): web and phone hide the done row for General; the link row stays"
status: merged
milestone: M5
branch: task/T-1835-general-no-done
model: auto
effort: default
depends_on: []
estimate: 10 min
---

# T-1835: No "Mark as done" in General

## Spec (written by Claude, do not edit)

### Why
**Web mock mode on 2026-10-17:** Dev team › General's panel offers "Mark as done" under Topic. General is the group's own room (everyone, always), so "done" doesn't apply there. The phone sheet draws the same row for every topic.

### Facts (read by the lead on 2026-10-17)
- **Web:** `apps/web/src/components/TopicPanel.tsx:233-258` is the "Topic" section, with `TopicLinkRow` and then a `ListRow` that toggles done ("Mark as done"/"Reopen"). `topic.isGeneral` is available.
- **Phone:** `apps/mobile/src/components/chat/topic-info-sheet.tsx:326` renders `<TopicDoneRow doneAt={topic.doneAt} patch={patch} onError={onPatchError} />`, and `topic.isGeneral` is available there.

### Steps
1. **Web:** render the done `ListRow` only when `topic.isGeneral !== true`. Keep the Topic section and its link row.
2. **Phone:** render `TopicDoneRow` only when `topic.isGeneral !== true`.
3. **No tests** (UI).

### Allowed files
- `apps/web/src/components/TopicPanel.tsx`
- `apps/mobile/src/components/chat/topic-info-sheet.tsx`
- `work/T-1835-general-no-done.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- General's panel and sheet show no done row.
- Other topics are unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Web:** in `apps/web/src/components/TopicPanel.tsx`, the done `ListRow` ("Mark as done"/"Reopen") in the "Topic" section now renders only when `topic.isGeneral !== true`. The section heading and `TopicLinkRow` still render for General. Extended the existing T-1534 comment to note that General has no done switch.
- **Phone:** in `apps/mobile/src/components/chat/topic-info-sheet.tsx`, `TopicDoneRow` now renders only when `topic.isGeneral !== true`.
- No other code changed; other topics render exactly as before.

### Checks run
- `pnpm install` — Done in 12.8s using pnpm v10.32.1.
- No single test files were run: the spec says no tests (UI), and both packages' nearby tests were exercised by the gate instead (`tests @zilar/mobile` PASS, web skipped for no nearby test files).
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.9s)
  PASS  lint  (1.1s)
  PASS  typecheck  (5.5s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/mobile  (1.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- Both guards use the same `isGeneral !== true` shape already used elsewhere in each file (`listsMembers={topic.isGeneral !== true}` on web, `topic?.isGeneral === true` checks on phone), so no new patterns were introduced.
- I did not run the apps in a browser or simulator; verification is code-level plus the gate, as the spec calls for no UI tests.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `82fcd4953`.
- **Web and phone** render the done row only when `topic.isGeneral !== true`; the link row stays.
- **The pre-review follow-up** (the API still accepts done on General) isn't filed: no client sends it now.
- **The lead checks** General's panel in web mock mode after this merge.
