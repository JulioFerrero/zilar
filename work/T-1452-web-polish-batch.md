---
id: T-1452
title: "Web polish batch: the chat header shows Connecting… / Waiting for network… like mobile (WUX-14 parity), the folder name field is focused on open, a stale handle-gate comment"
status: merged
milestone: M5
branch: task/T-1452-web-polish-batch
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1452: Web polish batch

## Spec (written by Claude, do not edit)

### Why
These are three small leftovers from tonight's reviews and the findings sweep:
- WUX-14 is partly open (`docs/audit/findings-sweep-client.md`): the web shows the connection line above the composer, while mobile shows it in the chat header (T-1192, MUX-15), as Telegram does.
- T-1447 follow-up: the folder name field isn't focused on open.
- T-1435 follow-up: a comment still says `sessionStorage`.

### Facts (the lead read them on main, 2026-10-15)
- **The status label:** `statusLabel(status)` (`apps/web/src/components/chatList/rowsSelector.ts:59-69`) returns "Connecting…" or "Waiting for network…", or `undefined` when online.
- **The current line:** `apps/web/src/routes/ChatView.tsx` (353 lines) computes `connection` at `:60` and renders it as a `role="status"` line above the composer at `:289-296`.
- **The web header:** `apps/web/src/components/ChatHeader.tsx` (365 lines) builds `subtitle` at `:74` (`aiLine ?? (writing ? 'writing…' : (typing ?? chatSubtitle(...)))`) and renders it at `:159`.
- **Mobile already does this:** `apps/mobile/src/components/chat/chat-header.tsx:89-96`, where `connection ?? aiLine ?? …`.
- **The folder name input** is at `apps/web/src/components/folder/FolderIconPicker.tsx:26`. The kit dialog focuses `[data-autofocus]` on open.
- **The stale comment:** `apps/web/src/routes/AppRoutes.tsx:88-90` still says the handle-gate dismissal is in `sessionStorage`. Since T-1435 it is in `localStorage`, per user, cleared on sign-out.

### What to build
1. **`ChatHeader.tsx`:** the subtitle becomes `connection ?? aiLine ?? …`, where `connection` is `statusLabel` of the store status, read the same way `ChatView.tsx:60` reads it. Keep it a `role="status"` text.
2. **`ChatView.tsx`:** remove the line above the composer (`:289-296`) and its now-unused variable and import.
3. **`FolderIconPicker.tsx`:** add `data-autofocus` to the name input.
4. **`AppRoutes.tsx:88-90`:** fix the comment to say `localStorage`, per user, cleared on sign-out.
5. Each file stays at 400 lines or fewer.

### Tests
None (UI).

### Allowed files
- `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/folder/FolderIconPicker.tsx`, `apps/web/src/routes/AppRoutes.tsx`
- `work/T-1452-web-polish-batch.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.

---

## Report (written by the worker when done)

**Status: review.**

### What I did
1. `ChatHeader.tsx`: added `connection = statusLabel(useChatSelector((s) => s.status))`, read exactly like `ChatView.tsx` did, and changed the subtitle to `connection ?? aiLine ?? (writing ? 'writing…' : (typing ?? chatSubtitle(...)))` (matches mobile `chat-header.tsx:95-96`). The subtitle line is now a `role="status"` text.
2. `ChatView.tsx`: removed the `role="status"` connection line above the composer, plus its now-unused `connection` variable and the `statusLabel` import.
3. `FolderIconPicker.tsx`: added `data-autofocus` to the `#folder-name` input, so the kit dialog (`ui/dialog.tsx` focuses `[data-autofocus]` on open) focuses it, like the other dialogs.
4. `AppRoutes.tsx:88-90`: fixed the comment to say `localStorage` per user, cleared on sign-out (matches `lib/handleGate.ts`, T-1435).

### Files changed
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `apps/web/src/components/folder/FolderIconPicker.tsx`
- `apps/web/src/routes/AppRoutes.tsx`
- `work/T-1452-web-polish-batch.md`

### Commands and results
- `pnpm install`: done (14.6s).
- Single tests: none — the task says "Tests: None (UI)" and the change is UI-only.
- `pnpm gate` from the repo root:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Deviations / notes
- The spec says "Keep it a `role="status"` text". The header subtitle had no `role`, so I put `role="status"` on the subtitle row `div` (the removed element was `role="status"`). The row also holds the typing dots; the dots are unchanged.
- The typing-dots condition in the header still ignores `connection` (dots can show next to "Connecting…"). Mobile's `chat-header.tsx` only changes the subtitle text, so I left the dots logic untouched to stay minimal.
- No open questions.

## Review (written by Claude)
Lead, 2026-10-15: approved. Pre-review CLEAN, nit 1.
- The header subtitle is now `connection ?? aiLine ?? …`, as on mobile, and the line above the composer is gone.
- The folder name field has `data-autofocus`, and the AppRoutes comment is fixed.
- Note: the whole subtitle is now `role="status"`, so a screen reader also hears typing changes. That is acceptable, and a candidate for a later polish.
