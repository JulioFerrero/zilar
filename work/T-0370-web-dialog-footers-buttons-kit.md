---
id: T-0370
title: "Web kit: ConfirmDialog, New AI dialog and avatar uploader footer buttons use the kit Button"
status: todo
milestone: M5
branch: task/T-0370-web-dialog-footers-buttons-kit
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0370: dialog footer buttons on the kit

## Spec (written by Claude, do not edit)

### Why
`ConfirmDialog` is shared by five screens (FolderEditorDialog, TopicPanel, MessageBubble, ToolDetailPanel and StickersPage) and still hand-rolls its Cancel and solid red confirm. The New AI dialog and the avatar uploader mix hand-rolled Cancel and Remove buttons with kit ones.

### Verified facts (do not re-derive)
- **`apps/web/src/components/ui/button.tsx`:**
  - variants: `default`, `outline`, `ghost`, `destructive` (`bg-danger/10 text-danger`) and `link` (`text-primary underline-offset-4 hover:underline`);
  - sizes: `default` (h-8), `sm`, `lg` (h-9) and the icon sizes;
  - it takes `React.ComponentProps<'button'>` on React 19, so `ref` passes through as a prop.
- **`apps/web/src/components/ConfirmDialog.tsx`** (no `Button` import):
  - line 38: Cancel, with `ref={cancelRef}` (the dialog's `initialFocusRef`) and `onCancel`;
  - line 46: `{confirmLabel}`, `onConfirm`, solid `bg-danger … text-white` through `cn`.
- **`apps/web/src/components/ais/NewAiDialog.tsx`** (line 7 imports the kit `Button` re-exported by `./AiPageShell`, `AiPageShell.tsx:1,98`):
  - line 169: Cancel (`onClose`);
  - line 177: a kit `<Button>` "Create" with the override `className="rounded-full px-4 py-1.5 text-[15px]"`.
- **`apps/web/src/components/AvatarUploader.tsx`** (`Button` at line 3):
  - line 284: "Remove" or "Removing…" (`disabled={busy}`, `rounded-full border border-border`);
  - line 314: "Dismiss" inside the error `<p>` (`underline hover:no-underline`);
  - line 332: Cancel (`closeCrop`, `disabled={busy}`), next to a kit `<Button>` Save at line ~340.

### What to build
1. **ConfirmDialog:**
   - Cancel → `<Button ref={cancelRef} type="button" variant="ghost" size="lg">`;
   - confirm → `<Button type="button" variant="destructive" size="lg">`.
   - Drop `cn` if it becomes unused.
2. **NewAiDialog:**
   - Cancel → `<Button type="button" variant="ghost" size="lg">`;
   - Create → `size="lg"`, dropping the `className` override.
   - Keep the existing `Button` import.
3. **AvatarUploader:**
   - Remove → `variant="outline"`;
   - Dismiss → `variant="link" size="sm"` with `className="h-auto px-0 text-inherit"` so it stays inline in the sentence;
   - Cancel → `variant="ghost"`.
4. Keep every text, `disabled`, `ref` and handler.

### Tests
`apps/web/src/components/ConfirmDialog.test.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx` and `apps/web/src/components/AvatarUploader.test.tsx` find buttons by role and name. ConfirmDialog's test may check that Cancel gets the initial focus, so keep the `ref`.

### Read first
`AGENTS.md`, `apps/web/src/components/ui/button.tsx` and the three files.

### Allowed files
`apps/web/src/components/ConfirmDialog.tsx`, `apps/web/src/components/ais/NewAiDialog.tsx`, `apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/ConfirmDialog.test.tsx`, `apps/web/src/components/ais/NewAiDialog.test.tsx`, `apps/web/src/components/AvatarUploader.test.tsx`, `work/T-0370-web-dialog-footers-buttons-kit.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot ConfirmDialog NewAiDialog AvatarUploader
pnpm gate
```

### Acceptance
- No hand-rolled `<button` in `ConfirmDialog.tsx` or `AvatarUploader.tsx`.
- `NewAiDialog.tsx` keeps only the template radio chips and "More options".
- Tests pass.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
