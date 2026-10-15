---
id: T-1476
title: "Web sidebar orders groups and single chats together by recency (pinned first), as mobile does, instead of listing every group above every DM"
status: merged
milestone: M5
branch: task/T-1476-web-sidebar-recency-order
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1476: Web sidebar by recency

## Spec (written by Claude, do not edit)

### Why
On web (mock, 2026-10-15), the sidebar shows every group, with its topics, before any DM or AI chat, even when a DM had a message today and the groups last spoke days ago.
- Mobile interleaves groups and chats by their latest activity, like Telegram.
- A just-created AI chat (T-1474) therefore cannot lead the web list.
- This is a parity bug.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/store/chatGroups.ts`** (115 lines), `groupChats`:
  - builds `groups` from `byGroup` (`:56-80`), then appends the singles (`:81-83`);
  - returns `sortGroupsPinnedFirst(groups)` (`:84`), which sorts only when something is pinned, and only by pin time (`:90-104`).
  - So the order is "all groups, then all singles", never by recency.
- **Mobile** (`apps/mobile/src/lib/chat-list.ts:54-73`):
  - sorts the rows pinned first, then by time;
  - a chat row's time is `chatSortTime(row.chat)`, and a group row's time is the newest `chatSortTime` of its topics.
- `chatSortTime` is exported from `@zilar/chat-core` (`packages/chat-core/src/topics.ts:9-13`).

### What to build
1. In `groupChats`, sort the combined `groups` list:
   - pinned first (the existing `groupPinTime`, newer pins first);
   - then by recency, newest first. A single's time is `chatSortTime(topics[0])`; a group's time is the max `chatSortTime` over its topics;
   - ties by title.
   - Replace `sortGroupsPinnedFirst` with that one sort. Topics inside a group keep `sortTopics` as they are.
2. Nothing else changes (search, folders, archived).
3. The file stays at 400 lines or fewer.

### Tests
None (UI order).

### Allowed files
`apps/web/src/store/chatGroups.ts`, `work/T-1476-web-sidebar-recency-order.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- In the lead's headless check (mock), a DM with a message today sits above groups whose last message is older, and pinned rows stay on top.

---

## Report (written by the worker when done)

Status: review.

### What I did
- `groupChats` (`apps/web/src/store/chatGroups.ts`) now returns the combined
  group + singleton-chat list through one sort (`sortGroups`), replacing
  `sortGroupsPinnedFirst`:
  - pinned rows first, using the existing `groupPinTime` (General topic's
    `pinnedAt` for groups, the row's for singles), newer pins first;
  - then by recency, newest first: a group's time is `groupSortTime` (the max
    `chatSortTime` over its topics) and a singleton's is its one topic's
    `chatSortTime`, so DMs and AI chats interleave with groups like mobile;
  - ties by title (`localeCompare`).
- Imported `chatSortTime` from `@zilar/chat-core` and updated the
  `groupChats` doc comment to describe the shared pinned/recency order.
- Nothing else changed: search, folders, archived, `groupPinTime` and
  `sortTopics` (topics inside a group) are untouched. The file is 120 lines
  (under 400).

### Files changed
- `apps/web/src/store/chatGroups.ts` (the sort).
- `work/T-1476-web-sidebar-recency-order.md` (front matter + this Report).

Both are in the task's Allowed files.

### Commands and real results
- `pnpm install` — done in 11.1s, 17 workspace projects.
- `pnpm gate` (first run) — FAIL at format: `[warn] apps/web/src/store/chatGroups.ts`,
  "Code style issues found in the above file"; install/lint/typecheck/effect/tests
  and scope all passed.
- `pnpm exec prettier --write apps/web/src/store/chatGroups.ts` — fixed the
  file's formatting (collapsed my `Math.max` call onto one line).
- `pnpm gate` (second run) — **GATE PASS**. Summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.1s)
  PASS  lint  (1.3s)
  PASS  typecheck  (3.5s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/web  (4.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Single test files: none. There is no test file for `chatGroups`/the web
  sidebar order, and the spec says "Tests: None (UI order)", so I wrote none.

### Problems
- None beyond the formatting round above.
- Fix round 1 (lead's headless check): the sort was a no-op because
  `groupPinTime(right) - groupPinTime(left)` was `-Infinity - -Infinity = NaN`
  for two unpinned rows, and `NaN !== 0` made the comparator return `NaN`
  (treated as equal), so nothing moved; same for two rows with no
  `groupSortTime`. Replaced both subtractions with `compareNewestFirst`, which
  returns `0` when the stamps are equal (covering two `-Infinity`s) and
  `right > left ? 1 : -1` otherwise. `pnpm gate` after the fix: **GATE PASS**
  (install/format/lint/typecheck/effect/tests @zilar/web all PASS, scope clean).

### Deviations from the spec
- None. The one sort (`sortGroups`) does pinned-then-recency-then-title as
  asked; `sortTopics` still orders topics inside a group.

### Open questions / not tested
- I did not verify the rendered sidebar; the acceptance check ("a DM with a
  message today sits above groups whose last message is older, pinned rows on
  top") is the lead's headless mock check. The ordering logic is covered only
  by the gate (typecheck + existing web tests), not by a new test.

## Review (written by Claude)
Lead, 2026-10-15: approved. The final pre-review is CLEAN, nit 0.
- **Caught in the first headless check:** a NaN comparator (`-Infinity - -Infinity`) made the sort a no-op.
- **After the fix**, the web mock sidebar reads Dev AI (00:40 today) → Dev team (Wed) → Marta, Familia (Tue) → QA squad, Acme (Mon) → Luis (Sun) → Marketing AI (Fri) → Gym buddies. That is the mobile order.
