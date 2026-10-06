---
id: T-0283
title: "Mobile kit: ActionSheet + ActionSheetItem; the AI and chat long-press sheets use it"
status: merged
milestone: M5
branch: task/T-0283-mobile-kit-action-sheet
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0283: mobile kit ActionSheet

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src` has 24 files that hand-roll a `<Modal>` (`docs/audit/ui-kit-audit.md` §5 step 6). The simplest family is the bottom **action sheet**:
- a transparent `Modal` with `animationType="fade"`;
- a full-screen `Pressable` backdrop with an `accessibilityLabel` that closes on press;
- a `rounded-2xl bg-background` card with an optional title row and a list of action rows divided by `border-divider`;
- an optional error line.

This task adds that shape to the mobile kit and moves the two plainest sheets onto it.

### Verified facts (do not re-derive)
- **`apps/mobile/src/components/ais/ai-actions-sheet.tsx`** (115 lines):
  - `Modal visible={ai !== null}` at line 44; backdrop `accessibilityLabel="Close AI actions"`, `className="flex-1 justify-end bg-black/40 px-2"`, `paddingBottom: Math.max(insets.bottom, 16)` (lines 45-50);
  - a header row with `Avatar` and name (lines 52-59);
  - rows "Open chat", "Edit", Stop/Resume (disabled while `runBusy`), an error `Text` with `accessibilityRole="alert"`, and "Delete" in `text-danger` (lines 60-110). Row style: `px-4 py-3.5 active:bg-list-hover`, `text-[16px]`.
  - It has no test. It is used from `apps/mobile/src/app/(tabs)/ais.tsx:224`.
- **`apps/mobile/src/components/chat/chat-actions-sheet.tsx`** (168 lines):
  - same shell (lines 60-72), but `paddingBottom: 16` ignores the safe-area inset;
  - a title row (lines 73-77);
  - rows with an 18 px lucide icon in a hard-coded `color="#8a8a8a"` (lines 85, 122, 138);
  - mute submenu rows indented with `pl-9` (lines 90-112);
  - an error line (lines 157-163); row press style `active:bg-surface-raised`.
  - Test: `apps/mobile/src/components/chat/chat-actions-sheet.test.tsx`. It stubs `react-native`, `../ui/text`, `../../lib/utils` and `lucide-react-native` with `vi.mock` and renders to a plain tree. There is no React Native testing library.
  - Used from `apps/mobile/src/app/(tabs)/index.tsx`.
- **Mobile kit** (`apps/mobile/src/components/ui/`):
  - `ListRow`, `Card`, `SectionLabel`, `IconTile`, `CountBadge`, `Button`, `Text`;
  - tests in `kit.test.tsx`;
  - catalog screen `apps/mobile/src/app/dev/kit.tsx` (sections start with `<SectionLabel>`, for example line 96 "List rows").
- **Muted icon colour:** `MUTED_FOREGROUND` in `apps/mobile/src/lib/colors.ts:37`, keyed by colour scheme.

### What to build
1. **`apps/mobile/src/components/ui/action-sheet.tsx`:**
   - **`ActionSheet`** props: `visible`, `onClose`, `closeLabel` (the backdrop's accessibility label), optional `header` (node) or `title` (string), `children`, optional `error` (string, shown as an alert line);
   - it uses `paddingBottom: Math.max(insets.bottom, 16)`;
   - **`ActionSheetItem`** props: `label`, optional `accessibilityLabel` (defaults to `label`), `onPress`, `disabled`, optional `icon` (a lucide component, drawn at 18 px in `MUTED_FOREGROUND` for the scheme), `destructive` (`text-danger`), `inset` (the `pl-9` submenu indent);
   - **dividers:** a divider between items and none after the last one. No caller should manage borders by hand.
2. **Catalog and tests:**
   - add an "Action sheet" section to `apps/mobile/src/app/dev/kit.tsx` with a button that opens a sample sheet: title, two items with icons, one destructive, one disabled, an error line;
   - kit tests in `kit.test.tsx`, in the same stubbed style: items render labels, `disabled` passes through, the destructive style, and no divider after the last item.
3. **Migrate `AiActionsSheet` and `ChatActionsSheet`:**
   - keep every label, accessibility label, disabled rule and callback;
   - `ChatActionsSheet` gains the safe-area bottom padding and loses the hard-coded `#8a8a8a`;
   - update `chat-actions-sheet.test.tsx` mocks as needed, and keep all its assertions.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/list-row.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, and the two sheets plus the chat sheet test.

### Allowed files
`apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/ui/kit.test.tsx`, `apps/mobile/src/app/dev/kit.tsx`, `apps/mobile/src/components/ais/ai-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.test.tsx`, `work/T-0283-mobile-kit-action-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit chat-actions-sheet
pnpm gate
```

