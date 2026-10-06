---
id: T-0310
title: "Mobile fix: the group visibility sheet moves above the keyboard; the sheet padding helper moves to lib"
status: merged
milestone: M5
branch: task/T-0310-mobile-visibility-sheet-keyboard
model: auto
effort: low
depends_on: [T-0299, T-0302]
estimate: 0.2 day
---

# T-0310: visibility sheet and the keyboard

## Spec (written by Claude, do not edit)

### Why
Emulator QA run 15 checked the group screen's eye icon → Visibility sheet → Public, then a tap on the Handle field. The keyboard covered the whole sheet, so the Handle field, the availability line and Save could not be seen while typing. The lead checked the screenshot. This is the same bug T-0299 fixed in the invite links sheet.

T-0299 put its padding helper inside `invite-links-sheet.tsx`. This task moves it to `lib` so both sheets share it.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/invite-links-sheet.tsx`:**
  - lines 90-103: `export function inviteSheetBottomPadding(platform, insetBottom, keyboardHeight)` returns `Math.max(insetBottom, 16)`, plus `keyboardHeight` on Android;
  - it is used at line 193, inside the T-0299 layout: `KeyboardAvoidingView` (`behavior` `'padding'` on iOS), then the backdrop `Pressable`, then the sheet `Pressable` (`max-h-[85%]`), then a `ScrollView` with `keyboardShouldPersistTaps="handled"`.
- **`apps/mobile/src/components/chat/invite-links-sheet.test.tsx`:** line 8 imports the helper, and its three cases are at lines 269-281.
- **`apps/mobile/src/lib/use-keyboard-height.ts`:** exports `useKeyboardHeight()` and `keyboardHeightFromEvent`. Its tests are in `apps/mobile/src/lib/use-keyboard-height.test.ts`.
- **`apps/mobile/src/components/chat/visibility-sheet.tsx`:**
  - line 2 imports `Modal, Pressable, View`;
  - line 102: `const insets = useSafeAreaInsets()`;
  - line 128: the `Modal`;
  - line 129: the backdrop `Pressable`;
  - lines 134-137: the sheet `Pressable` with `className="max-h-[85%] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"` and `style={{ paddingBottom: Math.max(insets.bottom, 16) }}`;
  - the sheet's content ends at line 261. There is no `ScrollView` and no keyboard handling.
- **`apps/mobile/src/components/chat/visibility-sheet.test.ts`:**
  - lines 8-13 mock `react-native` with `Modal`, `Pressable`, `TextInput` and `View` only;
  - it already mocks `nativewind`.

### What to build
1. **The helper moves to lib:**
   - move it into `apps/mobile/src/lib/use-keyboard-height.ts` as `export function sheetBottomPadding(platform: string, insetBottom: number, keyboardHeight: number): number`, keeping the same body and doc comment;
   - `invite-links-sheet.tsx` imports it from there and no longer defines `inviteSheetBottomPadding`;
   - move the three test cases from `invite-links-sheet.test.tsx` to `use-keyboard-height.test.ts` under `describe('sheetBottomPadding')`, and remove the old import and `describe` block.
2. **The visibility sheet gets the T-0299 layout:**
   - wrap the backdrop in `KeyboardAvoidingView` (`behavior` `'padding'` on iOS, `undefined` otherwise, `className="flex-1"`);
   - the sheet `Pressable` uses `paddingBottom: sheetBottomPadding(Platform.OS, insets.bottom, keyboardHeight)`, with `keyboardHeight` from `useKeyboardHeight()`;
   - put the sheet's content inside a `ScrollView` with `keyboardShouldPersistTaps="handled"`;
   - a backdrop tap still closes the sheet, and a tap inside it does not.
3. **Tests:**
   - extend the `react-native` mock in `visibility-sheet.test.ts` as needed: `ScrollView`, `KeyboardAvoidingView`, `Platform`, and `Keyboard` with `addListener` returning `{ remove }`;
   - all existing tests keep passing.

### Read first
`AGENTS.md`, `work/T-0299-mobile-invite-links-keyboard.md` (Report), `apps/mobile/src/lib/use-keyboard-height.ts`, the two sheets and their tests.

### Allowed files
`apps/mobile/src/lib/use-keyboard-height.ts`, `apps/mobile/src/lib/use-keyboard-height.test.ts`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/visibility-sheet.test.ts`, `work/T-0310-mobile-visibility-sheet-keyboard.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot use-keyboard-height invite-links-sheet visibility-sheet
pnpm gate
```

### Acceptance
- On Android, the visibility sheet's content is padded by the keyboard height and scrolls, so the Handle field, its availability line and Save can be reached while the keyboard is open.
- `sheetBottomPadding` lives in `lib/use-keyboard-height.ts` and is used by both sheets; `inviteSheetBottomPadding` is gone.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)
- Moved `inviteSheetBottomPadding` to `apps/mobile/src/lib/use-keyboard-height.ts` as `sheetBottomPadding(platform, insetBottom, keyboardHeight)` with the same body and an updated doc comment naming T-0310/T-0299/T-0254. `invite-links-sheet.tsx` imports it from lib; `inviteSheetBottomPadding` is gone.
- Moved the three padding cases from `invite-links-sheet.test.tsx` to `use-keyboard-height.test.ts` under `describe('sheetBottomPadding')`; removed the old import and describe block.
- Gave `visibility-sheet.tsx` the T-0299 layout: backdrop wrapped in `KeyboardAvoidingView` (`behavior` `'padding'` on iOS, `undefined` otherwise, `className="flex-1"`), sheet `Pressable` keeps `max-h-[85%]` and uses `paddingBottom: sheetBottomPadding(Platform.OS, insets.bottom, keyboardHeight)` via `useKeyboardHeight()`, content inside `ScrollView` with `keyboardShouldPersistTaps="handled"`. Backdrop tap still closes (`onClose`), inner tap is a no-op.
- Extended the `react-native` mock in `visibility-sheet.test.ts` with `ScrollView`, `KeyboardAvoidingView`, `Platform`, and `Keyboard` with `addListener` returning `{ remove }`.
- Files changed: `apps/mobile/src/lib/use-keyboard-height.ts`, `apps/mobile/src/lib/use-keyboard-height.test.ts`, `apps/mobile/src/components/chat/invite-links-sheet.tsx`, `apps/mobile/src/components/chat/invite-links-sheet.test.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/visibility-sheet.test.ts`, `work/T-0310-mobile-visibility-sheet-keyboard.md`.
- Commands:
  - `pnpm install`: pass.
  - `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot use-keyboard-height invite-links-sheet visibility-sheet`: 3 files, 20 tests passed.
  - `pnpm exec prettier --write apps/mobile/src/components/chat/visibility-sheet.tsx`: fixed format fail flagged by first gate run.
  - `pnpm gate`: GATE PASS. Summary: `7 changed file(s) against main; PASS install (frozen); PASS format; PASS lint; PASS typecheck; PASS tests @zilar/mobile; scope: every changed file is inside the Allowed files; GATE PASS`.
- Security checklist: no secrets/tokens logged; no deletes/updates; no caps; no new routes; no audit entries. No deviations from spec.

## Review (written by Claude)

**Approved.** Clean pre-review (0 nits), no fix rounds (Muse, peak).
- `sheetBottomPadding` now lives in `lib/use-keyboard-height.ts`, with its 3 tests moved there; `inviteSheetBottomPadding` is gone (checked with the lead's grep).
- The visibility sheet has the T-0299 layout: `KeyboardAvoidingView`, keyboard-height padding, and a `ScrollView` that keeps taps.

**Still to do:** emulator QA in the next run.
