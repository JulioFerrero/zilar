---
id: T-1280
title: "MUX-14 step 2: lock a voice recording — sliding up while holding the mic (≈70 px) locks it, the finger can lift, and the row swaps to Cancel (trash) and Send while the timer keeps running"
status: merged
milestone: M5
branch: task/T-1280-voice-lock
model: auto
effort: default
depends_on: [T-1276]
estimate: 0.3 day
---

# T-1280: Lock a voice recording (mobile)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-14 (P2, `:99`): there's no lock to keep a recording going hands-free; Telegram has one. Step 1 (T-1202) added the short-press hint, haptics and the chevron. Today:
- the hold gesture is `createHoldResponder` (`apps/mobile/src/components/chat/voice-recorder-gesture.ts:36-61`): grant starts, release sends, and a slide left past `CANCEL_SLIDE_PX = -90` (`:7`) or a lost touch cancels;
- the recorder component is `apps/mobile/src/components/chat/voice-recorder.tsx` (336 lines):
  - `release` is at `:251-257`;
  - the recording row (red dot, timer, "Slide to cancel", trash) is at `:277-300`;
  - the mic `View` with the pan handlers is at `:301-310`;
  - haptics are at `:157-180`.

### What to build
1. **Gesture:**
   - in `voice-recorder-gesture.ts`, add `LOCK_SLIDE_PX = -70` (dy);
   - while holding, a move with `dy < LOCK_SLIDE_PX` (and not past the cancel slide) calls a new `lock()` handler once;
   - after locking, the release doesn't send or cancel: the recording keeps running.
