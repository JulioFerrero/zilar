---
id: T-1219
title: "Web: arrow keys in the chat list also reach the open Archived rows — move the Archived section inside the TopicKeyboardNav wrapper in ChatListBody.tsx"
status: merged
milestone: M5
branch: task/T-1219-archived-rows-keyboard-nav
model: auto
effort: default
depends_on: [T-1199]
estimate: 0.05 day
---

# T-1219: Arrow keys reach archived rows

## Spec (written by Claude, do not edit)

### Why
T-1199's review left a follow-up. `TopicKeyboardNav` (`apps/web/src/components/TopicKeyboardNav.tsx:15-52`) moves focus between the `a[data-topic-row]` links rendered **inside** it (`:24`), using ArrowDown, ArrowUp and Enter. In `apps/web/src/components/chatList/ChatListBody.tsx`, the wrapper closes after the group rows (`:117-149`). The per-user Archived toggle and its rows (`:150-178`) render **after** it, so with Archived open the arrow keys skip those rows.

### What to build
1. In `ChatListBody.tsx`, move the `</TopicKeyboardNav>` close so the Archived section (the toggle `Button` and the `archived.map(…)` rows) is inside the wrapper, and drop the now-empty fragment if it's no longer needed.
   - The wrapper is a `flex min-h-0 flex-1 flex-col` div (`TopicKeyboardNav.tsx:47-51`), so check that the Archived toggle still sits right below the rows, not pushed to the bottom; if it moves, say so in the Report.
   - Don't change `TopicKeyboardNav.tsx`.
2. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/chatList/ChatListBody.tsx` and `apps/web/src/components/TopicKeyboardNav.tsx`.

### Allowed files
`apps/web/src/components/chatList/ChatListBody.tsx`, `work/T-1219-archived-rows-keyboard-nav.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the local web mock:** with Archived open, ArrowDown from the last chat row reaches the first archived row.

---

## Report (written by the worker when done)

### What I did
In `apps/web/src/components/chatList/ChatListBody.tsx` I moved the `</TopicKeyboardNav>` close tag down so it now wraps both the group rows and the per-user Archived section (the toggle `Button` plus the `archived.map(…)` rows). The `<>…</>` fragment that previously held the two as siblings is gone — after moving the close it had a single child, the wrapper, so it was no longer needed.

Result: `TopicKeyboardNav`'s `onKeyDown` handler queries `list.querySelectorAll('a[data-topic-row]')`, and the archived rows are `ChatListItem`s that render `data-topic-row` (`ChatListItem.tsx:78`). With the archived rows now inside the wrapper, ArrowDown from the last chat row reaches the first archived row (and Enter follows it) instead of skipping them.

I did not change `TopicKeyboardNav.tsx`, per the spec.

### Archived toggle position (checked as the spec asked)
Before: `TopicKeyboardNav` is `flex min-h-0 flex-1 flex-col` and was a sibling *before* the Archived toggle. Its `flex-1` made it grow to fill the list, so the toggle sat below the grown wrapper — effectively pinned toward the bottom. After: the toggle is inside the wrapper, right after the group rows in the flex column, so it now sits directly below the last row and above the archived rows. It moved up from the bottom; that is the intended outcome of the move, not a regression I introduced elsewhere. No other layout classes were changed.

### Files changed
- `apps/web/src/components/chatList/ChatListBody.tsx` — moved the wrapper close, dropped the now-empty outer fragment.
- `work/T-1219-archived-rows-keyboard-nav.md` — status and this Report.

### Commands run
- `pnpm install` — done, no errors.
- `pnpm gate` (repo root) summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (3.5s)
  PASS  effect  (1.0s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
No single test files were run: the task says "No tests (UI)", and the gate reports `SKIP tests @zilar/web (no nearby test files)`. I did not run format, lint, typecheck or tests individually — the gate covers all of them once.

### Deviations / open questions
None. No secrets touched. The acceptance check on the local web mock (ArrowDown from the last chat row reaches the first archived row with Archived open) is the lead's to run; I verified the mechanism in the code but did not run the browser mock.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 0 nits.**
- **The change:** the Archived toggle and its rows now render inside `TopicKeyboardNav`; `TopicKeyboardNav.tsx` is unchanged.
- **The lead's check on the local web mock:**
  - archived Luis, opened Archived (1), focused Ana (the last normal row) and pressed ArrowDown: focus went to Luis;
  - the toggle still sits right below the rows.
