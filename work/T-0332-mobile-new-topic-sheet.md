---
id: T-0332
title: "Mobile: the New topic sheet moves onto the kit BottomSheet, so a long Private form scrolls and Create stays reachable"
status: merged
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

Done. NewTopicSheet renders through the kit `BottomSheet`; no `Modal` is left in the file.

What I did:
- `apps/mobile/src/components/chat/new-topic-sheet.tsx`: renders `<BottomSheet visible onClose closeLabel="Close new topic" title="New topic">` around the content, starting with the "in {groupTitle}" line. Removed the hand-rolled `Modal`/backdrop/card shell, the header `Text` (the kit renders it from `title`), the `useSafeAreaInsets` use and the now-unused `Modal` import. All fields, the member/AI lists and the Cancel/Create row are unchanged. The long Private form now scrolls inside the kit `ScrollView` and stays above the keyboard.
- `apps/mobile/src/components/chat/new-topic-sheet.test.tsx` (new): node-only pattern copied from `pins-sheet.test.tsx` (BottomSheet stubbed as a pass-through, `react-native`/kit children stubbed). The sheet is stateful (`useState`), so the test stubs `react`'s `useState` with a fixed visibility value per test. Checks: renders through `BottomSheet` with title "New topic"; in private mode with 6 members all names plus the Create button are rendered inside the sheet's children.
- Transitive check: `grep` for tests importing `new-topic-sheet`/`NewTopicSheet` found none (only `apps/mobile/src/app/group/[id].tsx` renders it at runtime), so no other test file needed a mock update.

Files changed (all inside Allowed files): the sheet, the new test, plus this task file.

Commands (real results):
- `pnpm install`: ok (11.2 s).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot new-topic-sheet`: 1 file, 2 tests passed.
- `pnpm gate` (final): GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/mobile PASS; "scope: every changed file is inside the Allowed files". One intermediate gate run failed on prettier formatting in my 2 files (my manual re-indent); fixed with `prettier --write` on those 2 files only, re-ran the single test (2 passed) before the final gate.

Problems / deviations: none. Security checklist: no secrets, no deletes/updates, no caps, no new routes, no audit entries, no user-facing text changes (the "New topic" header is now rendered by the kit `title` prop, identical string).

Round fix-1 (PREREVIEW findings): finding 1 — BottomSheet stub now keeps its props; test 1 finds the `{ type: 'BottomSheet' }` element and asserts `title === 'New topic'` and `closeLabel === 'Close new topic'`, plus asserts no `Text` child with exactly "New topic". Finding 2 (nit) — test 2 presses Create with an empty name and now asserts `onCreate` was not called. Single test: 1 file, 2 tests passed. `pnpm gate`: GATE PASS — install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/mobile PASS; "scope: every changed file is inside the Allowed files". (An intermediate gate run failed on prettier in the test file; fixed with `prettier --write` on that file only, re-ran the single test (2 passed) before the final gate.)

## Review (written by Claude)

**Approved** after one fix round. The automatic round had died on the free-Muse rate limit with no fallback, so the lead switched the session to the paid Muse and resent the round; T-0335 fixes the autopilot gap. `NewTopicSheet` renders through the kit `BottomSheet` (`title="New topic"`, `closeLabel="Close new topic"`): the long Private form scrolls, the keyboard is handled, and Create stays reachable. The rest of the diff is re-indentation of the unchanged fields. The new tests assert the BottomSheet props directly, check that Create renders with 6 members, and check that an empty name does not call `onCreate`.
