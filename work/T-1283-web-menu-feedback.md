---
id: T-1283
title: "WUX-29 + WUX-30 + WUX-37: on web, the message menu opens at the pointer on right-click, Copy and Pin show a short toast (and pin failures say so), and icon buttons get a hover tooltip"
status: merged
milestone: M5
branch: task/T-1283-web-menu-feedback
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1283: Menu at the pointer, feedback toasts, tooltips (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-29** (P3, `:93`): right-click opens the message menu at the bubble corner (`apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageActionsMenu.tsx` `top-6 right-0`), not at the pointer.
- **WUX-30** (P3, `:95`):
  - Copy text and Pin give no feedback (`apps/web/src/components/message/MessageMenu.tsx`);
  - pin and unpin run detached and drop failures.
- **WUX-37** (P3, `:121`): header icon buttons have no hover tooltip (`apps/web/src/components/ui/icon-button.tsx`).

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **Menu position:**
   - a right-click opens the menu at the pointer (pass `clientX`/`clientY`), kept inside the viewport;
   - the "…" button keeps today's position;
   - `MessageBubble.tsx` is **400 lines**: it must not grow. Move code out if you need room, and say where.
2. **Toasts:**
   - if the app already has a toast, use it (find and cite it); otherwise add a small one: a new `apps/web/src/components/ui/toast.tsx` plus a tiny store or context;
   - it shows "Copied", "Pinned" or "Unpinned" for 2 s, and "Could not pin. Try again." when a pin or unpin fails.
3. **Tooltips:** `IconButton` sets `title` from its `aria-label` when no title is given.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:93-96`, `:121`), and the four files above.

### Allowed files
`apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/web/src/components/message/*.tsx`, `apps/web/src/components/ui/icon-button.tsx`, `apps/web/src/components/ui/toast.tsx`, `apps/web/src/App.tsx`, `apps/web/src/routes/ChatShell.tsx`, `work/T-1283-web-menu-feedback.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - a right-click opens the menu at the pointer;
  - Copy shows "Copied" and Pin shows "Pinned";
  - hovering a header icon shows its label.

---

## Report (written by the worker when done)

### Recheck of the findings on the base
- **WUX-29** still present: `MessageActionsMenu.tsx:60-63` hung the menu at `top-6 right-0`
  and `MessageBubble.tsx:204-210` opened it with `setMenuOpen(true)` and no pointer.
- **WUX-30** still present: `MessageMenu.tsx:147-150` copied with `void copyText(...)`
  (no feedback) and `MessageMenu.tsx:16-18,157-166` ran pin/unpin through a `runDetached`
  that ended in `Effect.ignore`, dropping failures.
- **WUX-37** still present: `ui/icon-button.tsx` rendered the button without a `title`.
- No toast existed: `grep -rn 'toast\|Toast' apps/web/src` returned no matches, so I added one
  (spec option 2) instead of reusing.

### What I did
1. **Menu at the pointer (WUX-29).** `MessageBubble` keeps a new `menuPoint` state; the
   `onContextMenu` handler stores `{clientX, clientY}`, the "…" button clears it. Both
   `MessageMenu` call sites pass `point`. `MessageMenu` forwards it to `MessageActionsMenu`,
   which wraps the menu in a `position: fixed` box at the point and, in a `useLayoutEffect`,
   measures the menu and clamps the point inside the viewport (8 px margin). With no point
   the menu keeps the old `top-6 right-0/left-0` corner position.
2. **Toasts (WUX-30).** New `apps/web/src/components/ui/toast.tsx`: a `ToastProvider`
   (React context, not the store, since `store.ts` is out of scope) rendering one
   `role="status"`/`aria-live="polite"` region, and a `useToast()` hook. The provider is
   mounted once in `App.tsx`. `MessageMenu` shows `Copied`, `Pinned` / `Unpinned`, and
   `Could not pin. Try again.` when a pin or unpin rejects; the 2 s timer restarts on each
   toast. Pin/unpin now use `runWeb(Effect.promise(...).pipe(Effect.match(...)))` so failures
   are reported instead of dropped.
3. **Tooltips (WUX-37).** `IconButton` sets `title` to its `aria-label` unless the caller
   passes a `title`, so every header icon gets its hover tooltip.
4. **No tests** (UI), per the spec.

### Code moved out of MessageBubble.tsx (kept at 400 lines)
`MessageBubble.tsx` was exactly 400 lines. I extracted the retracted-message tombstone
(lines 170-198) into `apps/web/src/components/message/MessageTombstone.tsx` and added a
short `menuPoint` state. Result: **394 lines** (≤ 400).

### Files changed
- `apps/web/src/components/MessageBubble.tsx` (tombstone extracted, `menuPoint`, pass `point`)
- `apps/web/src/components/MessageActionsMenu.tsx` (pointer positioning + clamping)
- `apps/web/src/components/message/MessageMenu.tsx` (toast wiring, `point` prop, real pin failures)
- `apps/web/src/components/message/MessageTombstone.tsx` (**new**)
- `apps/web/src/components/ui/toast.tsx` (**new**)
- `apps/web/src/components/ui/icon-button.tsx` (`title` default)
- `apps/web/src/App.tsx` (mount `ToastProvider`)
- `work/T-1283-web-menu-feedback.md` (this file)

`ChatShell.tsx` was not changed: the toast viewport lives inside `ToastProvider` in `App.tsx`,
so no route needed it.

### Commands and real results
- `pnpm install` — "Done in 1m 24.8s" (only the pre-existing `@types/react-dom` peer warning).
- `pnpm exec prettier --write <7 changed source files>` — formatted `MessageBubble.tsx` and
  `MessageActionsMenu.tsx`; the rest unchanged. (Ran per file so the gate's `format --check`
  step can pass; no repo-wide format run.)
- `pnpm gate` — final run:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (5.1s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No test files were near the change (UI), so the gate skipped tests.

### Notes / deviations
- The Effect ratchet first failed on `void call().then(...)` (`MessageMenu.tsx`, H1) and the
  `setTimeout` in `toast.tsx` (H3). I fixed the first by using Effect for the store calls;
  for the pure presentational timer I added the sanctioned `// effect-plain:` marker on
  line 1 of `toast.tsx`. Gate now passes.
- The audit's suggested extras ("invite-link copy" feedback) are **not** done: they live in
  `InviteLinksSection.tsx`/`ProfileSettingsSection.tsx`/etc., which are outside the Allowed
  files. The spec's "What to build" only required Copy/Pin/Unpin.
- `onCopy` shows `Copied` optimistically (as the spec asks for feedback on click); a clipboard
  failure is not announced, matching the old `void copyText(...)` behaviour.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **Lead's check on the web mock:**
  - a right-click on Marta's "Great, let me know…" bubble opens the menu at the pointer;
  - Copy text shows a "Copied" toast, and Pin shows "Pinned" with the pinned banner appearing;
  - header icon buttons carry `title` (for example "Back to chats").
- **Lead's checks after the rebase:** web tsc: 0 errors. `MessageBubble.tsx` went from 400 to 394 lines, with the tombstone extracted to `message/MessageTombstone.tsx`.
