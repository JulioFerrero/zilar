---
id: T-0263
title: "Web kit migration 3: TelegramImportDialog, NewAiDialog and NewGroupDialog render through the kit Dialog"
status: todo
milestone: M5
branch: task/T-0263-web-kit-dialogs-2
model: auto
effort: low
depends_on: [T-0258]
estimate: 0.3 day
---

# T-0263: three more dialogs on the kit Dialog

## Spec (written by Claude, do not edit)

### Why
This is audit step 6, batch 2. T-0258 moved four dialogs onto the kit `Dialog` (`apps/web/src/components/ui/dialog.tsx`). The kit has Escape handling (only the topmost dialog closes), a focus trap, focus return, `initialFocusRef`, a backdrop click to close, `size: 'sm' | 'md'` and an `actions` footer.

### Verified facts (do not re-derive)
- `apps/web/src/components/TelegramImportDialog.tsx` (332 lines): its own Escape at line 72 and `role="dialog"` at line 121. Per its doc comment (lines 16-17), it does not close on Escape or the backdrop while busy. Test: `apps/web/src/components/TelegramImportDialog.test.tsx`.
- `apps/web/src/components/ais/NewAiDialog.tsx` (351 lines): Escape at line 78, `role="dialog"` at line 169. Test: `apps/web/src/components/ais/NewAiDialog.test.tsx`.
- `apps/web/src/components/NewGroupDialog.tsx` (377 lines): Escape at line 39, `role="dialog"` at line 139. Test: `apps/web/src/components/NewGroupDialog.test.tsx`.

### What to build
1. Each of the three renders through the kit `Dialog`. Delete its own Escape handler, backdrop and panel markup, and keep every text, step, button and behaviour.
2. "Not while busy": pass an `onClose` that does nothing while busy, or add an optional kit prop `dismissable?: boolean` (default true) that blocks Escape and the backdrop. Add a kit test and a fixture case if you add the prop.
3. If a dialog needs to be wider than `max-w-md`, add `size: 'lg'` (`max-w-lg`) to the kit with a fixture case; do not hard-code widths in the callers.
4. Existing tests keep passing, changed only where they relied on the old markup. Each of the three has a test that Escape closes it (and, for Telegram import, one where Escape does not close it while busy).

### Read first
`AGENTS.md`, `apps/web/src/components/ui/dialog.tsx`, the three dialog files and their tests, and `work/T-0258-web-kit-dialogs-1.md` (Report) for how batch 1 was done.

### Allowed files
`apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/dialog.fixture.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `apps/web/src/components/TelegramImportDialog.tsx`, `apps/web/src/components/TelegramImportDialog.test.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/components/NewGroupDialog.test.tsx`, `work/T-0263-web-kit-dialogs-2.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot kit TelegramImportDialog NewAiDialog NewGroupDialog fixtures
pnpm gate
```

### Acceptance
- None of the three files contains `role="dialog"` or its own Escape handler. Behaviour and texts are unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
The remaining dialog files (`NewTopicDialog`, `FolderEditorDialog`, `AvatarUploader`, `GroupHandleRoute`, `NewChatButton`, `StickerPanel`, `ExplorePage`) and the side panels.

---

## Report (written by the worker when done)

## Review (written by Claude)
