---
id: T-1215
title: "Two bugs the lead found on the emulator (APK 86f8eef2): the mobile 'Hold to record' hint is squeezed to the mic's width and shows only 'H…'; and 'Send test notification' never shows anything, because the background wake handler skips while the app is open and the test is always sent from the open app"
status: merged
milestone: M5
branch: task/T-1215-voice-hint-and-test-push
model: auto
effort: default
depends_on: [T-1202, T-1208]
estimate: 0.1 day
---

# T-1215: Fix the voice hint width and the foreground test push

## Spec (written by Claude, do not edit)

### Why
The lead's emulator check of release APK `86f8eef2` against production found two bugs.
1. **A squeezed hint (T-1202):** a 400 ms press on the mic shows the hint box at the mic's width, with only "H" and an ellipsis inside. The hint `View` (`apps/mobile/src/components/chat/voice-recorder.tsx:315-321`, `absolute right-0 bottom-full …`) has no width, so it shrinks to its 36 px parent. The error popover right below it sets `w-64` (`:327`) and renders fine.
2. **A test push that never shows (T-1208):**
   - "Send test notification" says "Sent — leave the app to see it", and FCM **does** reach the phone: logcat shows `Finished task 'zilar-background-notification'` twice, within a second of each tap.
   - But nothing is posted: `onWake` returns at once while `AppState.currentState === 'active'` (`apps/mobile/src/lib/push/background.ts:135`), and the user is always in the app when they press the button.
   - Even pressing Home half a second after the tap was too slow.

### What to build
1. **`voice-recorder.tsx`:** give the hint the same width treatment as the error popover (`w-64`, or a width that fits its one line), so "Hold to record, release to send" shows in full on one or two lines.
2. **`background.ts`:**
   - a **test wake** (`payload.chatId === TEST_WAKE_CHAT_ID`) is posted **even while the app is active**: check the test-wake case before the `active` early return;
   - make sure a notification posted while the app is in the foreground is actually shown: find the app's `Notifications.setNotificationHandler` (none was found under `apps/mobile/src` by a quick grep; check `apps/mobile/src/app/_layout.tsx` and the push setup), and if none exists, show foreground notifications **only** for the test notification (match on its content or an identifier), never for chat messages;
   - change the settings page text "Sent — leave the app to see it" (`apps/mobile/src/app/settings/notifications.tsx`) to "Sent".
3. **Test** (push), 1, in `apps/mobile/src/lib/push/background.test.ts`: `onWake({ chatId: 'zilar:test' })` with `AppState.currentState === 'active'` posts the test notification, while a normal wake in the same state posts nothing.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/voice-recorder.tsx:300-335`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/background.test.ts`, `apps/mobile/src/app/settings/notifications.tsx` and `apps/mobile/src/app/_layout.tsx`.

