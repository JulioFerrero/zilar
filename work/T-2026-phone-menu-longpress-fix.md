---
id: T-2026
title: "Fix (phone): after T-2018 a long-press on a message no longer opens the action sheet — the shared menu host must present the sheet reliably (sheet mounted before it is opened), verified on the emulator"
status: merged
milestone: M5
branch: task/T-2026-phone-menu-longpress-fix
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2026: The phone message menu opens again

## Spec (written by Claude, do not edit)

### Why
T-2018 (merged 2026-10-18, perf W3a) moved the phone's message action sheet into one per-list host. The lead's emulator check, on a mock release build of main at `7dc1c7aca` (Ana's chat, long-press on "Bring snacks?"), found the bug:
- **After T-2018:** a long-press opens **nothing**.
- **Before T-2018:** the same press on the earlier build opens the sheet (reactions row, Reply, Forward, Select, Copy text, Delete for me, Pin).

No APK has shipped with this. It must be fixed before the next one.

### Facts (read by the lead on 2026-10-18; paths under `apps/mobile/src/components/chat/`)
- **The host.** `message-menu-host.tsx`, `MessageMenuHost`:
  - `open(next)` calls `setTarget(next)`, `setConfirmOpen(false)` and `setMenuOpen(true)` in one go;
  - the host renders `{target === null ? null : <BubbleActionsSheet visible={menuOpen} ... {...target} />}`;
  - so on the first long-press, the sheet **mounts already `visible`**.
- **Before T-2018,** each row's `BubbleActionsSheet` was always mounted with `visible={false}` and flipped to `true` on long-press. The old bubble opened it through `openMessageMenu(setMenuOpen)` (`message-bubble-actions.tsx:48`). Check what that helper does beyond `setMenuOpen(true)`: a haptic, `Keyboard.dismiss`, or a deferred open.
- **The sheet.** `BubbleActionsSheet` renders `MessageActionsSheet` (a TrueSheet). TrueSheet presents on a `visible` change, so mounting it already visible may never present it.

### Steps
1. **Find the cause.** Add a temporary log, or read the code, to see whether `open` is called on long-press at all. Check the bubble's `onLongPress` wiring after T-2018, and that `generating` or `draft` isn't blocking it.
2. **Fix it so the sheet presents every time.** Keep one sheet per list. The likely fix:
   - keep `BubbleActionsSheet` mounted from the start, with `visible={false}` and an empty or placeholder target;
   - or set the target first and flip `menuOpen` on the next frame.

   Keep everything `openMessageMenu` did before: haptic, keyboard dismiss.
3. **Second and later presses** must work too, including a long-press on another message while the sheet is closing.
4. **Remove any temporary logs.** Every file stays at or under 400 lines. No tests (UI).

### Allowed files
- `apps/mobile/src/components/chat/message-menu-host.tsx`
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`
- `apps/mobile/src/components/chat/message-bubble.tsx`
- `apps/mobile/src/components/chat/message-list.tsx`
- `work/T-2026-phone-menu-longpress-fix.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's emulator check** on a mock build of this branch:
  - a long-press on a text in Ana's chat opens the sheet;
  - closing it and long-pressing another message opens it again;
  - Pin and Copy work.

---

## Report (written by the worker when done)

### What I did

- Read the wiring end to end. A long-press does reach `open`: `message-bubble.tsx:152-172`
  builds the target and calls `openMessageMenu`, which is still `tap(); open()`
  (`message-bubble-actions.tsx:49-52`) — it did the same before T-2018, so there
  was no keyboard dismiss or deferred open to restore. `generating` is only set
  for the live AI bubble and `draft` is false for real messages, so neither
  blocks the press in a normal chat.
- The cause is in `MessageMenuHost`: before T-2026 it rendered
  `{target === null ? null : <BubbleActionsSheet visible={menuOpen} … />}` and
  `open` set `target` and `menuOpen` in the same update. On the first press the
  sheet therefore **mounted already visible**, which is the one case the
  pre-T-2018 code never exercised: every row's sheet used to stay mounted with
  `visible={false}` and was only flipped to `true` afterwards. TrueSheet
  presents on that visible change, once its view is mounted; when the sheet is
  born visible, the present runs against a view that is still mounting and can
  silently do nothing.
- Fix, in `message-menu-host.tsx` only:
  - `open` now stores the target and clears the delete confirm, then calls
    `setMenuOpen(true)` on the next animation frame (`requestAnimationFrame`).
    The sheet mounts in the target's commit with `visible={false}` and is
    presented on the following frame, matching the old per-row behaviour.
  - `open` still creates one target per press, and the target is never cleared
    on close (unchanged), so the sheet stays mounted after the first press.
    Every later press, including one while the sheet is closing, is a fresh
    target plus a fresh frame that flips `visible` false → true again.
  - Kept one sheet per list (still mounts zero sheets at rest, one after the
    first long-press) and kept the haptic in the press handler
    (`openMessageMenu` is untouched). No temporary logs were added.
- No tests: UI-only change, per the spec and AGENTS.md. No other files touched.

### Checks run

- No single test files were run on their own: no test covers these components
  and the change is UI-only.
- `pnpm gate` from the repo root (final run):

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (0.9s)
PASS  lint  (0.9s)
PASS  typecheck  (3.4s)
PASS  effect  (0.9s)
PASS  tests @zilar/mobile  (1.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into the Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

  Two earlier gate runs failed and were fixed before the final one: lint flagged
  `react(set-state-in-effect)` for an effect-based open, and prettier wanted the
  original one-line React import; the final run above is after those fixes.

### Notes for the lead

- I could not run the emulator or a device here, so the acceptance checks
  (long-press opens, reopen on another message, Pin and Copy) still need your
  mock-build check. The code path is now identical to the pre-T-2018 sheet:
  mounted hidden first, presented by a `visible` change.
- Files changed in the first round: `apps/mobile/src/components/chat/message-menu-host.tsx`
  and this task file; the fixup round also changed `message-bubble-actions.tsx`.

### Round: finding 1 (should-fix)

- Fixed the press-while-closing race. The claim in the first Report that a press
  during a dismissal "flips `visible` false → true again" was wrong for that
  window: `menuOpen` is still `true` until `onDidDismiss`, so the scheduled
  `setMenuOpen(true)` was a no-op.
- `message-menu-host.tsx` now keeps the committed visibility in a ref and, when
  `open` runs while the sheet is still visible, records the press in a `reopen`
  flag instead of scheduling a no-op frame. A press while the sheet is dimmed
  on screen cannot reach a bubble anyway, so visible means "on its way out".
- `message-bubble-actions.tsx` gained `onMenuClosed`, wired to the main
  `ActionSheet`'s `onClose`, which only fires for a user dismissal (drag,
  backdrop tap, Android back). The host's handler flips `visible` false for one
  commit and presents the stored target on the next frame, so `ActionSheet`
  sees the change and `present()` runs against a dismissed sheet.
- Programmatic closes (`setMenuOpen(false)` after Pin, Copy, Reply, …) keep
  their old behaviour; only a self-close consults the flag.
- Tests added: none. The spec says "No tests (UI)", AGENTS.md says UI code gets
  no tests, and finding 1 names no test. No disagreements with the finding.

No single test files were run on their own: no test covers these components and
the change is UI-only. `pnpm gate` (final, after the fix commit):

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.3s)
PASS  lint  (0.9s)
PASS  typecheck  (0.8s)
PASS  effect  (0.4s)
PASS  tests @zilar/mobile  (1.1s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into the Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

Still not verified on a device: the emulator check (open, reopen, Pin, Copy)
needs the lead.

## Review (written by Claude)

Approved: the pre-review was clean after 1 auto round. The lead checked it on the emulator with a mock release build of this branch, in Ana's chat:
- a long-press on "Bring snacks?" opens the sheet (reactions, Reply, Forward, Select, Copy text, Delete for me, Pin);
- Copy text puts the text on the clipboard (Android's copy preview shows "Bring snacks?");
- a long-press on your own "You're the best" opens the own-message menu with Edit and Delete;
- Pin pins it: the bar shows "You're the best · 1 of 2 · 2 pins".

**The fix.** The host mounts the sheet hidden, then shows it on the next frame. A press that lands while the sheet is closing reopens it after the close.
