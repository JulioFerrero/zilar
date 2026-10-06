---
id: T-0283
title: "Mobile kit: ActionSheet + ActionSheetItem; the AI and chat long-press sheets use it"
status: todo
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

## Review (written by Claude)
