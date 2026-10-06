---
id: T-0332
title: "Mobile: the New topic sheet moves onto the kit BottomSheet, so a long Private form scrolls and Create stays reachable"
status: todo
milestone: M5
branch: task/T-0332-mobile-new-topic-sheet
model: auto
effort: low
depends_on: [T-0329]
estimate: 0.2 day
---

# T-0332: New topic sheet on BottomSheet

## Spec (written by Claude, do not edit)

### Why
QA run 20 found an overflow (screenshot `qa20/03.png`, seen by the lead). In the Dev team mock, New topic → Private lists 4 people and 2 AIs, and the Cancel / Create row then spills below the card's bottom edge. The card is `max-h-[85%]` with no ScrollView, so a group with more members or roles pushes Create out of reach, and the keyboard is not handled either. T-0313 and T-0315 fixed the same problem for other sheets with the kit `BottomSheet`.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/chat/new-topic-sheet.tsx`:**
  - lines 99-295: a hand-rolled shell;
  - `<Modal visible transparent animationType="fade" onRequestClose={onClose}>`;
  - a backdrop `Pressable` (`accessibilityLabel="Close new topic"`, `flex-1 items-center justify-center bg-black/40 p-4`);
  - a card `Pressable` (`max-h-[85%] w-full max-w-sm rounded-2xl border border-border-strong bg-surface p-5`) with `paddingBottom: Math.max(insets.bottom, 20)`. `insets` comes from `useSafeAreaInsets()` at line 57.
  - The card holds a header Text "New topic" (lines 110-112), the "in {groupTitle}" line, the fields, and finally the Cancel / Create row (lines 272-292).
- **`apps/mobile/src/components/ui/bottom-sheet.tsx`:**
  - props: `visible`, `onClose`, `closeLabel`, `title?` (an 18 px header), `maxHeightClassName` (default `max-h-[85%]`) and `children`;
  - it renders a `Modal`, `KeyboardAvoidingView`, bottom padding (`sheetBottomPadding`) and a `ScrollView` with `keyboardShouldPersistTaps="handled"`.
  - Users: `apps/mobile/src/components/chat/visibility-sheet.tsx` and `apps/mobile/src/components/chat/topic-sheets.tsx`. Read one of them first.
- No test imports `new-topic-sheet.tsx`. `apps/mobile/src/app/group/[id].tsx:624` renders `<NewTopicSheet …>`.

### What to build
1. Replace the Modal, backdrop and card shell with `<BottomSheet visible={visible} onClose={onClose} closeLabel="Close new topic" title="New topic">`.
   - Drop the header Text, since `title` renders it.
   - Keep "in {groupTitle}" and every field, list and button inside the sheet, unchanged.
   - Remove the `useSafeAreaInsets` use, `Modal` and anything else that becomes unused.
2. **New file `apps/mobile/src/components/chat/new-topic-sheet.test.tsx`.** Copy the node-only pattern of `apps/mobile/src/components/chat/pins-sheet.test.tsx` (stub `BottomSheet` as a pass-through). The test checks that:
   - the sheet renders through `BottomSheet` with the title "New topic";
   - in private mode with 6 members, the Create button is still rendered inside the sheet's children.

### Read first
`AGENTS.md`, `docs/LEAD_HANDOFF.md` (the transitive test mocks pitfall), `work/T-0315-mobile-bottom-sheet-2.md` (Report), `apps/mobile/src/components/ui/bottom-sheet.tsx`, `apps/mobile/src/components/chat/visibility-sheet.tsx`, `apps/mobile/src/components/chat/pins-sheet.test.tsx`, and `apps/mobile/src/components/chat/new-topic-sheet.tsx`.

### Allowed files
`apps/mobile/src/components/chat/new-topic-sheet.tsx`, `apps/mobile/src/components/chat/new-topic-sheet.test.tsx`, `work/T-0332-mobile-new-topic-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-topic-sheet
pnpm gate
```

### Acceptance
- NewTopicSheet uses the kit `BottomSheet`; no `Modal` is left in the file.
- The new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
