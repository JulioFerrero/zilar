---
id: T-1218
title: "Mobile: a failed swipe action (pin, mute or archive) shows 'Could not save. Try again.' in a line above the chat list for 4 seconds; today the error is only shown inside the long-press sheet, so a failed swipe is silent"
status: merged
milestone: M5
branch: task/T-1218-swipe-failure-line
model: auto
effort: default
depends_on: [T-1204]
estimate: 0.1 day
---

# T-1218: Show a failed swipe action

## Spec (written by Claude, do not edit)

### Why
T-1204's review left a follow-up. The swipe actions call `saveChatPref` (`apps/mobile/src/components/chat/use-chat-actions.ts:70-100`), the same as the long-press sheet. On a failure it sets `actionError` (`:88-91`), but that's shown only inside the long-press sheet (`apps/mobile/src/components/chat/chat-actions-host.tsx:21,33`). A swipe has no sheet open, so the row just snaps back and nothing tells the user the change wasn't saved.

### What to build
1. **`use-chat-actions.ts`:**
   - export a `swipeError: string`: `actionError` while no sheet is open (`actionFor === null`), and `''` otherwise;
   - clear `actionError` 4 seconds after a failure when no sheet is open, using one timer that's cancelled on unmount or on the next save. Use the file's existing Effect style (`Effect.runFork` and `Effect.sleep`), as at `:77`.
2. **`apps/mobile/src/components/chat/chat-list.tsx`:**
   - add a prop `swipeError: string`;
   - when it isn't `''`, render one line right below the connection line (`:73-77`), with the same markup but `text-danger` instead of `text-muted-foreground`;
   - give it `accessibilityLiveRegion="polite"`.
3. **`apps/mobile/src/app/(tabs)/index.tsx`:** pass `swipeError={actions.swipeError}` next to `onPref={actions.saveChatPref}` (`:221`).
4. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/use-chat-actions.ts`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/components/chat/chat-actions-host.tsx` and `apps/mobile/src/app/(tabs)/index.tsx:190-230`.

### Allowed files
`apps/mobile/src/components/chat/use-chat-actions.ts`, `apps/mobile/src/components/chat/chat-list.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `work/T-1218-swipe-failure-line.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- The long-press sheet still shows its error inside the sheet, as before.

---

## Report (written by the worker when done)

Status: review. No deviations from the spec.

### What I did
A failed swipe now shows its message in a line above the chat list, for 4
seconds; a failure inside the long-press sheet still shows inside the sheet.

- `apps/mobile/src/components/chat/use-chat-actions.ts`
  - Exported `swipeError`: `actionError` while `actionFor === null`, otherwise
    `''`.
  - Added one timer (a `Fiber` ref) that clears `actionError` 4 s after a
    failed save when no sheet is open, using `Effect.runFork` +
    `Effect.sleep(SWIPE_ERROR_MS)` (4000 ms). It is cancelled at the start of
    the next save (via the existing `interruptFiber` helper) and on unmount
    (a `useEffect` cleanup). A save with the sheet open does not start a timer,
    so the sheet keeps its error until it closes.
- `apps/mobile/src/components/chat/chat-list.tsx`
  - Added the required `swipeError: string` prop and destructured it.
  - When it is not `''`, rendered one line right below the connection line,
    same markup as that line but `text-danger` instead of
    `text-muted-foreground`, with `accessibilityLiveRegion="polite"`.
- `apps/mobile/src/app/(tabs)/index.tsx`
  - Passed `swipeError={actions.swipeError}` next to `onPref`.

No tests were added (UI-only change, per the spec).

### Files changed
- `apps/mobile/src/components/chat/use-chat-actions.ts` (153 lines)
- `apps/mobile/src/components/chat/chat-list.tsx` (158 lines)
- `apps/mobile/src/app/(tabs)/index.tsx` (231 lines)
- `work/T-1218-swipe-failure-line.md`

### Commands and results
- `pnpm install` — done, no errors.
- `pnpm gate` (first run) — GATE FAIL: `@zilar/mobile:typecheck` failed with
  `chat-list.tsx(80,8): error TS2304: Cannot find name 'swipeError'` and
  `(83,14)` same. Cause: the type had the prop but the destructuring list did
  not. Fixed, then re-ran.
- `pnpm gate` (final) — GATE PASS:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (0.6s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No single test files were run: the change is UI-only and the gate reports no
  nearby tests for `@zilar/mobile`.

### Notes
- Long-press errors are unchanged: with `actionFor !== null`,
  `swipeError` is `''`, so the line never renders and no timer is started; the
  sheet's `error` prop still receives `actionError`.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit.**
- **The change:**
  - `use-chat-actions.ts` exposes `swipeError` (`actionError` while no sheet is open);
  - one Effect fiber clears it after 4 s, and a new save or unmount cancels it (`interruptFiber`);
  - `chat-list.tsx` shows it in `text-danger` below the connection line, with `accessibilityLiveRegion="polite"`;
  - the sheet error is unchanged.
- **Lead checks:** mobile `tsc` gives 0 errors.
- **Not checked on a device:** the failure needs the network down mid-swipe; it'll be covered when the next APK is checked.