2. **Locked state** in `voice-recorder.tsx`:
   - a `locked` state plus a haptic (Light) on lock;
   - the row shows the red dot and timer, a **Cancel** button (trash icon, accessibility label "Cancel recording") and a **Send** button (the composer's send style, accessibility label "Send voice message");
   - Send finishes and sends exactly as a release does today; Cancel discards exactly as a cancel does today;
   - the 5-minute cap still stops and sends.
3. **While holding but not locked,** show a small lock hint above the mic: a `Lock` icon from lucide with "Slide up to lock". Use icons, not emoji.
4. **File size:** move the recording row (the current `:277-300` plus the new locked variant) into a new `apps/mobile/src/components/chat/voice-recording-row.tsx`, so `voice-recorder.tsx` stays at most 400 lines.
5. **Accessibility:** update the mic's `accessibilityHint` to mention "slide up to lock".
6. **No tests** (UI). If the existing recorder tests (find them) break on a changed handler shape, update them minimally and cite them.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` MUX-14, `work/T-1202-mobile-voice-hints.md`, `apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts` and `apps/mobile/src/components/chat/voice-recorder-flow.ts`.

### Allowed files
`apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/components/chat/voice-recorder-gesture.ts`, `apps/mobile/src/components/chat/voice-recording-row.tsx`, `apps/mobile/src/components/chat/voice-recorder-flow.ts`, `apps/mobile/src/components/chat/*.test.ts`, `apps/mobile/src/components/chat/*.test.tsx`, `work/T-1280-voice-lock.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:**
  - hold the mic, slide up, release: the row shows the timer, Cancel and Send;
  - Send sends a voice message;
  - a second locked take with Cancel sends nothing.

---

## Report (written by the worker when done)

### What I did
- **Gesture (`voice-recorder-gesture.ts`):** added `LOCK_SLIDE_PX = -70` (dy) and a new `lock` handler on `HoldHandlers`. While holding, a move with `dy < LOCK_SLIDE_PX` that is not already past the cancel slide (`dx >= CANCEL_SLIDE_PX`) calls `lock()` once and sets `lockedRef`; from then on `onPanResponderMove` returns early and `onPanResponderRelease`/`onPanResponderTerminate` neither send nor cancel, so the finger can lift and the take keeps running. `onPanResponderGrant` resets `lockedRef` (via a new `lockedRef` parameter). The cancel slide still wins if the finger is past it when it slides up.
- **Locked state (`voice-recorder.tsx`):** added a `locked` state plus `lockedRef`, a `lock()` handler that shows the locked row and fires a `Haptics.ImpactFeedbackStyle.Light` impact. The `locked` flag is cleared in `finish()`, so Send, Cancel and the 5-minute cap all reset it. Send calls `finish(false)` and Cancel calls `finish(true)`, i.e. exactly the send/cancel paths a release used today; the cap still calls `finish(false)`.
- **New row (`voice-recording-row.tsx`):** the recording row moved out of `voice-recorder.tsx`. It keeps the existing holding variant (red dot, timer, "Slide to cancel"/"Release to cancel", trash icon) and adds the locked variant: red dot, timer, a spacer, a **Cancel** `Pressable` (trash icon, `accessibilityLabel="Cancel recording"`) and a **Send** `Pressable` (the composer's send key: `primaryKey` + `pressStyle` + `ArrowUp` in `ACCENT_FOREGROUND`, `accessibilityLabel="Send voice message"`). Both are driven through the page state hook `useKeyPress()` for the pressed look.
- **Lock hint:** while holding and not locked, a small hint above the mic shows a lucide `Lock` (size 12) and "Slide up to lock" (icons, not emoji), using the same tooltip placement as the existing short-press hint.
- **Accessibility:** the mic's `accessibilityHint` is now "Release to send, slide left to cancel, slide up to lock". The component doc comment was updated for the lock and for the mic now unmounting once locked.
- **Microphone on lock:** once locked the mic `View` is not rendered (the finger has lifted and the row's Cancel/Send replace it). Unmounting it may fire `onPanResponderTerminate`, but that is guarded by `lockedRef` so it cannot discard the take.

### Files changed
- `apps/mobile/src/components/chat/voice-recorder-gesture.ts` (62 -> 88 lines)
- `apps/mobile/src/components/chat/voice-recorder.tsx` (336 -> 348 lines)
- `apps/mobile/src/components/chat/voice-recording-row.tsx` (new, 87 lines)
- `work/T-1280-voice-lock.md` (this file)

### Commands and real results
- `pnpm install`: done, 10.5 s (deprecated `uuid@7.0.3` subdep warning and an unmet `@types/react` peer warning already present before my change).
- Targeted tests: none exist near these files. `grep` for `voice-recorder`/`VoiceRecorderButton`/`createHoldResponder`/`formatElapsed` in `apps/mobile/src/**/*.test.ts(x)` found no test importing the recorder, so spec item 6's "update existing tests minimally" has nothing to update. No tests written (UI, per the spec and AGENTS.md).
- `pnpm gate` (final, repo root): `PASS install (frozen) (0.9s)`, `PASS format (1.0s)`, `PASS lint (1.1s)`, `PASS typecheck (3.4s)`, `PASS effect (0.8s)`, `SKIP tests @zilar/mobile (no nearby test files)`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`, `GATE PASS`.
  - An earlier gate run failed on `format` only (`voice-recording-row.tsx`); fixed with `pnpm exec prettier --write apps/mobile/src/components/chat/voice-recording-row.tsx` and re-ran the gate to PASS.

### Deviations from the spec
- "Show a small lock hint above the mic": I placed it as a tooltip above the recorder container at `absolute right-0 bottom-full mb-3` (the same spot as the existing short-press hint). Since the mic is the rightmost element, it reads as above the mic. The exact pixel placement is a judgement call.
- Hiding the mic while locked is not spelled out in the spec; I did it because the finger has lifted and the row now owns Cancel/Send, and because the PanResponder is meaningless without a touch.

### Not done by me (needs the lead's phone smoke)
- The acceptance emulator checks (hold + slide up + release shows timer/Cancel/Send; Send sends; a second locked take with Cancel sends nothing) were not run — I have no emulator. This is UI covered by the lead's phone smoke.

### Security checklist
- No secrets, tokens or URLs logged. No new routes, deletes, updates, permissions, caps or audit entries — UI gesture/state only. Nothing reads user data at a new boundary.

### Blocked / needs a decision
- None.

### Round 2 (fix round)

- **Finding 1 (should-fix) — fixed.** `lock()` could latch while `begin` was still awaiting the native start; a failed start then left `locked === true` with `recording === false`, so neither the row nor the mic rendered and no gesture could recover until a remount. In `voice-recorder.tsx` the two start-failure paths now clear the lock: the `!result.started` branch of `onBegun` (the permission-denied case the finding names) sets `lockedRef.current = false` and `setLocked(false)` before showing the error, and the `Effect.catch` that handles a start that throws does the same. Clearing the lock with the failure re-renders the mic, so the composer can never be stranded.
- **Finding 2 (nit) — not touched**, per the fix-round rule to leave nits alone unless they sit in a line the fix changes; the tooltip placement is unchanged.
- **Tests added: none** (a deliberate deviation from the usual "add a test" rule, with reasons). The repo cut every mobile UI test on purpose (`T-0933: Cut the mobile tests: delete every UI test and every non-crucial test`), `AGENTS.md` says "UI code gets no tests", and spec item 6 says "No tests (UI)". `apps/mobile` has no component test harness (`@testing-library/react-native` and `react-test-renderer` are not installed, and `apps/mobile/src/components/chat/*.test.ts(x)` matches no files), and the fix is a React-state one-liner inside the component with no pure function to unit-test. A real test would need a new dependency, which `AGENTS.md` forbids. I did not add a fake or contrived test.
- **Disagreements:** none with the findings. The only thing I did beyond the exact wording is also clear the lock in the `Effect.catch` path, which is the same start-failure root cause the finding describes.
- **Commands:** `pnpm gate` (repo root) → `PASS install (frozen) (1.0s)`, `PASS format (1.7s)`, `PASS lint (0.9s)`, `PASS typecheck (2.7s)`, `PASS effect (0.5s)`, `SKIP tests @zilar/mobile (no nearby test files)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. No single tests were run (none exist near the change).

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (the lock is cleared when the recorder start fails).**
- **Lead's check on the emulator (mock build, before the one-line round-1 fix):**
  - hold the mic, slide up 264 px and release: the recording keeps running, and the row shows the red dot, the timer, a trash button and Send. Send posted a 0:07 voice message;
  - a second locked take with the trash button sent nothing, and the system mic indicator went off;
  - a plain 2 s hold and release still sends (0:02).
- **Not checked:** the "Slide up to lock" hint during the hold (the swipe was too fast to screenshot).
- **Lead's checks after the rebase:** mobile tsc: 0 errors. The recording row moved to `voice-recording-row.tsx`.
