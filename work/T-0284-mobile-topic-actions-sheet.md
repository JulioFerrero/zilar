---
id: T-0284
title: "Mobile kit migration: the topic actions sheet uses the kit ActionSheet"
status: todo
milestone: M5
branch: task/T-0284-mobile-topic-actions-sheet
model: auto
effort: low
depends_on: [T-0283]
estimate: 0.2 day
---

# T-0284: topic actions sheet on the kit ActionSheet

## Spec (written by Claude, do not edit)

### Why
T-0283 added `ActionSheet` and `ActionSheetItem` to the mobile kit (`apps/mobile/src/components/ui/action-sheet.tsx`) and moved the AI and chat long-press sheets onto them. Read `work/T-0283-mobile-kit-action-sheet.md` (Report) for how. The topic actions sheet has the same shape and is next.

### Verified facts (do not re-derive)
- **Kit API:**
  - `ActionSheet` props: `visible`, `onClose`, `closeLabel`, `header?` (node), `title?`, `children`, `error?`;
  - `ActionSheetItem` props: `label`, `accessibilityLabel?`, `onPress`, `disabled?`, `icon?` (lucide), `destructive?`, `inset?`;
  - the sheet draws the dividers and the safe-area bottom padding.
- **`TopicActionsSheet`** (`apps/mobile/src/components/chat/topic-sheets.tsx`, from line 32; its `Modal` is at line 53):
  - backdrop `accessibilityLabel="Close topic actions"`, `paddingBottom: 16` (no safe area);
  - a header row with the topic glyph tile, the title and, for a private topic, a `Lock` icon in a hard-coded `color="#8a8a8a"`;
  - rows: Pin/Unpin; Mute, or the mute duration rows plus Unmute while `muteOpen`; Archive/Unarchive; and, when `canArchive`, "Archive topic for everyone" in `text-danger` (ending near line 147).
  - Test: `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`. It is used from `apps/mobile/src/app/group/[id].tsx`.
- `TopicInfoSheet` (line 150 on) is a different shape. Leave it alone.
- **Muted icon colour:** `MUTED_FOREGROUND` in `apps/mobile/src/lib/colors.ts:37`. See how `ui/action-sheet.tsx` picks it per colour scheme.

### What to build
1. `TopicActionsSheet` renders through `ActionSheet`:
   - `closeLabel="Close topic actions"`;
   - its glyph, title and lock row passed as `header`, with the lock drawn in the kit's muted colour instead of `#8a8a8a`;
   - every row is an `ActionSheetItem` with the same label, accessibility label and callback; "Archive topic for everyone" is `destructive`.
   - The mute duration rows keep no indent: do not set `inset`.
2. `topic-actions-sheet.test.tsx` keeps all its assertions, with mocks updated as T-0283 did for `chat-actions-sheet.test.tsx`.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx` and its test (the T-0283 migration), `apps/mobile/src/components/chat/topic-sheets.tsx` lines 1-148, and `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`.

### Allowed files
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx` (only if its mocks need the new imports), `work/T-0284-mobile-topic-actions-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-actions-sheet topic-sheets
pnpm gate
```

### Acceptance
- `TopicActionsSheet` does not render a `Modal` itself and has no hard-coded colour. `TopicInfoSheet` is unchanged.
- Texts, labels and behaviour are unchanged, apart from the safe-area bottom padding.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
