---
id: T-0315
title: "Mobile kit migration: visibility, group members/roles and topic info sheets use the kit BottomSheet"
status: todo
milestone: M5
branch: task/T-0315-mobile-bottom-sheet-2
model: auto
effort: low
depends_on: [T-0313]
estimate: 0.3 day
---

# T-0315: BottomSheet, batch 2

## Spec (written by Claude, do not edit)

### Why
T-0313 added the kit `BottomSheet` (`apps/mobile/src/components/ui/bottom-sheet.tsx`) and moved the pins and invite links sheets onto it. Read its Report in `work/T-0313-mobile-kit-bottom-sheet.md` first.

This batch moves three more panel sheets. It also fixes two real gaps:
- the group members/roles sheet has no `ScrollView`, so a long member list is cut off at `max-h-[80%]`;
- its "New role name" field has no keyboard handling.

### Verified facts (do not re-derive)
- **`BottomSheet` props:** `visible`, `onClose`, `closeLabel`, `title?` (an 18 px header `Text`), `maxHeightClassName?` (default `'max-h-[85%]'`) and `children`.
  - It renders the keyboard-aware layout (`KeyboardAvoidingView` + `sheetBottomPadding` + a `ScrollView` with `keyboardShouldPersistTaps="handled"`) and the grab handle itself.
- **`apps/mobile/src/components/chat/visibility-sheet.tsx`:**
  - lines 130-284: the same layout, written by hand (T-0310), with backdrop label "Close visibility settings" and `max-h-[85%]`;
  - after the handle comes the header "Visibility" (`text-[18px]`, lines 149-154), then the content up to line 279.
- **`apps/mobile/src/components/chat/group-roles-sheet.tsx`:**
  - line 82: `Modal`; backdrop label "Close group members and roles";
  - the panel has `max-h-[80%]`, `paddingBottom: Math.max(insets.bottom, 16)` and no `ScrollView`;
  - after the handle comes the header `{groupTitle} · Members ({members.length})` (`py-2 text-[17px]`, lines 93-98), then the content;
  - lines 2-3 import `Modal, Pressable, View` and `useSafeAreaInsets`.
- **`apps/mobile/src/components/chat/topic-sheets.tsx`:**
  - line 201: the topic info sheet's `Modal` (`visible={chat !== null}`); backdrop label "Close topic info";
  - the panel has `max-h-[80%]` and `paddingBottom: Math.max(insets.bottom, 16)`, then the handle;
  - its header is a custom avatar row, not a plain title, so pass no `title`;
  - lines 3-4 import `Modal, Pressable, View` and `useSafeAreaInsets`; line 187 is `const insets`.
- **Tests:**
  - visibility: `apps/mobile/src/components/chat/visibility-sheet.test.ts`, `apps/mobile/src/components/chat/visibility-fields.test.tsx`, `apps/mobile/src/components/chat/new-channel-sheet.test.tsx`;
  - roles: `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`;
  - topic sheets: `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`.
  - T-0313 changed `pins-sheet.test.tsx` to stub `@/components/ui/bottom-sheet`; see how.

### What to build
1. **visibility-sheet:**
   - `<BottomSheet visible={visible} onClose={onClose} closeLabel="Close visibility settings" title="Visibility">` around the content (from the radiogroup to the end);
   - remove the hand-written layout, the handle, the header `Text`, and imports that become unused (`KeyboardAvoidingView`, `ScrollView`, `Platform`, `sheetBottomPadding`, `useKeyboardHeight`, `useSafeAreaInsets`, `Modal`), but only where nothing else in the file uses them.
2. **group-roles-sheet:**
   - `<BottomSheet visible={visible} onClose={onClose} closeLabel="Close group members and roles" title={`${groupTitle} · Members (${members.length})`} maxHeightClassName="max-h-[80%]">` around the content;
   - remove the old shell, handle, header and unused imports.
3. **topic-sheets** (the topic info sheet only):
   - `<BottomSheet visible={chat !== null} onClose={onClose} closeLabel="Close topic info" maxHeightClassName="max-h-[80%]">` around the existing content (from the `chat !== null && topic !== undefined` block on);
   - remove the old shell, handle and unused imports; keep everything else in the file.
4. **Tests:** existing tests keep passing. In the listed tests you may change mocks, and any element walk that has to go through `BottomSheet`; every assertion keeps checking the same thing.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the mobile test mocks pitfall, including the transitive part), `apps/mobile/src/components/ui/bottom-sheet.tsx`, `work/T-0313-mobile-kit-bottom-sheet.md` (Report), `apps/mobile/src/components/chat/pins-sheet.test.tsx`, the three sheets and their tests.

### Allowed files
`apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/visibility-sheet.test.ts`, `apps/mobile/src/components/chat/visibility-fields.test.tsx` (mocks only), `apps/mobile/src/components/chat/new-channel-sheet.test.tsx` (mocks only), `apps/mobile/src/components/chat/group-roles-sheet.test.tsx`, `apps/mobile/src/components/chat/group-roles-mounted.test.tsx`, `apps/mobile/src/components/chat/group-roles-load.test.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `work/T-0315-mobile-bottom-sheet-2.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot visibility new-channel-sheet group-roles topic-sheets-roles topic-actions-sheet
pnpm gate
```

### Acceptance
- None of the three sheets renders its own `Modal`.
- Their texts, labels and behaviour are unchanged.
- The members/roles sheet now scrolls and stays above the keyboard.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
- The emoji, GIF and sticker panels (fixed `h-[50%]` panels with their own lists);
- the attach sheet;
- the Telegram import sheet.

---

## Report (written by the worker when done)

## Review (written by Claude)
