---
id: T-1931
title: "iOS sheet race: kit sheets present/dismiss through one queue (and the kit ConfirmDialog waits for it), so Delete's confirm and Forward's picker open only after the message menu has really closed"
status: merged
milestone: M5
branch: task/T-1931-ios-sheet-queue
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1931: One sheet at a time on iOS

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, on the iPhone:**

> on the delete a message doenst close the drawer with the options so i can press the buttons to delete but nothing happens and when i close i see the message is deleted

> the forward doesnt work great in ios

Both flows close the message menu (a native sheet) and open the next sheet or dialog in the same instant. iOS cannot dismiss one presented controller while presenting another, so the menu sheet stays on screen while React state already says it is closed. Its buttons then do nothing until it is dragged away.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/ui/bottom-sheet.tsx`** (170 lines): it is built on `@lodev09/react-native-true-sheet`. An effect on `visible` calls `runInBackground(() => instance.present(), {})` or `instance.dismiss()`, tracked by a `presented` ref (`:94-106`). `onDidDismiss` resets the ref and calls `onClose` (`:119-122`).
- **`apps/mobile/src/components/ui/action-sheet.tsx`** also uses `TrueSheet` directly. Read it before changing it.
- **`apps/mobile/src/components/ui/confirm-dialog.tsx`:** an RN `Modal` with `animationType="fade"` (`:56`).
- **Delete:** `apps/mobile/src/components/chat/message-actions-sheet.tsx`.
  - The menu `BottomSheet` has `visible={visible && !confirmOpen}` (`:126`).
  - The confirm is either a second `BottomSheet` (`visible={visible && confirmOpen}`, `:227`) or a `ConfirmDialog` (`:258`, `:271`).
  - `message-bubble-actions.tsx:154-156` sets `confirmOpen` true, so the menu dismiss and the confirm present start together.
- **Forward:** `message-bubble-actions.tsx:157-160` calls `setMenuOpen(false)` and then `onForward(message)`. That opens `apps/mobile/src/components/chat/forward-sheet.tsx`, a kit `BottomSheet` (`:53`), in the same instant.

### Steps
1. **New `apps/mobile/src/components/ui/sheet-queue.ts`:**
   ```ts
   /** iOS presents one controller at a time (T-1931): every kit sheet present,
    *  dismiss and confirm waits for the previous transition to finish. */
   let chain: Promise<void> = Promise.resolve();
   export function queueSheetTransition(run: () => Promise<unknown> | void): Promise<void> {
     const next = chain.then(run, run).then(() => undefined, () => undefined);
     chain = next;
     return next;
   }
   ```
2. **`bottom-sheet.tsx`:** run the effect's `instance.present()` and `instance.dismiss()` through `queueSheetTransition(...)`, keeping the `presented` ref logic. TrueSheet's `present()` and `dismiss()` promises settle when the animation ends; confirm in the library's types.
3. **`action-sheet.tsx`:** the same for its present and dismiss calls.
4. **`confirm-dialog.tsx`:** add an internal `shown` state.
   - When `visible` turns true, `queueSheetTransition(() => setShown(true))`, so it waits for a menu sheet still leaving.
   - When it turns false, set `shown` false at once.
   - The `Modal` uses `visible={shown}`.
5. **No changes in the chat files:** the queue fixes Delete and Forward in the kit.
6. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/ui/sheet-queue.ts`
- `apps/mobile/src/components/ui/bottom-sheet.tsx`
- `apps/mobile/src/components/ui/action-sheet.tsx`
- `apps/mobile/src/components/ui/confirm-dialog.tsx`
- `work/T-1931-ios-sheet-queue.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Long-press a message, then Delete:** the menu closes, then the confirm appears. Confirming deletes the message and nothing stays on screen.
- **Long-press, then Forward:** the menu closes, then the forward picker opens and works.
- **Android:** these flows still work as before.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/components/ui/sheet-queue.ts`: a single module-level promise chain with
  `queueSheetTransition(run)`. Every transition waits for the previous one to settle, and a failed
  present/dismiss is swallowed so it cannot break the queue.
