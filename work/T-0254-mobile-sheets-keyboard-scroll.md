---
id: T-0254
title: "Mobile: create sheets taller than the space above the keyboard scroll so the last field and Create stay reachable (Android)"
status: merged
milestone: M5
branch: task/T-0254-mobile-sheets-keyboard-scroll
model: auto
effort: low
depends_on: [T-0234]
estimate: 0.2 day
---

# T-0254: create sheets scroll above the keyboard

## Spec (written by Claude, do not edit)

### Why
QA run 7 (2026-10-06, emulator, mock build of main after T-0234):
- The New group name step fits above the keyboard.
- The New channel sheet with Public selected is taller. With the keyboard open, the sheet moves up only partly: the Handle field is half hidden and Create is behind the keyboard (screenshot `~/.claude/jobs/fcd95e40/tmp/qa7/11.png`).
- The only way to reach Create was to close the keyboard.

### Verified facts (do not re-derive)
- `apps/mobile/src/components/chat/new-chat-button.tsx` lines 204-224: the create `Modal` wraps a `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`. Inside it is a `ScrollView` with `contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}` and `keyboardShouldPersistTaps={CREATE_SHEETS_SCROLL_TAPS_PERSIST}` (constant at line 27). A sibling `Pressable` "Close dialog" (`absolute inset-0`) is the backdrop.
- The channel sheet is `apps/mobile/src/components/chat/new-channel-sheet.tsx` (154 lines). Its Create button is at line 142 (`accessibilityLabel="Create channel"`), and its handle field sits in the visibility section that receives `onHandle` (line 113).
- `apps/mobile/src/components/nav/floating-tab-bar.tsx` lines 215-216 already listen to `Keyboard` `keyboardDidShow` / `keyboardDidHide`.

### What to build
1. New `apps/mobile/src/lib/use-keyboard-height.ts`: `useKeyboardHeight(): number`. It listens to `keyboardDidShow` (using `event.endCoordinates.height`) and `keyboardDidHide` (0), and removes both listeners on unmount. Put the pure part (event to height) in an exported function and test it in `apps/mobile/src/lib/use-keyboard-height.test.ts`.
2. In `new-chat-button.tsx`, on Android only:
   - drop the `KeyboardAvoidingView` behaviour (`behavior={Platform.OS === 'ios' ? 'padding' : undefined}`);
   - give the ScrollView's content a `paddingBottom` of `16 + keyboardHeight`, so a sheet taller than the free space can scroll;
   - when the keyboard height goes from 0 to more than 0, call `scrollToEnd({ animated: true })` on the ScrollView (via a ref), so the lowest field and Create come into view.
   iOS keeps its current `padding` behaviour.
3. Extend `apps/mobile/src/components/chat/new-chat-button.test.tsx` with a test for the Android padding rule (export a small pure helper, for example `createSheetBottomPadding(platform, keyboardHeight)`, and test it).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/new-chat-button.tsx` (lines 1-40 and 195-280), `apps/mobile/src/components/nav/floating-tab-bar.tsx` (lines 205-225).

### Allowed files
`apps/mobile/src/lib/use-keyboard-height.ts` (new), `apps/mobile/src/lib/use-keyboard-height.test.ts` (new), `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/chat/new-chat-button.test.tsx`, `work/T-0254-mobile-sheets-keyboard-scroll.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot use-keyboard-height new-chat-button
pnpm gate
```

### Acceptance
- On Android, with the keyboard open on the New channel sheet (Public), the Handle field and Create can be reached by the automatic scroll or by scrolling the sheet. The New group steps behave as before.
- Tapping the backdrop still closes the sheet, and taps inside the sheet do not.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
Changing the sheets' content or layout, and the floating tab bar.

---

## Report (written by the worker when done)

### What I did

- Added `apps/mobile/src/lib/use-keyboard-height.ts`: exported pure
  `keyboardHeightFromEvent(event)` (reads `event.endCoordinates.height`) and
  `useKeyboardHeight()`, which listens to `keyboardDidShow` / `keyboardDidHide`
  (0) and removes both listeners on unmount.
- Added `apps/mobile/src/lib/use-keyboard-height.test.ts`: covers the pure
  event reader (312 -> 312, 0 -> 0).
- `apps/mobile/src/components/chat/new-chat-button.tsx`:
  - exported pure `createSheetBottomPadding(platform, keyboardHeight)` ->
    `16 + keyboardHeight` on Android, `undefined` on iOS;
  - `KeyboardAvoidingView` behaviour is now
    `Platform.OS === 'ios' ? 'padding' : undefined` (Android no longer uses
    `height`);
  - the sheets' `ScrollView` gets a `ref`, and its content `paddingBottom` is
    `createSheetBottomPadding(Platform.OS, keyboardHeight)`;
  - a `useEffect` on `keyboardHeight` calls `scrollToEnd({ animated: true })`
    when the height goes from 0 to > 0.
- `apps/mobile/src/components/chat/new-chat-button.test.tsx`: mocks
  `@/lib/use-keyboard-height` and adds a `createSheetBottomPadding` describe
  (Android 16/336, iOS undefined).

### Files changed

- `apps/mobile/src/lib/use-keyboard-height.ts` (new)
- `apps/mobile/src/lib/use-keyboard-height.test.ts` (new)
- `apps/mobile/src/components/chat/new-chat-button.tsx`
- `apps/mobile/src/components/chat/new-chat-button.test.tsx`
- `work/T-0254-mobile-sheets-keyboard-scroll.md` (status + this report)

### Commands and real results

- `pnpm install`: done in 14s, code 0 (peer-dep warn only).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot use-keyboard-height new-chat-button`:
  2 test files passed, 8 tests passed (505 ms). (The test files print
  pre-existing React DOM casing warnings to stderr; no failures.)
- `pnpm gate` (repo root): first run FAIL at `format` on
  `new-chat-button.test.tsx`; after `pnpm exec prettier --write` on that file,
  second run:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.2s)`
  - `PASS  format  (15.5s)`
  - `PASS  lint  (0.8s)`
  - `PASS  typecheck  (6.2s)`
  - `PASS  tests @zilar/mobile  (1.4s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations

- None from the spec. No new dependencies, no file outside Allowed files, and
  `pnpm-lock.yaml` untouched.
- I could not verify the actual scroll on a device/emulator here; the behavior
  is pinned by the pure padding helper, the unit test, and the source change.

### Open questions

- None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (0 nits).
- I read the diff:
  - on Android, the `KeyboardAvoidingView` no longer sets a behaviour;
  - the content's bottom padding is 16 plus the keyboard height;
  - `scrollToEnd` runs when the keyboard opens;
  - iOS is unchanged.
- The emulator check of the New channel sheet (Public, keyboard open) goes into the next QA run.
