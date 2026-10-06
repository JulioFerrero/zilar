---
id: T-0284
title: "Mobile kit migration: the topic actions sheet uses the kit ActionSheet"
status: merged
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
2. **QA run 10 finding:** in `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, the "Open group" `ActionSheetItem` (line 110) has no icon. Its text therefore starts at the left edge, out of line with Pin, Mute and Archive, which have icons. Give it the lucide `Users` icon, and add `Users` to the `lucide-react-native` mock in `chat-actions-sheet.test.tsx` (line 33).
3. `topic-actions-sheet.test.tsx` keeps all its assertions, with mocks updated as T-0283 did for `chat-actions-sheet.test.tsx`.

### Read first
`AGENTS.md`, `apps/mobile/src/components/ui/action-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.tsx` and its test (the T-0283 migration), `apps/mobile/src/components/chat/topic-sheets.tsx` lines 1-148, and `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`.

### Allowed files
`apps/mobile/src/components/chat/topic-sheets.tsx`, `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`, `apps/mobile/src/components/chat/topic-sheets-roles.test.tsx` (only if its mocks need the new imports), `apps/mobile/src/components/chat/chat-actions-sheet.tsx`, `apps/mobile/src/components/chat/chat-actions-sheet.test.tsx`, `work/T-0284-mobile-topic-actions-sheet.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-actions-sheet topic-sheets chat-actions-sheet
pnpm gate
```

### Acceptance
- `TopicActionsSheet` does not render a `Modal` itself and has no hard-coded colour. `TopicInfoSheet` is unchanged.
- Texts, labels and behaviour are unchanged, apart from the safe-area bottom padding.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**

- `TopicActionsSheet` renders through the kit `ActionSheet` (`closeLabel="Close topic actions"`), so it no longer renders a `Modal` or owns the dividers. Its glyph tile, title and private `Lock` row are passed as `header`; the lock is now drawn with `MUTED_FOREGROUND[scheme]` (`asColorScheme(useColorScheme().colorScheme)`), not `#8a8a8a`. Every row is an `ActionSheetItem` with the same label, accessibility label and callback; the mute-duration rows keep no indent (no `inset`); "Archive topic for everyone" is `destructive`. `TopicInfoSheet` is untouched.
- `chat-actions-sheet.tsx`: imported lucide `Users` and gave the "Open group" item `icon={Users}` (QA run 10). `chat-actions-sheet.test.tsx`: added `Users` to the `lucide-react-native` mock.
- `topic-actions-sheet.test.tsx`: keeps all its assertions. The safe-area and nativewind mocks were already present; I added the `../../lib/utils` `cn` mock to match the T-0283 chat-sheet test.

**Files changed** (all inside the Allowed files)

- `apps/mobile/src/components/chat/topic-sheets.tsx`
- `apps/mobile/src/components/chat/topic-actions-sheet.test.tsx`
- `apps/mobile/src/components/chat/chat-actions-sheet.tsx`
- `apps/mobile/src/components/chat/chat-actions-sheet.test.tsx`
- `work/T-0284-mobile-topic-actions-sheet.md`

**Commands and results**

- `pnpm install`: finished, no lockfile change (1 peer-dependency warning, pre-existing).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-actions-sheet topic-sheets chat-actions-sheet`: 3 test files passed, 22 tests passed. The stderr text is the pre-existing `renderToStaticMarkup` DOM warnings from `topic-sheets-roles.test.tsx`, not failures.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot topic-actions-sheet` (re-run after the last mock edit): 1 file passed, 4 tests passed.
- `pnpm gate` from the repo root: `gate: 5 changed file(s) against main`; `PASS install (frozen) (2.3s)`, `PASS format (24.5s)`, `PASS lint (1.4s)`, `PASS typecheck (8.8s)`, `PASS tests @zilar/mobile (2.6s)`; scope `every changed file is inside the Allowed files`; ends with `GATE PASS`.

**Deviations**

- The header's `border-b border-divider` now comes from `ActionSheet`'s header wrapper, so the `header` node keeps `px-4 py-3` without its own border (avoids a double divider). Texts and labels are unchanged.
- Shared `ActionSheetItem` uses `py-3.5` and `active:bg-list-hover`; the mute rows were `py-3` and the old rows used `active:bg-surface-raised`. Same visual token (`list-hover`/`surface-raised` are both `#171717`) and the same accepted change T-0283 made for the chat sheet.
- With `canArchive` false the Archive row is now the last item, so the kit draws no divider after it (the old hand-rolled sheet always had one). This follows the kit's "divider between items, none after the last" rule.

**Open questions**

- None.

## Review (written by Claude)

Approved. Clean pre-review, no fix rounds.
- `TopicActionsSheet` is on the kit `ActionSheet`, and its lock icon uses the muted colour.
- "Open group" now has the `Users` icon, which fixes the QA run 10 finding.
- One nit accepted: the doc comment at `topic-sheets.tsx:26-31` still says "no hooks", which is stale. It gets fixed the next time this file is touched.
