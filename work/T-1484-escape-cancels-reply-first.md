---
id: T-1484
title: "Web: Escape while replying cancels the reply only; today one Escape cancels the reply AND closes the chat (ChatShell's window listener ignores an Escape the composer already handled)"
status: merged
milestone: M5
branch: task/T-1484-escape-cancels-reply-first
model: auto
effort: default
depends_on: [T-1482]
estimate: 0.05 day
---

# T-1484: Escape cancels the reply first

## Spec (written by Claude, do not edit)

### Why
In the lead's headless check (web mock, 1280 px, 2026-10-15), on main and on T-1482: open Marta, choose Reply from a message's menu, then press Escape once. The reply bar goes, and the chat closes too (the URL goes from `/c/marta%40zilar.test` to `/`). Telegram cancels the reply on the first Escape and closes the chat on the second.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/routes/ChatShell.tsx:35-47`:** a `window` `keydown` listener calls `navigate('/')` on any Escape while a chat is open. It skips only a wide layout with search open (`:40-42`).
- **`apps/web/src/components/Composer.tsx`, the textarea's key handler:**
  - The edit branch (`:342-348`) calls `preventDefault()` and `stopPropagation()`, with the comment "Keep the key from also closing the chat on a narrow layout".
  - The reply branch (`:349-353`) calls only `preventDefault()`, then `onCancelReply()`.
- React's synthetic `stopPropagation()` stops the native event before it reaches `window`, and `preventDefault()` sets `event.defaultPrevented` for the window listener.

### What to build
1. **`ChatShell.tsx`:** the Escape listener returns early when `event.defaultPrevented`, with one comment: an Escape a dialog, menu or the composer already handled never closes the chat too.
2. **`Composer.tsx`:** the reply branch also calls `event.stopPropagation()`, as the edit branch does. It changes by one line only, and the file stays under 400 lines.
3. Nothing else changes.

### Tests
None (keyboard UI).

### Allowed files
`apps/web/src/routes/ChatShell.tsx`, `apps/web/src/components/Composer.tsx`, `work/T-1484-escape-cancels-reply-first.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- In the lead's headless check: after Reply, the first Escape removes the reply bar and keeps the chat open, and the second Escape closes the chat.

---

## Report (written by the worker when done)

### What I did
1. `apps/web/src/routes/ChatShell.tsx`: the window `keydown` listener now returns
   early when `event.defaultPrevented` (after the existing `Escape`/`chatId` guard),
   with the comment "An Escape a dialog, menu or the composer already handled never
   closes the chat too." (`:37-45`.)
2. `apps/web/src/components/Composer.tsx`: the reply branch of the textarea key
   handler (`:349-353`) now also calls `event.stopPropagation()` before
   `onCancelReply()`, matching the edit branch. One line added; file is 394 lines
   (under 400).
3. Nothing else changed.

### Files changed
- `apps/web/src/routes/ChatShell.tsx`
- `apps/web/src/components/Composer.tsx`
- `work/T-1484-escape-cancels-reply-first.md` (this file)

### Commands and results
- `pnpm install`: "Done in 13.8s using pnpm v10.32.1" (no lockfile change).
- No single test files were run: the change is keyboard UI and the spec says
  "Tests: None (keyboard UI)", so there is no test file near it to run.
- `pnpm gate` (repo root): real summary lines, verbatim:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.0s)
PASS  lint  (1.4s)
PASS  typecheck  (6.2s)
PASS  effect  (1.0s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

The gate lists no files outside the Allowed files.

### Deviations from the spec
None.

### Problems
None.

### Open questions / Blocked
None. I did not run the lead's headless browser check (it is not part of
`pnpm gate` and I did not open a browser); the acceptance for the second point
(first Escape clears the reply bar and keeps the chat open, second Escape closes
the chat) still needs the lead's headless check.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 0.
- **Headless check, mock, 1280 px:** after Reply, the first Escape removes the reply bar and keeps the chat open (`/c/marta%40zilar.test`, focus in the composer). The second Escape closes the chat (`/`).
- **On main before this task,** the first Escape did both.