### Acceptance
- Neither migrated sheet imports `Modal` from `react-native`, and neither hard-codes a colour.
- Texts, labels and behaviour are unchanged, apart from the safe-area padding.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The other 22 `Modal` files: sheets with inputs and keyboard handling, pickers, confirms. They come later, one family at a time.

---

## Report (written by the worker when done)

**What I did**

- Added `ActionSheet` + `ActionSheetItem` in `apps/mobile/src/components/ui/action-sheet.tsx`.
  - `ActionSheet` owns the shell: fade `Modal` (`transparent`, `onRequestClose`), a full-screen `Pressable` backdrop closed on tap with the caller's `closeLabel`, `paddingBottom: Math.max(insets.bottom, 16)`, an optional `header` node or `title` string, the items, and an optional `error` alert line. Dividers come from `Children.toArray(children)` plus a wrapper `View` (`border-b border-divider`) after every item except the last; when an `error` line is present the last item is also separated, so no caller manages borders.
  - `ActionSheetItem` props: `label`, `accessibilityLabel` (defaults to `label`), `onPress`, `disabled`, optional lucide `icon` (18 px, `MUTED_FOREGROUND[scheme]`), `destructive` (`text-danger`), `inset` (`pl-9`). Row style `flex-row items-center gap-3 px-4 py-3.5 active:bg-list-hover disabled:opacity-50`, label `text-[16px]`.
- Added an "Action sheet" section to `apps/mobile/src/app/dev/kit.tsx`: a button that opens a sample sheet with a title, two icon items, a destructive item, a disabled item and an error line.
- Migrated `AiActionsSheet` and `ChatActionsSheet` onto the kit. Every label, accessibility label, disabled rule and callback is unchanged. `AiActionsSheet` keeps its `Avatar` header via the `header` node; its error still renders with `accessibilityRole="alert"`. `ChatActionsSheet` now uses the safe-area padding (was hard-coded `16`) and its icons go through `ActionSheetItem`, so `#8a8a8a` is gone.
- Tests: `kit.test.tsx` gained `Modal` in the `react-native` stub, stubs for `react-native-safe-area-context` and `nativewind`, and an ActionSheet describe block (labels, disabled pass-through, destructive style, icon at 18 px, divider count). `chat-actions-sheet.test.tsx` gained the safe-area and nativewind stubs; all its existing assertions are untouched.
- Acceptance check: neither migrated sheet imports `Modal` from `react-native` and neither hard-codes a colour.

**Files changed** (all inside the Allowed files)

- `apps/mobile/src/components/ui/action-sheet.tsx` (new)
- `apps/mobile/src/components/ui/kit.test.tsx`
- `apps/mobile/src/app/dev/kit.tsx`
- `apps/mobile/src/components/ais/ai-actions-sheet.tsx`
- `apps/mobile/src/components/chat/chat-actions-sheet.tsx`
- `apps/mobile/src/components/chat/chat-actions-sheet.test.tsx`
- `work/T-0283-mobile-kit-action-sheet.md`

**Commands and results**

- `pnpm install`: finished, no lockfile change.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot kit chat-actions-sheet`: 2 test files passed, 21 tests passed.
- `pnpm gate`: `gate: 7 changed file(s) against main`; ends with `GATE PASS`; scope line "every changed file is inside the Allowed files". Summary lines: `PASS install (frozen) (1.1s)`, `PASS format (15.4s)`, `PASS lint (1.2s)`, `PASS typecheck (6.8s)`, `PASS tests @zilar/mobile (1.4s)`.

**Deviations**

- The spec lists the `error` line after the items, so `ActionSheet` renders it at the bottom of the card. In `AiActionsSheet` this puts the error below the `Delete` row (it used to sit between Stop/Resume and Delete). Text, `alert` role, labels and callbacks are unchanged; the sheet still stays open on failure. Flagging in case the exact order matters.
- The mute submenu rows used `py-3` while other rows used `py-3.5`; the shared `ActionSheetItem` uses `py-3.5`. The `pl-9` indent is preserved via `inset`.
- Shared row press style is `active:bg-list-hover` (the AI sheet's token). `list-hover` and `surface-raised` are both `#171717` in `global.css`, so the choice is visually neutral.

**Open questions**

- None.

## Review (written by Claude)

**Approved.** Clean pre-review, no fix rounds. Neither sheet imports `Modal` any more or hard-codes a colour, and the chat sheet now respects the safe area.

**Accepted nits:**
- the AI run error now sits under Delete, because the error line belongs to the sheet;
- mute rows are 2 px taller;
- inset and icon would stack if a caller ever set both.

**Next step:** emulator QA runs after the merge.