- `bottom-sheet.tsx`: the `visible` effect now passes `instance.present()` / `instance.dismiss()`
  through `queueSheetTransition`; the `presented` ref logic and `onDidDismiss` are unchanged.
- `action-sheet.tsx`: same change, keeping the `presented` and `dismissedByEffect` refs (so a
  programmatic dismissal still does not call `onClose`).
- `confirm-dialog.tsx`: added an internal `shown` state. Opening queues `setShown(true)` behind any
  sheet still leaving; closing sets `shown` false at once (adjusted during render) and `Modal` now
  uses `visible={shown}`. A queued open is cancelled if the dialog is closed before it runs.
- No chat files changed, as the spec requires; the kit queue covers Delete and Forward. I checked
  the mount order from the code: the menu sheet is rendered before the confirm (same component) and
  before `ChatOverlays`/`ForwardSheet` (`app/chat/[id].tsx`), so the menu's dismiss is enqueued
  before the next present. React runs effects in that order.

Files changed: `sheet-queue.ts` (new), `bottom-sheet.tsx`, `action-sheet.tsx`,
`confirm-dialog.tsx`, and this task file.

### Checks run

- `pnpm install --prefer-offline`: "Done in 24s" (one existing unmet peer warning
  `@types/react@^19.3.0` vs 19.2.18, unrelated).
- `pnpm exec prettier --write apps/mobile/src/components/ui/sheet-queue.ts`: formatted the new file
  once after the gate flagged it (35 ms).
- `pnpm gate` (repo root), final run:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.5s)
  PASS  lint  (0.7s)
  PASS  typecheck  (3.9s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

  No tests were added (UI, as the spec says), so no single test files were run.
- `pnpm gate` after the fix round: PASS install, format, lint, typecheck, effect; `SKIP tests
  @zilar/mobile (no nearby test files)`; scope/migration/images/size all OK; **GATE PASS**.

### Notes for the lead

- Deviation from the literal snippet: the given `sheet-queue.ts` body failed the gate's `effect`
  ratchet (`needs Effect (H1)` for a new file using bare Promises). I kept the same promise chain and
  API, but each transition now runs through `Effect.runPromise(Effect.tryPromise(...).pipe(Effect.ignore))`,
  which classifies the file as `effect` and preserves the "a failed transition does not break the
  queue" behaviour.
- Two lint/robustness details: `ConfirmDialog` resets `shown` during render (the React derived-state
  pattern already used in `block-card.tsx`) because oxlint rejects a synchronous `setState` in an
  effect; and the queued open checks a `cancelled` flag so closing before the queue drains cannot
  re-show the dialog.
- I did not run the app on a phone. The acceptance items (long-press → Delete, long-press → Forward,
  Android) need the lead's device smoke / Julio's live check; the code path is now
  dismiss-then-present instead of both in one commit.
- The queue is global and FIFO across all kit sheets, deliberately not per component: that is what
  serialises the menu against whatever comes next.
- Fix round (pre-review nit 1): each queued transition is now capped by `Effect.timeout('1500 millis')`
  before `Effect.ignore`, so a promise that never settles (a sheet unmounted mid-animation) cannot
  stall every later sheet app-wide. FIFO order and swallowed failures are unchanged.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `7df37713b`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`).
- **Checked on Android:** long-press my message, then Delete. The menu sheet closes and the DM confirm sheet ("Delete message?", "Delete for me", "Delete for everyone") follows. After confirming, no sheet text is left on screen.
- **Mock mode:** it keeps seeded messages after a delete. `main` behaves the same, so this is not this task.
- **Fix round:** pre-review nit 1. Each queued transition is capped at 1.5 s (`Effect.timeout`), so a promise that never settles can't stall every sheet in the app.
- **Still to check on the iPhone:** the race itself (Delete, then confirm; and Forward) with the next iOS build.