### Allowed files
`apps/mobile/src/components/chat/voice-recorder.tsx`, `apps/mobile/src/lib/push/background.ts`, `apps/mobile/src/lib/push/background.test.ts`, `apps/mobile/src/app/settings/notifications.tsx`, `apps/mobile/src/app/_layout.tsx`, `work/T-1215-voice-hint-and-test-push.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/push/background.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:**
  - the short-press hint is readable;
  - "Send test notification" shows a notification while the app is open.

---

## Report (written by the worker when done)

Done. Both emulator bugs fixed; `pnpm gate` ends with GATE PASS and no files outside the Allowed list.

### What I did
1. **Voice hint width** (`apps/mobile/src/components/chat/voice-recorder.tsx:316`): added `w-64` to the short-press hint `View`, the same width treatment as the error popover below it (`:327`). "Hold to record, release to send" now fits on one or two lines instead of squeezing to the 36 px mic button.
2. **Foreground test push** (`apps/mobile/src/lib/push/background.ts`):
   - `onWake` now checks the test-wake case (`chatId === 'zilar:test'`) **before** the `AppState.currentState === 'active'` early return, so the test wake is posted even while the app is open; normal wakes are still skipped in the foreground.
   - `postTest` now schedules with `identifier: 'zilar-test'` (new exported `TEST_WAKE_IDENTIFIER`), so the foreground handler can tell it apart from chat posts.
   - New exported `isTestWake(notification)`: matches on the identifier, with the fixed title/body (`Zilar` / `Push notifications work on this device.`) as fallback for wakes scheduled before the identifier existed. Chat posts never match (message-text or `New message` bodies, no identifier).
   - New `Notifications.setNotificationHandler` at module scope (inside the existing `if (!MOCK_MODE)` block, next to the task registration): shows the test wake while the app is open (`shouldShowBanner/List: true`), keeps every chat post silent in the foreground (`false` across the board). None existed under `apps/mobile/src` before — confirmed `_layout.tsx` only imports the background module, so the handler lives there and is registered on cold start via the existing import.
3. **Settings text** (`apps/mobile/src/app/settings/notifications.tsx:281`): "Sent — leave the app to see it." → "Sent."
4. **Test** (`apps/mobile/src/lib/push/background.test.ts`): added "posts the test wake even while the app is in the foreground" — `onWake({ chatId: 'zilar:test' })` with `AppState.currentState === 'active'` schedules exactly one notification with the identifier and fixed text. The existing "posts nothing while the app is in the foreground" test (normal wake) still passes, proving the split behavior. Also added `setNotificationHandler: vi.fn()` to the `expo-notifications` mock (module scope now calls it).

`_layout.tsx` needed no change (allowed but not required): the handler is registered by the background module it already imports.

### Files changed
- `apps/mobile/src/components/chat/voice-recorder.tsx` (1 line: `w-64` on the hint)
- `apps/mobile/src/lib/push/background.ts` (+~60: identifier, `isTestWake`, `onWake` reorder, `setNotificationHandler`)
- `apps/mobile/src/lib/push/background.test.ts` (+18: mock fn + 1 test)
- `apps/mobile/src/app/settings/notifications.tsx` ("Sent.")
- `work/T-1215-voice-hint-and-test-push.md` (this Report + status)

### Commands and real results
- `pnpm install`: done (12s).
- `pnpm --filter @zilar/mobile exec vitest run src/lib/push/background.test.ts --reporter=dot`: 1 file passed, **5 passed** (4 existing + 1 new).
- `pnpm gate` (repo root): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile`, `scope: every changed file is inside the Allowed files`, `GATE PASS` (5 changed files against main: the 4 code files + this task file).
- Single tests run while working: only `background.test.ts` above, per instructions.
- Emulator check: not run here — needs the lead's emulator/phone smoke (Acceptance item 3). The behavior is covered by the unit test; please verify on device that the test notification appears while the app is open and the hint reads in full.

### Problems / deviations
- None from the spec. One judgment call: the content-fallback in `isTestWake` matches on the fixed title+body so a test notification scheduled by an older build (no identifier) still shows in the foreground; a chat post can never equal that body (message text or `New message`), so no chat message leaks through.
- Security checklist: no secrets/tokens in logs (warn paths untouched, error object only); no DB deletes/updates; no new routes; no message text in audit (no audit entries). The test wake still requires a session token via the existing `handleWake` path.

### Blocked / needs a decision
- Nothing. Ready for the lead's emulator check.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits.**
- **The hint:** it gets `w-64`, like the error popover.
- **The test wake:**
  - it's posted even while the app is active, and other wakes still skip;
  - the post carries the identifier `zilar-test`;
  - a `setNotificationHandler` shows only the test wake in the foreground (identifier, or the fixed title and body as a fallback), and chat posts stay hidden, as before;
  - the settings text is now "Sent".
- **Lead checks:** mobile push `background.test.ts` 5 of 5; mobile `tsc` gives 0 errors.
- **Still to do:** the emulator check with the next APK (the hint is readable, and the test shows while the app is open).
