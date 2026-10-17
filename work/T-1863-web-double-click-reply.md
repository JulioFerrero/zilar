---
id: T-1863
title: "Web: double-clicking a message bubble starts a reply to it (Telegram desktop), except on links, buttons, inputs, media and while selecting or generating; the phone already has swipe-to-reply"
status: merged
milestone: M5
branch: task/T-1863-web-double-click-reply
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1863: Double-click a message to reply (web)

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17).** The phone replies with a swipe (`apps/mobile/src/components/chat/message-bubble.tsx:277-332`, `SwipeToReply`). On the web, replying takes the hover ⋯ menu or a right-click, then Reply. Telegram desktop starts a reply on a double-click.

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/MessageBubble.tsx`** (392 lines):
  - `onReply: (message: UiMessage) => void` is a prop (`:40`, `:68`);
  - the outer row `div` has `onContextMenu` (off while `generating || selecting`) and `onClick` (only while `selecting`) (`:165-195`).
- **Nothing in `apps/web/src` handles `onDoubleClick`.**
- **A deleted message** renders `MessageTombstone` and returns early (`:153-163`), so it has no reply.

### Steps
1. **New `apps/web/src/components/message/doubleClickReply.ts`:** `doubleClickReply(onReply)` returns a `MouseEvent` handler that:
   - does nothing when the target is inside `a, button, input, textarea, select, [role="button"], [role="switch"], img, video, audio, [contenteditable="true"]`;
   - otherwise clears the browser's word selection (`window.getSelection()?.removeAllRanges()`) and calls `onReply()`.
2. **`MessageBubble`:** set `onDoubleClick={generating || selecting ? undefined : doubleClickReply(() => onReply(message))}` on the outer row `div`. The file must stay at most 400 lines, so add at most 4 lines.
3. **No tests** (UI).

### Allowed files
- `apps/web/src/components/message/doubleClickReply.ts`
- `apps/web/src/components/MessageBubble.tsx`
- `work/T-1863-web-double-click-reply.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Double-clicking a message's text** opens the reply bar for that message, with no word left selected.
- **Double-clicking a link, a button, a card control or media** behaves as before.
- **No reply starts** while selecting messages or while the AI is generating.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/web/src/components/message/doubleClickReply.ts`: `doubleClickReply(onReply)` returns a React `MouseEvent` handler that ignores events whose target is inside `a, button, input, textarea, select, [role="button"], [role="switch"], img, video, audio, [contenteditable="true"]`; otherwise it clears the browser selection with `window.getSelection()?.removeAllRanges()` and calls `onReply()`.
- `apps/web/src/components/MessageBubble.tsx`: added the import and set `onDoubleClick={generating || selecting ? undefined : doubleClickReply(() => onReply(message))}` on the outer row `div`. The file went from 392 to 394 lines (within the 400 limit); 3 lines added in total.
- Deleted messages still return early through `MessageTombstone`, so they get no reply.
- No tests, per the Spec (UI).

### Checks run

`pnpm gate` from the repo root (one run, final):

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.5s)
PASS  format  (0.7s)
PASS  lint  (1.3s)
PASS  typecheck  (5.1s)
PASS  effect  (0.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

An earlier gate run failed only on `format` for the split `onDoubleClick` prop; I put it on one line (exactly 100 columns) and the run above is green. No single test files were run: the change is UI-only and `@zilar/web` has no nearby test files.

### Notes for the lead

- I did not click through the web app in a browser, so the acceptance points (reply bar opens, word selection cleared, controls/media unchanged, no reply while selecting or generating) are verified by reading the code and by the gate, not by a live smoke. Worth a quick manual check.
- The interactive selector is a comma-joined list in one module-level constant in the new file.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `316d0447e`.
- **The mock check** ran on the branch in vite at 1440 px, in "Dev team › Checkout button hidden on Safari": a Playwright double-click on Dev-1's text "PR #42 is on staging." opens the reply bar ("Reply to Dev-1 · PR #42 is on staging.") with an empty selection.

