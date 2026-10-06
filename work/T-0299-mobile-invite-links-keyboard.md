---
id: T-0299
title: "Mobile fix: the invite links sheet moves above the keyboard and scrolls"
status: merged
milestone: M5
branch: task/T-0299-mobile-invite-links-keyboard
model: auto
effort: low
depends_on: [T-0297]
estimate: 0.2 day
---

# T-0299: invite links sheet and the keyboard

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 13 found a bug in the invite links sheet. Tapping "Expiry in hours" opens the numeric keyboard, and the keyboard covers:
- the Expiry and Max uses fields;
- "Create invite link";
- the links list.

The sheet does not move up or scroll. The sheet has never handled the keyboard; T-0297 only changed its fields.

T-0254 fixed the same problem in the create sheets of `apps/mobile/src/components/chat/new-chat-button.tsx`. On Android (edge-to-edge, Expo SDK 57) the window no longer resizes for the keyboard, so those sheets pad their scroll content by the keyboard height.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/invite-links-sheet.tsx`:**
  - line 2 imports `Modal, Pressable, View` from `react-native`;
  - line 161: the `Modal`, which holds a backdrop `Pressable` (`flex-1 justify-end bg-black/40`, `onPress={onClose}`);
  - lines 167-171: the sheet `Pressable`, `className="max-h-[85%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"` and `style={{ paddingBottom: Math.max(insets.bottom, 16) }}`;
  - the sheet's children are the handle, the header, the form (or `CreatedInviteLinkView`), the error, and the links list (`links.map`, about line 247). There is no `ScrollView`.
- **`apps/mobile/src/lib/use-keyboard-height.ts`:** `useKeyboardHeight()` returns the keyboard height in dp, or 0 when the keyboard is hidden. It listens to `Keyboard` `keyboardDidShow` and `keyboardDidHide`.
- **The T-0254 pattern, in `new-chat-button.tsx` lines 238-252:**
  - `KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}`;
  - a `ScrollView` with `keyboardShouldPersistTaps="handled"`;
  - Android bottom padding of `16 + keyboardHeight` (`createSheetBottomPadding`, line 38).
  - Do **not** import from `new-chat-button.tsx`: it pulls in the chat store and would break the sheet's test mocks.
- **`apps/mobile/src/components/chat/invite-links-sheet.test.tsx`:**
  - lines 17-23 mock `react-native` with only `Modal`, `Pressable`, `Share`, `TextInput` and `View`;
  - add whatever the new code needs: `ScrollView`, `KeyboardAvoidingView`, `Platform`, and `Keyboard` with `addListener` returning `{ remove }`.

### What to build
1. In `invite-links-sheet.tsx`, export a pure helper:
   ```ts
   inviteSheetBottomPadding(platform: string, insetBottom: number, keyboardHeight: number): number
   ```
   - It returns `Math.max(insetBottom, 16)`, plus `keyboardHeight` when `platform === 'android'`.
   - Add a short doc comment naming T-0254 and this task.
2. Inside the `Modal`:
   - wrap the backdrop in `KeyboardAvoidingView`, with `behavior` `'padding'` on iOS and `undefined` otherwise, and `className="flex-1"`;
   - the sheet `Pressable` keeps `max-h-[85%]` and its look, and uses `paddingBottom: inviteSheetBottomPadding(Platform.OS, insets.bottom, keyboardHeight)`;
   - put the sheet's content (header through links list) inside a `ScrollView` with `keyboardShouldPersistTaps="handled"`, so the form, the Create button and the list can be scrolled into view while the keyboard is open;
   - a tap on the backdrop still closes the sheet, and a tap inside it does not.
3. **Tests in `invite-links-sheet.test.tsx`:**
   - existing tests keep passing; extend the `react-native` mock as needed;
   - add `inviteSheetBottomPadding` cases:
     - `('android', 0, 0)` gives 16;
     - `('android', 24, 300)` gives 324;
     - `('ios', 34, 300)` gives 34.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall), `apps/mobile/src/lib/use-keyboard-height.ts`, `apps/mobile/src/components/chat/new-chat-button.tsx` lines 25-45 and 230-300, the sheet and its test.

### Allowed files
`apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `work/T-0299-mobile-invite-links-keyboard.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invite-links-sheet
pnpm gate
```

### Acceptance
- On Android, the sheet's content is padded by the keyboard height and scrolls, so every field and "Create invite link" can be reached while the keyboard is open.
- iOS uses `KeyboardAvoidingView` padding.
- Texts, labels and behaviour are otherwise unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Added `inviteSheetBottomPadding(platform, insetBottom, keyboardHeight)` to `apps/mobile/src/components/chat/invite-links-sheet.tsx` (returns `Math.max(insetBottom, 16)` plus keyboard height on android).
- Wrapped the backdrop `Pressable` in `KeyboardAvoidingView` (`behavior` `'padding'` on iOS, `undefined` otherwise, `className="flex-1"`); sheet `Pressable` keeps `max-h-[85%]` and now uses the helper for `paddingBottom`; sheet content (handle through links list) is inside a `ScrollView` with `keyboardShouldPersistTaps="handled"`. Backdrop tap still closes, inner tap does not. Wired `useKeyboardHeight()`.
- Extended the `react-native` mock (`Keyboard`, `KeyboardAvoidingView`, `Platform`, `ScrollView`) and added 3 `inviteSheetBottomPadding` cases: android/0/0 -> 16, android/24/300 -> 324, ios/34/300 -> 34.
- Files changed: `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `work/T-0299-mobile-invite-links-keyboard.md`.
- Commands:
  - `pnpm install`: pass.
  - `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot invite-links-sheet`: 15 passed (12 existing + 3 new).
  - `pnpm exec prettier --write` on the two touched source files: fixed format fail flagged by first gate run.
  - `pnpm gate`: GATE PASS. Summary: `3 changed file(s) against main; PASS install (frozen); PASS format; PASS lint; PASS typecheck; PASS tests @zilar/mobile; scope: every changed file is inside the Allowed files; GATE PASS`.
- Security checklist: no secrets/tokens logged; no deletes/updates; no caps; no new routes; no audit entries. No deviations from spec.

## Review (written by Claude)

**Approved.** Clean pre-review (0 nits), no fix rounds (Muse, peak).
- The sheet sits in a `KeyboardAvoidingView` (`padding` on iOS).
- Its content scrolls inside a `ScrollView` with `keyboardShouldPersistTaps="handled"`.
- `inviteSheetBottomPadding` adds the keyboard height on Android, with 3 tests.

**Still to do:** emulator QA in the next run.
